import socketio, asyncio
from datetime import datetime
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
from .models import QueueEntry

pi_client = socketio.AsyncClient(engineio_logger=True)
# log.info(f"[pi_client create] PID={os.getpid()} TID={threading.get_ident()} pi_client_id={id(pi_client)}")

async def connect_pi():
    while True:
        try:
            # log.info(f"[pi connect] PID={os.getpid()} pi_client_id={id(pi_client)} namespaces={pi_client.namespaces}")
            await pi_client.connect(PI_SERVER_URL, transports=['websocket'])
            break
        except Exception as e:
            log.warning("Pi connect error: %s", e)
            await asyncio.sleep(5)
            
           
_turn_lock = asyncio.Lock()   # serialize turn transitions

async def safe_pi_emit(event, data=None):
    """
    Emit to the Pi client only when the connection is healthy.
    Returns True on success, False otherwise.
    """
    # log.info(f"[{event}] PID={os.getpid()} pi_client_id={id(pi_client)} connected={state.pi_connected} ns_ok={state.pi_namespace_ok}")

    if state.pi_connected and state.pi_namespace_ok:
        try:
            await pi_client.emit(event, data=data)
            return True
        except Exception as e:
            log.warning("pi_client emit failed: %s", e)
    log.warning(f"pi_client emit failed due to connectivity issues. Connected: {state.pi_connected}. Namespace ok: {state.pi_namespace_ok}")
    return False

 
@pi_client.on("turn_end")
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
    
  
@pi_client.on("prize_won")
async def on_turn_win(*_):
        
    key_str = state.current_key
    if not key_str:
        return
    
    key_bytes = bytes.fromhex(key_str)
    
    log.info(f"Pi emitted player win. Player: {state.current_player}. Turn key: 0x{key_str}")
    await sio.emit("player_win")
    
    w3 = Web3(Web3.HTTPProvider(BASE_RPC_HTTP))
    contract = w3.eth.contract(address=CLAW_ADDRESS, abi=claw_abi)
    owner = w3.eth.account.from_key(PRIVATE_KEY).address

    # build transaction
    txn = contract.functions.notifyWin(key_bytes).build_transaction({
        "from": owner,
        "nonce": w3.eth.get_transaction_count(owner, 'pending'),
        "chainId": CHAIN_ID,
    })
    
    # sign and send
    signed = w3.eth.account.sign_transaction(txn, private_key=PRIVATE_KEY)
    tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
    
    # check result
    if receipt.status == 1:
        log.info(f"Win on {state.current_key} successfully notified!")
    else:
        log.info(f"Win notification transaction on turn {state.current_key} failed.")
    
    
@pi_client.event
async def connect():
    ns_ok = "/" in pi_client.namespaces
    state.set_pi_status(True, ns_ok)
    await sio.emit("claw_connection_change", {"con": ns_ok})
    log.info("Pi socket CONNECTED (reconnect OK)")
    log.info(f"Connected namespaces: {pi_client.namespaces}")
    

@pi_client.event
async def connect_error(data):
    state.set_pi_status(False, False)
    await sio.emit("claw_connection_change", {"con": False})
    log.warning(f"Pi socket CONNECTION FAILED because of: {data}")


@pi_client.event
async def disconnect(reason):
    state.set_pi_status(False, False)
    await sio.emit("claw_connection_change", {"con": False})
    log.warning(f"Pi socket DISCONNECTED because of: {reason} – will retry...")
