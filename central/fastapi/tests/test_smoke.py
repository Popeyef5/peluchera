"""Smoke test — validates the async-loop + fixtures + a basic reserve_win."""
from app import models as M
from app import win_transitions as wt

from conftest import (
    seed_vocab, mk_round, mk_opened, mk_ball, mk_queue_entry,
)


async def test_reserve_opened_booster(db):
    await seed_vocab(db)
    r = await mk_round(db)
    ob = await mk_opened(db)
    ball = await mk_ball(db, "T1", M.PrizeKind.OPENED_BOOSTER, opened=ob)
    qe = await mk_queue_entry(db, "0xabc", r)
    await db.commit()

    win = await wt.reserve_win(
        db, ball_serial="T1", wallet_address="0xabc", queue_entry_id=qe.id
    )
    await db.commit()

    assert win.prize_kind == M.PrizeKind.OPENED_BOOSTER
    assert win.status == M.WinStatus.PENDING
    # ball grabbed, opening reserved
    await db.refresh(ball)
    await db.refresh(ob)
    assert ball.status == M.BallStatus.GRABBED
    assert ob.status == M.InventoryStatus.RESERVED
