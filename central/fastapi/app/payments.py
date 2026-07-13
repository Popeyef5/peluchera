"""Payment convergence seam for the unified pay-to-play flow.

Both funding rails — crypto (USDC transfer from the player's embedded address)
and card (Stripe) — create a PENDING Payment via `initiate_payment`, then
converge on the single `confirm_payment` chokepoint. Confirmation marks the
payment CONFIRMED and enqueues the paid-for play, so rail-specific verification
(on-chain receipt vs. Stripe webhook) stays out of the shared enqueue logic.

Note: a ticket payment does NOT create a balance-affecting LedgerEntry. The
off-chain balance accrues only from winnings (resold prizes), never from
deposits — so the `payment` table is itself the audit record of ticket revenue.
"""
from datetime import datetime

from sqlalchemy import select, func

from .models import QueueEntry, Round, Payment, PaymentStatus
from .socket.sio_instance import sio


async def current_round(db):
    return await db.scalar(select(Round).order_by(Round.created_at.desc()))


async def already_in_queue(db, addr, round_id) -> bool:
    """True if addr already has a queued/active entry this round (double-entry guard)."""
    existing = await db.scalar(
        select(QueueEntry)
        .where(QueueEntry.round_id == round_id)
        .where(QueueEntry.address == addr)
        .where(QueueEntry.status.in_(["queued", "active"]))
    )
    return existing is not None


async def initiate_payment(db, addr, method, amount_cents) -> Payment:
    """Create a PENDING payment for one play. Flushes so the id is available.

    The caller commits (synchronous crypto path) or commits separately so the
    PENDING row survives until an async confirmation (card webhook).
    """
    payment = Payment(
        address=addr,
        method=method,
        amount_cents=amount_cents,
        status=PaymentStatus.PENDING,
    )
    db.add(payment)
    await db.flush()
    return payment


async def confirm_payment(db, payment, key) -> int:
    """Single convergence point for both rails.

    Marks `payment` CONFIRMED, creates the paid-for QueueEntry into the current
    round, links the two, commits, and broadcasts `player_queued`. Returns the
    queued count (the player's position). The caller owns the session.
    """
    round_ = await current_round(db)
    entry = QueueEntry(address=payment.address, round_id=round_.id, key=key.hex())
    db.add(entry)
    await db.flush()

    payment.status = PaymentStatus.CONFIRMED
    payment.confirmed_at = datetime.utcnow()
    payment.queue_entry_id = entry.id

    await db.commit()

    qcount = await db.scalar(
        select(func.count()).select_from(QueueEntry).where(QueueEntry.status == "queued")
    )
    await sio.emit("player_queued")
    return qcount
