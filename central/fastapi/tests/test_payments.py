"""Payment seam + the machine.blocked() pay-time guard."""
from sqlalchemy import select, func

from app import models as M
from app import machine
from app.payments import initiate_payment, confirm_payment, already_in_queue, current_round

from conftest import seed_vocab, mk_round, mk_closed, mk_ball


async def test_confirm_payment_enqueues(db):
    import secrets
    await mk_round(db)
    await db.commit()
    payment = await initiate_payment(db, "0xpay", M.PaymentMethod.COMP, 0)
    pos = await confirm_payment(db, payment, secrets.token_bytes(32))
    assert pos >= 1
    assert payment.status == M.PaymentStatus.CONFIRMED
    n = await db.scalar(
        select(func.count()).select_from(M.QueueEntry).where(M.QueueEntry.status == "queued")
    )
    assert n == 1


async def test_already_in_queue_guard(db):
    import secrets
    r = await mk_round(db)
    await db.commit()
    p = await initiate_payment(db, "0xdup", M.PaymentMethod.COMP, 0)
    await confirm_payment(db, p, secrets.token_bytes(32))
    assert await already_in_queue(db, "0xdup", r.id) is True
    assert await already_in_queue(db, "0xother", r.id) is False


async def test_machine_blocked_on_unclaimable(db):
    # a LOADED ball whose closed booster is out of stock => blocked
    await seed_vocab(db)
    cb = await mk_closed(db, in_stock=False)
    await mk_ball(db, "BLK", M.PrizeKind.CLOSED_BOOSTER, closed=cb)
    await db.commit()
    fault = await machine.blocked()
    assert fault is not None
    assert fault.get("kind") == "unclaimable_prizes"


async def test_machine_not_blocked_when_clean(db):
    await seed_vocab(db)
    cb = await mk_closed(db, in_stock=True)
    await mk_ball(db, "OKB", M.PrizeKind.CLOSED_BOOSTER, closed=cb)
    await db.commit()
    # no protocol/cabinet fault set in tests; inventory is clean
    fault = await machine.blocked()
    assert fault is None or fault.get("kind") != "unclaimable_prizes"
