import asyncio
import time
from web3 import Web3

import app.state as state

from datetime import datetime, timedelta, timezone
from sqlalchemy import select, update
from sqlalchemy.exc import OperationalError
from .abi import claw_abi
from .models import QueueEntry
from .deps import async_session
from .errors import NewRoundError
from .models import Round
from .socket.sio_instance import sio
from .logging import log
from .pi_client import safe_pi_emit
from . import machine
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

    # Rest while a turn is in flight, a round is changing, or the machine isn't
    # fit to play. "Not fit" covers a jammed chute AND a loaded ball whose prize
    # can't be handed over — both pause the queue until an operator resolves it,
    # so nobody can pay for a play the machine cannot honour. turn_end applies
    # the same gate, so the machine simply stays idle.
    if await machine.blocked():
        await asyncio.sleep(1)
        return

    if (
        datetime.utcnow() - state.last_start
    ).total_seconds() < TURN_DURATION + INTER_TURN_DELAY or state.changing_round:
        await asyncio.sleep(1)
        return

    # Last game was over TURN_DURATION seconds ago? Close out any entry left
    # pending and claim the next queued one — in ONE tight transaction.
    #
    # The DB session MUST NOT stay open across the inter-turn sleep or the socket
    # emits below: a checked-out connection idling for a few seconds is exactly
    # what Supabase's pooler kills, and the next use then fails with
    # "SSL SYSCALL error: EOF detected". So we pull out the plain values we need,
    # commit, close the session, and only then wait / emit.
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

        new_entry = await db.scalar(
            select(QueueEntry)
            .where(QueueEntry.status == "queued")
            .order_by(QueueEntry.created_at.asc())
        )
        had_old = old_entry is not None
        next_addr = next_key = next_id = None
        if new_entry:
            new_entry.status = "active"
            next_addr, next_key, next_id = new_entry.address, new_entry.key, new_entry.id
        await db.commit()

    # --- nothing queued: go idle (no DB connection held across the sleep) ---
    if next_id is None:
        if had_old:
            await sio.emit("turn_end")
        state.current_player = None
        state.current_key = None
        await asyncio.sleep(INTER_TURN_DELAY)
        return

    # --- start the next turn; no session held across these waits/emits ---
    await sio.emit("turn_end")
    await asyncio.sleep(INTER_TURN_DELAY)  # wait between turns

    state.current_player = next_addr
    state.current_key = next_key
    state.last_start = datetime.utcnow()
    await sio.emit("turn_start")
    await safe_pi_emit("turn_start")

    async with async_session() as db:
        await db.execute(
            update(QueueEntry).where(QueueEntry.id == next_id).values(played_at=datetime.utcnow())
        )
        await db.commit()

    log.info(
        f"Started turn {state.current_key} by player {state.current_player} from the scheduler"
    )


async def turn_scheduler():  # clean up any partially-played entry
    # Crash recovery: mark any entry left "active" by a previous run as "played".
    # Wrapped in try/except because a transient DB blip HERE (e.g. Supabase
    # dropped the connection at boot) would otherwise throw straight out of this
    # coroutine and kill the task — silently stopping ALL turn scheduling until
    # the next restart. Retry instead until the DB answers.
    while True:
        try:
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
        except OperationalError:
            log.warning("turn_scheduler startup cleanup: DB connection dropped — retrying in 2s")
            await asyncio.sleep(2)
        except Exception:
            log.exception("turn_scheduler startup cleanup failed — retrying in 2s")
            await asyncio.sleep(2)

    # main loop
    while True:
        try:
            await _turn_scheduler_loop()
        except OperationalError:
            # Transient DB drop (Supabase closing a pooled connection). The next
            # loop reconnects (pool_pre_ping) — one tick is skipped, ~1s, which
            # players never notice. Log a calm one-liner, not a fatal-looking
            # 40-line traceback.
            log.warning("turn_scheduler: DB connection dropped — retrying next tick")
            await asyncio.sleep(1)
        except Exception as e:
            log.exception(f"turn_scheduler crashed: {e}")
            await asyncio.sleep(1)  # brief pause before retrying


async def sync_scheduler():
    while True:
        # One transient DB drop (Supabase closing a connection mid-query) must
        # NOT kill this loop — an unhandled exception here silently stops all
        # queue-position updates until the next restart. Catch, log, retry.
        try:
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
        except OperationalError:
            log.warning("sync_scheduler: DB connection dropped — retrying")
            await asyncio.sleep(1)
        except Exception:
            log.exception("sync_scheduler iteration failed — retrying")
            await asyncio.sleep(1)


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
