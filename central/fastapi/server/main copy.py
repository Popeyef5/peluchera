import time
import threading
import requests
import asyncio
from collections import defaultdict
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, StreamingResponse
import socketio
from eth_account.messages import encode_defunct
from eth_account import Account
import os
from web3 import Web3
from .abi import claw_abi

# --- Web3 Setup ---
BASE_RPC = os.environ.get('BASE_RPC')
CHAIN_ID = int(os.environ.get('CHAIN_ID'))
CONTRACT_ADDRESS = os.environ.get('CLAW_CONTRACT_ADDRESS')
PRIVATE_KEY = os.environ.get('CLAW_PRIVATE_KEY')
w3 = Web3(Web3.HTTPProvider(BASE_RPC))

owner = w3.eth.account.from_key(PRIVATE_KEY).address
claw_contract = w3.eth.contract(address=CONTRACT_ADDRESS, abi=claw_abi)


# --- SQLAlchemy Setup with PostgreSQL ---
from sqlalchemy import create_engine, Column, Integer, String, DateTime, ForeignKey, Boolean
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, relationship
from datetime import datetime

# Set DATABASE_URL to something like "postgresql://postgres:postgres@db:5432/queue"
DATABASE_URL = os.environ.get("DATABASE_URL")
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

class Round(Base):
    __tablename__ = "round"
    id = Column(Integer, primary_key=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    entries = relationship("QueueEntry", back_populates="round") 


class QueueEntry(Base):
    __tablename__ = "queue"
    id = Column(Integer, primary_key=True, index=True)
    address = Column(String, unique=True, index=True)
    status = Column(String, default="queued", index=True)  # "queued" or "active" or "done"
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    bet = Column(Integer, default=1, index=True)
    win = Column(Boolean, default=False, index=True)
    key = Column(String(66), index=True)

    round_id = Column(Integer, ForeignKey("round.id"))  
    round = relationship("Round", back_populates="entries") 

Base.metadata.create_all(bind=engine)

# --- FastAPI and Socket.IO Setup ---t
sio = socketio.AsyncServer(async_mode="asgi")
app = FastAPI()
socket_app = socketio.ASGIApp(sio, other_asgi_app=app)

# Async Socket.IO client to connect to the Pi server.
pi_socket = socketio.AsyncClient()
PI_SERVER_URL = 'http://192.168.1.211:5001'  # Update with your Pi server address

@pi_socket.event
async def connect():
    print("Connected to Pi server")

@pi_socket.event
async def disconnect():
    print("Disconnected from Pi server")

# --- Video Feed Caching ---
latest_frame = None
frame_lock = threading.Lock()

def video_feed_background():
    global latest_frame
    pi_feed_url = f'{PI_SERVER_URL}/video_feed'
    try:
        with requests.get(pi_feed_url, stream=True) as r:
            r.raise_for_status()
            bytes_buffer = b""
            for chunk in r.iter_content(chunk_size=1024):
                bytes_buffer += chunk
                a = bytes_buffer.find(b'\xff\xd8')  # JPEG start
                b = bytes_buffer.find(b'\xff\xd9')  # JPEG end
                if a != -1 and b != -1 and b > a:
                    jpg = bytes_buffer[a:b+2]
                    with frame_lock:
                        latest_frame = jpg
                    bytes_buffer = bytes_buffer[b+2:]
    except Exception as e:
        print("Error in video_feed_background:", e)

def generate_frames():
    while True:
        with frame_lock:
            frame = latest_frame
        if frame is not None:
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + frame + b'\r\n')
        time.sleep(0.1)

@app.get("/video_feed")
async def video_feed():
    return StreamingResponse(generate_frames(),
                             media_type='multipart/x-mixed-replace; boundary=frame')

# --- Queue Management using PostgreSQL via SQLAlchemy ---
active_address = None  # Global variable for the currently active address
sid_to_address = defaultdict()

@sio.event
async def connect(sid, environ):
    print("Client connected:", sid)

@sio.event
async def disconnect(sid):
    old_address = sid_to_address.get(sid)
    if old_address:
        await sio.leave_room(sid, old_address)
    sid_to_address[sid] = None

@sio.on('wallet_connected')
async def handle_wallet_connected(sid, data):
    old_address = sid_to_address.get(sid)
    if old_address:
      await sio.leave_room(sid, old_address)

    address = data.get("address")
    sid_to_address[sid] = address
    await sio.enter_room(sid, address)

    session = SessionLocal()
    count = session.query(QueueEntry).filter(QueueEntry.status == "queued").count()
    session.close()

    return {'status': 'ok', 'queue': count}


@sio.on('join_queue')
async def handle_join_queue(sid, data):
    address = sid_to_address.get(sid)
    amount = data.get('amount')
    deadline = data.get('deadline')
    signature = data.get('signature')

    session = SessionLocal()
    # Add a new entry only if none exists for this sid in queued/active state.
    round = session.query(Round).order_by(Round.created_at.desc()).first()
    existing = next((
        entry for entry in round.entries
        if entry.address == address and entry.status in ["queued", "active"]
    ), None)

    if existing:
        print(existing.id)
        return {'status': 'error', 'position': -1} #TODO fix, should not be -1 here but rather the current position

    # Prepare function call
    txn = claw_contract.functions.bet(address, amount, deadline, signature).build_transaction({
        'from': owner,
        'nonce': w3.eth.get_transaction_count(owner),
        'chainId': CHAIN_ID 
    })
    
    # Sign it
    signed_txn = w3.eth.account.sign_transaction(txn, private_key=PRIVATE_KEY)
    
    # Send it
    tx_hash = w3.eth.send_raw_transaction(signed_txn.raw_transaction)
     
    # Wait for it to be mined
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash)

    if receipt.get('status') != 1:
        sio.emit('bet_error', to=sid)
        return {'status': 'error', 'position': -1}

    new_entry = QueueEntry(address=address, round_id=round.id, status="queued")
    session.add(new_entry)
    session.commit()
     
    count = session.query(QueueEntry).filter(QueueEntry.status == "queued").count()
    session.close()
    
    await sio.emit('player_queued')
    return {'status': 'ok', 'position': count}

async def start_turn():
    global active_address
    session = SessionLocal()
    entry = session.query(QueueEntry).filter(QueueEntry.status == "queued").order_by(QueueEntry.created_at).first()
    if entry:
        entry.status = "active"
        active_address = entry.address
        session.commit()
        session.close()
        await sio.emit('your_turn', room=active_address)
        asyncio.create_task(turn_timer(active_address))
    else:
        session.close()
        asyncio.create_task(start_timer())

async def start_timer():
    await asyncio.sleep(3)
    await start_turn()

async def turn_timer(sid):
    import random
    await asyncio.sleep(60)
    global active_address
    if sid == active_address:
        await sio.emit(f'turn_end {random.randint(1, 100)}')
        await end_turn()

async def end_turn():
    global active_address
    session = SessionLocal()
    if active_address:
        session.query(QueueEntry).filter(QueueEntry.address == active_address, QueueEntry.status=="active").delete()
        session.commit()
        active_address = None

    # count = session.query(QueueEntry).filter(QueueEntry.status=="queued").count()
    session.close()
    # if count > 0:
        # await start_turn()
    asyncio.create_task(start_timer())


@sio.on('move')
async def handle_move(sid, data):
    global active_address
    if sid == active_address:
        await pi_socket.emit('move', data)
        print("Forwarded move command to Pi server:", data)
    else:
        print("Ignored move command from non-active user.")

# --- Startup ---
async def connect_pi_server():
    while True:
        try:
            await pi_socket.connect(PI_SERVER_URL)
            print("Connected to Pi server")
            break
        except Exception as e:
            print("Error connecting to Pi server:", e)
            await asyncio.sleep(5)

@app.on_event("startup")
async def startup_event():
    # Start connecting to the Pi server in the background.
    asyncio.create_task(connect_pi_server())
    threading.Thread(target=video_feed_background, daemon=True).start()
    session = SessionLocal()
    round = session.query(Round).first()
    if not round:
        first_round = Round()
        session.add(first_round)
        session.commit()
    session.close()
     
    asyncio.create_task(start_timer())