# import socketio, asyncio, websockets, json
from datetime import datetime
from typing import Optional
from eth_utils import to_bytes
import os, threading
from web3 import Web3
import app.state as state
from .socket.sio_instance import sio
from .config import BASE_RPC_HTTP, CLAW_ADDRESS, PI_SERVER_URL, INTER_TURN_DELAY, PRIVATE_KEY, CHAIN_ID
from .abi import claw_abi
from .logging import log
from sqlalchemy import select, func
from .deps import async_session
from .models import QueueEntry, PrizeKind
from . import win_transitions as wt
import asyncio, websockets, json

PI_WEBSOCKET_URL = PI_SERVER_URL.replace('http://', 'ws://').replace('https://', 'wss://')

pi_websocket = None
# log.info(f"[pi_client create] PID={os.getpid()} TID={threading.get_ident()} pi_client_id={id(pi_client)}")

# Connection event handlers (equivalent to socketio decorators)
async def on_connect():
    """Called when WebSocket connects successfully"""
    state.set_pi_status(True)
    await sio.emit("claw_connection_change", {"con": True})
    log.info("Pi socket CONNECTED (reconnect OK)")

async def on_connect_error(error_data):
    """Called when WebSocket connection fails"""
    state.set_pi_status(False)
    await sio.emit("claw_connection_change", {"con": False})
    log.warning(f"Pi socket CONNECTION FAILED because of: {error_data}")

async def on_disconnect(reason):
    """Called when WebSocket disconnects"""
    state.set_pi_status(False)
    await sio.emit("claw_connection_change", {"con": False})
    log.warning(f"Pi socket DISCONNECTED because of: {reason} – will retry...")

async def _attempt_connection():
    """Single connection attempt"""
    global pi_websocket
    
    # log.info(f"[pi connect] PID={os.getpid()} pi_client_id={id(pi_websocket)}")
    pi_websocket = await websockets.connect(PI_WEBSOCKET_URL)
    

async def handle_pi_messages():
    """Handle incoming messages from Pi WebSocket"""
    global pi_websocket
    try:
        while True:  # Keep listening indefinitely
            message = await pi_websocket.recv()  # This blocks until message received
            try:
                data = json.loads(message)
                message_type = data.get("type")
                log.info(f"Received message type: {message_type}")
                
                if message_type == "turn_end":
                    asyncio.create_task(turn_end())
                elif message_type == "prize_won":
                    asyncio.create_task(on_turn_win(data.get("data") or {}))
                elif message_type == "fault":
                    asyncio.create_task(on_pi_fault(data.get("data") or {}))
                else:
                    log.warning(f"Unknown message type from Pi: {message_type}")
                    
            except json.JSONDecodeError:
                log.warning(f"Invalid JSON from Pi: {message}")
                
    except websockets.exceptions.ConnectionClosed as e:
        await on_disconnect(f"Connection closed: {e}")
        raise  # Re-raise to trigger reconnect
    except Exception as e:
        await on_disconnect(f"Handler error: {e}")
        raise  # Re-raise to trigger reconnect
    
async def connect_pi():
    """Main connection loop that handles reconnects"""
    global pi_websocket
    
    while True:
        try:
            await _attempt_connection()
            # If we get here, connection was successful
            await on_connect()
            
            # Handle messages until connection drops - this blocks here
            await handle_pi_messages()
            
        except Exception as e:
            await on_connect_error(str(e))
            log.warning("Pi connect error: %s", e)
            pi_websocket = None
            await asyncio.sleep(5)  # Wait before retry
    
           
_turn_lock = asyncio.Lock()   # serialize turn transitions

async def safe_pi_emit(event, data=None):
    """
    Emit to the Pi client only when the connection is healthy.
    Returns True on success, False otherwise.
    """
    # log.info(f"[{event}] PID={os.getpid()} pi_client_id={id(pi_client)} connected={state.pi_connected} ns_ok={state.pi_namespace_ok}")

    if state.pi_connected:
        try:
            await pi_websocket.send(json.dumps({"type": event, "data": data}))
            return True
        except Exception as e:
            log.warning("pi_websocket emit failed: %s", e)
    log.warning(f"pi_websocket emit failed due to connectivity issues. Connected: {state.pi_connected}.")
    return False

 
async def turn_end(*_):
  log.info("Pi informed turn end")
  async with _turn_lock:         # prevent overlapping turn transitions
    async with async_session() as db:
      old_entry = await db.scalar(
          select(QueueEntry)
          .where(QueueEntry.status == "active")
          .where(QueueEntry.address == state.current_player)
      ) 
      
      new_entry = await db.scalar(
          select(QueueEntry)
          .where(QueueEntry.status == "queued")
          .order_by(QueueEntry.created_at.asc())
      )
      
      if not old_entry:
          state.current_key = None
          state.current_player = None
          log.warning("This should not happen, turn ended reported by pi and no player was playing. Maybe someone is playing live.")
      else:
          old_entry.ended_at = datetime.utcnow()
          old_entry.status = "played"
          await db.commit()
   
      if not new_entry:
          await sio.emit("turn_end")
          await asyncio.sleep(INTER_TURN_DELAY)
          state.current_player = None
          state.current_key = None
          log.info("No pending turn")
          return
  
      new_entry.status = "active"
      await db.commit()
      await sio.emit("turn_end")
      
      await asyncio.sleep(INTER_TURN_DELAY)
      state.current_player = new_entry.address
      state.current_key = new_entry.key
      state.last_start = datetime.utcnow()
       
      await sio.emit("turn_start")
      await safe_pi_emit("turn_start")
      new_entry.played_at = datetime.utcnow()
      await db.commit()
      log.info(f"Started turn {state.current_key} by player {state.current_player} from turn_end callback")
    
  
async def on_pi_fault(data: Optional[dict] = None):
    """Handler for Pi's `fault` message (forwarded from the chute ESP32).

    Wire shape: {"kind": "rfid_failed" | "exit_timeout" | "internal_error",
                 "reason"?: "still_blocked" | "esp_timeout" | "esp_reset"}.

    Before the ESP32 split + this handler, chute faults were dropped on
    the floor (logged as "Unknown message type"), so the frontend would
    silently fall through to "Better luck next time" even though the
    cabinet was physically latched. Now:

    - Operators get a logged signal.
    - The current player's room gets a `cabinet_fault` event so the
      frontend can surface "we're sorting this out" instead of a fake loss.

    Note: this does NOT settle anything on-chain. The operator path
    (void_ball + ledger refund) still happens out-of-band.
    """
    data = data or {}
    kind = data.get("kind") or "unknown"
    reason = data.get("reason")
    log.warning("Pi reported cabinet fault: kind=%s reason=%s", kind, reason)
    if state.current_player:
        await sio.emit("cabinet_fault", data, room=state.current_player)


async def on_turn_win(data: Optional[dict] = None):
    """Handler for Pi's `prize_won` message.

    Expected payload (from the RFID reader on the claw):
        { "ball_serial": "<unique ball id>", ... }

    The ball_serial is required to look up the bound prize and create a
    Win row via win_transitions.reserve_win. If the Pi sends nothing (the
    legacy contract), we fall back to the old behaviour: emit player_win
    and notify the chain, but no Win row is created. Once Pi firmware is
    updated to include ball_serial, this fallback can be removed.
    """
    data = data or {}
    ball_serial = data.get("ball_serial")

    key_str = state.current_key
    if not key_str:
        log.info("No current key, win is not from game")
        return

    key_bytes = bytes.fromhex(key_str)
    log.info(f"Pi emitted player win. Player: {state.current_player}. Turn key: 0x{key_str}. Ball: {ball_serial}")

    win_payload: Optional[dict] = None
    if ball_serial and state.current_player:
        try:
            async with async_session() as db:
                entry = await db.scalar(
                    select(QueueEntry).where(QueueEntry.key == key_str)
                )
                if entry is None:
                    log.warning("on_turn_win: no QueueEntry for key %s — skipping reserve_win", key_str)
                else:
                    win = await wt.reserve_win(
                        db,
                        ball_serial=ball_serial,
                        wallet_address=state.current_player,
                        queue_entry_id=entry.id,
                    )
                    await db.commit()
                    win_payload = {
                        "win_id": str(win.id),
                        "prize_kind": win.prize_kind.value,
                        "expires_at": int(win.expires_at.timestamp()),
                        "resell_price_cents": win.resell_price_cents,
                    }
                    log.info(f"reserve_win OK: win_id={win.id} prize_kind={win.prize_kind.value}")
        except wt.BallNotAvailable as e:
            log.warning("on_turn_win: ball not available: %s", e)
        except wt.PoolExhausted as e:
            # The bet was placed but no inventory remains. The user still
            # needs to be made whole — refund handling lives in the bet
            # flow / chain settlement, not here. TODO: emit a refund event.
            log.error("on_turn_win: pool exhausted: %s", e)
        except Exception:
            log.exception("on_turn_win: reserve_win failed")

    # Notify the winning client. Payload is optional; old listeners ignore
    # extra fields. Targeted to the player's room (set up at wallet_connected).
    await sio.emit("player_win", win_payload, room=state.current_player)

    # Existing on-chain notification — settles the win on the contract.
    w3 = Web3(Web3.HTTPProvider(BASE_RPC_HTTP))
    contract = w3.eth.contract(address=CLAW_ADDRESS, abi=claw_abi)
    owner = w3.eth.account.from_key(PRIVATE_KEY).address

    txn = contract.functions.notifyWin(key_bytes).build_transaction({
        "from": owner,
        "nonce": w3.eth.get_transaction_count(owner, 'pending'),
        "chainId": CHAIN_ID,
    })

    signed = w3.eth.account.sign_transaction(txn, private_key=PRIVATE_KEY)
    tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash)

    if receipt.status == 1:
        log.info(f"Win on {state.current_key} successfully notified!")
    else:
        log.info(f"Win notification transaction on turn {state.current_key} failed.")
    
    
# @pi_client.event
# async def connect():
#     ns_ok = "/" in pi_client.namespaces
#     state.set_pi_status(True, ns_ok)
#     await sio.emit("claw_connection_change", {"con": ns_ok})
#     log.info("Pi socket CONNECTED (reconnect OK)")
#     log.info(f"Connected namespaces: {pi_client.namespaces}")
    

# @pi_client.event
# async def connect_error(data):
#     state.set_pi_status(False, False)
#     await sio.emit("claw_connection_change", {"con": False})
#     log.warning(f"Pi socket CONNECTION FAILED because of: {data}")


# @pi_client.event
# async def disconnect(reason):
#     state.set_pi_status(False, False)
#     await sio.emit("claw_connection_change", {"con": False})
#     log.warning(f"Pi socket DISCONNECTED because of: {reason} – will retry...")
