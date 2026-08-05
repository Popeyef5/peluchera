"""Regression tests for the core inventory/win invariants (SPEC §15)."""
import pytest
from sqlalchemy import select, func
from sqlalchemy.exc import IntegrityError

from app import models as M
from app import win_transitions as wt

from conftest import (
    seed_vocab, mk_round, mk_opened, mk_closed, mk_pool_card, mk_ball,
    mk_queue_entry, mk_batch, in_fresh_session,
)


# ── claimability ────────────────────────────────────────────────────────

async def test_unclaimable_flags_bad_balls(db):
    await seed_vocab(db)
    # good opened booster
    ob = await mk_opened(db)
    await mk_ball(db, "GOOD-OB", M.PrizeKind.OPENED_BOOSTER, opened=ob)
    # opened booster no longer AVAILABLE
    ob2 = await mk_opened(db)
    ob2.status = M.InventoryStatus.CONSUMED
    await mk_ball(db, "BAD-OB", M.PrizeKind.OPENED_BOOSTER, opened=ob2)
    # closed booster out of stock
    cb = await mk_closed(db, in_stock=False)
    await mk_ball(db, "BAD-CB", M.PrizeKind.CLOSED_BOOSTER, closed=cb)
    # card left the pool
    card = await mk_pool_card(db)
    card.status = M.CardStatus.IN_COLLECTION
    await mk_ball(db, "BAD-SC", M.PrizeKind.SINGLE_CARD, card=card)
    await db.commit()

    bad = await wt.unclaimable_loaded_balls(db)
    serials = {b["serial"] for b in bad}
    assert "GOOD-OB" not in serials
    assert {"BAD-OB", "BAD-CB", "BAD-SC"} <= serials


async def test_all_good_is_claimable(db):
    await seed_vocab(db)
    ob = await mk_opened(db)
    await mk_ball(db, "OK1", M.PrizeKind.OPENED_BOOSTER, opened=ob)
    cb = await mk_closed(db, in_stock=True)
    await mk_ball(db, "OK2", M.PrizeKind.CLOSED_BOOSTER, closed=cb)
    card = await mk_pool_card(db)
    await mk_ball(db, "OK3", M.PrizeKind.SINGLE_CARD, card=card)
    await db.commit()
    assert await wt.unclaimable_loaded_balls(db) == []


# ── one LOADED ball per prize (partial unique index) ────────────────────

async def test_two_loaded_balls_same_opening_rejected(db):
    ob = await mk_opened(db)
    await mk_ball(db, "L1", M.PrizeKind.OPENED_BOOSTER, opened=ob)
    await db.commit()
    with pytest.raises(IntegrityError):
        await mk_ball(db, "L2", M.PrizeKind.OPENED_BOOSTER, opened=ob)
        await db.commit()
    await db.rollback()


async def test_grabbed_ball_does_not_block_new_loaded(db):
    ob = await mk_opened(db)
    await mk_ball(db, "G1", M.PrizeKind.OPENED_BOOSTER, opened=ob,
                  status=M.BallStatus.GRABBED)
    # a NEW loaded ball may hold the same opening — the grabbed one is historical
    await mk_ball(db, "G2", M.PrizeKind.OPENED_BOOSTER, opened=ob,
                  status=M.BallStatus.LOADED)
    await db.commit()
    n = await db.scalar(
        select(func.count()).select_from(M.Ball).where(M.Ball.opened_booster_id == ob.id)
    )
    assert n == 2


# ── reuse: resell frees the opening for a NEW ball ──────────────────────

async def test_opening_reusable_after_resell(db):
    await seed_vocab(db)
    ob = await mk_opened(db)
    ball = await mk_ball(db, "R1", M.PrizeKind.OPENED_BOOSTER, opened=ob)
    r = await mk_round(db)
    qe = await mk_queue_entry(db, "0xp", r)
    await db.commit()
    win = await wt.reserve_win(db, ball_serial="R1", wallet_address="0xp", queue_entry_id=qe.id)
    await db.commit()
    await in_fresh_session(wt.resell_booster_win, win.id)   # opening -> AVAILABLE
    await db.commit()
    await db.refresh(ob)
    assert ob.status == M.InventoryStatus.AVAILABLE
    # bind a brand-new LOADED ball to the freed opening (R1 is now GRABBED)
    await mk_ball(db, "R2", M.PrizeKind.OPENED_BOOSTER, opened=ob)
    await db.commit()  # no IntegrityError


# ── re-win: a reusable tag accrues many wins (win.ball_id not unique) ────

async def test_ball_can_be_won_twice(db):
    await seed_vocab(db)
    cb = await mk_closed(db)
    ball = await mk_ball(db, "RW", M.PrizeKind.CLOSED_BOOSTER, closed=cb)
    r = await mk_round(db)
    qe1 = await mk_queue_entry(db, "0xp", r)
    await db.commit()
    win1 = await wt.reserve_win(db, ball_serial="RW", wallet_address="0xp", queue_entry_id=qe1.id)
    await db.commit()
    # reload the tag and win it again (different turn)
    ball.status = M.BallStatus.LOADED
    await db.commit()
    qe2 = await mk_queue_entry(db, "0xp", r)
    await db.commit()
    win2 = await wt.reserve_win(db, ball_serial="RW", wallet_address="0xp", queue_entry_id=qe2.id)
    await db.commit()
    assert win1.id != win2.id
    n = await db.scalar(select(func.count()).select_from(M.Win).where(M.Win.ball_id == ball.id))
    assert n == 2
