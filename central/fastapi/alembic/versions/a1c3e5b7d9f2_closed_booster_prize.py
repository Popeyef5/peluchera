"""closed-booster prize: PrizeKind.CLOSED_BOOSTER + ball.closed_booster_id

A ball can now award a sealed pack directly (kept or sold back, never opened),
in addition to a booster pair (opened) or a single card.

Revision ID: a1c3e5b7d9f2
Revises: f0a1b2c3d4e5
Create Date: 2026-08-04

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'a1c3e5b7d9f2'
down_revision: Union[str, None] = 'f0a1b2c3d4e5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # New enum value. Safe inside Alembic's transaction on PG12+ (the value just
    # can't be *used* until commit — this migration only adds a column).
    op.execute("ALTER TYPE prize_kind ADD VALUE IF NOT EXISTS 'CLOSED_BOOSTER'")
    op.add_column("ball", sa.Column("closed_booster_id", sa.UUID(), nullable=True))
    op.create_foreign_key(
        "fk_ball_closed_booster", "ball", "closed_booster",
        ["closed_booster_id"], ["id"],
    )


def downgrade() -> None:
    op.drop_constraint("fk_ball_closed_booster", "ball", type_="foreignkey")
    op.drop_column("ball", "closed_booster_id")
    # Postgres can't drop an enum value; leaving 'CLOSED_BOOSTER' in prize_kind
    # is harmless.
