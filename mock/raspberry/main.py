"""Mock raspberry-pi server.

Runs the production Pi-side FSM with a mock EspLink (in-process simulation
of the chute ESP32) and mock claw outputs. Same wire protocol as a real
cabinet — anything that exercises this mock is exercising the production
FSM, just with simulated sensors and a fake serial link.

Inbound (central → mock):
    {"type": "move",        "data": {"bitmask": int}}
    {"type": "turn_start",  "data": ...}
    {"type": "fault_clear", "data": ...}

Outbound (mock → central):
    {"type": "turn_end"}
    {"type": "prize_won", "data": {"tag_uid": "<hex>"}}
    {"type": "fault",     "data": {"kind": "...", "reason"?: "..."}}

Scenario HTTP controls (curl-friendly):
    POST /scenarios/always-win
    POST /scenarios/always-lose
    POST /scenarios/random            (default)
    POST /scenarios/rfid-fail
    POST /scenarios/exit-stuck
    POST /scenarios/disconnect        (closes all WS clients)
    POST /scenarios/fault-clear       (simulates the Telegram bot clearing a fault)
    POST /scenarios/next-tag/{uid}    (force next prize_won UID)
    GET  /scenarios/state
"""

import asyncio
import json
import logging
import os
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, WebSocketException

from esp_link import EspLink
from fsm import FSM, FSMHooks, EV_TURN_START, EV_FAULT_CLEAR
from mock_hardware import (
    MockClawOutputs,
    MockState,
    Scenario,
    TAG_UIDS,
    TURN_DURATION_MIN,
    TURN_DURATION_MAX,
)

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("mock-rpi")


state = MockState()
events: "asyncio.Queue[str]" = asyncio.Queue()
esp_events: "asyncio.Queue" = asyncio.Queue()
claw = MockClawOutputs(state, events)
esp = EspLink(state)   # the mock impl, shape-compatible with the real one

fsm: Optional[FSM] = None


class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active_connections.append(ws)

    def disconnect(self, ws: WebSocket):
        try:
            self.active_connections.remove(ws)
        except ValueError:
            pass

    async def broadcast(self, payload: dict) -> None:
        text = json.dumps(payload)
        for c in list(self.active_connections):
            try:
                await c.send_text(text)
            except Exception as e:
                log.warning("send failed: %s", e)


manager = ConnectionManager()


async def _esp_pump() -> None:
    async for msg in esp.events():
        await esp_events.put(msg)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global fsm
    esp_task = asyncio.create_task(esp.run())
    pump_task = asyncio.create_task(_esp_pump())
    fsm = FSM(
        events=events,
        esp_events=esp_events,
        esp=esp,
        hooks=FSMHooks(
            broadcast=manager.broadcast,
            start_turn_pulse=claw.start_turn_pulse,
        ),
    )
    fsm_task = asyncio.create_task(fsm.run())
    try:
        yield
    finally:
        for t in (fsm_task, pump_task, esp_task):
            t.cancel()


app = FastAPI(lifespan=lifespan)


async def on_move(_ws, message):
    claw.apply_move_bitmask((message or {}).get("bitmask", 0))


async def on_turn_start(_ws, _message):
    log.info("turn_start received")
    events.put_nowait(EV_TURN_START)


async def on_fault_clear(_ws, _message):
    log.info("fault_clear received")
    events.put_nowait(EV_FAULT_CLEAR)


MESSAGE_HANDLERS = {
    "move": on_move,
    "turn_start": on_turn_start,
    "fault_clear": on_fault_clear,
}


@app.websocket("/")
async def websocket_endpoint(ws: WebSocket):
    await manager.connect(ws)
    log.info("WS connected (active=%d)", len(manager.active_connections))
    try:
        while True:
            data = await ws.receive_text()
            try:
                message = json.loads(data)
                mtype = message.get("type")
                mdata = message.get("data")
                handler = MESSAGE_HANDLERS.get(mtype)
                if handler:
                    await handler(ws, mdata)
                else:
                    await ws.send_text(json.dumps({
                        "type": "error",
                        "message": f"Unknown message type: {mtype}",
                        "supported_types": list(MESSAGE_HANDLERS.keys()),
                    }))
            except json.JSONDecodeError:
                await ws.send_text(json.dumps({
                    "type": "error", "message": "Invalid JSON format",
                }))
    except (WebSocketDisconnect, WebSocketException) as e:
        manager.disconnect(ws)
        log.warning("WS disconnected: %s", e)


# --- Scenario HTTP endpoints ------------------------------------------------

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


@app.post("/scenarios/rfid-fail")
async def scenario_rfid_fail():
    state.mode = Scenario.RFID_FAIL
    return {"mode": state.mode}


@app.post("/scenarios/exit-stuck")
async def scenario_exit_stuck():
    state.mode = Scenario.EXIT_STUCK
    return {"mode": state.mode}


@app.post("/scenarios/fault-clear")
async def scenario_fault_clear():
    """Simulates a Telegram bot acknowledging a fault and clearing it."""
    events.put_nowait(EV_FAULT_CLEAR)
    return {"sent": "fault_clear"}


@app.post("/scenarios/disconnect")
async def scenario_disconnect():
    n = len(manager.active_connections)
    for ws in list(manager.active_connections):
        try:
            await ws.close(code=1000)
        except Exception as e:
            log.warning("error closing ws: %s", e)
    manager.active_connections.clear()
    return {"closed": n}


@app.post("/scenarios/next-tag/{uid}")
async def scenario_next_tag(uid: str):
    state.next_uid_override = uid
    return {"next_uid_override": uid}


@app.get("/scenarios/state")
async def scenario_state():
    return {
        "mode": state.mode,
        "win_rate": state.win_rate,
        "active_connections": len(manager.active_connections),
        "turn_duration_range": [TURN_DURATION_MIN, TURN_DURATION_MAX],
        "tag_pool": TAG_UIDS,
        "next_uid_override": state.next_uid_override,
        "fsm_state": fsm.state.value if fsm else None,
        "fault_kind": esp.latched_fault,
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "5001")))
