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
from datetime import datetime
from sqlalchemy import select

from .db import async_session, engine, Base
from .models import (
    CommitmentBatch, Ball, OpenedBooster, ClosedBooster, Card,
    BallStatus, CardStatus, CardOrigin, CardRarity, PrizeKind,
)

SKU = "pkmn-151"

# (set, number, rarity, image_url) — image URLs are placeholders.
CARD_TEMPLATES = [
    ("151", "001", CardRarity.COMMON,     "https://example.com/cards/151-001.png"),
    ("151", "004", CardRarity.COMMON,     "https://example.com/cards/151-004.png"),
    ("151", "007", CardRarity.COMMON,     "https://example.com/cards/151-007.png"),
    ("151", "025", CardRarity.RARE,       "https://example.com/cards/151-025.png"),
    ("151", "150", CardRarity.HOLO_RARE,  "https://example.com/cards/151-150.png"),
    ("151", "151", CardRarity.CHASE,      "https://example.com/cards/151-151.png"),
]


def _fake_hash(*parts: str) -> str:
    return "0x" + hashlib.sha256("|".join(parts).encode()).hexdigest()


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

        # 6 OpenedBoosters, each with 3 catalogued cards (the filmed reveal).
        opened_list = []
        for i in range(6):
            ob = OpenedBooster(
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
                    set=set_, number=num, rarity=rarity, image_url=image_url,
                    origin=CardOrigin.OPENED_BOOSTER,
                    opened_booster_id=ob.id,
                    status=CardStatus.IN_POOL,
                ))

        # 12 ClosedBoosters of the same SKU — fungible pool with surplus.
        for _ in range(12):
            db.add(ClosedBooster(sku=SKU))

        # 6 standalone single-prize Cards.
        single_cards = []
        for i in range(6):
            set_, num, rarity, image_url = CARD_TEMPLATES[i % len(CARD_TEMPLATES)]
            card = Card(
                set=set_, number=num, rarity=rarity, image_url=image_url,
                origin=CardOrigin.SINGLE_PRIZE,
                status=CardStatus.IN_POOL,
            )
            db.add(card)
            await db.flush()
            single_cards.append(card)

        # 12 Balls — 6 bound to OpenedBoosters (BOOSTER_PAIR), 6 bound to
        # single Cards (SINGLE_CARD). Secrets and commitments are fake but
        # well-formed; merkle_proof is a stub.
        for i, ob in enumerate(opened_list):
            secret = _fake_hash(f"secret-booster-{i}")
            db.add(Ball(
                serial=f"BALL-B{i:03d}",
                prize_kind=PrizeKind.BOOSTER_PAIR,
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
    await seed()


if __name__ == "__main__":
    asyncio.run(main())
