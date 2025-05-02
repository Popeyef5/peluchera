from datetime import datetime
from sqlalchemy import Column, Integer, String, DateTime, Boolean, ForeignKey
from sqlalchemy.orm import relationship

from .db import Base

class Round(Base):
    __tablename__ = "round"
    id         = Column(Integer, primary_key=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
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