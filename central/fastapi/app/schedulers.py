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
        # If a turn is being played, rest
        if (datetime.utcnow() - state.last_start).total_seconds() < TURN_DURATION + INTER_TURN_DELAY:
            await asyncio.sleep(1)
            continue
        
        # Last game was over TURN_DURATION seconds ago? let's end any game that might have been left pending
        async with async_session() as db:
            old_entry = await db.scalar(
                select(QueueEntry)
                .where(QueueEntry.status == "active")
                .where(QueueEntry.address == state.current_player)
            )
            if old_entry:
              log.info("Cleaning up old entry...")
              old_entry.ended_at = datetime.utcnow()
              old_entry.status = "played"
            await db.commit()
              
            new_entry = await db.scalar(
                select(QueueEntry)
                .where(QueueEntry.status == "queued")
                .order_by(QueueEntry.created_at.asc())
            )
            if not new_entry:
                if old_entry:
                    await sio.emit("turn_end")
                state.current_player = None
                state.current_key = None
                await asyncio.sleep(INTER_TURN_DELAY)
                continue
            
            await db.commit()
            
            await sio.emit("turn_end")
        
            # Wait between turns
            await asyncio.sleep(INTER_TURN_DELAY)
            
            new_entry.status = "active"
            state.current_player = new_entry.address
            state.current_key = new_entry.key
            state.last_start = datetime.utcnow()
            state.print_state()
            # And launch the next one
            await sio.emit("turn_start")
            await pi_client.emit("turn_start")

            new_entry.played_at = datetime.utcnow()
            await db.commit()

        await asyncio.sleep(TURN_DURATION)


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
            # log.info("Sleeping for %ds" % (SYNC_PERIOD - spent_time))
            await asyncio.sleep(SYNC_PERIOD - spent_time) 
