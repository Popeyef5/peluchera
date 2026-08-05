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
from sqlalchemy import select, delete, update

from .db import async_session, engine, Base
from .models import (
    CommitmentBatch, Ball, OpenedBooster, ClosedBooster, Card, CardType,
    Win, LedgerEntry, Payment, QueueEntry,
    BallStatus, CardStatus, CardOrigin, PrizeKind,
)

SKU = "pkmn-151"

# Sealed-pack SKUs to seed. Each becomes a ClosedBooster plus `openings` filmed
# OpenedBoosters (every one carrying `card_count` ordered cards) and one loaded
# OPENED_BOOSTER ball per opening (serial BALL-<ball_prefix><nnn>). `reveal`
# is the ClosedBooster.reveal_card_count — how many face-down cards the open
# animation fans out, independent of the real card_count.
BOOSTERS = [
    {
        "sku": SKU, "name": "Pokémon 151",
        # Local dev pack art (served from next/public) — the classic Base Set
        # Charizard pack, a coherent front/back pair (extracted from booster.glb's
        # own baked faces). Distinct from the thunder SKU below so the two dev
        # boosters don't look identical.
        "front": "/boosters/test/charizard-front.webp",
        "back": "/boosters/test/charizard-back.webp",
        "card_count": 3, "reveal": 3, "openings": 6, "ball_prefix": "B",
    },
    {
        "sku": "thunder", "name": "Raging Pokemons",
        # Supabase-hosted pack art. card_count is 5 but the reveal fans only 2 —
        # a live example of reveal_card_count being independent of pack size.
        "front": "https://cjuryopztkipqqkivsge.supabase.co/storage/v1/object/public/assets/boosters/aecrkn95.jpeg",
        "back": "https://cjuryopztkipqqkivsge.supabase.co/storage/v1/object/public/assets/boosters/ke34synt.jpeg",
        "card_count": 5, "reveal": 2, "openings": 3, "ball_prefix": "T",
    },
]

# Real card assets so the admin catalog (and, once wired, the win reveal) shows
# the same cards + foil styles as the design demo. (set, number, rarity, holo
# type, image) — `type` is a holo_type vocabulary value that maps to a foil.
_TCG = "https://images.pokemontcg.io"
CARD_TEMPLATES = [
    # A spread across simey categories, each paired with a matching real card so
    # the win reveal showcases distinct holo effects (see next/lib/cards.ts
    # HOLO_STYLES). `type` is the holo_type vocabulary value that drives the CSS.
    ("151", "001", "HOLO_RARE",  "holo",         f"{_TCG}/pgo/24.png"),        # Articuno — holofoil
    ("151", "004", "RARE",       "reverse-holo", f"{_TCG}/swsh12/127.png"),    # Togedemaru — reverse holo
    ("151", "007", "HOLO_RARE",  "cosmos-holo",  f"{_TCG}/swshp/SWSH012.png"), # Morpeko — cosmos holo
    ("151", "025", "ULTRA_RARE", "v",            f"{_TCG}/swsh7/110.png"),     # Rayquaza V
    ("151", "150", "ULTRA_RARE", "vmax",         f"{_TCG}/swsh7/29.png"),      # Gyarados VMAX
    ("151", "151", "CHASE",      "rainbow",      f"{_TCG}/swsh4/188.png"),     # Pikachu VMAX — rainbow
]


def _fake_hash(*parts: str) -> str:
    return "0x" + hashlib.sha256("|".join(parts).encode()).hexdigest()


# Game/inventory/queue tables, in FK-safe delete order (children first). Users,
# rounds and withdrawals are intentionally left alone. Only reachable via the
# explicit `--reset` flag, so a normal seed can never wipe data by accident.
_RESET_ORDER = [
    LedgerEntry, Win, Payment, QueueEntry,   # ledger refs win; win refs ball/card/queue
    Ball, Card, OpenedBooster, ClosedBooster, CardType, CommitmentBatch,
]


async def reset():
    async with async_session() as db:
        # Break the opened_booster -> win FK cycle first: a RESERVED opening
        # points back at its Win, which would block deleting the Win rows.
        await db.execute(update(OpenedBooster).values(reserved_by_win_id=None))
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
        for set_, num, rarity, type_, image_url in CARD_TEMPLATES:
            ct = CardType(
                sku=f"{set_}-{num}", name=f"Card {num}", image_url=image_url,
                type=type_, rarity=rarity, set=set_, number=num,
            )
            db.add(ct)
            card_types[ct.sku] = ct
        await db.flush()

        # Closed-booster catalog + filmed openings + cards, one set per SKU in
        # BOOSTERS. Each opening carries exactly card_count cards (so it's
        # complete and its ball can bind).
        opened_balls = []  # (ball_prefix, opening_index, OpenedBooster)
        for spec in BOOSTERS:
            closed = ClosedBooster(
                sku=spec["sku"], name=spec["name"], in_stock=True,
                card_count=spec["card_count"], reveal_card_count=spec["reveal"],
                image_front_url=spec["front"], image_back_url=spec["back"],
            )
            db.add(closed)
            await db.flush()

            for i in range(spec["openings"]):
                ob = OpenedBooster(
                    closed_booster_id=closed.id,
                    sku=spec["sku"],
                    video_url=f"https://example.com/videos/{spec['sku']}_{i}.mp4",
                    video_hash=_fake_hash(f"opened-{spec['sku']}-{i}"),
                    filmed_at=datetime.utcnow(),
                )
                db.add(ob)
                await db.flush()
                opened_balls.append((spec["ball_prefix"], i, ob))

                for j in range(spec["card_count"]):
                    set_, num, rarity, type_, image_url = CARD_TEMPLATES[(i + j) % len(CARD_TEMPLATES)]
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
            set_, num, rarity, type_, image_url = CARD_TEMPLATES[i % len(CARD_TEMPLATES)]
            card = Card(
                card_type_id=card_types[f"{set_}-{num}"].id,
                origin=CardOrigin.SINGLE_PRIZE,
                status=CardStatus.IN_POOL,
            )
            db.add(card)
            await db.flush()
            single_cards.append(card)

        # Balls — one OPENED_BOOSTER ball per opening (serial by SKU prefix),
        # plus one SINGLE_CARD ball per standalone card. Secrets and commitments
        # are fake but well-formed; merkle_proof is a stub.
        idx = 0
        for prefix, i, ob in opened_balls:
            secret = _fake_hash(f"secret-booster-{prefix}-{i}")
            db.add(Ball(
                serial=f"BALL-{prefix}{i:03d}",
                prize_kind=PrizeKind.OPENED_BOOSTER,
                opened_booster_id=ob.id,
                secret=secret,
                commitment_hash=_fake_hash(secret, str(ob.id)),
                merkle_proof={"siblings": [], "index": idx},
                batch_id=batch.id,
                status=BallStatus.LOADED,
            ))
            idx += 1

        for i, card in enumerate(single_cards):
            secret = _fake_hash(f"secret-card-{i}")
            db.add(Ball(
                serial=f"BALL-C{i:03d}",
                prize_kind=PrizeKind.SINGLE_CARD,
                prize_card_id=card.id,
                secret=secret,
                commitment_hash=_fake_hash(secret, str(card.id)),
                merkle_proof={"siblings": [], "index": idx + i},
                batch_id=batch.id,
                status=BallStatus.LOADED,
            ))

        await db.commit()

    print("[seed] done:")
    print("  1 commitment batch")
    for spec in BOOSTERS:
        p, n = spec["ball_prefix"], spec["openings"]
        print(f"  {n} booster balls  (BALL-{p}000 .. BALL-{p}{n-1:03d})  "
              f"SKU={spec['sku']} card_count={spec['card_count']} reveal={spec['reveal']}")
    print("  6 single-card balls    (BALL-C000 .. BALL-C005)")
    print("  + booster-internal cards & 6 standalone")


async def main():
    # Ensure tables/enums exist before inserting.
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    if "--reset" in sys.argv:
        await reset()
    await seed()


if __name__ == "__main__":
    asyncio.run(main())
