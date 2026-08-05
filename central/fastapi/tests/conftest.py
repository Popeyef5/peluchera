"""Test fixtures + factories.

Run against an isolated DB by pointing DATABASE_URL at claw_test BEFORE pytest
imports the app (see tests/run: `DATABASE_URL=.../claw_test pytest`). The whole
app (deps.async_session, engine) then binds to the test DB.

Each test starts from a truncated schema (autouse `_clean`). Factories build the
minimal graph a test needs.
"""
import uuid

import pytest_asyncio
from sqlalchemy import text

from app.deps import async_session
from app.db import engine
from app import models as M

# Mutable tables, truncated before each test. opened_booster<->win is a cycle,
# broken by nulling reserved_by_win_id first.
_TABLES = [
    "win", "ledger_entry", "payment", "queue", "ball", "card", "opened_booster",
    "closed_booster", "card_type", "holo_type", "rarity", "commitment_batch",
    "shipment", "user_account", "round", "withdrawal",
]


@pytest_asyncio.fixture(autouse=True)
async def _clean():
    async with async_session() as db:
        await db.execute(text("UPDATE opened_booster SET reserved_by_win_id = NULL"))
        await db.execute(text("TRUNCATE " + ", ".join(_TABLES) + " RESTART IDENTITY CASCADE"))
        await db.commit()
    yield
    # Empty the pool so a pooled connection never crosses into another test's
    # event loop (pytest-asyncio uses a fresh loop per test) — otherwise
    # pool_pre_ping / close fires outside a greenlet (MissingGreenlet).
    await engine.dispose()


@pytest_asyncio.fixture
async def db():
    async with async_session() as s:
        yield s


# ── factories (module-level async helpers; call with the test's db session) ──

async def seed_vocab(db):
    for i, n in enumerate(["holo", "reverse-holo", "cosmos-holo"]):
        db.add(M.HoloType(name=n, sort_order=i))
    for i, (n, p) in enumerate([("COMMON", 50), ("RARE", 400), ("CHASE", 8000)]):
        db.add(M.Rarity(name=n, resell_price_cents=p, sort_order=i))
    await db.flush()


async def mk_round(db):
    r = M.Round()
    db.add(r)
    await db.flush()
    return r


async def mk_batch(db):
    b = M.CommitmentBatch(
        merkle_root="0x" + uuid.uuid4().hex, chain_tx_hash="0x" + uuid.uuid4().hex
    )
    db.add(b)
    await db.flush()
    return b


async def mk_closed(db, sku=None, in_stock=True, complete=True):
    sku = sku or "cb-" + uuid.uuid4().hex[:6]
    cb = M.ClosedBooster(
        sku=sku,
        name="Pack" if complete else None,
        image_front_url="http://x/f.png" if complete else None,
        image_back_url="http://x/b.png" if complete else None,
        card_count=3 if complete else None,
        in_stock=in_stock,
    )
    db.add(cb)
    await db.flush()
    return cb


async def mk_card_type(db, sku=None, complete=True, rarity="COMMON"):
    sku = sku or "ct-" + uuid.uuid4().hex[:6]
    ct = M.CardType(
        sku=sku,
        name="Card" if complete else None,
        image_url="http://x/c.png" if complete else None,
        type="holo" if complete else None,
        rarity=rarity if complete else None,
    )
    db.add(ct)
    await db.flush()
    return ct


async def mk_opened(db, cb=None, complete=True):
    cb = cb or await mk_closed(db)
    ob = M.OpenedBooster(
        closed_booster_id=cb.id,
        sku=cb.sku,
        video_url="http://x/v.mp4" if complete else None,
        video_hash="0x" + uuid.uuid4().hex,
        status=M.InventoryStatus.AVAILABLE,
    )
    db.add(ob)
    await db.flush()
    if complete:
        for j in range(cb.card_count or 3):
            ct = await mk_card_type(db)
            db.add(M.Card(
                card_type_id=ct.id, origin=M.CardOrigin.OPENED_BOOSTER,
                opened_booster_id=ob.id, position=j, status=M.CardStatus.IN_POOL,
            ))
        await db.flush()
    return ob


async def mk_pool_card(db, rarity="COMMON"):
    ct = await mk_card_type(db, rarity=rarity)
    c = M.Card(card_type_id=ct.id, origin=M.CardOrigin.SINGLE_PRIZE, status=M.CardStatus.IN_POOL)
    db.add(c)
    await db.flush()
    return c


async def mk_ball(db, serial, kind, *, opened=None, closed=None, card=None,
                  status=M.BallStatus.LOADED):
    batch = await mk_batch(db)
    ball = M.Ball(
        serial=serial,
        prize_kind=kind,
        opened_booster_id=opened.id if opened else None,
        closed_booster_id=closed.id if closed else None,
        prize_card_id=card.id if card else None,
        secret="0x" + uuid.uuid4().hex,
        commitment_hash="0x" + uuid.uuid4().hex,
        merkle_proof={"siblings": [], "index": 0},
        batch_id=batch.id,
        status=status,
    )
    db.add(ball)
    await db.flush()
    return ball


async def mk_queue_entry(db, addr, round_):
    qe = M.QueueEntry(address=addr, round_id=round_.id, key=uuid.uuid4().hex)
    db.add(qe)
    await db.flush()
    return qe


async def in_fresh_session(fn, *args, **kw):
    """Run a transition in its own session/transaction — how production settles
    each win (a fresh session re-queries + eager-loads relationships, avoiding
    identity-map staleness from a session that also created the win)."""
    async with async_session() as s:
        res = await fn(s, *args, **kw)
        await s.commit()
        return res
