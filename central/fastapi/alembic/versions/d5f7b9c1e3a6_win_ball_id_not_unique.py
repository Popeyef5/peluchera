"""drop unique on win.ball_id — a reusable tag accrues many wins

A physical ball (RFID tag) is rebound to a new prize and re-won over its
lifetime, so it legitimately gets multiple Win rows. The plain UNIQUE on
win.ball_id made the second win of any re-bound ball fail (UniqueViolation ->
prize_unavailable -> no win modal). queue_entry_id stays unique (one win per
turn) and the grab guard prevents a double-win within a turn.

Revision ID: d5f7b9c1e3a6
Revises: c3e5a7b9d1f4
Create Date: 2026-08-05

"""
from typing import Sequence, Union

from alembic import op

revision: str = 'd5f7b9c1e3a6'
down_revision: Union[str, None] = 'c3e5a7b9d1f4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint("win_ball_id_key", "win", type_="unique")


def downgrade() -> None:
    op.create_unique_constraint("win_ball_id_key", "win", ["ball_id"])
