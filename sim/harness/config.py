"""Where the simulation finds the running dev stack.

The suite is deliberately OUT OF PROCESS: it drives the real backend over
Socket.IO, the real cabinet over the mock Pi's scenario HTTP API, and asserts
against the real Postgres. No production code is modified or bypassed — the
mock Pi *is* the hardware boundary, which is the seam the system was built for.

Bring the stack up first:
    cd central && docker compose -f docker-compose.dev.yml up

BYPASS_PAYMENT must be true for the crypto rail (no chain in the loop). The two
web3 calls it skips — verify_usdc_transfer (pay in) and send_usdc (pay out) —
are the only things this suite cannot cover; they're unit-tested separately.
"""
import os

BACKEND_URL = os.environ.get("SIM_BACKEND_URL", "http://localhost:5000")
CABINET_URL = os.environ.get("SIM_CABINET_URL", "http://localhost:5001")

# Host-side DSN for the dev Postgres (published by docker-compose.dev.yml).
DB_DSN = os.environ.get(
    "SIM_DB_DSN",
    "postgresql://{u}:{p}@localhost:5432/{d}".format(
        u=os.environ.get("POSTGRES_USER", "garra"),
        p=os.environ.get("POSTGRES_PASSWORD", "peluchera"),
        d=os.environ.get("POSTGRES_DB", "claw"),
    ),
)

# Ball serials created by app.seed_dev: BALL-B### (booster), BALL-C### (card).
BOOSTER_BALL = os.environ.get("SIM_BOOSTER_BALL", "BALL-B000")
CARD_BALL = os.environ.get("SIM_CARD_BALL", "BALL-C000")

# Generous: a turn runs TURN_DURATION (30s) plus INTER_TURN_DELAY before the
# cabinet reports an outcome.
TURN_TIMEOUT = float(os.environ.get("SIM_TURN_TIMEOUT", "75"))
