import asyncio
import secrets

from sqlalchemy import select, func
from datetime import datetime

from ..config import BYPASS_PAYMENT, TICKET_PRICE_CENTS, ticket_usdc_base_units
from ..models import (
    QueueEntry, Round, Withdrawal, Payment, PaymentMethod,
    User, LedgerEntry, LedgerKind,
)
from ..deps import async_session
from .sio_instance import sio
from ..state import sid_to_addr
from ..helpers import (
    safe_verify_usdc_transfer, user_account_data,
    off_chain_balance_cents, withdrawable_balance_cents,
    safe_send_usdc, cents_to_usdc_base_units,
)
from ..payments import already_in_queue, initiate_payment, confirm_payment
from ..win_transitions import get_or_create_user
from ..logging import log


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
    """Withdraw the full off-chain winnings balance as USDC to the player's
    address. The contract is retired: we debit the ledger first (under a row
    lock, so concurrent withdrawals can't double-spend), pay out from the
    treasury, then reverse the debit if the payout fails.
    """
    addr = sid_to_addr[sid]
    if not addr:
        return {"status": "error", "error": "not connected"}
    log.info(f"Player {addr} is issuing a withdrawal of funds")
    try:
        # 1) Reserve: lock the user, compute the *withdrawable* balance (total
        #    minus card-chargeback holds), write the WITHDRAWAL debit.
        async with async_session() as db:
            user = await get_or_create_user(db, addr)
            await db.scalar(select(User).where(User.id == user.id).with_for_update())
            total_cents = await off_chain_balance_cents(db, user.id)
            balance_cents = await withdrawable_balance_cents(db, user.id)
            if total_cents <= 0:
                return {"status": "error", "error": "no funds to withdraw"}
            if balance_cents <= 0:
                # They have winnings, but all of it is card-funded and still
                # inside the chargeback window.
                return {"status": "error", "error": "funds on hold (card payment clearing)"}
            debit = LedgerEntry(
                user_id=user.id, kind=LedgerKind.WITHDRAWAL, amount_cents=balance_cents,
            )
            db.add(debit)
            await db.commit()
            debit_id = debit.id

        # 2) Pay out from the treasury.
        loop = asyncio.get_running_loop()
        ok, tx_hash = await safe_send_usdc(loop, addr, cents_to_usdc_base_units(balance_cents))

        # 3) Finalize or reverse.
        async with async_session() as db:
            row = await db.scalar(select(LedgerEntry).where(LedgerEntry.id == debit_id))
            if not ok:
                if row:
                    await db.delete(row)   # payout failed → un-debit
                    await db.commit()
                return {"status": "error", "error": "payout transaction failed"}
            row.withdrawal_tx_hash = tx_hash
            db.add(Withdrawal(address=addr, amount=balance_cents, timestamp=datetime.utcnow()))
            await db.commit()

        log.info(f"Player {addr} withdrew {balance_cents}c (tx {tx_hash})")
        return {"status": "ok", "data": {"withdrawn": balance_cents / 100}}
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


# NOTE: the legacy `join_queue` handler (EIP-712 permit -> on-chain escrow
# bet()) has been removed. The escrow contract is retired; pay-to-play is now a
# direct USDC transfer verified in `pay_crypto` below. `helpers.place_bet`/
# `safe_place_bet` are now dead and can be deleted in a later cleanup.


@sio.on("pay_crypto")
async def pay_crypto(sid, data):
    """Crypto rail v2: pay-to-play by a direct USDC transfer to the treasury.

    The frontend transfers USDC straight to the treasury (no escrow permit/bet)
    and sends us the tx hash; we verify the on-chain receipt, then converge on
    the same initiate/confirm seam as every other rail. The QueueEntry key is a
    synthetic turn id — there's no contract round-trip behind it. In bypass mode
    there's no transfer: the backend mints a synthetic key and skips the check.
    """
    addr = sid_to_addr[sid]

    async with async_session() as db:
        round_ = await db.scalar(select(Round).order_by(Round.created_at.desc()))
        if await already_in_queue(db, addr, round_.id):
            log.warning("Rejected player %s for double entry" % addr)
            return {"status": "error", "position": -1, "error": "user already in queue"}

        tx_hash = None
        if BYPASS_PAYMENT:
            key = secrets.token_bytes(32)
            log.info("BYPASS_PAYMENT: skipped USDC transfer check for %s", addr)
        else:
            tx_hash = (data or {}).get("tx_hash")
            if not tx_hash:
                return {"status": "error", "position": -1, "error": "missing tx_hash"}

            # Replay guard: a tx hash can fund exactly one play (also enforced by
            # the unique constraint on payment.ref).
            if await db.scalar(select(Payment).where(Payment.ref == tx_hash)):
                log.warning("Rejected %s: tx %s already used", addr, tx_hash)
                return {"status": "error", "position": -1, "error": "payment already used"}

            loop = asyncio.get_running_loop()
            ok = await safe_verify_usdc_transfer(loop, tx_hash, addr, ticket_usdc_base_units())
            if not ok:
                log.warning("Rejected %s: could not verify USDC payment %s", addr, tx_hash)
                return {"status": "error", "position": -1, "error": "payment not verified"}
            key = secrets.token_bytes(32)

        payment = await initiate_payment(db, addr, PaymentMethod.CRYPTO, TICKET_PRICE_CENTS)
        payment.ref = tx_hash
        position = await confirm_payment(db, payment, key)

    return {"status": "ok", "position": position}
