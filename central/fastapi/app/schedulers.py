import asyncio
import time

import app.state as state

from datetime import datetime
from sqlalchemy import select, func
from .models import QueueEntry
from .deps import async_session
from .socket.sio_instance import sio
from .logging import log
from .pi_client import pi_client
from .config import TURN_DURATION, INTER_TURN_DELAY, SYNC_PERIOD
from .state import global_sync

async def turn_scheduler():
    # clean up any partially-played entry
    while True:
        async with async_session() as db:
            entry = await db.scalar(
                select(QueueEntry).where(QueueEntry.status == "active")
            )
            if entry:
                entry.status, entry.ended_at = "played", datetime.utcnow()
                await db.commit()
            else:
                break

    # main loop
    while True:
        async with async_session() as db:
            entry = await db.scalar(
                select(QueueEntry)
                .where(QueueEntry.status == "queued")
                .order_by(QueueEntry.created_at.asc())
            )
            if not entry:
                state.current_player = None
                await asyncio.sleep(INTER_TURN_DELAY)
                continue

            entry.status = "active"
            state.current_player = entry.address
            await db.commit()

        await sio.emit("turn_start")
        await asyncio.sleep(INTER_TURN_DELAY)
        await sio.emit("your_turn", room=entry.address)
        await pi_client.emit("turn_start")

        async with async_session() as db:
            entry.played_at = datetime.utcnow()
            await db.commit()

        await asyncio.sleep(TURN_DURATION)

        async with async_session() as db:
            entry = await db.scalar(
                select(QueueEntry)
                .where(QueueEntry.status == "active")
                .where(QueueEntry.address == state.current_player)
            )
            entry.ended_at = datetime.utcnow()
            entry.status = "played"
            await db.commit()
        await sio.emit("turn_end", room=state.current_player)
        

async def sync_scheduler():
    while True:
        start_time = time.time()
        
        # --- Global sync to every socket connection ---
        await sio.emit("global_sync", await global_sync())
        
        # --- Personal sync to every address in queue ---
        async with async_session() as db:
            result = await db.execute(
                select(QueueEntry)
                .where(QueueEntry.status == "queued")
                .order_by(QueueEntry.created_at.asc())
            )
            queue = result.scalars().all()
        
        for i, entry in enumerate(queue):
            await sio.emit("personal_sync", {"position": i+1}, room=entry.address)
         
                
        spent_time = time.time() - start_time
        if spent_time < SYNC_PERIOD:
            log.info("Sleeping for %ds" % (SYNC_PERIOD - spent_time))
            await asyncio.sleep(SYNC_PERIOD - spent_time) 
