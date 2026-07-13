import os

# Central place for env-vars and project constants
FRAME_RATE           = 0.1
TURN_DURATION        = 30
INTER_TURN_DELAY     = 3
SYNC_PERIOD          = 15

DATABASE_URL     = os.environ.get("DATABASE_URL")
PI_SERVER_URL    = os.environ.get("PI_SERVER_URL")
BASE_RPC_HTTP    = os.environ.get("BASE_RPC_HTTP")
BASE_RPC_WS      = os.environ.get("BASE_RPC_WS")
CLAW_ADDRESS     = os.environ.get("CLAW_CONTRACT_ADDRESS")
CHAIN_ID         = int(os.environ.get("CHAIN_ID"))
PRIVATE_KEY      = os.environ.get("CLAW_PRIVATE_KEY")

# When true, the play flow skips wallet/permit/on-chain steps entirely:
# join_queue accepts dummy bet data and creates a QueueEntry with a synthetic
# key; on_turn_win skips notifyWin; user_account_data returns balance=0
# without an RPC call. Intended for demos / public sessions where you want
# people to hit Play without connecting a wallet. The commit-reveal trust
# guarantee is off in this mode, by design.
BYPASS_PAYMENT   = os.environ.get("BYPASS_PAYMENT", "false").lower() == "true"

# Admin app — Supabase auth integration. JWTs minted by Supabase are HS256-
# signed with the project's JWT secret. Backend verifies incoming admin
# requests against this secret; if unset, the admin router refuses to mount
# and any admin request 401s. SUPABASE_URL is informational (used in error
# messages); SUPABASE_JWT_AUDIENCE defaults to Supabase's standard "authenticated".
SUPABASE_URL          = os.environ.get("SUPABASE_URL")
SUPABASE_JWT_SECRET   = os.environ.get("SUPABASE_JWT_SECRET")
SUPABASE_JWT_AUDIENCE = os.environ.get("SUPABASE_JWT_AUDIENCE", "authenticated")

# Default game settings
DEFAULT_MAX_FEE    = os.environ.get("DEFAULT_MAX_FEE", 20)
DEFAULT_FEE_GROWTH = os.environ.get("DEFAULT_FEE_GROWTH", 50)

# Price of one play ("ticket"), in cents. Both funding rails charge this; with
# $10+ tickets, per-play card charging is viable (no prepaid balance needed).
TICKET_PRICE_CENTS = int(os.environ.get("TICKET_PRICE_CENTS", 1000))

# Card rail (Stripe). SECRET_KEY authenticates API calls; WEBHOOK_SECRET
# verifies event signatures on /payments/stripe/webhook. If SECRET_KEY is
# unset, card payment events answer with a "card payments disabled" error.
STRIPE_SECRET_KEY     = os.environ.get("STRIPE_SECRET_KEY")
STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET")

# Crypto rail: ticket payments are a direct USDC transfer from the player's
# (embedded) wallet to this treasury — no escrow contract. Payouts are later
# sent FROM here (balance/withdraw rework). USDC on Base Sepolia has 6 decimals.
TREASURY_ADDRESS   = os.environ.get("TREASURY_ADDRESS")
# Signs USDC payouts (withdrawals) FROM the treasury. Defaults to the old
# operator key for convenience when treasury == operator address.
TREASURY_PRIVATE_KEY = os.environ.get("TREASURY_PRIVATE_KEY", PRIVATE_KEY)
USDC_TOKEN_ADDRESS = os.environ.get("USDC_TOKEN_ADDRESS", "0x036CbD53842c5426634e7929541eC2318f3dCF7e")
USDC_DECIMALS      = 6


def ticket_usdc_base_units() -> int:
    """The ticket price expressed in USDC base units (cents -> 6-decimal units)."""
    return TICKET_PRICE_CENTS * (10 ** USDC_DECIMALS) // 100

# Chargeback protection: card payments are reversible (a cardholder can dispute
# a charge for weeks) but USDC withdrawals are not. So winnings traceable to a
# CARD-funded ticket are non-withdrawable until this many days after the charge
# confirmed. Crypto-funded winnings have no hold. Set to a value >= your card
# processor's dispute window.
CHARGEBACK_HOLD_DAYS = int(os.environ.get("CHARGEBACK_HOLD_DAYS", 7))

# Resell prices per CardRarity, in cents. Placeholder — operator should
# eventually drive this from an admin-config table or a per-card snapshot.
RESELL_PRICE_BY_RARITY_CENTS = {
	"COMMON":     50,
	"UNCOMMON":   150,
	"RARE":       400,
	"HOLO_RARE":  900,
	"ULTRA_RARE": 2500,
	"CHASE":      8000,
}

# Resell price per booster SKU, in cents. "default" is the fallback when an
# unknown SKU shows up. Same placeholder caveat as above.
RESELL_PRICE_BY_BOOSTER_SKU_CENTS = {
	"default": 500,
}

TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", None)
TELEGRAM_BOT_CHATS = {
	'regular': int(info) if (info := os.environ.get("TELEGRAM_BOT_CHAT_INFO", None)) is not None else None
}

# reconciler config
# START_BLOCK = 0              # deploy block
# CONFIRMATIONS = 50           # finality buffer
# CHUNK_SIZE = 2000            # tune to provider
# RECONCILE_INTERVAL_SEC = 60
# NEARHEAD_POLL_SEC = 3
