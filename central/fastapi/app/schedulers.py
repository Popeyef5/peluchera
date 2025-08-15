import asyncio
import time
from web3 import Web3

import app.state as state

from datetime import datetime, timedelta, timezone
from sqlalchemy import select
from .abi import claw_abi
from .models import QueueEntry
from .deps import async_session
from .errors import NewRoundError
from .models import Round
from .socket.sio_instance import sio
from .logging import log
from .pi_client import safe_pi_emit
from .config import (
    TURN_DURATION,
    INTER_TURN_DELAY,
    SYNC_PERIOD,
    BASE_RPC_HTTP,
    CLAW_ADDRESS,
    CHAIN_ID,
    PRIVATE_KEY,
)
from .state import global_sync


async def _turn_scheduler_loop():

    # If a turn is being played or the round is being ended, rest
    if (
        datetime.utcnow() - state.last_start
    ).total_seconds() < TURN_DURATION + INTER_TURN_DELAY or state.changing_round:
        await asyncio.sleep(1)
        return

    # Last game was over TURN_DURATION seconds ago? let's end any game that might have been left pending
    async with async_session() as db:
        old_entry = await db.scalar(
            select(QueueEntry)
            .where(QueueEntry.status == "active")
            .where(QueueEntry.address == state.current_player)
        )
        if old_entry:
            log.info("Cleaning up old entry in scheduler... This should not happen")
            old_entry.ended_at = datetime.utcnow()
            old_entry.status = "played"
        await db.commit()

        new_entry = await db.scalar(
            select(QueueEntry)
            .where(QueueEntry.status == "queued")
            .order_by(QueueEntry.created_at.asc())
        )
        if not new_entry:
            if old_entry:
                await sio.emit("turn_end")
            state.current_player = None
            state.current_key = None
            await asyncio.sleep(INTER_TURN_DELAY)
            return

        new_entry.status = "active"
        await db.commit()
        await sio.emit("turn_end")

        # Wait between turns
        await asyncio.sleep(INTER_TURN_DELAY)

        state.current_player = new_entry.address
        state.current_key = new_entry.key
        state.last_start = datetime.utcnow()
        # And launch the next one
        await sio.emit("turn_start")
        await safe_pi_emit("turn_start")

        new_entry.played_at = datetime.utcnow()
        await db.commit()
        log.info(
            f"Started turn {state.current_key} by player {state.current_player} from the scheduler"
        )


async def turn_scheduler():  # clean up any partially-played entry
    while True:
        async with async_session() as db:
            entry = await db.scalar(
                select(QueueEntry).where(QueueEntry.status == "active")
            )
            if entry:
                entry.status, entry.ended_at = "played", datetime.utcnow()
                await db.commit()
                log.info("Cleaned old entry on startup")
            else:
                break

    # main loop
    while True:
        try:
            await _turn_scheduler_loop()
        except Exception as e:
            log.exception(f"turn_scheduler crashed: {e}")
            await asyncio.sleep(1)  # brief pause before retrying


async def sync_scheduler():
    while True:
        start_time = time.time()

        # --- Global sync to every socket connection ---
        await sio.emit("global_sync", await global_sync())

        # --- Personal sync to every address in queue ---
        async with async_session() as db:
            result = await db.execute(
                select(QueueEntry)
                .where(QueueEntry.status == "queued")
                .order_by(QueueEntry.created_at.asc())
            )
            queue = result.scalars().all()

        for i, entry in enumerate(queue):
            await sio.emit("personal_sync", {"position": i + 1}, room=entry.address)

        spent_time = time.time() - start_time
        if spent_time < SYNC_PERIOD:
            # log.info("Sleeping for %ds" % (SYNC_PERIOD - spent_time))
            await asyncio.sleep(SYNC_PERIOD - spent_time)


async def round_end_scheduler():
    while True:
        now = datetime.now(timezone.utc)
        next_midnight = (now + timedelta(days=1)).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        seconds_left = int((next_midnight - now).total_seconds())
        await asyncio.sleep(seconds_left)
        log.info("Attempting round change")

        try:
            state.changing_round = True
            await asyncio.sleep(TURN_DURATION * 1.5)

            w3 = Web3(Web3.HTTPProvider(BASE_RPC_HTTP))
            contract = w3.eth.contract(address=CLAW_ADDRESS, abi=claw_abi)
            owner = w3.eth.account.from_key(PRIVATE_KEY).address

            async with async_session() as db:
                round = await db.scalar(select(Round).order_by(Round.created_at.desc()))
                multiplier = contract.functions.winMultiplier(round.id).call()
                round.multiplier = multiplier

                # build round end transaction
                txn = contract.functions.endRound().build_transaction(
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
                    log.warning(receipt)
                    raise NewRoundError("Error terminating round")

                await db.commit()
                # state.changing_round = False

        except Exception as e:
            log.warning(f"An error occurred while ending the round: {e}")
            state.changing_round = False
