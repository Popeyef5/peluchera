from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .socket.sio_instance import sio, sio_app
from .db import engine, Base
from .deps import async_session, ensure_first_round
from .pi_client import connect_pi
from .schedulers import turn_scheduler, sync_scheduler
from .notifier import alertBot
from .admin import router as admin_router
from .stripe_rail import router as stripe_router
from .versioning import version_watch
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
api.include_router(stripe_router)   # /payments/stripe/webhook (card rail)
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
    #
    # The on-chain Claw contract is retired: rounds/odds were dead weight, so
    # round_end_scheduler (nightly endRound) and web3_listener (PlayerBet/
    # PlayerWin/RoundStart subscriptions) are no longer started. A single
    # perpetual round is seeded by ensure_first_round above; wins are marked
    # off-chain in pi_client.on_turn_win. The schedulers/listeners modules are
    # left in the tree as dead code pending cleanup.
    asyncio.create_task(connect_pi())
    asyncio.create_task(turn_scheduler())
    asyncio.create_task(sync_scheduler())
    asyncio.create_task(version_watch())

__all__ = ["app"]   # for `uvicorn app:app`
