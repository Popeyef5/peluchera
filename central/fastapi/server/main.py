"""
claw_server/app.py
FastAPI + python-socketio (async_mode='asgi')
PostgreSQL via SQLAlchemy‑async
"""
import os, asyncio, time, logging
from datetime import datetime, timedelta
from collections import defaultdict

from .abi import claw_abi

from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse
import socketio
import httpx
from web3 import Web3, WebSocketProvider, AsyncWeb3
from web3.utils.subscriptions import LogsSubscription, LogsSubscriptionContext
from sqlalchemy.ext.asyncio import (
    AsyncSession, create_async_engine, async_sessionmaker
)
from sqlalchemy import (
    Column, Integer, String, DateTime, Boolean,
    ForeignKey, select, delete, func
)
from sqlalchemy.orm import declarative_base, relationship
from typing import AsyncGenerator
import threading
import requests

# ───── Database ──────────────────────────────────────────────────────────────
engine = create_async_engine(os.environ["DATABASE_URL"], echo=False, pool_size=5)
async_session = async_sessionmaker(engine, expire_on_commit=False)
Base = declarative_base()

class Round(Base):
    __tablename__ = "round"
    id         = Column(Integer, primary_key=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    entries    = relationship("QueueEntry", back_populates="round", lazy="selectin")

class QueueEntry(Base):
    __tablename__ = "queue"
    id           = Column(Integer, primary_key=True)
    address      = Column(String, index=True)
    status       = Column(String, default="queued", index=True)
    created_at   = Column(DateTime, default=datetime.utcnow, index=True)
    played_at    = Column(DateTime, default=None, index=True)
    ended_at     = Column(DateTime, default=None, index=True)
    cancelled_at = Column(DateTime, default=None, index=True)
    bet          = Column(Integer, default=1)
    win          = Column(Boolean, default=False)
    key          = Column(String(66))
    round_id     = Column(Integer, ForeignKey("round.id"))
    round        = relationship("Round", back_populates="entries")

# ───── FastAPI + Socket.IO ───────────────────────────────────────────────────
sio  = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins="*")
api  = FastAPI()
app = socketio.ASGIApp(sio, other_asgi_app=api)

PI_SERVER        = os.getenv("PI_SERVER_URL", "http://192.168.1.211:5001")
FRAME_RATE       = 0.1      # seconds
TURN_DURATION    = 60       # seconds
INTER_TURN_DELAY = 3        # seconds

BASE_RPC_HTTP = os.environ.get("BASE_RPC_HTTP")
BASE_RPC_WS= os.environ.get("BASE_RPC_WS")
CLAW_ADDRESS = os.environ.get("CLAW_CONTRACT_ADDRESS")

sid_to_addr: dict[str, str] = {}
current_player = None
game_state = 0, 0
log = logging.getLogger("claw")

# ───── Pi socket client ─────────────────────────────
pi_client = socketio.AsyncClient()

async def connect_pi():
    while True:
        try:
            await pi_client.connect(PI_SERVER)
            log.info("Pi socket connected")
            break
        except Exception as e:
            log.warning("Pi connect error: %s", e)
            await asyncio.sleep(5)

# ───── Utility helpers ───────────────────────────────────────────────────────
async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async with async_session() as session:
        yield session

async def ensure_first_round(session: AsyncSession):
    if not await session.scalar(select(Round).limit(1)):
        session.add(Round())
        await session.commit()

# ───── Queue / Turn scheduler ────────────────────────────────────────────────
async def scheduler():
    global current_player

    # In case server was cut off mid turn
    while True:
        async with async_session() as db:
                entry = await db.scalar(
                    select(QueueEntry)
                    .where(QueueEntry.status == "active")
                )
                if entry:
                    entry.status = "played"
                    entry.ended_at = datetime.utcnow()
                    # await db.execute(
                    #     delete(QueueEntry)
                    #     .where(QueueEntry.address == entry.address)
                    #     .where(QueueEntry.status == "active")
                    # )
                    await db.commit()
                else:
                    break

    while True:
        async with async_session() as db:
            entry = await db.scalar(
                select(QueueEntry)
                .where(QueueEntry.status == "queued")
                .order_by(QueueEntry.created_at)
            )
            if not entry:
                current_player = None
                await asyncio.sleep(INTER_TURN_DELAY)
                continue

            entry.status = "active"
            current_player = entry.address
            await db.commit()
            await sio.emit("turn_start")
            await asyncio.sleep(INTER_TURN_DELAY)
            await sio.emit("your_turn", room=current_player)
            await pi_client.emit("turn_start")
            entry.played_at = datetime.utcnow()
            await db.commit()

        await asyncio.sleep(TURN_DURATION)

        async with async_session() as db:
            entry = await db.scalar(
                select(QueueEntry)
                .where(QueueEntry.status == "active")
                .where(QueueEntry.address == current_player) 
            )
            # await db.execute(
            #     delete(QueueEntry)
            #     .where(QueueEntry.address == current_player)
            #     .where(QueueEntry.status == "active")
            # )
            entry.ended_at = datetime.now()
            await db.commit()
            await sio.emit("turn_end", room=current_player)

# ───── Logs scheduler ───────────────────────────────────────────────────────
async def web3_listener():
    global game_state

    # keep‑alive tweaks so Infura doesn’t drop us after an idle hour
    ws = WebSocketProvider(
        BASE_RPC_WS,
        websocket_kwargs={"ping_interval": 20, "ping_timeout": None},
    )
    
    async with AsyncWeb3(ws) as w3:
        claw = w3.eth.contract(address=CLAW_ADDRESS, abi=claw_abi)

        # --- 1. snapshot current state --------------------------------------------------
        game_state = await claw.functions.gameState().call()
        log.warning("Game state: %d, %d", *game_state)
        # --- 2. build handlers ----------------------------------------------------------
        async def _round_end(ctx: LogsSubscriptionContext):
            evt = claw.events.RoundEnd().process_log(ctx.result)
            print(evt)                # your handler

        async def _player_bet(ctx: LogsSubscriptionContext):
            evt = claw.events.PlayerBet().process_log(ctx.result)
            amount = evt['args']['amount']
            game_state[0] += amount
            log.warning("Game state: %d, %d", *game_state)
            await sio.emit("game_state", data={"state": game_state})
            log.warning(evt)

        async def _player_win(ctx: LogsSubscriptionContext):
            evt = claw.events.PlayerWin().process_log(ctx.result)
            print(evt)

        # --- 3. register subscriptions & start loop ------------------------------------
        await w3.subscription_manager.subscribe(
            [
                LogsSubscription(
                    label="round-end",
                    address=claw.address,
                    topics=[claw.events.RoundEnd().topic],
                    handler=_round_end,
                ),
                LogsSubscription(
                    label="player-bet",
                    address=claw.address,
                    topics=[claw.events.PlayerBet().topic],
                    handler=_player_bet,
                ),
                LogsSubscription(
                    label="player-win",
                    address=claw.address,
                    topics=[claw.events.PlayerWin().topic],
                    handler=_player_win,
                ),
            ]
        )

        # blocks forever (reconnect logic built into provider)
        await w3.subscription_manager.handle_subscriptions()


# ───── Socket.IO events ──────────────────────────────────────────────────────
@sio.event
async def connect(sid, environ):
    await sio.emit("game_state", data={"state": game_state}, to=sid)
    

@sio.event
async def disconnect(sid):
    old_address = sid_to_addr.get(sid)
    if old_address:
        await sio.leave_room(sid, old_address)
    sid_to_addr[sid] = None

@sio.on("wallet_connected")
async def wallet_connected(sid, data):
    sid_to_addr[sid] = addr = data["address"]
    await sio.enter_room(sid, addr)

    async with async_session() as db:
        qcount = await db.scalar(
            select(func.count()).select_from(QueueEntry).where(QueueEntry.status == "queued")
        )
    
    w3 = Web3(Web3.HTTPProvider(BASE_RPC_HTTP))
    CONTRACT   = w3.eth.contract(
        address=CLAW_ADDRESS,
        abi=claw_abi
    )
    balance = await CONTRACT.functions.getTotalBalance(addr).call()
    await sio.emit("balance", data={"balance": balance}, to=sid)
    
    return {"status": "ok", "queue": qcount}

@sio.on("join_queue")
async def join_queue(sid, data):
    addr = sid_to_addr.get(sid)
    amount, deadline, signature = (
        data["amount"], data["deadline"], data["signature"]
    )

    async with async_session() as db:
        round_ = await db.scalar(select(Round).order_by(Round.created_at.desc()))
        already_in = await db.scalar(
            select(QueueEntry)
            .where(QueueEntry.round_id == round_.id)
            .where(QueueEntry.address == addr)
            .where(QueueEntry.status.in_(["queued", "active"]))
        )
        if already_in:
            return {"status": "error", "position": -1}

        # ─ call bet() on‑chain (sync because web3.py is blocking) ────────────
        loop = asyncio.get_running_loop()
        ok = await safe_place_bet(loop, addr, amount, deadline, signature)
        if not ok:
            return {"status": "error", "position": -1}

        db.add(QueueEntry(address=addr, round_id=round_.id))
        await db.commit()

        qcount = await db.scalar(
            select(func.count()).select_from(QueueEntry).where(QueueEntry.status == "queued")
        )
    await sio.emit("player_queued")
    return {"status": "ok", "position": qcount}

def place_bet(addr, amount, deadline, sig) -> bool:
    w3 = Web3(Web3.HTTPProvider(BASE_RPC_HTTP))
    OWNER      = w3.eth.account.from_key(os.environ["CLAW_PRIVATE_KEY"]).address
    CHAIN_ID   = int(os.environ["CHAIN_ID"])
    CONTRACT   = w3.eth.contract(
        address=CLAW_ADDRESS,
        abi=claw_abi
    )
    txn = CONTRACT.functions.bet(addr, amount, deadline, sig).build_transaction({
        "from": OWNER,
        "nonce": w3.eth.get_transaction_count(OWNER),
        "chainId": CHAIN_ID,
    })
    signed = w3.eth.account.sign_transaction(txn, private_key=os.environ["CLAW_PRIVATE_KEY"])
    tx = w3.eth.send_raw_transaction(signed.raw_transaction)
    rcpt = w3.eth.wait_for_transaction_receipt(tx)
    return rcpt["status"] == 1


async def safe_place_bet(loop, *args):
    for attempt in range(3):
        try:
            return await loop.run_in_executor(None, place_bet, *args)
        except (requests.exceptions.RequestException, ConnectionResetError) as e:
            log.warning("RPC error: %s (retry %s/3)", e, attempt + 1)
            await asyncio.sleep(1.5 ** attempt)
    return False


@sio.on("move")
async def move(sid, data):
    if sid_to_addr.get(sid) == current_player:
        print(data)
        await pi_client.emit("move", data)

# ───── Startup / Lifespan ────────────────────────────────────────────────────
@api.on_event("startup")
async def on_startup():
    async with engine.begin() as conn:  # create tables first time
        await conn.run_sync(Base.metadata.create_all)

    async with async_session() as db:
        await ensure_first_round(db)

    asyncio.create_task(connect_pi())
    asyncio.create_task(scheduler())
    asyncio.create_task(web3_listener())

