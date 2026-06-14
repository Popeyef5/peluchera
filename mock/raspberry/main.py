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
    {"type": "prize_won", "data": {"ball_serial": "<hex>"}}
    {"type": "fault",     "data": {"kind": "...", "reason"?: "..."}}

Scenario HTTP controls (curl-friendly):
    POST /scenarios/always-win
    POST /scenarios/always-lose
    POST /scenarios/random            (default)
    POST /scenarios/odds              (set win/fault rates; body below)
    POST /scenarios/rfid-fail
    POST /scenarios/exit-stuck
    POST /scenarios/disconnect        (closes all WS clients)
    POST /scenarios/fault-clear       (simulates the Telegram bot clearing a fault)
    POST /scenarios/next-tag/{uid}    (force next prize_won UID)
    GET  /scenarios/state

Full-turn end-to-end loop (drives a real Win in the central backend):
    1. enroll a ball in next-admin -> capture the scanned serial
    2. create + bind the ball to an OpenedBooster / Card
    3. POST /scenarios/next-tag/<that-serial>
    4. POST /scenarios/odds {"win_rate": 1}
    5. queue up / start a turn -> prize_won(<serial>) -> central reserve_win
"""

import asyncio
import json
import logging
import os
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import (
    Body, FastAPI, HTTPException, WebSocket, WebSocketDisconnect,
    WebSocketException,
)

from esp_link import EspLink
from fsm import FSM, FSMHooks, State, EV_TURN_START, EV_FAULT_CLEAR
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
    """Dispatch ESP events: admin-flow events (tag_scanned / enroll_timeout)
    go straight to central; everything else queues into the FSM."""
    async for msg in esp.events():
        if msg.type in ("tag_scanned", "enroll_timeout"):
            await manager.broadcast({"type": msg.type, "data": msg.data})
        else:
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


async def on_enroll(_ws, message):
    timeout_ms = (message or {}).get("timeout_ms", 10000)
    log.info("enroll received (timeout_ms=%d)", timeout_ms)
    await esp.send("enroll", {"timeout_ms": timeout_ms})


def _interpret_verdict(msg) -> dict:
    if msg is None:
        return {"outcome": "timeout",
                "detail": "No verdict within the window — no ball dropped, or the ESP is unresponsive."}
    if msg.type == "prize_won":
        return {"outcome": "prize_won", "ball_serial": (msg.data or {}).get("ball_serial"),
                "detail": "Full sequence OK — entry beam, RFID read, solenoid fired, exit beam."}
    if msg.type == "no_fall":
        return {"outcome": "no_fall", "detail": "No ball detected at the entry break-beam."}
    if msg.type == "fault":
        kind = (msg.data or {}).get("kind")
        detail = {
            "rfid_failed": "Ball fell (entry beam broke) but the RFID tag didn't read.",
            "exit_timeout": "Ball fell and RFID read, but it didn't clear the exit (solenoid / exit beam).",
            "internal_error": "ESP internal error or reset during the sequence.",
        }.get(kind, "Chute fault.")
        return {"outcome": kind or "fault", "fault_kind": kind, "detail": detail}
    return {"outcome": msg.type, "detail": "Unrecognized verdict."}


async def on_test_arm(_ws, _message):
    """Mirror of the real Pi server's test-arm: simulate one chute sequence
    (per the active scenario) and report the verdict. Does NOT create a Win."""
    if fsm is None or fsm.state != State.IDLE:
        await manager.broadcast({"type": "test_result",
            "data": {"outcome": "busy", "detail": "Cabinet is not idle (a turn is running)."}})
        return
    if esp.latched_fault:
        await manager.broadcast({"type": "test_result",
            "data": {"outcome": "blocked", "fault_kind": esp.latched_fault,
                     "detail": "Chute is latched — clear the fault first."}})
        return
    log.info("test_arm: simulating a drop test")
    msg = await esp.arm_and_wait(timeout=15.0)
    await manager.broadcast({"type": "test_result", "data": _interpret_verdict(msg)})


MESSAGE_HANDLERS = {
    "move": on_move,
    "turn_start": on_turn_start,
    "fault_clear": on_fault_clear,
    "enroll": on_enroll,
    "test_arm": on_test_arm,
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
    return {
        "mode": state.mode,
        "win_rate": state.win_rate,
        "rfid_fail_rate": state.rfid_fail_rate,
        "exit_stuck_rate": state.exit_stuck_rate,
    }


@app.post("/scenarios/odds")
async def scenario_odds(body: Optional[dict] = Body(default=None)):
    """Set RANDOM-mode outcome odds and switch to RANDOM mode. Body keys are
    all optional; omitted ones keep their current value:

        {"win_rate": 0.5, "rfid_fail_rate": 0.2, "exit_stuck_rate": 0.1}

    Each must be in [0, 1] and win + rfid + exit must be <= 1 (the remainder
    is a clean lose / no_fall)."""
    body = body or {}
    new = {
        "win_rate": state.win_rate,
        "rfid_fail_rate": state.rfid_fail_rate,
        "exit_stuck_rate": state.exit_stuck_rate,
    }
    for key in new:
        if key in body and body[key] is not None:
            try:
                val = float(body[key])
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail=f"{key} must be a number")
            if not 0.0 <= val <= 1.0:
                raise HTTPException(status_code=400, detail=f"{key} must be in [0, 1]")
            new[key] = val

    total = new["win_rate"] + new["rfid_fail_rate"] + new["exit_stuck_rate"]
    if total > 1.0 + 1e-9:
        raise HTTPException(
            status_code=400,
            detail=f"win_rate + rfid_fail_rate + exit_stuck_rate must be <= 1 (got {total:.3f})",
        )

    state.win_rate = new["win_rate"]
    state.rfid_fail_rate = new["rfid_fail_rate"]
    state.exit_stuck_rate = new["exit_stuck_rate"]
    state.mode = Scenario.RANDOM
    return {"mode": state.mode, **new}


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


@app.get("/health")
async def health():
    """Mirrors the real Pi server's /health so central + tools behave the same
    against the mock."""
    ping_ok = await esp.ping(timeout=2.0)
    return {
        "ok": esp.connected and ping_ok and esp.latched_fault is None,
        "esp": {
            "connected": esp.connected,
            "fw": esp.fw,
            "latched_fault": esp.latched_fault,
            "ping_ok": ping_ok,
        },
        "central_connected": len(manager.active_connections) > 0,
    }


@app.get("/scenarios/state")
async def scenario_state():
    return {
        "mode": state.mode,
        "win_rate": state.win_rate,
        "rfid_fail_rate": state.rfid_fail_rate,
        "exit_stuck_rate": state.exit_stuck_rate,
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
