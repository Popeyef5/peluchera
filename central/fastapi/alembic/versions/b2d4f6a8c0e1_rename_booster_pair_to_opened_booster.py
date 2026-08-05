"""rename PrizeKind BOOSTER_PAIR -> OPENED_BOOSTER

A ball's booster prize is just an OpenedBooster binding; the "pair" name was
legacy. Recreate the prize_kind enum with the clearer value and remap existing
rows. Recreate-in-one-transaction (rather than ADD VALUE + UPDATE) sidesteps
Postgres's "unsafe use of new enum value in same transaction" restriction.

Revision ID: b2d4f6a8c0e1
Revises: a1c3e5b7d9f2
Create Date: 2026-08-05

"""
from typing import Sequence, Union

from alembic import op

revision: str = 'b2d4f6a8c0e1'
down_revision: Union[str, None] = 'a1c3e5b7d9f2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLES = ("ball", "win")


def _recreate(new_values: str, remap_sql: str) -> None:
    op.execute(f"CREATE TYPE prize_kind_new AS ENUM ({new_values})")
    for t in _TABLES:
        op.execute(
            f"ALTER TABLE {t} ALTER COLUMN prize_kind TYPE prize_kind_new "
            f"USING ({remap_sql})::prize_kind_new"
        )
    op.execute("DROP TYPE prize_kind")
    op.execute("ALTER TYPE prize_kind_new RENAME TO prize_kind")


def upgrade() -> None:
    _recreate(
        "'OPENED_BOOSTER','CLOSED_BOOSTER','SINGLE_CARD'",
        "CASE prize_kind::text WHEN 'BOOSTER_PAIR' THEN 'OPENED_BOOSTER' ELSE prize_kind::text END",
    )


def downgrade() -> None:
    _recreate(
        "'BOOSTER_PAIR','CLOSED_BOOSTER','SINGLE_CARD'",
        "CASE prize_kind::text WHEN 'OPENED_BOOSTER' THEN 'BOOSTER_PAIR' ELSE prize_kind::text END",
    )
