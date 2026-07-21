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

# The machine has a ball whose prize can't be handed over, so it must not take
# another turn (see app/machine.py). Same pause semantics as cabinet_fault:
# nobody can pay for a play we cannot honour. Shape:
#   {"kind": "unclaimable_prizes", "reason": str, "balls": [{serial, reason}]}
inventory_fault: Optional[dict] = None

# A protocol-version mismatch between VPS / Pi / ESP (see versioning.py). Pauses
# the queue like any other "machine not fit" fault. Shape:
#   {"kind": "version_mismatch", "problems": [str], "versions": {...}}
version_fault: Optional[dict] = None

# Last-seen protocol snapshot from the Pi handshake (esp_status), kept even when
# everything AGREES — version_fault is null when healthy, so without this the ops
# page could only ever show the numbers on a mismatch. With it, the panel renders
# the whole chain (VPS/Pi/ESP all on 1 ✓) live. Updated by pi_client.on_esp_status.
pi_proto: Optional[int] = None
esp_proto: Optional[int] = None
esp_fw: Optional[str] = None
pi_fw: Optional[str] = None
esp_pi_ok: bool = True   # ESP<->Pi contract, per the Pi's own latch

# Mirror of the chute ESP32's latched fault, surfaced to the admin ops page.
# Set by pi_client.on_pi_fault when the Pi forwards a `fault`, cleared by the
# admin /cabinet/clear_fault endpoint once the Pi acks the clear. None == healthy.
# Shape: {"kind": str, "reason": Optional[str]}
cabinet_fault: Optional[dict] = None

def set_pi_status(connected: bool) -> None:
    """Update global flags that reflect the Pi‑side socket health."""
    global pi_connected, pi_proto, esp_proto, esp_fw, pi_fw, esp_pi_ok
    pi_connected = connected
    if not connected:
        # The version snapshot describes a live Pi/ESP link; once the Pi drops,
        # it's stale. Clear it so the ops page shows "unknown", not a phantom ✓.
        pi_proto = esp_proto = esp_fw = pi_fw = None
        esp_pi_ok = True
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
