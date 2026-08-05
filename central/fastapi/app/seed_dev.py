"""Dev-only seed script.

Populates the inventory pools and balls so the win flow can be exercised
end-to-end without a Pi or RFID hardware. Idempotent — bails out if a
CommitmentBatch already exists.

Run from inside the FastAPI container:
    docker compose exec claw_fastapi python -m app.seed_dev

After seeding, the dev-only `dev_simulate_win` socket event (gated by
ENABLE_DEV_EVENTS=1) lets you trigger a win from the browser console:
    socket.emit('dev_simulate_win', {ball_serial: 'BALL-B000'}, console.log)
"""

import asyncio
import hashlib
import sys
from datetime import datetime
from sqlalchemy import select, delete

from .db import async_session, engine, Base
from .models import (
    CommitmentBatch, Ball, OpenedBooster, ClosedBooster, Card, CardType,
    Win, LedgerEntry, Payment, QueueEntry,
    BallStatus, CardStatus, CardOrigin, PrizeKind,
)

SKU = "pkmn-151"

# (set, number, rarity, image_url) — image URLs are placeholders.
CARD_TEMPLATES = [
    ("151", "001", "COMMON",     "https://example.com/cards/151-001.png"),
    ("151", "004", "COMMON",     "https://example.com/cards/151-004.png"),
    ("151", "007", "COMMON",     "https://example.com/cards/151-007.png"),
    ("151", "025", "RARE",       "https://example.com/cards/151-025.png"),
    ("151", "150", "HOLO_RARE",  "https://example.com/cards/151-150.png"),
    ("151", "151", "CHASE",      "https://example.com/cards/151-151.png"),
]


def _fake_hash(*parts: str) -> str:
    return "0x" + hashlib.sha256("|".join(parts).encode()).hexdigest()


# Game/inventory/queue tables, in FK-safe delete order (children first). Users,
# rounds and withdrawals are intentionally left alone. Only reachable via the
# explicit `--reset` flag, so a normal seed can never wipe data by accident.
_RESET_ORDER = [
    Win, LedgerEntry, Payment, QueueEntry,   # reference queue/ball/card
    Ball, Card, OpenedBooster, ClosedBooster, CardType, CommitmentBatch,
]


async def reset():
    async with async_session() as db:
        for model in _RESET_ORDER:
            await db.execute(delete(model))
        await db.commit()
    print("[seed] reset: cleared inventory, queue, payments, wins, ledger.")


async def seed():
    async with async_session() as db:
        existing = await db.scalar(select(CommitmentBatch).limit(1))
        if existing:
            print(f"[seed] CommitmentBatch already exists ({existing.id}); skipping.")
            return

        batch = CommitmentBatch(
            merkle_root=_fake_hash("dev-batch-root"),
            chain_tx_hash=_fake_hash("dev-tx-hash"),
        )
        db.add(batch)
        await db.flush()

        # Card catalog (CardType), one per template — complete so cards bind.
        card_types = {}
        for set_, num, rarity, image_url in CARD_TEMPLATES:
            ct = CardType(
                sku=f"{set_}-{num}", name=f"Card {num}", image_url=image_url,
                type="holo", rarity=rarity, set=set_, number=num,
            )
            db.add(ct)
            card_types[ct.sku] = ct
        await db.flush()

        # Closed-booster catalog for this SKU — complete (name, faces, count).
        closed = ClosedBooster(
            sku=SKU, name="Pokémon 151", card_count=3, in_stock=True,
            image_front_url="https://example.com/boosters/151-front.png",
            image_back_url="https://example.com/boosters/151-back.png",
        )
        db.add(closed)
        await db.flush()

        # 6 OpenedBoosters, each linked to the ClosedBooster with 3 ordered cards.
        opened_list = []
        for i in range(6):
            ob = OpenedBooster(
                closed_booster_id=closed.id,
                sku=SKU,
                video_url=f"https://example.com/videos/opened_{i}.mp4",
                video_hash=_fake_hash(f"opened-video-{i}"),
                filmed_at=datetime.utcnow(),
            )
            db.add(ob)
            await db.flush()
            opened_list.append(ob)

            for j in range(3):
                set_, num, rarity, image_url = CARD_TEMPLATES[(i + j) % len(CARD_TEMPLATES)]
                db.add(Card(
                    card_type_id=card_types[f"{set_}-{num}"].id,
                    origin=CardOrigin.OPENED_BOOSTER,
                    opened_booster_id=ob.id,
                    position=j,
                    status=CardStatus.IN_POOL,
                ))

        # 6 standalone single-prize Cards.
        single_cards = []
        for i in range(6):
            set_, num, rarity, image_url = CARD_TEMPLATES[i % len(CARD_TEMPLATES)]
            card = Card(
                card_type_id=card_types[f"{set_}-{num}"].id,
                origin=CardOrigin.SINGLE_PRIZE,
                status=CardStatus.IN_POOL,
            )
            db.add(card)
            await db.flush()
            single_cards.append(card)

        # 12 Balls — 6 bound to OpenedBoosters (OPENED_BOOSTER), 6 bound to
        # single Cards (SINGLE_CARD). Secrets and commitments are fake but
        # well-formed; merkle_proof is a stub.
        for i, ob in enumerate(opened_list):
            secret = _fake_hash(f"secret-booster-{i}")
            db.add(Ball(
                serial=f"BALL-B{i:03d}",
                prize_kind=PrizeKind.OPENED_BOOSTER,
                opened_booster_id=ob.id,
                secret=secret,
                commitment_hash=_fake_hash(secret, str(ob.id)),
                merkle_proof={"siblings": [], "index": i},
                batch_id=batch.id,
                status=BallStatus.LOADED,
            ))

        for i, card in enumerate(single_cards):
            secret = _fake_hash(f"secret-card-{i}")
            db.add(Ball(
                serial=f"BALL-C{i:03d}",
                prize_kind=PrizeKind.SINGLE_CARD,
                prize_card_id=card.id,
                secret=secret,
                commitment_hash=_fake_hash(secret, str(card.id)),
                merkle_proof={"siblings": [], "index": 6 + i},
                batch_id=batch.id,
                status=BallStatus.LOADED,
            ))

        await db.commit()

    print("[seed] done:")
    print("  1 commitment batch")
    print("  6 booster-pair balls   (BALL-B000 .. BALL-B005)")
    print("  6 single-card balls    (BALL-C000 .. BALL-C005)")
    print(f"  12 closed boosters     (SKU={SKU})")
    print("  18 booster-internal cards + 6 standalone")


async def main():
    # Ensure tables/enums exist before inserting.
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    if "--reset" in sys.argv:
        await reset()
    await seed()


if __name__ == "__main__":
    asyncio.run(main())
