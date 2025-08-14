import asyncio

from sqlalchemy import select, func
from web3 import Web3
from datetime import datetime

from ..config import BASE_RPC_HTTP, CLAW_ADDRESS, PRIVATE_KEY, CHAIN_ID
from ..abi import claw_abi
from ..models import QueueEntry, Round, Withdrawal
from ..deps import async_session
from .sio_instance import sio
from ..state import sid_to_addr
from ..helpers import safe_place_bet, user_account_data
from ..logging import log
from ..errors import WithdrawalError


@sio.on("wallet_connected")
async def wallet_connected(sid, data):
    addr = data["address"]
    sid_to_addr[sid] = addr
    await sio.enter_room(sid, addr)
    log.info(f"Player {addr} joined")

    async with async_session() as db:
        # Get current round
        round_ = await db.scalar(select(Round).order_by(Round.created_at.desc()))

        # Get amount of turns played and won this round
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

        # Get any existing queued bet
        user_entry = await db.scalar(
            select(QueueEntry).where(
                QueueEntry.status == "queued", QueueEntry.address == addr
            )
        )

        if user_entry:
            position = (
                await db.scalar(
                    select(func.count())
                    .select_from(QueueEntry)
                    .where(
                        QueueEntry.status == "queued",
                        QueueEntry.created_at < user_entry.created_at,
                    )
                )
                + 1
            )
        else:
            position = -1

        balance, bets, withdrawals = await user_account_data(addr, db)

    return {
        "status": "ok",
        "data": {
            "position": position,
            "balance": balance,
            "played": played,
            "won": won,
            "bets": bets,
            "withdrawals": withdrawals,
        },
    }


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
        txn = contract.functions.withdrawFull(addr).build_transaction(
            {
                "from": owner,
                "nonce": w3.eth.get_transaction_count(owner, "pending"),
                "chainId": CHAIN_ID,
            }
        )

        # sign and send
        signed = w3.eth.account.sign_transaction(txn, private_key=PRIVATE_KEY)
        tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
        receipt = w3.eth.wait_for_transaction_receipt(tx_hash)

        if receipt["status"] != 1:
            raise WithdrawalError("Withdraw tx failed")

        logs = contract.events.FullWithrawal().process_receipt(receipt)

        if not logs:
            raise RuntimeError("No Withdraw event found!")

        withdrawn = logs[0]["args"]["amount"]
        log.info(f"Player {addr} withdrew ${withdrawn}")

        async with async_session() as db:
            db.add(
                Withdrawal(address=addr, amount=withdrawn, timestamp=datetime.utcnow())
            )
            await db.commit()

        return {"status": "ok", "data": {"withdrawn": withdrawn}}
    except Exception as e:
        log.warning(f"Could not withdraw funds: {e}")
        return {"status": "error", "error": f"{e}"}


@sio.on("ckeck_balance")
async def check_balance(sid, data):
    addr = sid_to_addr[sid]

    try:
        async with async_session() as db:
            balance, bets, withdrawals = await user_account_data(addr, db)
        return {
            "status": "ok",
            "balance": balance,
            "bets": bets,
            "withdrawals": withdrawals,
        }
    except:
        return {"status": "error", "balance": -1, "bets": None, "withdrawals": None}


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
            log.warning(
                "Rejected entry by %s because bet placing threw an error" % addr
            )
            return {
                "status": "error",
                "position": -1,
                "error": "unexpected error while placing bet",
            }

        db.add(QueueEntry(address=addr, round_id=round_.id, key=key.hex()))
        await db.commit()

        qcount = await db.scalar(
            select(func.count())
            .select_from(QueueEntry)
            .where(QueueEntry.status == "queued")
        )
    await sio.emit("player_queued")
    return {"status": "ok", "position": qcount}
