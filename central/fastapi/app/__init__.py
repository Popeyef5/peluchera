from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .socket.sio_instance import sio, sio_app
from .db import engine, Base
from .deps import async_session, ensure_first_round
from .pi_client import connect_pi
from .schedulers import turn_scheduler, sync_scheduler, round_end_scheduler
from .listeners import web3_listener
from .notifier import alertBot
from .admin import router as admin_router
import asyncio

api = FastAPI()
# Admin app runs on its own subdomain — it talks to FastAPI cross-origin, so
# CORS has to allow the admin origin (configured via env or via nginx). For
# local dev we permit anything; tighten in prod via env-driven allowlist.
api.add_middleware(
	CORSMiddleware,
	allow_origins=["*"],
	allow_credentials=False,
	allow_methods=["*"],
	allow_headers=["*"],
)
api.include_router(admin_router)
app = sio_app(api)          # merged ASGI app (socket.io + FastAPI)

@api.on_event("startup")
async def on_startup():
    # Schema is owned by Alembic now (run `alembic upgrade head` on deploy);
    # we no longer create_all at startup so the app can't silently drift from
    # the migration history. Fresh dev DBs: `alembic upgrade head` first.

    # first round
    async with async_session() as db:
        await ensure_first_round(db)
        
    # background tasks
    asyncio.create_task(connect_pi())
    asyncio.create_task(turn_scheduler())
    asyncio.create_task(sync_scheduler())
    asyncio.create_task(round_end_scheduler())
    asyncio.create_task(web3_listener())

__all__ = ["app"]   # for `uvicorn app:app`
