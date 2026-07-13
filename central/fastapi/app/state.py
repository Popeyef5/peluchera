from typing import Optional
from sqlalchemy import select, func
from datetime import datetime, timezone, timedelta
from .db import async_session
from .logging import log
from .models import QueueEntry
from .config import DEFAULT_FEE_GROWTH, DEFAULT_MAX_FEE

sid_to_addr = {}
current_player = None
last_start = datetime.min
current_key = None

# The turn that has ended and is awaiting a chute verdict.
#
# The Pi broadcasts `turn_end` as soon as the ball drops past the opto, and only
# THEN arms the chute and waits for the RFID verdict — so `prize_won` always
# arrives after the turn ended, and possibly after the next turn has begun
# (INTER_TURN_DELAY is only a few seconds; a slow ball or an RFID retry can
# outlast it). Attributing the prize to `current_key` would therefore credit it
# to whoever is playing *now*. These hold the turn that actually fired the arm.
# Set on turn_end, consumed once by on_chute_verdict.
awaiting_verdict_key = None
awaiting_verdict_player = None
game_state = [0, 0]  # list so it’s mutable in-place
round_info = [DEFAULT_MAX_FEE, DEFAULT_FEE_GROWTH]
changing_round = False
pi_connected = False

# Admin tag-enrollment slot. Set by /admin/balls/enroll/start, populated by
# pi_client when the Pi forwards `tag_scanned` or `enroll_timeout`, polled by
# /admin/balls/enroll/status. Only one enrollment may be active at a time
# (gated in the admin router).
# Shape: {"expires_at": float, "scanned_ball_serial": Optional[str], "timed_out": bool}
enroll_pending: Optional[dict] = None

# Mirror of the chute ESP32's latched fault, surfaced to the admin ops page.
# Set by pi_client.on_pi_fault when the Pi forwards a `fault`, cleared by the
# admin /cabinet/clear_fault endpoint once the Pi acks the clear. None == healthy.
# Shape: {"kind": str, "reason": Optional[str]}
cabinet_fault: Optional[dict] = None

def set_pi_status(connected: bool) -> None:
    """Update global flags that reflect the Pi‑side socket health."""
    global pi_connected
    pi_connected = connected
    log.info(
        f"\033[95m[PI STATUS] connected={pi_connected}\033[0m"
    )


async def global_sync():
    async with async_session() as db:
        qcount = await db.scalar(
            select(func.count())
            .select_from(QueueEntry)
            .where(QueueEntry.status == "queued")
        )
        now = datetime.now(timezone.utc)
        next_midnight = (now + timedelta(days=1)).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        seconds_left = int((next_midnight - now).total_seconds())

    return {
        "state": game_state,
        "round_info": round_info,
        "queue_length": qcount,
        "con": pi_connected,
        "seconds_left": seconds_left,
    }


def print_state():
    log.info(f"[STATE] current_key={current_key}, current_player={current_player}")
