"""one LOADED ball per prize (enable OpenedBooster/Card reuse)

Ball.opened_booster_id / prize_card_id were plain-UNIQUE — one ball per prize
forever — which silently blocked reuse: after a winner bought back or shipped
sealed, the freed OpenedBooster couldn't be rebound because the (now settled)
ball still held the unique reference. Replace with partial unique indexes so
only ONE LOADED ball may hold a given prize at a time; settled/voided balls
keep their reference for audit.

Revision ID: c3e5a7b9d1f4
Revises: b2d4f6a8c0e1
Create Date: 2026-08-05

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'c3e5a7b9d1f4'
down_revision: Union[str, None] = 'b2d4f6a8c0e1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint("ball_opened_booster_id_key", "ball", type_="unique")
    op.drop_constraint("ball_prize_card_id_key", "ball", type_="unique")
    op.create_index(
        "uq_ball_opened_booster_loaded", "ball", ["opened_booster_id"], unique=True,
        postgresql_where=sa.text("status = 'LOADED' AND opened_booster_id IS NOT NULL"),
    )
    op.create_index(
        "uq_ball_prize_card_loaded", "ball", ["prize_card_id"], unique=True,
        postgresql_where=sa.text("status = 'LOADED' AND prize_card_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_ball_prize_card_loaded", "ball")
    op.drop_index("uq_ball_opened_booster_loaded", "ball")
    op.create_unique_constraint("ball_prize_card_id_key", "ball", ["prize_card_id"])
    op.create_unique_constraint("ball_opened_booster_id_key", "ball", ["opened_booster_id"])
