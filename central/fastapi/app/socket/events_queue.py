import asyncio

from sqlalchemy import select, func
from web3 import Web3
from datetime import datetime

from ..config import BASE_RPC_HTTP, CLAW_ADDRESS, PRIVATE_KEY, CHAIN_ID
from ..abi import claw_abi
from ..models import QueueEntry, Round, Withrawal
from ..deps import async_session
from .sio_instance import sio
from ..state import sid_to_addr, current_player
from ..helpers import safe_place_bet
from ..logging import log

@sio.on("wallet_connected")
async def wallet_connected(sid, data):
    addr = data["address"]
    sid_to_addr[sid] = addr
    await sio.enter_room(sid, addr)
    log.info(f"Player {addr} joined")
    
    async with async_session() as db:
        round_ = await db.scalar(select(Round).order_by(Round.created_at.desc()))
        played = await db.scalar(
            select(func.count())
              .select_from(QueueEntry)
              .where(QueueEntry.status == "played")
              .where(QueueEntry.address == addr)
              .where(QueueEntry.round_id == round_.id)
        )
        won = await db.scalar(
            select(func.count())
              .select_from(QueueEntry)
              .where(QueueEntry.status == "played")
              .where(QueueEntry.address == addr)
              .where(QueueEntry.round_id == round_.id)
              .where(QueueEntry.win == True)
        )
        
        user_entry = await db.scalar(
            select(QueueEntry)
            .where(QueueEntry.status == "queued", QueueEntry.address == addr)
        )
    
        if user_entry:
            position = await db.scalar(
                select(func.count())
                .select_from(QueueEntry)
                .where(
                    QueueEntry.status == "queued",
                    QueueEntry.created_at < user_entry.created_at
                )
            ) + 1
        else:
            position = -1

    w3 = Web3(Web3.HTTPProvider(BASE_RPC_HTTP))
    balance = w3.eth.contract(address=CLAW_ADDRESS, abi=claw_abi)\
                      .functions.getTotalBalance(addr).call()
                      
    return {"status": "ok", "data": {"position": position, "balance": balance, "played": played, "won": won}}


@sio.on("wallet_disconnected")
async def wallet_disconnected(sid, data):
    old_address = sid_to_addr.get(sid)
    if old_address:
        await sio.leave_room(sid, old_address)
    sid_to_addr[sid] = None
    
    
@sio.on("withdraw")
async def withdraw(sid, data=None):
    addr = sid_to_addr[sid]
    log.info(f"Player {addr} is issuing a withdrawal of funds")
    try:
        w3 = Web3(Web3.HTTPProvider(BASE_RPC_HTTP))
        contract = w3.eth.contract(address=CLAW_ADDRESS, abi=claw_abi)
        owner = w3.eth.account.from_key(PRIVATE_KEY).address

        # build transaction
        txn = contract.functions.withdrawFull(addr).build_transaction({
            "from": owner,
            "nonce": w3.eth.get_transaction_count(owner, 'pending'),
            "chainId": CHAIN_ID,
        })
        
        # sign and send
        signed = w3.eth.account.sign_transaction(txn, private_key=PRIVATE_KEY)
        tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
        receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
        logs = contract.events.FullWithrawal().process_receipt(receipt)

        if not logs:
            raise RuntimeError("No Withdraw event found!")
        
        withdrawn = logs[0]["args"]["amount"]
        log.info(f"Total withdrawn: {withdrawn}")
        
        async with async_session() as db:
          db.add(Withrawal(address=addr, amount=withdrawn, timestamp=datetime.utcnow()))
          await db.commit()
        
        return {"status": "ok", "data": {"withdrawn": withdrawn}}
    except Exception as e:
        log.warning(f"Could not withdraw funds: {e}")
        return {"status": "error", "error": f"{e}"}
        

@sio.on("ckeck_balance")
async def check_balance(sid, data):
    addr = sid_to_addr[sid]

    w3 = Web3(Web3.HTTPProvider(BASE_RPC_HTTP))
    try:
        balance = w3.eth.contract(address=CLAW_ADDRESS, abi=claw_abi)\
                      .functions.getTotalBalance(addr).call()
        return {"status": "ok", "balance": balance}       
    except:
        return {"status": "error", "balance": -1}


@sio.on("join_queue")
async def join_queue(sid, data):
    addr = sid_to_addr[sid]
    amount, deadline, signature = data["amount"], data["deadline"], data["signature"]
    log.info("amount: %d, signature %s" % (amount, signature))

    async with async_session() as db:
        round_ = await db.scalar(select(Round).order_by(Round.created_at.desc()))
        in_queue = await db.scalar(
            select(QueueEntry)
            .where(QueueEntry.round_id == round_.id)
            .where(QueueEntry.address == addr)
            .where(QueueEntry.status.in_(["queued", "active"]))
        )
        if in_queue:
            log.warning("Rejected player %s for double entry" % addr)
            return {"status": "error", "position": -1, "error": "user already in queue"}

        # on-chain
        loop = asyncio.get_running_loop()
        ok, key = await safe_place_bet(loop, addr, amount, deadline, signature)
        if not ok:
            log.warning("Rejected entry by %s because bet placing threw an error" % addr)
            return {"status": "error", "position": -1, "error": "unexpected error while placing bet"}

        db.add(QueueEntry(address=addr, round_id=round_.id, key=key.hex()))
        await db.commit()

        qcount = await db.scalar(
            select(func.count()).select_from(QueueEntry).where(QueueEntry.status == "queued")
        )
    await sio.emit("player_queued")
    return {"status": "ok", "position": qcount}
