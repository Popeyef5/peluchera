"""Realistic load simulation — drives the LIVE turn scheduler + mock cabinet.

Runs in the fastapi container (shares the DB + app code). It:
  - binds a pool of balls across all three prize kinds to claimable prizes,
  - keeps N synthetic players queued (real confirm_payment enqueue),
  - lets the live scheduler run turns; the mock reports win/lose per MOCK_WIN_RATE,
  - settles every PENDING win a random way (open/resell/keep/ship),
  - restocks grabbed balls (rebinds to a fresh claimable prize),
  - and periodically an "operator" adds a fresh ball,
until TARGET turns have completed. Prints stats; any exception in a settle/
restock step is counted and logged (not swallowed silently).

Usage:  python -m scripts.sim [TARGET]   (default 1000)
Requires sim env (TURN_DURATION=1, INTER_TURN_DELAY=0, mock fast) — see the
harness that sets .env.dev + mock env.
"""
import asyncio
import random
import secrets
import sys
import uuid
import time

import httpx
from sqlalchemy import select, func, update

from app.config import PI_SERVER_URL
from app.deps import async_session
from app import models as M
from app import win_transitions as wt
from app import machine
from app.payments import initiate_payment, confirm_payment, current_round

TARGET = int(sys.argv[1]) if len(sys.argv) > 1 else 1000
QUEUE_DEPTH = 5                      # concurrent players in queue
BALL_SERIALS = [f"BALL-B00{i}" for i in range(6)] + [f"BALL-C00{i}" for i in range(6)]

stats = {"wins": 0, "settled": {}, "restocked": 0, "enqueued": 0, "errors": 0,
         "blocked_skips": 0, "added_balls": 0}
errors = []


def _bump(d, k):
    d[k] = d.get(k, 0) + 1


async def configure_mock():
    base = (PI_SERVER_URL or "").rstrip("/")
    async with httpx.AsyncClient(timeout=5) as c:
        await c.post(f"{base}/scenarios/random")
        await c.post(f"{base}/scenarios/odds", json={"win_rate": 0.6})


async def _ensure_batch(db):
    b = await db.scalar(select(M.CommitmentBatch).limit(1))
    if b is None:
        b = M.CommitmentBatch(merkle_root="0x" + uuid.uuid4().hex,
                              chain_tx_hash="0x" + uuid.uuid4().hex)
        db.add(b)
        await db.flush()
    return b


async def _fresh_opening(db, cb):
    ob = M.OpenedBooster(closed_booster_id=cb.id, sku=cb.sku,
                         video_url="/v.mp4", video_hash="0x" + uuid.uuid4().hex,
                         status=M.InventoryStatus.AVAILABLE)
    db.add(ob)
    await db.flush()
    ct = await db.scalar(select(M.CardType).limit(1))
    for j in range(cb.card_count or 3):
        db.add(M.Card(card_type_id=ct.id, origin=M.CardOrigin.OPENED_BOOSTER,
                      opened_booster_id=ob.id, position=j, status=M.CardStatus.IN_POOL))
    await db.flush()
    return ob


async def _fresh_card(db):
    ct = await db.scalar(select(M.CardType).where(M.CardType.rarity.isnot(None)).limit(1))
    c = M.Card(card_type_id=ct.id, origin=M.CardOrigin.SINGLE_PRIZE, status=M.CardStatus.IN_POOL)
    db.add(c)
    await db.flush()
    return c


async def _bind(db, ball, kind, cb):
    """(Re)bind an existing Ball object to a fresh claimable prize of `kind`."""
    batch = await _ensure_batch(db)
    ball.opened_booster_id = ball.closed_booster_id = ball.prize_card_id = None
    if kind == M.PrizeKind.OPENED_BOOSTER:
        ob = await _fresh_opening(db, cb)
        ball.opened_booster_id = ob.id
    elif kind == M.PrizeKind.CLOSED_BOOSTER:
        ball.closed_booster_id = cb.id
    else:
        card = await _fresh_card(db)
        ball.prize_card_id = card.id
    ball.prize_kind = kind
    ball.secret = "0x" + uuid.uuid4().hex
    ball.commitment_hash = "0x" + uuid.uuid4().hex
    ball.merkle_proof = {"i": 0}
    ball.batch_id = batch.id
    ball.status = M.BallStatus.LOADED
    ball.voided_at = None


async def setup_inventory():
    """A mix across all three kinds so every reserve/settle path runs live."""
    async with async_session() as db:
        cb = await db.scalar(select(M.ClosedBooster).where(M.ClosedBooster.in_stock.is_(True)))
        if cb is None:
            cb = M.ClosedBooster(sku="SIM-CB", name="Sim Pack",
                                 image_front_url="/boosters/test/front.webp",
                                 image_back_url="/boosters/test/back.webp",
                                 card_count=3, in_stock=True)
            db.add(cb)
            await db.flush()
        kinds = [M.PrizeKind.OPENED_BOOSTER, M.PrizeKind.CLOSED_BOOSTER, M.PrizeKind.SINGLE_CARD]
        for i, serial in enumerate(BALL_SERIALS):
            ball = await db.scalar(select(M.Ball).where(M.Ball.serial == serial))
            if ball is None:
                ball = M.Ball(serial=serial, prize_kind=M.PrizeKind.CLOSED_BOOSTER,
                              secret="x", commitment_hash="0x" + uuid.uuid4().hex,
                              merkle_proof={}, batch_id=(await _ensure_batch(db)).id,
                              status=M.BallStatus.VOIDED)
                db.add(ball)
                await db.flush()
            await _bind(db, ball, kinds[i % 3], cb)
        await db.commit()
        return cb.id


async def restock(cb_id):
    """Re-load grabbed sim balls with a fresh claimable prize of the same kind."""
    async with async_session() as db:
        cb = await db.get(M.ClosedBooster, cb_id)
        balls = (await db.execute(
            select(M.Ball).where(M.Ball.serial.in_(BALL_SERIALS),
                                 M.Ball.status != M.BallStatus.LOADED)
        )).scalars().all()
        for ball in balls:
            try:
                await _bind(db, ball, ball.prize_kind, cb)
                stats["restocked"] += 1
            except Exception as e:  # noqa
                stats["errors"] += 1
                errors.append(f"restock {ball.serial}: {type(e).__name__}: {e}")
        await db.commit()


async def ensure_queue():
    async with async_session() as db:
        if await machine.blocked():
            stats["blocked_skips"] += 1
            return
        n = await db.scalar(
            select(func.count()).select_from(M.QueueEntry).where(M.QueueEntry.status == "queued")
        )
        for _ in range(max(0, QUEUE_DEPTH - int(n or 0))):
            addr = "0x" + secrets.token_hex(20)
            p = await initiate_payment(db, addr, M.PaymentMethod.COMP, 0)
            await confirm_payment(db, p, secrets.token_bytes(32))
            stats["enqueued"] += 1


async def settle_wins():
    async with async_session() as db:
        wins = (await db.execute(
            select(M.Win.id, M.Win.prize_kind).where(M.Win.status == M.WinStatus.PENDING)
        )).all()
    for win_id, kind in wins:
        choice = None
        try:
            async with async_session() as db:
                if kind == M.PrizeKind.OPENED_BOOSTER:
                    choice = random.choice(["open", "resell", "ship"])
                    if choice == "open":
                        await wt.open_booster_win(db, win_id)
                    elif choice == "resell":
                        await wt.resell_booster_win(db, win_id)
                    else:
                        await wt.ship_booster_win(db, win_id, {"line1": "1", "city": "X", "country": "US"})
                elif kind == M.PrizeKind.CLOSED_BOOSTER:
                    choice = random.choice(["keep", "resell"])
                    fn = wt.keep_closed_booster_win if choice == "keep" else wt.resell_closed_booster_win
                    await fn(db, win_id)
                else:
                    choice = random.choice(["keep", "resell", "ship"])
                    if choice == "keep":
                        await wt.keep_card_win(db, win_id)
                    elif choice == "resell":
                        await wt.resell_card_win(db, win_id)
                    else:
                        await wt.ship_card_win(db, win_id, {"line1": "1", "city": "X", "country": "US"})
                await db.commit()
            _bump(stats["settled"], f"{kind.value}:{choice}")
            stats["wins"] += 1
        except wt.WinAlreadySettled:
            pass
        except Exception as e:  # noqa
            stats["errors"] += 1
            errors.append(f"settle {win_id} {kind.value}/{choice}: {type(e).__name__}: {e}")


async def played_count():
    async with async_session() as db:
        return int(await db.scalar(
            select(func.count()).select_from(M.QueueEntry).where(M.QueueEntry.status == "played")
        ) or 0)


async def add_operator_ball(cb_id, idx):
    """Operator occasionally adds a brand-new ball to the machine."""
    async with async_session() as db:
        cb = await db.get(M.ClosedBooster, cb_id)
        serial = f"SIM-OP-{idx}"
        if await db.scalar(select(M.Ball).where(M.Ball.serial == serial)):
            return
        ball = M.Ball(serial=serial, prize_kind=M.PrizeKind.CLOSED_BOOSTER,
                      secret="x", commitment_hash="0x" + uuid.uuid4().hex,
                      merkle_proof={}, batch_id=(await _ensure_batch(db)).id,
                      status=M.BallStatus.VOIDED)
        db.add(ball)
        await db.flush()
        await _bind(db, ball, M.PrizeKind.CLOSED_BOOSTER, cb)
        await db.commit()
        stats["added_balls"] += 1


async def main():
    await configure_mock()
    cb_id = await setup_inventory()
    print(f"[sim] inventory ready; target={TARGET}", flush=True)
    start = time.time()
    baseline = await played_count()
    tick = 0
    while True:
        done = await played_count() - baseline
        if done >= TARGET:
            break
        await ensure_queue()
        await settle_wins()
        await restock(cb_id)
        if tick % 40 == 0 and tick > 0:
            await add_operator_ball(cb_id, tick // 40)
        if tick % 20 == 0:
            print(f"[sim] played={done}/{TARGET} wins={stats['wins']} "
                  f"errors={stats['errors']} elapsed={int(time.time()-start)}s", flush=True)
        tick += 1
        await asyncio.sleep(0.4)

    # drain remaining pending wins
    await settle_wins()
    elapsed = int(time.time() - start)
    print("\n===== SIM COMPLETE =====", flush=True)
    print(f"target turns : {TARGET}   elapsed: {elapsed}s", flush=True)
    print(f"wins settled : {stats['wins']}", flush=True)
    print(f"settle mix   : {stats['settled']}", flush=True)
    print(f"restocked    : {stats['restocked']}   enqueued: {stats['enqueued']}   "
          f"added_balls: {stats['added_balls']}   blocked_skips: {stats['blocked_skips']}", flush=True)
    print(f"ERRORS       : {stats['errors']}", flush=True)
    for e in errors[:30]:
        print("  -", e, flush=True)


if __name__ == "__main__":
    asyncio.run(main())
