"""manage holo types and rarities (editable vocabularies + rarity resell price)

Introduces two admin-managed lookup tables — holo_type and rarity — and moves
card_type.rarity off the card_rarity enum onto a plain string that names a
rarity row. Rarity rows carry the resell price (moved out of config), so an
operator can add/remove/reprice without a deploy.

Revision ID: f0a1b2c3d4e5
Revises: 382488dd0106
Create Date: 2026-08-04

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'f0a1b2c3d4e5'
down_revision: Union[str, None] = '382488dd0106'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Defaults seeded so existing data keeps working: the rarity names match the old
# enum's values (card_type.rarity strings already equal these), and the prices
# match the old RESELL_PRICE_BY_RARITY_CENTS map in config.py.
_RARITIES = [
    ("COMMON", 50, 0),
    ("UNCOMMON", 150, 1),
    ("RARE", 400, 2),
    ("HOLO_RARE", 900, 3),
    ("ULTRA_RARE", 2500, 4),
    ("CHASE", 8000, 5),
]
_HOLO_TYPES = [
    "holo", "reverse-holo", "cosmos-holo", "galaxy-holo",
    "radiant-holo", "amazing", "trainer-gallery", "rainbow", "secret",
]


def upgrade() -> None:
    op.create_table(
        "holo_type",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
    )
    op.create_table(
        "rarity",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("resell_price_cents", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
    )

    # Seed the vocabularies.
    for i, name in enumerate(_HOLO_TYPES):
        op.execute(
            sa.text(
                "INSERT INTO holo_type (id, name, sort_order, created_at) "
                "VALUES (gen_random_uuid(), :name, :ord, now())"
            ).bindparams(name=name, ord=i)
        )
    for name, price, order in _RARITIES:
        op.execute(
            sa.text(
                "INSERT INTO rarity (id, name, resell_price_cents, sort_order, created_at) "
                "VALUES (gen_random_uuid(), :name, :price, :ord, now())"
            ).bindparams(name=name, price=price, ord=order)
        )

    # card_type.rarity: card_rarity enum -> plain string (values are identical).
    op.alter_column(
        "card_type", "rarity",
        existing_type=postgresql.ENUM(
            "COMMON", "UNCOMMON", "RARE", "HOLO_RARE", "ULTRA_RARE", "CHASE",
            name="card_rarity", create_type=False,
        ),
        type_=sa.String(),
        postgresql_using="rarity::text",
        existing_nullable=True,
    )
    op.execute("DROP TYPE IF EXISTS card_rarity")


def downgrade() -> None:
    card_rarity = postgresql.ENUM(
        "COMMON", "UNCOMMON", "RARE", "HOLO_RARE", "ULTRA_RARE", "CHASE",
        name="card_rarity",
    )
    card_rarity.create(op.get_bind(), checkfirst=True)
    op.alter_column(
        "card_type", "rarity",
        existing_type=sa.String(),
        type_=card_rarity,
        postgresql_using="rarity::card_rarity",
        existing_nullable=True,
    )
    op.drop_table("rarity")
    op.drop_table("holo_type")
