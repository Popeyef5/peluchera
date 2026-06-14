"""baseline schema

Revision ID: a8936058c0d8
Revises:
Create Date: 2026-06-10

Full initial schema, rendered from the SQLAlchemy models via create_all DDL so
the mutually-dependent FK cycles (ball / card / opened_booster / win) come out
as post-hoc ALTER TABLE ADD CONSTRAINT. (Plain autogenerate inlines those FKs
and fails on a fresh database.)
"""
from alembic import op

revision = "a8936058c0d8"
down_revision = None
branch_labels = None
depends_on = None

_UPGRADE = [
    "CREATE TYPE kyc_status AS ENUM ('NONE', 'PENDING', 'APPROVED', 'REJECTED')",
    "CREATE TYPE prize_kind AS ENUM ('BOOSTER_PAIR', 'SINGLE_CARD')",
    "CREATE TYPE ball_status AS ENUM ('LOADED', 'GRABBED', 'VOIDED')",
    "CREATE TYPE inventory_status AS ENUM ('AVAILABLE', 'RESERVED', 'CONSUMED', 'SHIPPED', 'RETIRED')",
    "CREATE TYPE card_rarity AS ENUM ('COMMON', 'UNCOMMON', 'RARE', 'HOLO_RARE', 'ULTRA_RARE', 'CHASE')",
    "CREATE TYPE card_origin AS ENUM ('OPENED_BOOSTER', 'SINGLE_PRIZE')",
    "CREATE TYPE card_status AS ENUM ('IN_POOL', 'RESERVED', 'IN_COLLECTION', 'SHIPPED', 'RESOLD')",
    "CREATE TYPE win_status AS ENUM ('PENDING', 'SETTLED_OPEN', 'SETTLED_RESELL', 'SETTLED_SHIP', 'SETTLED_KEEP', 'EXPIRED')",
    "CREATE TYPE settlement_kind AS ENUM ('USER_OPEN', 'USER_RESELL', 'USER_SHIP', 'USER_KEEP', 'AUTO_RESELL')",
    "CREATE TYPE shipment_status AS ENUM ('REQUESTED', 'PACKED', 'SHIPPED', 'DELIVERED', 'RETURNED')",
    "CREATE TYPE ledger_kind AS ENUM ('DEPOSIT', 'BET_PLACED', 'BET_REFUND', 'RESELL', 'AUTO_RESELL', 'CARD_RESELL', 'WITHDRAWAL')",
    "CREATE TABLE round (\n\tid SERIAL NOT NULL, \n\tcreated_at TIMESTAMP WITHOUT TIME ZONE, \n\tmax_fee INTEGER, \n\tfee_growth INTEGER, \n\tmultiplier INTEGER, \n\tPRIMARY KEY (id)\n)",
    "CREATE INDEX ix_round_id ON round (id)",
    "CREATE INDEX ix_round_created_at ON round (created_at)",
    "CREATE TABLE withdrawal (\n\tid SERIAL NOT NULL, \n\taddress VARCHAR, \n\ttimestamp TIMESTAMP WITHOUT TIME ZONE, \n\tamount INTEGER, \n\tPRIMARY KEY (id)\n)",
    "CREATE INDEX ix_withdrawal_timestamp ON withdrawal (timestamp)",
    "CREATE INDEX ix_withdrawal_address ON withdrawal (address)",
    "CREATE INDEX ix_withdrawal_amount ON withdrawal (amount)",
    "CREATE TABLE user_account (\n\tid UUID NOT NULL, \n\twallet_address VARCHAR NOT NULL, \n\temail VARCHAR, \n\tshipping_name VARCHAR, \n\tshipping_address JSONB, \n\tkyc_status kyc_status NOT NULL, \n\tcreated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, \n\tPRIMARY KEY (id)\n)",
    "CREATE UNIQUE INDEX ix_user_account_wallet_address ON user_account (wallet_address)",
    "CREATE TABLE commitment_batch (\n\tid UUID NOT NULL, \n\tmerkle_root VARCHAR NOT NULL, \n\tchain_tx_hash VARCHAR NOT NULL, \n\tpublished_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, \n\tPRIMARY KEY (id), \n\tUNIQUE (merkle_root)\n)",
    "CREATE TABLE ball (\n\tid UUID NOT NULL, \n\tserial VARCHAR NOT NULL, \n\tprize_kind prize_kind NOT NULL, \n\topened_booster_id UUID, \n\tprize_card_id UUID, \n\tsecret VARCHAR NOT NULL, \n\tcommitment_hash VARCHAR NOT NULL, \n\tmerkle_proof JSONB NOT NULL, \n\tbatch_id UUID NOT NULL, \n\tstatus ball_status NOT NULL, \n\tvoided_at TIMESTAMP WITHOUT TIME ZONE, \n\tPRIMARY KEY (id), \n\tUNIQUE (opened_booster_id), \n\tUNIQUE (prize_card_id), \n\tUNIQUE (commitment_hash)\n)",
    "CREATE UNIQUE INDEX ix_ball_serial ON ball (serial)",
    "CREATE TABLE closed_booster_stock (\n\tid UUID NOT NULL, \n\tsku VARCHAR NOT NULL, \n\tin_stock BOOLEAN NOT NULL, \n\tPRIMARY KEY (id)\n)",
    "CREATE UNIQUE INDEX ix_closed_booster_stock_sku ON closed_booster_stock (sku)",
    "CREATE TABLE opened_booster (\n\tid UUID NOT NULL, \n\tsku VARCHAR NOT NULL, \n\tvideo_url VARCHAR NOT NULL, \n\tvideo_hash VARCHAR NOT NULL, \n\tfilmed_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, \n\tstatus inventory_status NOT NULL, \n\treserved_by_win_id UUID, \n\tPRIMARY KEY (id), \n\tUNIQUE (video_hash), \n\tUNIQUE (reserved_by_win_id)\n)",
    "CREATE INDEX ix_opened_booster_sku_status ON opened_booster (sku, status)",
    "CREATE TABLE card (\n\tid UUID NOT NULL, \n\tset VARCHAR NOT NULL, \n\tnumber VARCHAR NOT NULL, \n\trarity card_rarity NOT NULL, \n\timage_url VARCHAR NOT NULL, \n\tcondition VARCHAR, \n\torigin card_origin NOT NULL, \n\topened_booster_id UUID, \n\tstatus card_status NOT NULL, \n\towner_user_id UUID, \n\tacquired_at TIMESTAMP WITHOUT TIME ZONE, \n\tshipment_id UUID, \n\tPRIMARY KEY (id)\n)",
    "CREATE INDEX ix_card_owner_status ON card (owner_user_id, status)",
    "CREATE TABLE win (\n\tid UUID NOT NULL, \n\tuser_id UUID NOT NULL, \n\tqueue_entry_id INTEGER NOT NULL, \n\tball_id UUID NOT NULL, \n\tprize_kind prize_kind NOT NULL, \n\tstatus win_status NOT NULL, \n\texpires_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, \n\tprize_card_id UUID, \n\tresell_price_cents INTEGER NOT NULL, \n\tcreated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, \n\tsettled_at TIMESTAMP WITHOUT TIME ZONE, \n\tsettled_by settlement_kind, \n\tPRIMARY KEY (id), \n\tUNIQUE (queue_entry_id), \n\tUNIQUE (ball_id), \n\tUNIQUE (prize_card_id)\n)",
    "CREATE INDEX ix_win_status_expires ON win (status, expires_at)",
    "CREATE INDEX ix_win_user_status ON win (user_id, status)",
    "CREATE TABLE queue (\n\tid SERIAL NOT NULL, \n\taddress VARCHAR, \n\tstatus VARCHAR, \n\tcreated_at TIMESTAMP WITHOUT TIME ZONE, \n\tplayed_at TIMESTAMP WITHOUT TIME ZONE, \n\tended_at TIMESTAMP WITHOUT TIME ZONE, \n\tcancelled_at TIMESTAMP WITHOUT TIME ZONE, \n\tbet INTEGER, \n\twin BOOLEAN, \n\tkey VARCHAR(66), \n\tround_id INTEGER, \n\tPRIMARY KEY (id), \n\tFOREIGN KEY(round_id) REFERENCES round (id)\n)",
    "CREATE INDEX ix_queue_played_at ON queue (played_at)",
    "CREATE INDEX ix_queue_ended_at ON queue (ended_at)",
    "CREATE INDEX ix_queue_status ON queue (status)",
    "CREATE INDEX ix_queue_address ON queue (address)",
    "CREATE INDEX ix_queue_cancelled_at ON queue (cancelled_at)",
    "CREATE INDEX ix_queue_created_at ON queue (created_at)",
    "CREATE TABLE shipment (\n\tid UUID NOT NULL, \n\tuser_id UUID NOT NULL, \n\tstatus shipment_status NOT NULL, \n\tcarrier VARCHAR, \n\ttracking_number VARCHAR, \n\tshipped_at TIMESTAMP WITHOUT TIME ZONE, \n\tdelivered_at TIMESTAMP WITHOUT TIME ZONE, \n\tshipping_address JSONB NOT NULL, \n\tsku VARCHAR, \n\tcreated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, \n\tPRIMARY KEY (id), \n\tFOREIGN KEY(user_id) REFERENCES user_account (id)\n)",
    "CREATE INDEX ix_shipment_user_status ON shipment (user_id, status)",
    "CREATE TABLE ledger_entry (\n\tid UUID NOT NULL, \n\tuser_id UUID NOT NULL, \n\tkind ledger_kind NOT NULL, \n\tamount_cents INTEGER NOT NULL, \n\tqueue_entry_id INTEGER, \n\twin_id UUID, \n\tshipment_id UUID, \n\twithdrawal_tx_hash VARCHAR, \n\tcreated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, \n\tPRIMARY KEY (id), \n\tFOREIGN KEY(user_id) REFERENCES user_account (id), \n\tFOREIGN KEY(queue_entry_id) REFERENCES queue (id), \n\tFOREIGN KEY(win_id) REFERENCES win (id), \n\tFOREIGN KEY(shipment_id) REFERENCES shipment (id)\n)",
    "CREATE INDEX ix_ledger_user_created ON ledger_entry (user_id, created_at)",
    "ALTER TABLE win ADD FOREIGN KEY(prize_card_id) REFERENCES card (id)",
    "ALTER TABLE ball ADD FOREIGN KEY(batch_id) REFERENCES commitment_batch (id)",
    "ALTER TABLE opened_booster ADD FOREIGN KEY(reserved_by_win_id) REFERENCES win (id)",
    "ALTER TABLE win ADD FOREIGN KEY(queue_entry_id) REFERENCES queue (id)",
    "ALTER TABLE card ADD FOREIGN KEY(opened_booster_id) REFERENCES opened_booster (id)",
    "ALTER TABLE card ADD FOREIGN KEY(shipment_id) REFERENCES shipment (id)",
    "ALTER TABLE win ADD FOREIGN KEY(ball_id) REFERENCES ball (id)",
    "ALTER TABLE ball ADD FOREIGN KEY(prize_card_id) REFERENCES card (id)",
    "ALTER TABLE win ADD FOREIGN KEY(user_id) REFERENCES user_account (id)",
    "ALTER TABLE ball ADD FOREIGN KEY(opened_booster_id) REFERENCES opened_booster (id)",
    "ALTER TABLE card ADD FOREIGN KEY(owner_user_id) REFERENCES user_account (id)",
]

_TABLES = ["round", "queue", "withdrawal", "user_account", "commitment_batch", "ball", "closed_booster_stock", "opened_booster", "card", "win", "shipment", "ledger_entry"]
_TYPES = ["kyc_status", "prize_kind", "ball_status", "inventory_status", "card_rarity", "card_origin", "card_status", "win_status", "settlement_kind", "shipment_status", "ledger_kind"]


def upgrade() -> None:
    for stmt in _UPGRADE:
        op.execute(stmt)


def downgrade() -> None:
    for t in _TABLES:
        op.execute('DROP TABLE IF EXISTS "%s" CASCADE' % t)
    for ty in _TYPES:
        op.execute('DROP TYPE IF EXISTS "%s"' % ty)
