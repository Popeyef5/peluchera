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
 
async def global_sync():
  async with async_session() as db:
        qcount = await db.scalar(
            select(func.count()).select_from(QueueEntry).where(QueueEntry.status == "queued")
        )
  return {"state": game_state, "queue_length": qcount}


def print_state():
    log.info(f"[STATE] current_key={current_key}, current_player={current_player}")