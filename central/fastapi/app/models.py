from datetime import datetime
from sqlalchemy import Column, Integer, String, DateTime, Boolean, ForeignKey, BigInteger, UniqueConstraint, Index
from sqlalchemy.dialects.postgresql import JSONB
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