from sqlalchemy import select, func
from datetime import datetime
from .db import async_session
from .logging import log
from .models import QueueEntry

sid_to_addr = {}
current_player = None
last_start = datetime.min
current_key = None
game_state = [0, 0]   # list so it’s mutable in-place
pi_connected = False
pi_namespace_ok = False

def set_pi_status(connected: bool, namespace_ok: bool) -> None:
    """Update global flags that reflect the Pi‑side socket health."""
    global pi_connected, pi_namespace_ok
    pi_connected = connected
    pi_namespace_ok = namespace_ok
    log.info(f"\033[95m[PI STATUS] connected={pi_connected} namespace_ok={pi_namespace_ok}\033[0m")

 
async def global_sync():
  async with async_session() as db:
        qcount = await db.scalar(
            select(func.count()).select_from(QueueEntry).where(QueueEntry.status == "queued")
        )
  return {"state": game_state, "queue_length": qcount, "con": pi_connected and pi_namespace_ok}


def print_state():
    log.info(f"[STATE] current_key={current_key}, current_player={current_player}")