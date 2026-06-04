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
