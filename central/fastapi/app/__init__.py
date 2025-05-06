from fastapi import FastAPI
from .socket.sio_instance import sio, sio_app
from .logging import log
from .db import engine, Base
from .deps import async_session, ensure_first_round
from .pi_client import connect_pi
from .schedulers import turn_scheduler
from .listeners import web3_listener
import asyncio

api = FastAPI()
app = sio_app(api)          # merged ASGI app (socket.io + FastAPI)

@api.on_event("startup")
async def on_startup():
    # DB tables
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # first round
    async with async_session() as db:
        await ensure_first_round(db)

    # background tasks
    asyncio.create_task(connect_pi())
    asyncio.create_task(turn_scheduler())
    asyncio.create_task(web3_listener())

__all__ = ["app"]   # for `uvicorn app:app`
