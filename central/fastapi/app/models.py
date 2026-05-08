import enum
import uuid
from datetime import datetime
from sqlalchemy import Column, Integer, String, DateTime, Boolean, ForeignKey, BigInteger, UniqueConstraint, Index, Enum
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import relationship

from .config import DEFAULT_FEE_GROWTH, DEFAULT_MAX_FEE
from .db import Base

class Round(Base):
    __tablename__ = "round"
    id         = Column(Integer, primary_key=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    max_fee    = Column(Integer, default=DEFAULT_MAX_FEE)
    fee_growth = Column(Integer, default=DEFAULT_FEE_GROWTH)
    multiplier = Column(Integer, default=0)
    
    entries    = relationship("QueueEntry", back_populates="round", lazy="selectin")


class QueueEntry(Base):
    __tablename__ = "queue"
    id           = Column(Integer, primary_key=True)
    address      = Column(String, index=True)
    status       = Column(String, default="queued", index=True)
    created_at   = Column(DateTime, default=datetime.utcnow, index=True)
    played_at    = Column(DateTime, default=None, index=True)
    ended_at     = Column(DateTime, default=None, index=True)
    cancelled_at = Column(DateTime, default=None, index=True)
    bet          = Column(Integer, default=1)
    win          = Column(Boolean, default=False)
    key          = Column(String(66))
    round_id     = Column(Integer, ForeignKey("round.id"))
    
    round        = relationship("Round", back_populates="entries")
    

class Withdrawal(Base):
    __tablename__ = "withdrawal"
    id           = Column(Integer, primary_key=True)
    address      = Column(String, index=True)
    timestamp    = Column(DateTime, index=True)
    amount       = Column(Integer, index=True)
    

# class Block(Base):
#     __tablename__ = "chain_block"
#     number    = Column(BigInteger, primary_key=True)
#     hash      = Column(String(66), nullable=False)      # 0x...
#     timestamp = Column(BigInteger, nullable=False)      # unix seconds
#     reorged   = Column(Boolean, default=False, nullable=False)


# class Event(Base):
#     __tablename__ = "chain_event"
#     id           = Column(Integer, primary_key=True)
#     block_number = Column(BigInteger, nullable=False, index=True)
#     tx_hash      = Column(String(66),  nullable=False)
#     log_index    = Column(Integer,     nullable=False)
#     address      = Column(String(42),  nullable=False, index=True)
#     event_name   = Column(String(64),  nullable=False, index=True)
#     args         = Column(JSONB,       nullable=False)
#     removed      = Column(Boolean,     default=False, nullable=False)

#     __table_args__ = (
#         UniqueConstraint("block_number", "tx_hash", "log_index", name="ux_event_triple"),
#         Index("ix_event_name_block", "event_name", "block_number"),
#     )


# class Cursor(Base):
#     __tablename__ = "cursor"
#     name  = Column(String(64), primary_key=True)
#     value = Column(BigInteger, nullable=False)


# ─── Prize / inventory model ────────────────────────────────────────────
# QueueEntry above is the "ticket" (Bet). When QueueEntry.win = True we also
# create a Win row below holding the prize details and state machine. The
# legacy `address` column on QueueEntry/Withdrawal stays as-is; new tables
# FK to a User row created lazily by win_transitions.get_or_create_user.


class KycStatus(str, enum.Enum):
    NONE     = "NONE"
    PENDING  = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"


class PrizeKind(str, enum.Enum):
    BOOSTER_PAIR = "BOOSTER_PAIR"
    SINGLE_CARD  = "SINGLE_CARD"


class BallStatus(str, enum.Enum):
    LOADED  = "LOADED"
    GRABBED = "GRABBED"
    VOIDED  = "VOIDED"


class InventoryStatus(str, enum.Enum):
    AVAILABLE = "AVAILABLE"
    RESERVED  = "RESERVED"
    CONSUMED  = "CONSUMED"   # OpenedBooster whose cards moved to a user
    SHIPPED   = "SHIPPED"    # ClosedBooster
    RETIRED   = "RETIRED"


class CardStatus(str, enum.Enum):
    IN_POOL       = "IN_POOL"
    RESERVED      = "RESERVED"
    IN_COLLECTION = "IN_COLLECTION"
    SHIPPED       = "SHIPPED"
    RESOLD        = "RESOLD"


class CardOrigin(str, enum.Enum):
    OPENED_BOOSTER = "OPENED_BOOSTER"
    SINGLE_PRIZE   = "SINGLE_PRIZE"


class CardRarity(str, enum.Enum):
    COMMON      = "COMMON"
    UNCOMMON    = "UNCOMMON"
    RARE        = "RARE"
    HOLO_RARE   = "HOLO_RARE"
    ULTRA_RARE  = "ULTRA_RARE"
    CHASE       = "CHASE"


class WinStatus(str, enum.Enum):
    PENDING        = "PENDING"
    SETTLED_OPEN   = "SETTLED_OPEN"
    SETTLED_RESELL = "SETTLED_RESELL"
    SETTLED_SHIP   = "SETTLED_SHIP"
    SETTLED_KEEP   = "SETTLED_KEEP"
    EXPIRED        = "EXPIRED"


class SettlementKind(str, enum.Enum):
    USER_OPEN    = "USER_OPEN"
    USER_RESELL  = "USER_RESELL"
    USER_SHIP    = "USER_SHIP"
    USER_KEEP    = "USER_KEEP"
    AUTO_RESELL  = "AUTO_RESELL"


class ShipmentStatus(str, enum.Enum):
    REQUESTED = "REQUESTED"
    PACKED    = "PACKED"
    SHIPPED   = "SHIPPED"
    DELIVERED = "DELIVERED"
    RETURNED  = "RETURNED"


class LedgerKind(str, enum.Enum):
    DEPOSIT     = "DEPOSIT"
    BET_PLACED  = "BET_PLACED"
    BET_REFUND  = "BET_REFUND"
    RESELL      = "RESELL"
    AUTO_RESELL = "AUTO_RESELL"
    CARD_RESELL = "CARD_RESELL"
    WITHDRAWAL  = "WITHDRAWAL"


class User(Base):
    __tablename__ = "user_account"   # "user" is reserved in some Postgres contexts
    id               = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    wallet_address   = Column(String, unique=True, index=True, nullable=False)
    email            = Column(String)
    shipping_name    = Column(String)
    shipping_address = Column(JSONB)
    kyc_status       = Column(Enum(KycStatus, name="kyc_status"), default=KycStatus.NONE, nullable=False)
    created_at       = Column(DateTime, default=datetime.utcnow, nullable=False)


class CommitmentBatch(Base):
    __tablename__ = "commitment_batch"
    id            = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    merkle_root   = Column(String, unique=True, nullable=False)
    chain_tx_hash = Column(String, nullable=False)
    published_at  = Column(DateTime, default=datetime.utcnow, nullable=False)


class Ball(Base):
    __tablename__ = "ball"
    id                  = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    serial              = Column(String, unique=True, index=True, nullable=False)
    prize_kind          = Column(Enum(PrizeKind, name="prize_kind"), nullable=False)

    # Exactly one of these is set, matching prize_kind.
    opened_booster_id   = Column(UUID(as_uuid=True), ForeignKey("opened_booster.id"), unique=True)
    prize_card_id       = Column(UUID(as_uuid=True), ForeignKey("card.id"), unique=True)

    secret              = Column(String, nullable=False)
    commitment_hash     = Column(String, unique=True, nullable=False)
    merkle_proof        = Column(JSONB, nullable=False)
    batch_id            = Column(UUID(as_uuid=True), ForeignKey("commitment_batch.id"), nullable=False)

    status              = Column(Enum(BallStatus, name="ball_status"), default=BallStatus.LOADED, nullable=False)
    voided_at           = Column(DateTime)

    opened_booster      = relationship("OpenedBooster", foreign_keys=[opened_booster_id], back_populates="ball", uselist=False, lazy="selectin")
    prize_card          = relationship("Card", foreign_keys=[prize_card_id], back_populates="ball", uselist=False, lazy="selectin")
    batch               = relationship("CommitmentBatch", lazy="selectin")
    win                 = relationship("Win", back_populates="ball", uselist=False)


class ClosedBooster(Base):
    __tablename__ = "closed_booster"
    id                = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    sku               = Column(String, nullable=False)
    status            = Column(Enum(InventoryStatus, name="inventory_status"), default=InventoryStatus.AVAILABLE, nullable=False)

    reserved_by_win_id = Column(UUID(as_uuid=True), ForeignKey("win.id"), unique=True)
    shipment_id       = Column(UUID(as_uuid=True), ForeignKey("shipment.id"), unique=True)

    reserved_by_win   = relationship("Win", foreign_keys=[reserved_by_win_id], back_populates="closed_booster")
    shipment          = relationship("Shipment", foreign_keys=[shipment_id], back_populates="closed_booster")

    __table_args__ = (
        Index("ix_closed_booster_sku_status", "sku", "status"),
    )


class OpenedBooster(Base):
    __tablename__ = "opened_booster"
    id                = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    sku               = Column(String, nullable=False)
    video_url         = Column(String, nullable=False)
    video_hash        = Column(String, unique=True, nullable=False)
    filmed_at         = Column(DateTime, nullable=False)
    status            = Column(Enum(InventoryStatus, name="inventory_status"), default=InventoryStatus.AVAILABLE, nullable=False)

    reserved_by_win_id = Column(UUID(as_uuid=True), ForeignKey("win.id"), unique=True)

    reserved_by_win   = relationship("Win", foreign_keys=[reserved_by_win_id], back_populates="opened_booster")
    cards             = relationship("Card", back_populates="opened_booster", lazy="selectin")
    ball              = relationship("Ball", back_populates="opened_booster", uselist=False)

    __table_args__ = (
        Index("ix_opened_booster_sku_status", "sku", "status"),
    )


class Card(Base):
    __tablename__ = "card"
    id                = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    set               = Column(String, nullable=False)
    number            = Column(String, nullable=False)
    rarity            = Column(Enum(CardRarity, name="card_rarity"), nullable=False)
    image_url         = Column(String, nullable=False)
    condition         = Column(String)

    origin            = Column(Enum(CardOrigin, name="card_origin"), nullable=False)
    opened_booster_id = Column(UUID(as_uuid=True), ForeignKey("opened_booster.id"))

    status            = Column(Enum(CardStatus, name="card_status"), default=CardStatus.IN_POOL, nullable=False)
    owner_user_id     = Column(UUID(as_uuid=True), ForeignKey("user_account.id"))
    acquired_at       = Column(DateTime)

    shipment_id       = Column(UUID(as_uuid=True), ForeignKey("shipment.id"))

    opened_booster    = relationship("OpenedBooster", back_populates="cards")
    owner             = relationship("User", foreign_keys=[owner_user_id])
    shipment          = relationship("Shipment", foreign_keys=[shipment_id], back_populates="cards")
    ball              = relationship("Ball", back_populates="prize_card", uselist=False)
    win               = relationship("Win", back_populates="prize_card", uselist=False, foreign_keys="Win.prize_card_id")

    __table_args__ = (
        Index("ix_card_owner_status", "owner_user_id", "status"),
    )


class Win(Base):
    __tablename__ = "win"
    id                = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id           = Column(UUID(as_uuid=True), ForeignKey("user_account.id"), nullable=False)
    queue_entry_id    = Column(Integer, ForeignKey("queue.id"), unique=True, nullable=False)
    ball_id           = Column(UUID(as_uuid=True), ForeignKey("ball.id"), unique=True, nullable=False)

    prize_kind        = Column(Enum(PrizeKind, name="prize_kind"), nullable=False)
    status            = Column(Enum(WinStatus, name="win_status"), default=WinStatus.PENDING, nullable=False)
    expires_at        = Column(DateTime, nullable=False)

    # Single-card wins set this; booster-pair wins use closed/opened relationships.
    prize_card_id     = Column(UUID(as_uuid=True), ForeignKey("card.id"), unique=True)

    # Snapshotted at win time so later operator price changes don't
    # retroactively alter what users were promised.
    resell_price_cents = Column(Integer, nullable=False)

    created_at        = Column(DateTime, default=datetime.utcnow, nullable=False)
    settled_at        = Column(DateTime)
    settled_by        = Column(Enum(SettlementKind, name="settlement_kind"))

    user              = relationship("User", lazy="selectin")
    queue_entry       = relationship("QueueEntry", lazy="selectin")
    ball              = relationship("Ball", back_populates="win", lazy="selectin")
    closed_booster    = relationship("ClosedBooster", back_populates="reserved_by_win", uselist=False, foreign_keys="ClosedBooster.reserved_by_win_id", lazy="selectin")
    opened_booster    = relationship("OpenedBooster", back_populates="reserved_by_win", uselist=False, foreign_keys="OpenedBooster.reserved_by_win_id", lazy="selectin")
    prize_card        = relationship("Card", back_populates="win", foreign_keys=[prize_card_id], lazy="selectin")

    __table_args__ = (
        Index("ix_win_user_status", "user_id", "status"),
        Index("ix_win_status_expires", "status", "expires_at"),
    )


class Shipment(Base):
    __tablename__ = "shipment"
    id                = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id           = Column(UUID(as_uuid=True), ForeignKey("user_account.id"), nullable=False)
    status            = Column(Enum(ShipmentStatus, name="shipment_status"), default=ShipmentStatus.REQUESTED, nullable=False)
    carrier           = Column(String)
    tracking_number   = Column(String)
    shipped_at        = Column(DateTime)
    delivered_at      = Column(DateTime)
    shipping_address  = Column(JSONB, nullable=False)

    created_at        = Column(DateTime, default=datetime.utcnow, nullable=False)

    user              = relationship("User")
    closed_booster    = relationship("ClosedBooster", back_populates="shipment", uselist=False, foreign_keys="ClosedBooster.shipment_id")
    cards             = relationship("Card", back_populates="shipment", foreign_keys="Card.shipment_id")

    __table_args__ = (
        Index("ix_shipment_user_status", "user_id", "status"),
    )


class LedgerEntry(Base):
    __tablename__ = "ledger_entry"
    id                  = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id             = Column(UUID(as_uuid=True), ForeignKey("user_account.id"), nullable=False)
    kind                = Column(Enum(LedgerKind, name="ledger_kind"), nullable=False)
    amount_cents        = Column(Integer, nullable=False)

    queue_entry_id      = Column(Integer, ForeignKey("queue.id"))
    win_id              = Column(UUID(as_uuid=True), ForeignKey("win.id"))
    shipment_id         = Column(UUID(as_uuid=True), ForeignKey("shipment.id"))
    withdrawal_tx_hash  = Column(String)

    created_at          = Column(DateTime, default=datetime.utcnow, nullable=False)

    user                = relationship("User")

    __table_args__ = (
        Index("ix_ledger_user_created", "user_id", "created_at"),
    )