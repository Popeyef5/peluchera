"""closed_booster.reveal_card_count (open-animation face-down card count)

An independent presentation field: how many face-down cards the win-reveal
animation fans to the back before turning the pile — distinct from card_count
(the real pack size). Nullable; the reveal falls back to card_count when unset.

Revision ID: f8b0d2c4e6a9
Revises: e7a9c1b3d5f8
Create Date: 2026-08-05
"""
from alembic import op
import sqlalchemy as sa


revision = "f8b0d2c4e6a9"
down_revision = "e7a9c1b3d5f8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "closed_booster",
        sa.Column("reveal_card_count", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("closed_booster", "reveal_card_count")
