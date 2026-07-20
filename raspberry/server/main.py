"""Pi-side websocket server: claw I/O + bridge to the chute ESP32.

Wire protocol with central is unchanged:

Inbound (central → Pi):
  {"type": "move",        "data": {"bitmask": int}}
  {"type": "turn_start",  "data": ...}
  {"type": "fault_clear", "data": ...}

Outbound (Pi → central):
  {"type": "turn_end"}
  {"type": "verdict",     "data": {"outcome": "no_fall|no_read|no_exit|ok", "ball_serial": "<hex>"|null}}
  {"type": "fault",       "data": {"kind": "...", "reason"?: "..."}}

The chute identification subsystem (entry/exit break-beams, PN5180 pool,
solenoid) lives on the ESP32 now — see esp/ and esp_link.py. fault frames
that originate on the ESP32 are forwarded as-is, which fixes the pre-split
bug where any chute fault was silently dropped on the Pi side.
"""

import asyncio
import json
import logging
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, WebSocketException

from protocol_version import PI_VPS_PROTO, PI_FW
from esp_link import EspLink
from fsm import FSM, FSMHooks, State, EV_TURN_START, EV_FAULT_CLEAR
from hardware import ClawOutputs, Sensors, open_gpiochip

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("rpi")


# Hardware singletons. Constructed at import; the loop + ESP link are
# bound in lifespan.
h = open_gpiochip()
claw = ClawOutputs(h)
events: asyncio.Queue[str] = asyncio.Queue()
esp_events: asyncio.Queue = asyncio.Queue()
sensors = Sensors(h=h, events=events)
sensors.install()
esp = EspLink()

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
    go straight to central — they never belong to a turn and the FSM
    consumer would block on them. Everything else queues into the FSM."""
    async for msg in esp.events():
        if msg.type in ("tag_scanned", "enroll_timeout"):
            await manager.broadcast({"type": msg.type, "data": msg.data})
        else:
            await esp_events.put(msg)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global fsm
    loop = asyncio.get_running_loop()
    sensors.bind_loop(loop)

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


@app.get("/health")
async def health():
    """Status of the chute ESP + this Pi server. Curl it on the Pi, or via the
    admin Cabinet page (central proxies it). Does a live ping, so it reflects
    actual ESP responsiveness, not just that the serial port is open."""
    ping_ok = await esp.ping(timeout=2.0)
    esp_ok = esp.connected and ping_ok and esp.latched_fault is None
    return {
        "ok": esp_ok,
        "esp": {
            "connected": esp.connected,
            "fw": esp.fw,
            "latched_fault": esp.latched_fault,
            "ping_ok": ping_ok,
        },
        "central_connected": len(manager.active_connections) > 0,
    }


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
    """Map the chute's single verdict frame to an operator-readable drop-test result."""
    if msg is None:
        return {"outcome": "timeout",
                "detail": "No verdict within the window — no ball dropped, or the ESP is unresponsive."}
    if msg.type == "verdict":
        d = msg.data or {}
        outcome = d.get("outcome")
        serial = d.get("ball_serial")
        detail = {
            "ok": "Full sequence OK — entry beam, RFID read, solenoid fired, exit beam.",
            "no_fall": "No ball detected at the entry break-beam.",
            "no_read": "Ball fell (entry beam broke) but the RFID tag didn't read. Chute is blocked.",
            "no_exit": "Ball fell and RFID read, but it didn't clear the exit (solenoid / exit beam). "
                       "Chute is blocked — but the tag WAS read, so the prize is known.",
        }.get(outcome, "Unrecognized verdict outcome.")
        out = {"outcome": outcome, "detail": detail}
        if serial:
            out["ball_serial"] = serial
        return out
    if msg.type == "fault":
        kind = (msg.data or {}).get("kind")
        detail = {
            "internal_error": "ESP internal error or reset during the sequence.",
            "rfid_failed": "Chute latched blocked (RFID failure).",
            "exit_timeout": "Chute latched blocked (exit timeout).",
        }.get(kind, "Chute fault.")
        return {"outcome": kind or "fault", "fault_kind": kind, "detail": detail}
    return {"outcome": msg.type, "detail": "Unrecognized verdict."}


async def on_test_arm(_ws, _message):
    """Diagnostic 'test win': arm the chute outside a turn so an operator can
    drop a ball and see the real ESP sequence (break-beams, RFID, solenoid).
    Does NOT create a Win. Refuses unless idle and unlatched."""
    if fsm is None or fsm.state != State.IDLE:
        await manager.broadcast({"type": "test_result",
            "data": {"outcome": "busy", "detail": "Cabinet is not idle (a turn is running)."}})
        return
    if esp.latched_fault:
        await manager.broadcast({"type": "test_result",
            "data": {"outcome": "blocked", "fault_kind": esp.latched_fault,
                     "detail": "Chute is latched — clear the fault first."}})
        return
    log.info("test_arm: arming chute for a drop test")
    msg = await esp.arm_and_wait(timeout=15.0)
    await manager.broadcast({"type": "test_result", "data": _interpret_verdict(msg)})


MESSAGE_HANDLERS = {
    "move": on_move,
    "turn_start": on_turn_start,
    "fault_clear": on_fault_clear,
    "enroll": on_enroll,
    "test_arm": on_test_arm,
}


def esp_status_frame() -> dict:
    """The status the Pi reports to central: the effective chute fault plus the
    version info central needs for the Pi<->VPS and ESP<->Pi compatibility
    checks. Every esp_status the Pi sends goes through here."""
    return {"type": "esp_status", "data": esp.status_data()}


@app.websocket("/")
async def websocket_endpoint(ws: WebSocket):
    await manager.connect(ws)
    log.info("WS connected (active=%d)", len(manager.active_connections))
    # Tell the new client the chute's current latch so its mirror is correct
    # even when the latch predates this connection (e.g. the ESP latched across
    # a Pi restart and re-announced it via `ready`).
    try:
        await ws.send_text(json.dumps(esp_status_frame()))
    except Exception as e:
        log.warning("esp_status send failed: %s", e)
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
