"""Mock raspberry-pi server.

Drop-in replacement for raspberry/server/main.py — same WebSocket protocol,
no GPIO. Used for local frontend/backend development.

Inbound (from central):
    {"type": "move",       "data": {"bitmask": int}}    -> ignored (logged)
    {"type": "turn_start", "data": ...}                 -> simulates a turn

Outbound (broadcast to central, after turn_start):
    {"type": "turn_end"}            -> always
    {"type": "prize_won"}           -> only if turn was a "win"

HTTP scenario controls (curl-friendly):
    POST /scenarios/always-win
    POST /scenarios/always-lose
    POST /scenarios/random          (default)
    POST /scenarios/disconnect      (closes all WS clients, useful for reconnect tests)
    GET  /scenarios/state
"""

import asyncio
import json
import logging
import os
import random

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, WebSocketException

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("mock-rpi")

DEFAULT_WIN_RATE = float(os.getenv("MOCK_WIN_RATE", "1.0"))
TURN_DURATION_MIN = float(os.getenv("MOCK_TURN_MIN_SEC", "2.0"))
TURN_DURATION_MAX = float(os.getenv("MOCK_TURN_MAX_SEC", "4.0"))
PRIZE_DELAY_SEC = float(os.getenv("MOCK_PRIZE_DELAY_SEC", "0.5"))


class Scenario:
    RANDOM = "random"
    ALWAYS_WIN = "always-win"
    ALWAYS_LOSE = "always-lose"


class State:
    def __init__(self):
        self.mode = Scenario.RANDOM
        self.win_rate = DEFAULT_WIN_RATE

    def is_win(self) -> bool:
        if self.mode == Scenario.ALWAYS_WIN:
            return True
        if self.mode == Scenario.ALWAYS_LOSE:
            return False
        roll = random.random()
        log.info(f"is_win roll={roll:.4f} threshold={self.win_rate} -> {roll < self.win_rate}")
        return roll < self.win_rate


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
        await manager.broadcast(json.dumps({"type": "prize_won"}))


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


@app.get("/scenarios/state")
async def scenario_state():
    return {
        "mode": state.mode,
        "win_rate": state.win_rate,
        "active_connections": len(manager.active_connections),
        "turn_duration_range": [TURN_DURATION_MIN, TURN_DURATION_MAX],
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "5001")))
