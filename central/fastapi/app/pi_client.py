import socketio, asyncio
from datetime import datetime
from eth_utils import to_bytes
from web3 import Web3
import app.state as state
from .socket.sio_instance import sio
from .config import BASE_RPC_HTTP, CLAW_ADDRESS, PI_SERVER_URL, INTER_TURN_DELAY, PRIVATE_KEY, CHAIN_ID
from .abi import claw_abi
from .logging import log
from sqlalchemy import select, func
from .deps import async_session
from .models import QueueEntry

pi_client = socketio.AsyncClient()

async def connect_pi():
    while True:
        try:
            await pi_client.connect(PI_SERVER_URL)
            log.info("Pi socket connected")
            break
        except Exception as e:
            log.warning("Pi connect error: %s", e)
            await asyncio.sleep(5)
            
           
_turn_lock = asyncio.Lock()   # serialize turn transitions
 
@pi_client.on("turn_end")
async def turn_end(*_):
  log.info("Pi informed turn end")
  async with _turn_lock:         # prevent overlapping turn transitions
    async with async_session() as db:
      entry = await db.scalar(
          select(QueueEntry)
          .where(QueueEntry.status == "active")
          .where(QueueEntry.address == state.current_player)
      )
      if not entry:
          state.current_key = None
          state.current_player = None
          log.info("No pending turn")
          return
      
      entry.ended_at = datetime.utcnow()
      entry.status = "played"
      await db.commit()
     
      await sio.emit("turn_end")
      await asyncio.sleep(INTER_TURN_DELAY)
    
      entry = await db.scalar(
          select(QueueEntry)
          .where(QueueEntry.status == "queued")
          .order_by(QueueEntry.created_at.asc())
      )
      if not entry:
          state.current_player = None
          state.current_key = None
          return
  
      entry.status = "active"
      state.current_player = entry.address
      state.current_key = entry.key
      state.last_start = datetime.utcnow()
      log.info(f"Started turn {state.current_key} by player {state.current_player} from turn_end callback")
      await db.commit()
      
      await sio.emit("turn_start")
      # await sio.emit("your_turn", room=entry.address)
      await pi_client.emit("turn_start")
  
      entry.played_at = datetime.utcnow()
      await db.commit()
    
  
@pi_client.on("prize_won")
async def on_turn_win(*_):
        
    key_str = state.current_key
    if not key_str:
        return
    
    bet_key = to_bytes(hexstr=key_str.replace("\\x", ""))
    
    log.info(f"Pi emitted player win. Player: {state.current_player}. Turn key: {bet_key}")
    await sio.emit("player_win")
    
    w3 = Web3(Web3.HTTPProvider(BASE_RPC_HTTP))
    contract = w3.eth.contract(address=CLAW_ADDRESS, abi=claw_abi)
    owner = w3.eth.account.from_key(PRIVATE_KEY).address

    # build transaction
    txn = contract.functions.notifyWin(bet_key).build_transaction({
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
    log.info("Pi socket CONNECTED (reconnect OK)")
    log.info(f"Connected namespaces: {pi_client.namespaces}")


@pi_client.event
async def disconnect():
    log.warning("Pi socket DISCONNECTED – will retry...")


# optional: log each attempt
@pi_client.event
async def reconnect():
    log.warning("Reconnecting to Pi...")
