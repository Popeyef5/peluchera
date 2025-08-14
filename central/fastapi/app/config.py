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

# reconciler config
# START_BLOCK = 0              # deploy block
# CONFIRMATIONS = 50           # finality buffer
# CHUNK_SIZE = 2000            # tune to provider
# RECONCILE_INTERVAL_SEC = 60
# NEARHEAD_POLL_SEC = 3
