"""Win state machine: reserve_win (all kinds + failures) and settlements."""
import pytest
from sqlalchemy import select, func

from app import models as M
from app import win_transitions as wt
from app.deps import async_session

from conftest import (
    seed_vocab, mk_round, mk_opened, mk_closed, mk_pool_card, mk_ball,
    mk_queue_entry, in_fresh_session,
)


async def _reserve(db, serial, kind, **ball_kw):
    r = await mk_round(db)
    ball = await mk_ball(db, serial, kind, **ball_kw)
    qe = await mk_queue_entry(db, "0xp", r)
    await db.commit()
    win = await wt.reserve_win(db, ball_serial=serial, wallet_address="0xp", queue_entry_id=qe.id)
    await db.commit()
    return win, ball


# ── reserve_win ─────────────────────────────────────────────────────────

async def test_reserve_closed_booster(db):
    await seed_vocab(db)
    cb = await mk_closed(db, in_stock=True)
    win, ball = await _reserve(db, "CB1", M.PrizeKind.CLOSED_BOOSTER, closed=cb)
    assert win.prize_kind == M.PrizeKind.CLOSED_BOOSTER
    assert win.resell_price_cents == 500  # default booster resell
    await db.refresh(ball)
    assert ball.status == M.BallStatus.GRABBED


async def test_reserve_single_card(db):
    await seed_vocab(db)
    card = await mk_pool_card(db, rarity="RARE")
    win, ball = await _reserve(db, "SC1", M.PrizeKind.SINGLE_CARD, card=card)
    assert win.prize_kind == M.PrizeKind.SINGLE_CARD
    assert win.resell_price_cents == 400  # RARE
    await db.refresh(card)
    assert card.status != M.CardStatus.IN_POOL  # reserved


async def test_reserve_rejects_non_loaded_ball(db):
    await seed_vocab(db)
    cb = await mk_closed(db)
    r = await mk_round(db)
    await mk_ball(db, "GB", M.PrizeKind.CLOSED_BOOSTER, closed=cb, status=M.BallStatus.VOIDED)
    qe = await mk_queue_entry(db, "0xp", r)
    await db.commit()
    with pytest.raises(wt.BallNotAvailable):
        await wt.reserve_win(db, ball_serial="GB", wallet_address="0xp", queue_entry_id=qe.id)


async def test_reserve_closed_booster_out_of_stock_raises(db):
    await seed_vocab(db)
    cb = await mk_closed(db, in_stock=False)
    r = await mk_round(db)
    await mk_ball(db, "OOS", M.PrizeKind.CLOSED_BOOSTER, closed=cb)
    qe = await mk_queue_entry(db, "0xp", r)
    await db.commit()
    with pytest.raises(wt.PoolExhausted):
        await wt.reserve_win(db, ball_serial="OOS", wallet_address="0xp", queue_entry_id=qe.id)


# ── settlements ─────────────────────────────────────────────────────────

async def test_open_booster_consumes_and_collects(db):
    await seed_vocab(db)
    ob = await mk_opened(db)
    win, _ = await _reserve(db, "OB", M.PrizeKind.OPENED_BOOSTER, opened=ob)
    await in_fresh_session(wt.open_booster_win, win.id)
    await db.commit()
    await db.refresh(win); await db.refresh(ob)
    assert win.status == M.WinStatus.SETTLED_OPEN
    assert ob.status == M.InventoryStatus.CONSUMED
    n_owned = await db.scalar(
        select(func.count()).select_from(M.Card).where(
            M.Card.opened_booster_id == ob.id,
            M.Card.status == M.CardStatus.IN_COLLECTION,
        )
    )
    assert n_owned == 3


async def test_resell_booster_frees_opening_and_credits(db):
    await seed_vocab(db)
    ob = await mk_opened(db)
    win, _ = await _reserve(db, "OB2", M.PrizeKind.OPENED_BOOSTER, opened=ob)
    await in_fresh_session(wt.resell_booster_win, win.id)
    await db.commit()
    await db.refresh(win); await db.refresh(ob)
    assert win.status == M.WinStatus.SETTLED_RESELL
    assert ob.status == M.InventoryStatus.AVAILABLE  # reusable
    credited = await db.scalar(
        select(func.sum(M.LedgerEntry.amount_cents)).where(M.LedgerEntry.win_id == win.id)
    )
    assert credited == 500


async def test_ship_booster_frees_opening_and_ships(db):
    await seed_vocab(db)
    ob = await mk_opened(db)
    win, _ = await _reserve(db, "OB3", M.PrizeKind.OPENED_BOOSTER, opened=ob)
    await in_fresh_session(wt.ship_booster_win, win.id, {"line1": "1 St", "city": "X", "country": "US"})
    await db.commit()
    await db.refresh(win); await db.refresh(ob)
    assert win.status == M.WinStatus.SETTLED_SHIP
    assert ob.status == M.InventoryStatus.AVAILABLE  # reusable
    n_ship = await db.scalar(select(func.count()).select_from(M.Shipment))
    assert n_ship == 1


async def test_keep_card_to_collection(db):
    await seed_vocab(db)
    card = await mk_pool_card(db)
    win, _ = await _reserve(db, "SC2", M.PrizeKind.SINGLE_CARD, card=card)
    await wt.keep_card_win(db, win.id)
    await db.commit()
    await db.refresh(win); await db.refresh(card)
    assert win.status == M.WinStatus.SETTLED_KEEP
    assert card.status == M.CardStatus.IN_COLLECTION
    assert card.owner_user_id is not None


async def test_resell_card_credits_rarity_price(db):
    await seed_vocab(db)
    card = await mk_pool_card(db, rarity="CHASE")
    win, _ = await _reserve(db, "SC3", M.PrizeKind.SINGLE_CARD, card=card)
    await wt.resell_card_win(db, win.id)
    await db.commit()
    credited = await db.scalar(
        select(func.sum(M.LedgerEntry.amount_cents)).where(M.LedgerEntry.win_id == win.id)
    )
    assert credited == 8000  # CHASE


async def test_keep_and_resell_closed_booster(db):
    await seed_vocab(db)
    cb = await mk_closed(db)
    win, _ = await _reserve(db, "CB2", M.PrizeKind.CLOSED_BOOSTER, closed=cb)
    await wt.keep_closed_booster_win(db, win.id)
    await db.commit()
    await db.refresh(win)
    assert win.status == M.WinStatus.SETTLED_KEEP

    cb2 = await mk_closed(db)
    win2, _ = await _reserve(db, "CB3", M.PrizeKind.CLOSED_BOOSTER, closed=cb2)
    await wt.resell_closed_booster_win(db, win2.id)
    await db.commit()
    credited = await db.scalar(
        select(func.sum(M.LedgerEntry.amount_cents)).where(M.LedgerEntry.win_id == win2.id)
    )
    assert credited == 500


async def test_settlement_wrong_kind_raises(db):
    await seed_vocab(db)
    cb = await mk_closed(db)
    win, _ = await _reserve(db, "CB4", M.PrizeKind.CLOSED_BOOSTER, closed=cb)
    with pytest.raises(wt.WinKindMismatch):
        await in_fresh_session(wt.open_booster_win, win.id)  # not an opened booster


async def test_double_settle_raises(db):
    await seed_vocab(db)
    card = await mk_pool_card(db)
    win, _ = await _reserve(db, "SC4", M.PrizeKind.SINGLE_CARD, card=card)
    await wt.keep_card_win(db, win.id)
    await db.commit()
    with pytest.raises(wt.WinAlreadySettled):
        await wt.resell_card_win(db, win.id)


async def test_auto_resell_expired(db):
    import datetime
    await seed_vocab(db)
    cb = await mk_closed(db)
    win, _ = await _reserve(db, "EXP", M.PrizeKind.CLOSED_BOOSTER, closed=cb)
    win.expires_at = datetime.datetime.utcnow() - datetime.timedelta(days=1)
    await db.commit()
    n = await wt.run_auto_resell_expired(async_session)
    assert n >= 1
    await db.refresh(win)
    assert win.status == M.WinStatus.EXPIRED
