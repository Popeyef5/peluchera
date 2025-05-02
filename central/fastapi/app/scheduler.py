import asyncio

import app.state as state

from datetime import datetime
from sqlalchemy import select, func
from .models import QueueEntry
from .deps import async_session
from .socket.sio_instance import sio
from .pi_client import pi_client
from .config import TURN_DURATION, INTER_TURN_DELAY

async def scheduler():
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
                .order_by(QueueEntry.created_at)
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
