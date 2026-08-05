"""full simey holo-type vocabulary (V / VMAX / VSTAR / shiny / full-art)

Extends the holo_type vocabulary so the admin catalog offers the complete set
of poke-holo.simey.me categories by default — the frontend already knows how to
render each one (see next/lib/cards.ts HOLO_STYLES), which instantiates the
matching data-rarity / data-subtypes CSS treatment when a won card is shown.

Additive and idempotent: existing rows keep their names (only their sort_order
is normalized to the showcase order) and the missing categories are inserted.
No card_type.type value is touched, so nothing is orphaned.

Revision ID: e7a9c1b3d5f8
Revises: d5f7b9c1e3a6
Create Date: 2026-08-05
"""
from alembic import op
import sqlalchemy as sa


revision = "e7a9c1b3d5f8"
down_revision = "d5f7b9c1e3a6"
branch_labels = None
depends_on = None

# The full vocabulary in simey showcase order. Names already present are left
# in place (their sort_order re-normalized); the rest are inserted.
_HOLO_TYPES = [
    "basic",
    "reverse-holo",
    "holo",
    "cosmos-holo",
    "amazing",
    "radiant-holo",
    "v",
    "v-full-art",
    "vmax",
    "vmax-alt",
    "vstar",
    "rainbow",
    "secret",
    "galaxy-holo",
    "trainer-gallery",
    "trainer-full-art",
    "shiny",
    "shiny-v",
]

# The names that did NOT exist before this migration — removed on downgrade so
# the original nine-entry vocabulary is restored.
_ADDED = [
    "basic", "v", "v-full-art", "vmax", "vmax-alt",
    "vstar", "trainer-full-art", "shiny", "shiny-v",
]


def upgrade() -> None:
    for i, name in enumerate(_HOLO_TYPES):
        # Insert if missing; otherwise just fix the ordering. Unique(name)
        # backs the ON CONFLICT.
        op.execute(
            sa.text(
                "INSERT INTO holo_type (id, name, sort_order, created_at) "
                "VALUES (gen_random_uuid(), :name, :ord, now()) "
                "ON CONFLICT (name) DO UPDATE SET sort_order = EXCLUDED.sort_order"
            ).bindparams(name=name, ord=i)
        )


def downgrade() -> None:
    for name in _ADDED:
        op.execute(
            sa.text("DELETE FROM holo_type WHERE name = :name").bindparams(name=name)
        )
