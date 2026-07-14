"""add COMP payment method (free play)

Revision ID: d4e6f8a0b2c3
Revises: c3d5e7f9a1b2
Create Date: 2026-07-13

A comped play (FREE_PLAY mode): the player logged in for real and played for
real, but nobody was charged. Recorded as its own method with amount_cents=0 so
it is unmistakable in the payment table — revenue reporting stays clean, and you
can always see which plays were free.

`ALTER TYPE ... ADD VALUE` cannot run inside a transaction block, hence the
autocommit block. IF NOT EXISTS keeps it re-runnable.
"""
from alembic import op

revision = "d4e6f8a0b2c3"
down_revision = "c3d5e7f9a1b2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE payment_method ADD VALUE IF NOT EXISTS 'COMP'")


def downgrade() -> None:
    # Postgres cannot drop a value from an enum. Removing it would mean
    # recreating the type and rewriting every dependent column — not worth it
    # for an additive change, and any COMP rows would have nowhere to go.
    pass
