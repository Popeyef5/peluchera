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
