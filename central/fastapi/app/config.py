import os
from typing import Optional

# Central place for env-vars and project constants
FRAME_RATE           = 0.1
# Env-overridable so a load simulation can compress the turn cadence (see
# scripts/sim). Production leaves them at the defaults.
TURN_DURATION        = int(os.environ.get("TURN_DURATION", 30))
INTER_TURN_DELAY     = int(os.environ.get("INTER_TURN_DELAY", 3))
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

# Dev-only tooling (the /test-win ball picker). Gates socket events that let a
# developer force the mock chute to drop a chosen ball and run a real turn.
# MUST stay false in production — there is no /test-win in prod.
DEV_TOOLS        = os.environ.get("DEV_TOOLS", "false").lower() == "true"

# Admin app — Neon Auth (Managed Better Auth on the production branch). The
# admin panel sends a short-lived EdDSA JWT; we verify it against the JWKS under
# this URL, and its origin is the expected issuer/audience. Copy it from the
# Neon Console (Auth → Configuration). Unset → every admin request 503s.
NEON_AUTH_BASE_URL = os.environ.get("NEON_AUTH_BASE_URL")

# Player sign-in (SIWX). A wallet proves it controls an address by signing a
# server-issued nonce; the server then hands back a session token signed with
# this secret, and the socket only accepts an address that carries a matching
# token. Set it in prod: if unset, a random per-process secret is used and every
# player has to sign in again after each restart or deploy.
PLAYER_SESSION_SECRET = os.environ.get("PLAYER_SESSION_SECRET")

# Hosts a sign-in message may name as its domain. A signature is only accepted
# for a message that says it is signing in to one of these, so a lookalike site
# cannot collect signatures that work here. Include every host the player app
# is served from (LAN addresses too, if you test from a phone).
PLAYER_AUTH_DOMAINS = {
    d.strip().strip('"').lower()
    for d in os.environ.get("PLAYER_AUTH_DOMAINS", "localhost,cl4ws.com,www.cl4ws.com").split(",")
    if d.strip()
}

# Uploaded assets (pack art, card images, opening videos) live in an
# S3-compatible bucket: Neon Object Storage in prod, though any S3 API works.
# The admin panel uploads straight from the browser with a presigned PUT that
# the backend issues, so large videos never pass through nginx or this process.
ASSETS_S3_ENDPOINT = os.environ.get("ASSETS_S3_ENDPOINT")
ASSETS_S3_REGION = os.environ.get("ASSETS_S3_REGION", "us-east-2")
ASSETS_S3_ACCESS_KEY_ID = os.environ.get("ASSETS_S3_ACCESS_KEY_ID")
ASSETS_S3_SECRET_ACCESS_KEY = os.environ.get("ASSETS_S3_SECRET_ACCESS_KEY")
ASSETS_BUCKET = os.environ.get("ASSETS_BUCKET", "assets")
# Where the public copy of an object is read from. Defaults to the bucket's
# path-style URL; point it at a CDN later without touching stored rows' shape.
ASSETS_PUBLIC_BASE = (
    os.environ.get("ASSETS_PUBLIC_BASE")
    or (f"{ASSETS_S3_ENDPOINT.rstrip('/')}/{ASSETS_BUCKET}" if ASSETS_S3_ENDPOINT else None)
)

# Admin access allow-list. Neon Auth sign-up is open (anyone can create an
# account with an emailed code or Google), so this is the gate that decides who
# is actually an operator. Two knobs:
#   ADMIN_EMAIL_ALLOWLIST — comma-separated exact emails
#   ADMIN_EMAIL_DOMAINS   — comma-separated domains, e.g. "cl4ws.com"
# If BOTH are empty NOBODY is an admin: a valid sign-in alone must never be
# enough.
ADMIN_EMAIL_ALLOWLIST = {
    e.strip().lower()
    for e in os.environ.get("ADMIN_EMAIL_ALLOWLIST", "").split(",")
    if e.strip()
}
ADMIN_EMAIL_DOMAINS = {
    d.strip().lower().lstrip("@")
    for d in os.environ.get("ADMIN_EMAIL_DOMAINS", "").split(",")
    if d.strip()
}


def admin_email_allowed(email: Optional[str]) -> bool:
    """Whether this identity may act as an admin. Closed when no allow-list is set."""
    if not email:
        return False
    email = email.lower()
    if email in ADMIN_EMAIL_ALLOWLIST:
        return True
    return email.rsplit("@", 1)[-1] in ADMIN_EMAIL_DOMAINS

# FREE PLAY — the pre-monetization mode.
#
# Everyone logs in for real (wallet / email / social, so they get a persistent
# account, their own inventory and a real payout address) but nobody pays: PLAY
# goes straight to the queue. Wins, boosters, cards, resells are all real; only
# the payment step is comped, and withdrawals are simulated (no USDC leaves the
# treasury for a play nobody paid for).
#
# Distinct from BYPASS_PAYMENT, which is DEMO mode: no wallet at all, synthetic
# guest addresses. Dev and the simulation suite rely on that one.
#
# Turning monetization on is: FREE_PLAY=false + restart. No frontend rebuild —
# the client is told at login.
FREE_PLAY = os.environ.get("FREE_PLAY", "false").lower() == "true"


def free_play() -> bool:
    """Plays are comped and withdrawals simulated (demo mode implies this)."""
    return FREE_PLAY or BYPASS_PAYMENT


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

# Card resell prices are now operator-managed per rarity in the `rarity` table
# (admin: Inventory → Types), read at settlement via rarity_resell_price().

# Resell price per booster SKU, in cents. "default" is the fallback when an
# unknown SKU shows up. Same placeholder caveat as above.
RESELL_PRICE_BY_BOOSTER_SKU_CENTS = {
	"default": 500,
}

TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", None)
TELEGRAM_BOT_CHATS = {
	'info': int(info) if (info := os.environ.get("TELEGRAM_BOT_CHAT_INFO", None)) is not None else None
}

# Global switch for ALL Telegram alerts (version mismatch, inventory fault, ...).
# OFF by default — alerts are opt-in. Set TELEGRAM_ALERTS=true (+ token/chat) to
# turn them on; leave unset/false to keep the app silent everywhere.
TELEGRAM_ALERTS = os.environ.get("TELEGRAM_ALERTS", "false").lower() == "true"

# reconciler config
# START_BLOCK = 0              # deploy block
# CONFIRMATIONS = 50           # finality buffer
# CHUNK_SIZE = 2000            # tune to provider
# RECONCILE_INTERVAL_SEC = 60
# NEARHEAD_POLL_SEC = 3
