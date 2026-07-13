# import socketio, asyncio, websockets, json
from datetime import datetime
from typing import Optional
from eth_utils import to_bytes
import os, threading
from web3 import Web3
import app.state as state
from .socket.sio_instance import sio
from .config import BASE_RPC_HTTP, CLAW_ADDRESS, PI_SERVER_URL, INTER_TURN_DELAY, PRIVATE_KEY, CHAIN_ID, BYPASS_PAYMENT
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
                elif message_type == "verdict":
                    asyncio.create_task(on_chute_verdict(data.get("data") or {}))
                elif message_type == "fault":
                    asyncio.create_task(on_pi_fault(data.get("data") or {}))
                elif message_type == "tag_scanned":
                    on_tag_scanned(data.get("data") or {})
                elif message_type == "enroll_timeout":
                    on_enroll_timeout()
                elif message_type == "test_result":
                    on_test_result(data.get("data") or {})
                elif message_type == "esp_status":
                    on_esp_status(data.get("data") or {})
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

 
_test_future: Optional[asyncio.Future] = None


async def request_test_arm(timeout: float = 20.0) -> dict:
    """Trigger a chute drop-test on the Pi and await its verdict. Diagnostic
    only — the Pi runs the real ESP sequence but reports via `test_result`, so
    no Win is created."""
    global _test_future
    if not state.pi_connected:
        raise RuntimeError("cabinet offline")
    _test_future = asyncio.get_event_loop().create_future()
    ok = await safe_pi_emit("test_arm")
    if not ok:
        _test_future = None
        raise RuntimeError("cabinet offline")
    try:
        return await asyncio.wait_for(_test_future, timeout)
    except asyncio.TimeoutError:
        raise RuntimeError("no test_result from the Pi within the window")
    finally:
        _test_future = None


def on_esp_status(data: Optional[dict] = None):
    """Authoritative chute-latch sync sent by the Pi on every (re)connect, so
    the central mirror is correct even when the latch predates the connection
    (the bug where a latch arrived via the ESP `ready` frame and central's
    `cabinet_fault` stayed None). Sets or clears the mirror to match the ESP."""
    kind = (data or {}).get("latched_fault")
    state.cabinet_fault = {"kind": kind, "reason": "latched"} if kind else None
    log.info("ESP status sync: latched_fault=%s", kind)


def on_test_result(data: Optional[dict] = None):
    global _test_future
    if _test_future is not None and not _test_future.done():
        _test_future.set_result(data or {})
    else:
        log.info("test_result with no pending request: %s", data)


# Set by on_chute_verdict; awaited by turn_end. This is what makes the dead time
# between turns *the chute sequence* rather than a fixed guess.
_verdict_ready = asyncio.Event()

# Ceiling on the verification window. Must exceed the Pi's ESP_VERDICT_TIMEOUT
# (15s) so the Pi gets to report an internal_error itself before we give up.
VERDICT_GRACE = 20.0

# outcome -> (player won?, chute still usable?)
_VERDICT_TABLE = {
    "no_fall": (False, True),    # nothing fell — ordinary loss
    "no_read": (False, False),   # fell, tag unreadable — we can't say what it was
    "no_exit": (True,  False),   # read, then jammed — we DO know what they won
    "ok":      (True,  True),
}

# outcome -> the fault kind the operator sees
_VERDICT_FAULT = {"no_read": "rfid_failed", "no_exit": "exit_timeout"}


async def on_chute_verdict(data: Optional[dict] = None):
    """The chute's single verdict for the turn that just ended.

    One message answers both questions: did the player win, and can we keep
    playing. Notably `no_exit` is both — the chute is jammed AND the tag was
    read, so the queue stops but the player still learns what they won.
    """
    data = data or {}
    outcome = data.get("outcome")
    ball_serial = data.get("ball_serial")

    key_str = state.awaiting_verdict_key
    winner = state.awaiting_verdict_player
    state.awaiting_verdict_key = None
    state.awaiting_verdict_player = None

    won, healthy = _VERDICT_TABLE.get(outcome, (False, False))
    log.info("Chute verdict %s (ball=%s) for %s — won=%s healthy=%s",
             outcome, ball_serial, winner, won, healthy)

    try:
        if not key_str:
            log.info("Verdict with no turn awaiting it — ignoring")
            return

        if won and ball_serial:
            await _record_win(key_str, winner, ball_serial)
        else:
            # A loss is now REPORTED, not inferred from a timeout downstream.
            await sio.emit(
                "turn_result",
                {"won": False, "outcome": outcome},
                room=winner,
            )

        if not healthy:
            kind = _VERDICT_FAULT.get(outcome, "internal_error")
            state.cabinet_fault = {"kind": kind, "reason": outcome}
            await sio.emit("cabinet_fault", state.cabinet_fault)
            log.warning("Chute blocked (%s) — queue paused until operator clears it", kind)
    finally:
        # Always release turn_end, even if handling blew up — otherwise the
        # machine would hang for the full grace period.
        _verdict_ready.set()


async def _start_next_turn():
    """Hand the machine to the next player in the queue, if there is one."""
    async with async_session() as db:
        new_entry = await db.scalar(
            select(QueueEntry)
            .where(QueueEntry.status == "queued")
            .order_by(QueueEntry.created_at.asc())
        )
        if not new_entry:
            log.info("No pending turn")
            return

        new_entry.status = "active"
        await db.commit()

        state.current_player = new_entry.address
        state.current_key = new_entry.key
        state.last_start = datetime.utcnow()

        await sio.emit("turn_start")
        await safe_pi_emit("turn_start")

        new_entry.played_at = datetime.utcnow()
        await db.commit()
        log.info(f"Started turn {state.current_key} by player {state.current_player}")


async def turn_end(*_):
  """The claw let go. The turn is over, but the OUTCOME is not known yet.

  The Pi broadcasts turn_end the moment the ball passes the opto, and only then
  arms the chute. So this is the start of the verification window, not the end
  of the play: we must not hand the machine to the next player until the chute
  has reported, or its verdict would land mid-turn and be credited to the wrong
  person (and a jammed chute would swallow the next ball too).

  So the dead time IS the chute sequence — we wait for the verdict, then decide
  whether the machine is fit to keep going.
  """
  log.info("Pi informed turn end")

  # The verdict belongs to THIS turn. Stash its identity before current_* is
  # reassigned; on_chute_verdict consumes it.
  state.awaiting_verdict_key = state.current_key
  state.awaiting_verdict_player = state.current_player
  _verdict_ready.clear()

  async with _turn_lock:         # prevent overlapping turn transitions
    async with async_session() as db:
      old_entry = await db.scalar(
          select(QueueEntry)
          .where(QueueEntry.status == "active")
          .where(QueueEntry.address == state.current_player)
      )
      if not old_entry:
          log.warning("turn_end reported by pi but no player was active. Maybe someone is playing live.")
      else:
          old_entry.ended_at = datetime.utcnow()
          old_entry.status = "played"
          await db.commit()

    # Clients update the queue; the player who just played sees "analysing…"
    # until the verdict resolves it.
    await sio.emit("turn_end")

    # --- the verification window ---
    try:
        await asyncio.wait_for(_verdict_ready.wait(), timeout=VERDICT_GRACE)
    except asyncio.TimeoutError:
        # The Pi should have sent an internal_error fault by now; if we're here
        # the cabinet is silent. Treat as unsafe rather than blindly continuing.
        log.warning("No chute verdict within %ss — pausing the queue", VERDICT_GRACE)
        if not state.cabinet_fault:
            state.cabinet_fault = {"kind": "internal_error", "reason": "verdict_timeout"}
            await sio.emit("cabinet_fault", state.cabinet_fault)

    state.current_player = None
    state.current_key = None

    # A blocked chute must not be handed another ball. The queue stays paused
    # until an operator clears the fault (admin /cabinet/clear_fault), which is
    # also what the turn scheduler now honours.
    if state.cabinet_fault:
        log.warning("Cabinet faulted (%s) — queue paused", state.cabinet_fault)
        return

    # Brief settle so the player sees the result before the next turn begins.
    await asyncio.sleep(INTER_TURN_DELAY)
    await _start_next_turn()


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
    # Mirror the latch for the admin ops page. `still_blocked` is a re-emit on
    # arm while already latched, so it doesn't change the stored kind.
    if reason != "still_blocked":
        state.cabinet_fault = {"kind": kind, "reason": reason}
    if state.current_player:
        await sio.emit("cabinet_fault", data, room=state.current_player)


def on_tag_scanned(data: Optional[dict] = None):
    """Pi-forwarded ESP `tag_scanned` — drop the UID into state.enroll_pending
    so the admin status endpoint can return it. Silently no-ops if no enroll
    is pending (e.g., a stale event after timeout)."""
    data = data or {}
    serial = data.get("ball_serial")
    if not serial:
        log.warning("tag_scanned with no ball_serial; ignoring")
        return
    if not state.enroll_pending:
        log.info("tag_scanned but no enrollment pending; ignoring (%s)", serial)
        return
    state.enroll_pending["scanned_ball_serial"] = serial
    log.info("Enrollment scan recorded: %s", serial)


def on_enroll_timeout():
    if not state.enroll_pending:
        return
    state.enroll_pending["timed_out"] = True
    log.info("Enrollment timed out")


async def _record_win(key_str: str, winner: Optional[str], ball_serial: str):
    """Credit a won prize to the turn that produced it.

    Called only from on_chute_verdict, which owns attribution — the key/winner
    are the turn that fired the arm, not whoever is playing now.
    """
    log.info(f"Prize won by {winner}. Turn key: 0x{key_str}. Ball: {ball_serial}")

    # Mark the win off-chain. This replaces the old on-chain round-trip
    # (notifyWin -> PlayerWin event -> listeners._player_win set entry.win):
    # the contract is retired, so the backend is the source of truth.
    async with async_session() as db:
        entry = await db.scalar(select(QueueEntry).where(QueueEntry.key == key_str))
        if entry is None:
            log.warning("_record_win: no QueueEntry for key %s — cannot mark win", key_str)
        else:
            entry.win = True
            await db.commit()
    entry_id = entry.id if entry is not None else None

    # Reserve the actual prize in its own session so a reserve_win failure
    # (ball not available / pool exhausted) can't roll back the win mark.
    win_payload: Optional[dict] = None
    if entry_id is not None and ball_serial and winner:
        try:
            async with async_session() as db:
                win = await wt.reserve_win(
                    db,
                    ball_serial=ball_serial,
                    wallet_address=winner,
                    queue_entry_id=entry_id,
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
            log.warning("_record_win: ball not available: %s", e)
        except wt.PoolExhausted as e:
            # Should be unreachable: a turn must not start while any loaded ball
            # has an unclaimable prize. If we're here, that invariant is broken.
            # TODO: refund the ticket (LedgerKind.BET_REFUND) and alert the operator.
            log.error("_record_win: pool exhausted: %s", e)
        except Exception:
            log.exception("_record_win: reserve_win failed")

    if win_payload:
        # Targeted to the player's room (set up at wallet_connected).
        await sio.emit("player_win", win_payload, room=winner)
    else:
        # The ball dropped and we read its tag, but we could not hand over a
        # prize. Never announce this as a win: emitting `player_win` with a null
        # payload made the UI celebrate — confetti and "🎉 You won!" — while
        # giving the player nothing. Report it as the failure it is.
        log.error(
            "No prize for a winning grab (ball=%s, player=%s) — player owed a refund",
            ball_serial, winner,
        )
        await sio.emit(
            "turn_result",
            {"won": False, "outcome": "prize_unavailable"},
            room=winner,
        )
    
    
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
