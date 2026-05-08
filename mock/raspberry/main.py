"""Mock raspberry-pi server.

Drop-in replacement for raspberry/server/main.py — same WebSocket protocol,
no GPIO. Used for local frontend/backend development.

Inbound (from central):
    {"type": "move",       "data": {"bitmask": int}}    -> ignored (logged)
    {"type": "turn_start", "data": ...}                 -> simulates a turn

Outbound (broadcast to central, after turn_start):
    {"type": "turn_end"}                                -> always
    {"type": "prize_won", "data": {"ball_serial": ...}} -> only if turn was a "win"

HTTP scenario controls (curl-friendly):
    POST /scenarios/always-win
    POST /scenarios/always-lose
    POST /scenarios/random          (default)
    POST /scenarios/disconnect      (closes all WS clients, useful for reconnect tests)
    POST /scenarios/next-ball/{serial}  (force the next prize_won to use this ball)
    GET  /scenarios/state
"""

import asyncio
import itertools
import json
import logging
import os
import random
from typing import Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, WebSocketException

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("mock-rpi")

DEFAULT_WIN_RATE = float(os.getenv("MOCK_WIN_RATE", "1.0"))
TURN_DURATION_MIN = float(os.getenv("MOCK_TURN_MIN_SEC", "2.0"))
TURN_DURATION_MAX = float(os.getenv("MOCK_TURN_MAX_SEC", "4.0"))
PRIZE_DELAY_SEC = float(os.getenv("MOCK_PRIZE_DELAY_SEC", "0.5"))

# Default to the serials produced by app.seed_dev. Override with
# MOCK_BALL_SERIALS=BALL-B000,BALL-B001,... if you've seeded differently.
DEFAULT_BALL_SERIALS = (
    "BALL-B000,BALL-B001,BALL-B002,BALL-B003,BALL-B004,BALL-B005,"
    "BALL-C000,BALL-C001,BALL-C002,BALL-C003,BALL-C004,BALL-C005"
)
BALL_SERIALS = [s.strip() for s in os.getenv("MOCK_BALL_SERIALS", DEFAULT_BALL_SERIALS).split(",") if s.strip()]


class Scenario:
    RANDOM = "random"
    ALWAYS_WIN = "always-win"
    ALWAYS_LOSE = "always-lose"


class State:
    def __init__(self):
        self.mode = Scenario.RANDOM
        self.win_rate = DEFAULT_WIN_RATE
        # Round-robin over the configured ball pool so consecutive wins
        # exercise both prize types. `next_ball_override` lets the
        # /scenarios/next-ball endpoint pin a specific serial for one win.
        self._ball_cycle = itertools.cycle(BALL_SERIALS) if BALL_SERIALS else None
        self.next_ball_override: Optional[str] = None

    def is_win(self) -> bool:
        if self.mode == Scenario.ALWAYS_WIN:
            return True
        if self.mode == Scenario.ALWAYS_LOSE:
            return False
        roll = random.random()
        log.info(f"is_win roll={roll:.4f} threshold={self.win_rate} -> {roll < self.win_rate}")
        return roll < self.win_rate

    def next_ball_serial(self) -> Optional[str]:
        if self.next_ball_override is not None:
            serial = self.next_ball_override
            self.next_ball_override = None
            return serial
        if self._ball_cycle is None:
            return None
        return next(self._ball_cycle)


state = State()
app = FastAPI()


class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        try:
            self.active_connections.remove(websocket)
        except ValueError:
            pass

    async def broadcast(self, message: str):
        for connection in list(self.active_connections):
            try:
                await connection.send_text(message)
            except Exception as e:
                log.warning(f"Error sending to connection: {e}")


manager = ConnectionManager()


async def simulate_turn():
    duration = random.uniform(TURN_DURATION_MIN, TURN_DURATION_MAX)
    won = state.is_win()
    log.info(f"Simulating turn: duration={duration:.2f}s, win={won}, mode={state.mode}")
    await asyncio.sleep(duration)
    await manager.broadcast(json.dumps({"type": "turn_end"}))
    if won:
        await asyncio.sleep(PRIZE_DELAY_SEC)
        ball_serial = state.next_ball_serial()
        payload = {"type": "prize_won", "data": {"ball_serial": ball_serial} if ball_serial else None}
        log.info(f"prize_won ball_serial={ball_serial}")
        await manager.broadcast(json.dumps(payload))


async def on_move(_websocket, message):
    log.debug(f"move bitmask={message.get('bitmask', 0):b}")


async def on_turn_start(_websocket, _message):
    log.info("turn_start received")
    asyncio.create_task(simulate_turn())


MESSAGE_HANDLERS = {
    "move": on_move,
    "turn_start": on_turn_start,
}


@app.websocket("/")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    log.info(f"WebSocket connected ({len(manager.active_connections)} active)")

    try:
        while True:
            data = await websocket.receive_text()
            try:
                message = json.loads(data)
                message_type = message.get("type")
                message_data = message.get("data")

                handler = MESSAGE_HANDLERS.get(message_type)
                if handler:
                    await handler(websocket, message_data)
                else:
                    await websocket.send_text(json.dumps({
                        "type": "error",
                        "message": f"Unknown message type: {message_type}",
                        "supported_types": list(MESSAGE_HANDLERS.keys()),
                    }))
            except json.JSONDecodeError:
                await websocket.send_text(json.dumps({
                    "type": "error",
                    "message": "Invalid JSON format",
                }))
    except (WebSocketDisconnect, WebSocketException) as e:
        manager.disconnect(websocket)
        log.warning(f"WebSocket disconnected: {e}")


@app.post("/scenarios/always-win")
async def scenario_always_win():
    state.mode = Scenario.ALWAYS_WIN
    return {"mode": state.mode}


@app.post("/scenarios/always-lose")
async def scenario_always_lose():
    state.mode = Scenario.ALWAYS_LOSE
    return {"mode": state.mode}


@app.post("/scenarios/random")
async def scenario_random():
    state.mode = Scenario.RANDOM
    return {"mode": state.mode, "win_rate": state.win_rate}


@app.post("/scenarios/disconnect")
async def scenario_disconnect():
    n = len(manager.active_connections)
    for ws in list(manager.active_connections):
        try:
            await ws.close(code=1000)
        except Exception as e:
            log.warning(f"Error closing connection: {e}")
    manager.active_connections.clear()
    return {"closed": n}


@app.post("/scenarios/next-ball/{serial}")
async def scenario_next_ball(serial: str):
    """Force the next prize_won to use a specific ball serial. Useful for
    triggering a known prize kind (BOOSTER_PAIR vs SINGLE_CARD) in tests."""
    state.next_ball_override = serial
    return {"next_ball_override": serial}


@app.get("/scenarios/state")
async def scenario_state():
    return {
        "mode": state.mode,
        "win_rate": state.win_rate,
        "active_connections": len(manager.active_connections),
        "turn_duration_range": [TURN_DURATION_MIN, TURN_DURATION_MAX],
        "ball_pool": BALL_SERIALS,
        "next_ball_override": state.next_ball_override,
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "5001")))
