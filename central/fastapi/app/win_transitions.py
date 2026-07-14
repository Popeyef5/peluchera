"""State-machine transitions for wins and inventory.

Each public function is a single short transaction. The caller is expected
to commit (or rely on the surrounding session context manager). Errors are
typed so route handlers can map them to HTTP status codes.

The win lifecycle and trust model are documented in the project memory at
~/.claude/projects/-home-gaston-garra/memory/project_garra_overview.md.
"""

import uuid
import logging
from datetime import datetime, timedelta
from typing import Optional, TypedDict, Literal

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from .config import RESELL_PRICE_BY_RARITY_CENTS, RESELL_PRICE_BY_BOOSTER_SKU_CENTS
from .models import (
    User, Win, Ball, ClosedBoosterStock, OpenedBooster, Card, Shipment, LedgerEntry,
    QueueEntry,
    WinStatus, BallStatus, InventoryStatus, CardStatus, PrizeKind,
    SettlementKind, ShipmentStatus, LedgerKind,
)

log = logging.getLogger(__name__)

RESELL_DEADLINE_DAYS = 30


# ─── Errors ─────────────────────────────────────────────────────────────

class BallNotAvailable(Exception): ...
class PoolExhausted(Exception): ...
class WinAlreadySettled(Exception): ...
class WinKindMismatch(Exception): ...
class NotOwner(Exception): ...
class CardNotActionable(Exception): ...


class ShippingAddress(TypedDict, total=False):
    line1: str
    line2: Optional[str]
    city: str
    region: str
    postal: str
    country: str


def _expiry_from_now() -> datetime:
    return datetime.utcnow() + timedelta(days=RESELL_DEADLINE_DAYS)


# ─── Identity ───────────────────────────────────────────────────────────

async def get_or_create_user(session: AsyncSession, wallet_address: str) -> User:
    """Look up or lazily create a User row for a wallet address.

    The legacy QueueEntry/Withdrawal tables key off `address` directly. New
    tables (Win, Card, Shipment, LedgerEntry) FK to User. This is the
    bridge — call it any time you need a user row for a wallet.
    """
    res = await session.execute(
        select(User).where(User.wallet_address == wallet_address)
    )
    user = res.scalar_one_or_none()
    if user is None:
        user = User(wallet_address=wallet_address)
        session.add(user)
        await session.flush()
    return user


# ─── Machine fitness ────────────────────────────────────────────────────

async def unclaimable_loaded_balls(session: AsyncSession) -> list[dict]:
    """LOADED balls whose bound prize could not actually be handed over.

    This is the precondition for taking someone's money: every ball still in the
    machine must be winnable. If one isn't, a player can pay, physically win, and
    get nothing — so the machine must refuse to start a turn until an operator
    voids or rebinds the offending balls.

    Checking the STATE rather than guarding each mutation is deliberate: it
    catches every route into the bad state (admin toggles, bulk import, a direct
    DB edit, a future endpoint nobody has written yet), not just the ones we
    thought to guard.

    A ball is unclaimable when:
      - BOOSTER_PAIR: its bound OpenedBooster is no longer AVAILABLE, or the
        sealed-pack SKU it needs is out of stock (e.g. the set went out of print);
      - SINGLE_CARD:  its bound Card has left the pool.
    """
    rows = (await session.execute(
        select(Ball, OpenedBooster, Card, ClosedBoosterStock.in_stock)
        .outerjoin(OpenedBooster, OpenedBooster.id == Ball.opened_booster_id)
        .outerjoin(Card, Card.id == Ball.prize_card_id)
        .outerjoin(ClosedBoosterStock, ClosedBoosterStock.sku == OpenedBooster.sku)
        .where(Ball.status == BallStatus.LOADED)
    )).all()

    bad: list[dict] = []
    for ball, booster, card, in_stock in rows:
        if ball.prize_kind == PrizeKind.BOOSTER_PAIR:
            if booster is None:
                bad.append({"serial": ball.serial, "reason": "no bound booster"})
            elif booster.status != InventoryStatus.AVAILABLE:
                bad.append({"serial": ball.serial,
                            "reason": f"booster is {booster.status.value}, not AVAILABLE"})
            elif not in_stock:
                bad.append({"serial": ball.serial,
                            "reason": f"sealed pack {booster.sku} is out of stock"})
        else:  # SINGLE_CARD
            if card is None:
                bad.append({"serial": ball.serial, "reason": "no bound card"})
            elif card.status != CardStatus.IN_POOL:
                bad.append({"serial": ball.serial,
                            "reason": f"card is {card.status.value}, not IN_POOL"})
    return bad


# ─── Win creation (at grab time) ────────────────────────────────────────

async def reserve_win(
    session: AsyncSession,
    *,
    ball_serial: str,
    wallet_address: str,
    queue_entry_id: int,
) -> Win:
    """Called when the claw confirms a grab.

    Pre-conditions assumed by the caller:
    - The RFID secret + prize_id read from the ball has been verified
      against its on-chain commitment.
    - The QueueEntry exists and corresponds to this player's turn.

    Atomically:
    - Marks the ball GRABBED.
    - For BOOSTER_PAIR: reserves the bound OpenedBooster (single-row) and
      confirms a sealed pack of the same SKU is in stock (ClosedBoosterStock
      is a per-SKU availability flag — fungible, nothing to decrement).
    - For SINGLE_CARD: reserves the bound Card.
    - Creates the Win row in PENDING with a 30d expiry, snapshotting the
      resell price computed from the ball's bound prize.

    Does NOT flip QueueEntry.win — that stays driven by the on-chain
    PlayerWin event handled in listeners.py, which is the authoritative
    on-chain confirmation.

    Raises PoolExhausted if any required inventory is missing — the caller
    should refund the bet (BET_REFUND ledger entry) per its own policy.
    """
    res = await session.execute(
        select(Ball).where(Ball.serial == ball_serial).with_for_update()
    )
    ball: Optional[Ball] = res.scalar_one_or_none()
    if ball is None or ball.status != BallStatus.LOADED:
        raise BallNotAvailable(f"Ball {ball_serial} is not LOADED")

    user = await get_or_create_user(session, wallet_address)

    # The ball has physically fallen down the chute — that is a fact about the
    # world, not a consequence of the prize bookkeeping working out. Commit it
    # on its own, BEFORE we try to reserve the prize.
    #
    # Otherwise any failure below (PoolExhausted, a constraint violation, a
    # transient DB error — everything the caller's `except Exception` catches)
    # rolls the whole transaction back and returns the ball to LOADED. The
    # database would then insist a ball is in the machine that is sitting in the
    # prize bin: it gets counted as available, and could be awarded a second
    # time if its serial is ever read again.
    #
    # Committing here also strengthens the double-grab guard: a concurrent
    # reserve_win for the same serial now sees GRABBED and raises BallNotAvailable.
    ball.status = BallStatus.GRABBED
    await session.commit()

    if ball.prize_kind == PrizeKind.BOOSTER_PAIR:
        opened_id = ball.opened_booster_id
        r1 = await session.execute(
            update(OpenedBooster)
            .where(
                OpenedBooster.id == opened_id,
                OpenedBooster.status == InventoryStatus.AVAILABLE,
            )
            .values(status=InventoryStatus.RESERVED)
        )
        if r1.rowcount == 0:
            raise PoolExhausted(f"OpenedBooster {opened_id} not available")

        sku = (await session.execute(
            select(OpenedBooster.sku).where(OpenedBooster.id == opened_id)
        )).scalar_one()

        # Sealed packs are fungible-by-SKU: just confirm we still have one of
        # this SKU to ship. No per-unit reservation — ClosedBoosterStock is an
        # availability flag the operator manages by hand.
        in_stock = await session.scalar(
            select(ClosedBoosterStock.in_stock).where(ClosedBoosterStock.sku == sku)
        )
        if not in_stock:
            raise PoolExhausted(f"No sealed pack in stock for SKU {sku}")

        win = Win(
            user_id=user.id,
            queue_entry_id=queue_entry_id,
            ball_id=ball.id,
            prize_kind=ball.prize_kind,
            expires_at=_expiry_from_now(),
            resell_price_cents=_booster_resell_price(sku),
        )
        session.add(win)
        await session.flush()  # populate win.id

        await session.execute(
            update(OpenedBooster)
            .where(OpenedBooster.id == opened_id)
            .values(reserved_by_win_id=win.id)
        )
        return win

    # SINGLE_CARD
    card_id = ball.prize_card_id
    card_row = (await session.execute(
        select(Card).where(Card.id == card_id)
    )).scalar_one_or_none()
    if card_row is None:
        raise PoolExhausted(f"Card {card_id} not found")
    r = await session.execute(
        update(Card)
        .where(Card.id == card_id, Card.status == CardStatus.IN_POOL)
        .values(status=CardStatus.RESERVED)
    )
    if r.rowcount == 0:
        raise PoolExhausted(f"Card {card_id} not available")

    win = Win(
        user_id=user.id,
        queue_entry_id=queue_entry_id,
        ball_id=ball.id,
        prize_kind=ball.prize_kind,
        expires_at=_expiry_from_now(),
        resell_price_cents=_card_resell_price(card_row),
        prize_card_id=card_id,
    )
    session.add(win)
    await session.flush()
    return win


def _booster_resell_price(sku: str) -> int:
    return RESELL_PRICE_BY_BOOSTER_SKU_CENTS.get(
        sku, RESELL_PRICE_BY_BOOSTER_SKU_CENTS["default"]
    )


def _card_resell_price(card: Card) -> int:
    return RESELL_PRICE_BY_RARITY_CENTS.get(card.rarity.value, 0)


# ─── Booster-pair settlements ───────────────────────────────────────────

async def open_booster_win(session: AsyncSession, win_id: uuid.UUID) -> None:
    """User opens a booster digitally — consume the opened (filmed) booster and
    transfer its cards to the user's collection. The sealed pack stays in the
    SKU pool (nothing to release — availability is operator-managed)."""
    win = await _load_pending_booster_win(session, win_id)

    await session.execute(
        update(OpenedBooster)
        .where(OpenedBooster.id == win.opened_booster.id)
        .values(status=InventoryStatus.CONSUMED)
    )
    await session.execute(
        update(Card)
        .where(Card.opened_booster_id == win.opened_booster.id)
        .values(
            owner_user_id=win.user_id,
            status=CardStatus.IN_COLLECTION,
            acquired_at=datetime.utcnow(),
        )
    )
    win.status = WinStatus.SETTLED_OPEN
    win.settled_at = datetime.utcnow()
    win.settled_by = SettlementKind.USER_OPEN


async def resell_booster_win(session: AsyncSession, win_id: uuid.UUID) -> None:
    await _settle_booster_as_resell(session, win_id, SettlementKind.USER_RESELL)


async def ship_booster_win(
    session: AsyncSession,
    win_id: uuid.UUID,
    address: ShippingAddress,
) -> Shipment:
    win = await _load_pending_booster_win(session, win_id)
    # Capture the SKU before releasing the opened booster — it's what the
    # operator physically pulls and mails.
    sku = win.opened_booster.sku if win.opened_booster else None

    await session.execute(
        update(OpenedBooster)
        .where(OpenedBooster.id == win.opened_booster.id)
        .values(status=InventoryStatus.AVAILABLE, reserved_by_win_id=None)
    )

    shipment = Shipment(
        user_id=win.user_id, shipping_address=dict(address), sku=sku,
    )
    session.add(shipment)
    await session.flush()

    win.status = WinStatus.SETTLED_SHIP
    win.settled_at = datetime.utcnow()
    win.settled_by = SettlementKind.USER_SHIP
    return shipment


async def _settle_booster_as_resell(
    session: AsyncSession,
    win_id: uuid.UUID,
    settled_by: SettlementKind,
) -> None:
    win = await _load_pending_booster_win(session, win_id)

    await session.execute(
        update(OpenedBooster)
        .where(OpenedBooster.id == win.opened_booster.id)
        .values(status=InventoryStatus.AVAILABLE, reserved_by_win_id=None)
    )
    session.add(LedgerEntry(
        user_id=win.user_id,
        kind=(LedgerKind.AUTO_RESELL if settled_by == SettlementKind.AUTO_RESELL else LedgerKind.RESELL),
        amount_cents=win.resell_price_cents,
        win_id=win.id,
    ))
    win.status = (
        WinStatus.EXPIRED if settled_by == SettlementKind.AUTO_RESELL
        else WinStatus.SETTLED_RESELL
    )
    win.settled_at = datetime.utcnow()
    win.settled_by = settled_by


# ─── Single-card settlements ────────────────────────────────────────────

async def keep_card_win(session: AsyncSession, win_id: uuid.UUID) -> None:
    win = await _load_pending_card_win(session, win_id)
    await session.execute(
        update(Card)
        .where(Card.id == win.prize_card_id)
        .values(
            status=CardStatus.IN_COLLECTION,
            owner_user_id=win.user_id,
            acquired_at=datetime.utcnow(),
        )
    )
    win.status = WinStatus.SETTLED_KEEP
    win.settled_at = datetime.utcnow()
    win.settled_by = SettlementKind.USER_KEEP


async def resell_card_win(session: AsyncSession, win_id: uuid.UUID) -> None:
    await _settle_card_as_resell(session, win_id, SettlementKind.USER_RESELL)


async def ship_card_win(
    session: AsyncSession,
    win_id: uuid.UUID,
    address: ShippingAddress,
) -> Shipment:
    win = await _load_pending_card_win(session, win_id)

    shipment = Shipment(user_id=win.user_id, shipping_address=dict(address))
    session.add(shipment)
    await session.flush()

    # Bypass IN_COLLECTION — user is committing to physical ownership.
    # acquired_at still set for the audit trail.
    await session.execute(
        update(Card)
        .where(Card.id == win.prize_card_id)
        .values(
            status=CardStatus.SHIPPED,
            owner_user_id=win.user_id,
            acquired_at=datetime.utcnow(),
            shipment_id=shipment.id,
        )
    )
    win.status = WinStatus.SETTLED_SHIP
    win.settled_at = datetime.utcnow()
    win.settled_by = SettlementKind.USER_SHIP
    return shipment


async def _settle_card_as_resell(
    session: AsyncSession,
    win_id: uuid.UUID,
    settled_by: SettlementKind,
) -> None:
    win = await _load_pending_card_win(session, win_id)

    await session.execute(
        update(Card).where(Card.id == win.prize_card_id).values(status=CardStatus.IN_POOL)
    )
    session.add(LedgerEntry(
        user_id=win.user_id,
        kind=(LedgerKind.AUTO_RESELL if settled_by == SettlementKind.AUTO_RESELL else LedgerKind.RESELL),
        amount_cents=win.resell_price_cents,
        win_id=win.id,
    ))
    win.status = (
        WinStatus.EXPIRED if settled_by == SettlementKind.AUTO_RESELL
        else WinStatus.SETTLED_RESELL
    )
    win.settled_at = datetime.utcnow()
    win.settled_by = settled_by


# ─── From-collection actions on Card ────────────────────────────────────

async def ship_card_from_collection(
    session: AsyncSession,
    *,
    card_id: uuid.UUID,
    user_id: uuid.UUID,
    address: ShippingAddress,
) -> Shipment:
    card = await session.get(Card, card_id)
    if card is None:
        raise CardNotActionable(f"Card {card_id} not found")
    if card.owner_user_id != user_id:
        raise NotOwner(f"User {user_id} does not own card {card_id}")
    if card.status != CardStatus.IN_COLLECTION:
        raise CardNotActionable(f"Card not shippable from status {card.status}")

    shipment = Shipment(user_id=user_id, shipping_address=dict(address))
    session.add(shipment)
    await session.flush()

    await session.execute(
        update(Card).where(Card.id == card_id).values(
            status=CardStatus.SHIPPED, shipment_id=shipment.id
        )
    )
    return shipment


async def resell_card_from_collection(
    session: AsyncSession,
    *,
    card_id: uuid.UUID,
    user_id: uuid.UUID,
    resell_price_cents: int,
) -> None:
    card = await session.get(Card, card_id)
    if card is None:
        raise CardNotActionable(f"Card {card_id} not found")
    if card.owner_user_id != user_id:
        raise NotOwner(f"User {user_id} does not own card {card_id}")
    if card.status != CardStatus.IN_COLLECTION:
        raise CardNotActionable(f"Card not resellable from status {card.status}")

    await session.execute(
        update(Card).where(Card.id == card_id).values(status=CardStatus.RESOLD)
    )
    session.add(LedgerEntry(
        user_id=user_id,
        kind=LedgerKind.CARD_RESELL,
        amount_cents=resell_price_cents,
    ))


# ─── Operator: void a stuck/lost ball ───────────────────────────────────

async def void_ball(session: AsyncSession, ball_id: uuid.UUID) -> None:
    """Operator-side. Releases the bound prize back to the pool. The ball's
    secret should be published off-chain alongside this call so anyone
    tracking commitments can verify the prize wasn't reassigned silently."""
    ball = await session.get(Ball, ball_id)
    if ball is None:
        raise BallNotAvailable(f"Ball {ball_id} not found")
    if ball.status != BallStatus.LOADED:
        raise BallNotAvailable(f"Cannot void ball in status {ball.status}")

    if ball.prize_kind == PrizeKind.BOOSTER_PAIR and ball.opened_booster_id:
        await session.execute(
            update(OpenedBooster)
            .where(OpenedBooster.id == ball.opened_booster_id)
            .values(status=InventoryStatus.AVAILABLE)
        )
    elif ball.prize_kind == PrizeKind.SINGLE_CARD and ball.prize_card_id:
        await session.execute(
            update(Card)
            .where(Card.id == ball.prize_card_id)
            .values(status=CardStatus.IN_POOL)
        )
    ball.status = BallStatus.VOIDED
    ball.voided_at = datetime.utcnow()


# ─── Cron: auto-resell expired pending wins ─────────────────────────────

async def run_auto_resell_expired(
    session_factory: async_sessionmaker[AsyncSession],
) -> int:
    """Find all PENDING wins past their expiry and settle each as
    AUTO_RESELL. Each win is its own short tx so a bad row can't block
    the rest. Intended to run on a periodic scheduler (e.g. once a minute).
    """
    async with session_factory() as session:
        res = await session.execute(
            select(Win.id, Win.prize_kind)
            .where(Win.status == WinStatus.PENDING, Win.expires_at <= datetime.utcnow())
        )
        expired = res.all()

    settled = 0
    for win_id, prize_kind in expired:
        try:
            async with session_factory() as session:
                async with session.begin():
                    if prize_kind == PrizeKind.BOOSTER_PAIR:
                        await _settle_booster_as_resell(session, win_id, SettlementKind.AUTO_RESELL)
                    else:
                        await _settle_card_as_resell(session, win_id, SettlementKind.AUTO_RESELL)
            settled += 1
        except WinAlreadySettled:
            # Race with a user terminal action; expected, just skip.
            continue
        except Exception as e:
            log.warning("auto-resell skipped for %s: %s", win_id, e)
    return settled


# ─── Helpers ────────────────────────────────────────────────────────────

async def _load_pending_booster_win(session: AsyncSession, win_id: uuid.UUID) -> Win:
    win = await session.get(Win, win_id)
    if win is None or win.status != WinStatus.PENDING:
        raise WinAlreadySettled(f"Win {win_id} is not PENDING")
    if win.prize_kind != PrizeKind.BOOSTER_PAIR:
        raise WinKindMismatch(f"Win {win_id} is not a booster pair")
    return win


async def _load_pending_card_win(session: AsyncSession, win_id: uuid.UUID) -> Win:
    win = await session.get(Win, win_id)
    if win is None or win.status != WinStatus.PENDING:
        raise WinAlreadySettled(f"Win {win_id} is not PENDING")
    if win.prize_kind != PrizeKind.SINGLE_CARD:
        raise WinKindMismatch(f"Win {win_id} is not a single card")
    return win
