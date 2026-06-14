"""enable row level security on all tables

Revision ID: b7c1d9e2f3a4
Revises: a8936058c0d8
Create Date: 2026-06-10

On Supabase the `public` schema is auto-exposed via the REST API to the public
anon key. We access the DB only through FastAPI's direct postgres-role
connection (which bypasses RLS), so we enable RLS with NO policies — that locks
the anon/authenticated roles out of the REST surface entirely while leaving the
backend's access untouched. Harmless on plain local Postgres (no REST layer).

Every NEW table should be added here (or in its own migration) so this invariant
holds across environments.
"""
from alembic import op

revision = "b7c1d9e2f3a4"
down_revision = "a8936058c0d8"
branch_labels = None
depends_on = None

_TABLES = [
    "alembic_version",
    "round",
    "withdrawal",
    "user_account",
    "commitment_batch",
    "ball",
    "closed_booster_stock",
    "opened_booster",
    "card",
    "win",
    "queue",
    "shipment",
    "ledger_entry",
]


def upgrade() -> None:
    for t in _TABLES:
        op.execute(f'ALTER TABLE public."{t}" ENABLE ROW LEVEL SECURITY')


def downgrade() -> None:
    for t in _TABLES:
        op.execute(f'ALTER TABLE public."{t}" DISABLE ROW LEVEL SECURITY')
