import asyncio

from sqlalchemy import select, func
from web3 import Web3

from ..config import BASE_RPC_HTTP, CLAW_ADDRESS
from ..abi import claw_abi
from ..models import QueueEntry, Round
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
    
    async with async_session() as db:
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
    
    return {"status": "ok", "data": {"position": position, "balance": balance}}


@sio.on("wallet_disconnected")
async def wallet_disconnected(sid, data):
    old_address = sid_to_addr.get(sid)
    if old_address:
        await sio.leave_room(sid, old_address)
    sid_to_addr[sid] = None
    
    
@sio.on("withdraw")
async def withdraw(sid, data):
    addr = sid_to_addr[sid]
    
    w3 = Web3(Web3.HTTPProvider(BASE_RPC_HTTP))
    try:
        withdrawn = w3.eth.contract(address=CLAW_ADDRESS, abi=claw_abi)\
                      .functions.withdrawFull(addr).call()
        
        return {"status": "ok", "data": {"withdrawn": withdrawn}}
    except:
        return {"status": "error"}
    

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
            return {"status": "error", "position": -1}

        # on-chain
        loop = asyncio.get_running_loop()
        ok, key = await safe_place_bet(loop, addr, amount, deadline, signature)
        if not ok:
            return {"status": "error", "position": -1}

        db.add(QueueEntry(address=addr, round_id=round_.id, key=key))
        await db.commit()

        qcount = await db.scalar(
            select(func.count()).select_from(QueueEntry).where(QueueEntry.status == "queued")
        )
    await sio.emit("player_queued")
    return {"status": "ok", "position": qcount}
