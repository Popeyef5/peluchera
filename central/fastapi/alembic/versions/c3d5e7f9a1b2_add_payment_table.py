"""add payment table, stripe_customer_id, nullable wallet_address

Revision ID: c3d5e7f9a1b2
Revises: b7c1d9e2f3a4
Create Date: 2026-06-23

Groundwork for the unified pay-to-play flow (crypto OR card). Adds:
  - payment table: the convergence seam between the two funding rails.
  - user_account.stripe_customer_id: saved-card ("remember card") customer.
  - user_account.wallet_address made nullable: card-only players don't need an
    address to pay (they still get a Reown embedded address for payouts).

Follows the baseline's raw-SQL op.execute style. RLS is enabled on the new
payment table to preserve the no-REST-surface invariant from b7c1d9e2f3a4.
"""
from alembic import op

revision = "c3d5e7f9a1b2"
down_revision = "b7c1d9e2f3a4"
branch_labels = None
depends_on = None


_UPGRADE = [
    "CREATE TYPE payment_method AS ENUM ('CRYPTO', 'CARD')",
    "CREATE TYPE payment_status AS ENUM ('PENDING', 'CONFIRMED', 'FAILED', 'REFUNDED')",

    "ALTER TABLE user_account ADD COLUMN stripe_customer_id VARCHAR",
    "CREATE UNIQUE INDEX ix_user_account_stripe_customer_id ON user_account (stripe_customer_id)",
    "ALTER TABLE user_account ALTER COLUMN wallet_address DROP NOT NULL",

    "CREATE TABLE payment (\n\tid UUID NOT NULL, \n\tuser_id UUID, \n\taddress VARCHAR, \n\tqueue_entry_id INTEGER, \n\tmethod payment_method NOT NULL, \n\tamount_cents INTEGER NOT NULL, \n\tstatus payment_status NOT NULL, \n\tref VARCHAR, \n\tcreated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, \n\tconfirmed_at TIMESTAMP WITHOUT TIME ZONE, \n\tPRIMARY KEY (id), \n\tUNIQUE (queue_entry_id), \n\tUNIQUE (ref), \n\tFOREIGN KEY(user_id) REFERENCES user_account (id), \n\tFOREIGN KEY(queue_entry_id) REFERENCES queue (id)\n)",
    "CREATE INDEX ix_payment_user_id ON payment (user_id)",
    "CREATE INDEX ix_payment_address ON payment (address)",
    "CREATE INDEX ix_payment_status_created ON payment (status, created_at)",

    # Preserve the RLS invariant (see b7c1d9e2f3a4): lock the REST surface,
    # backend's direct postgres role bypasses it. Harmless on plain Postgres.
    'ALTER TABLE public."payment" ENABLE ROW LEVEL SECURITY',
]


def upgrade() -> None:
    for stmt in _UPGRADE:
        op.execute(stmt)


def downgrade() -> None:
    op.execute('DROP TABLE IF EXISTS "payment" CASCADE')
    op.execute("DROP INDEX IF EXISTS ix_user_account_stripe_customer_id")
    op.execute("ALTER TABLE user_account DROP COLUMN IF EXISTS stripe_customer_id")
    # Restore the NOT NULL constraint (fails if any NULL wallet_address exists).
    op.execute("ALTER TABLE user_account ALTER COLUMN wallet_address SET NOT NULL")
    op.execute('DROP TYPE IF EXISTS "payment_status"')
    op.execute('DROP TYPE IF EXISTS "payment_method"')
