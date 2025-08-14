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
game_state = [0, 0]  # list so it’s mutable in-place
round_info = [DEFAULT_MAX_FEE, DEFAULT_FEE_GROWTH]
changing_round = False
pi_connected = False
pi_namespace_ok = False


def set_pi_status(connected: bool, namespace_ok: bool) -> None:
    """Update global flags that reflect the Pi‑side socket health."""
    global pi_connected, pi_namespace_ok
    pi_connected = connected
    pi_namespace_ok = namespace_ok
    log.info(
        f"\033[95m[PI STATUS] connected={pi_connected} namespace_ok={pi_namespace_ok}\033[0m"
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
        "con": pi_connected and pi_namespace_ok,
        "seconds_left": seconds_left,
    }


def print_state():
    log.info(f"[STATE] current_key={current_key}, current_player={current_player}")
