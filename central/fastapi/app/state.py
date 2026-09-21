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

# ── Letting the database sleep ────────────────────────────────────────────
# Serverless Postgres (Neon) bills compute by the hour and scales to zero only
# after minutes without queries. The scheduler used to query every second and
# the sync loop every 15, forever, so the database never slept: at the smallest
# size that is 180 CU-hours a month against a 100 CU-hour free allowance.
#
# Most of those queries asked "is anyone queued?" on an empty machine. A queue
# entry is only ever CREATED by payments.confirm_payment, in this process, so we
# can know the answer without asking: once a query has seen the queue empty,
# nothing can change that except a confirm_payment, which says so here.
#
# queue_generation guards the race: a reader records it before querying and
# only marks the queue empty if no payment landed while its query was in
# flight. Assumes ONE backend process (true in dev and prod); a second worker
# would enqueue without the first one hearing about it.
queue_known_empty = False   # unknown at boot, so the first tick asks once
queue_generation = 0


def note_queue_grew() -> None:
    """Called by confirm_payment after committing a new queued entry."""
    global queue_known_empty, queue_generation
    queue_generation += 1
    queue_known_empty = False


def note_queue_empty(seen_generation: int) -> None:
    """A query saw no queued entries. Believe it only if no payment committed
    while that query was in flight."""
    global queue_known_empty
    if seen_generation == queue_generation:
        queue_known_empty = True


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
    # Sent to every viewer on connect and every 15s. With nobody queued it needs
    # no database at all, which is what lets an idle machine's database sleep.
    if queue_known_empty:
        qcount = 0
    else:
        gen = queue_generation
        async with async_session() as db:
            qcount = await db.scalar(
                select(func.count())
                .select_from(QueueEntry)
                .where(QueueEntry.status == "queued")
            )
        if not qcount:
            note_queue_empty(gen)
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
        # True when the machine can't start a turn (protocol / chute / inventory
        # fault). Mirrors machine.blocked(); read from the cached fault fields,
        # which the scheduler refreshes every tick, so this adds no DB query and
        # avoids a state<->machine import cycle. Lets the client disable PLAY
        # instead of letting a player try to pay into a queue that can't serve.
        "blocked": bool(version_fault or cabinet_fault or inventory_fault),
    }


def print_state():
    log.info(f"[STATE] current_key={current_key}, current_player={current_player}")
