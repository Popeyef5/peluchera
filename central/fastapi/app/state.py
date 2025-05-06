from sqlalchemy import select, func
from .db import async_session
from .models import QueueEntry

sid_to_addr = {}
current_player = None
game_state = [0, 0]   # list so it’s mutable in-place
 
async def global_sync():
  async with async_session() as db:
        qcount = await db.scalar(
            select(func.count()).select_from(QueueEntry).where(QueueEntry.status == "queued")
        )
        
  return {"game_state": game_state, "queue_length": qcount}