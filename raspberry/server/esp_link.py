"""Async UART link to the chute ESP32.

Wire format: newline-delimited JSON, 115200 8N1. Symmetric with the
central↔Pi websocket so debugging is uniform — a stray `cat /dev/ttyUSB0`
on the Pi shows the same shape of frames you'd see in the central log.

Pi  → ESP:  arm | fault_clear | ping | enroll | reset
ESP → Pi :  ready | verdict | fault | pong | log | tag_scanned | enroll_timeout

The chute sub-FSM (T_FALL/T_ID/T_EXIT, CHUTE_BLOCKED latch) lives entirely
on the ESP32. This module is a transport with reconnect — it does not
own state beyond a mirror of the latch so the Pi-side FSM can short-circuit
turn_start while latched.

Pure-Python implementation: pyserial-asyncio so we slot into the existing
asyncio loop the way websockets did.
"""

import asyncio
import json
import logging
import os
from dataclasses import dataclass, field
from typing import AsyncIterator, Optional

import serial_asyncio

log = logging.getLogger("rpi.esp_link")

ESP_PORT = os.getenv("ESP_PORT", "/dev/ttyUSB0")
ESP_BAUD = int(os.getenv("ESP_BAUD", "115200"))


@dataclass
class EspMessage:
    type: str
    data: dict = field(default_factory=dict)
    seq: Optional[int] = None


class EspLink:
    """Reconnecting JSON-over-serial client.

    Exposes:
      - send(type, data=None): fire-and-forget; silently drops if the link
        is down (mirrors the Pi↔central pattern).
      - events(): async iterator of EspMessage as they arrive.
      - latched_fault: mirror of ESP's CHUTE_BLOCKED latch; updated from
        ready/fault frames and cleared optimistically when send("fault_clear")
        succeeds.
    """

    def __init__(self, port: str = ESP_PORT, baud: int = ESP_BAUD):
        self.port = port
        self.baud = baud
        self._reader: Optional[asyncio.StreamReader] = None
        self._writer: Optional[asyncio.StreamWriter] = None
        self._queue: "asyncio.Queue[EspMessage]" = asyncio.Queue()
        self.connected = False
        self.latched_fault: Optional[str] = None
        self.fw: Optional[str] = None          # firmware version from the last `ready`
        self.esp_proto: Optional[int] = None   # ESP_PI protocol from the last `ready`
        # Live chute snapshot, refreshed by every pong. Cleared when the link
        # drops so a dead board can't keep reporting a state it isn't in.
        self.chute_state: Optional[str] = None  # chute FSM state
        self.tag_pending: Optional[bool] = None # RFID latch holds an unconsumed tag
        self.last_tag: Optional[str] = None     # last tag the reader decoded
        self._ready_seen = False
        self._ready_event = asyncio.Event()
        self._ping_seq = 0
        self._pong_waiters: "dict[int, asyncio.Future]" = {}
        # When set (by arm_and_wait), the next verdict frame resolves it and is
        # NOT forwarded to the turn FSM — used by the admin "test win" probe.
        self._verdict_waiter: Optional["asyncio.Future"] = None

    def version_ok(self) -> bool:
        """False once we've heard a `ready` whose protocol doesn't match ours.
        Unknown-until-first-ready is treated as OK so we don't fault on boot."""
        from protocol_version import ESP_PI_PROTO
        return (not self._ready_seen) or (self.esp_proto == ESP_PI_PROTO)

    def effective_fault(self) -> Optional[str]:
        """What to report as the chute's blocking fault: a version mismatch takes
        precedence (a reflash is the only fix — an operator's fault_clear cannot
        resolve it), otherwise the physical latch."""
        if not self.version_ok():
            return "esp_version_mismatch"
        return self.latched_fault

    def status_data(self) -> dict:
        """The esp_status payload the Pi reports to central. EVERY esp_status
        must go through here — omitting pi_proto makes central read the Pi as
        version-unaware and pause the queue."""
        from protocol_version import PI_VPS_PROTO, PI_FW
        return {
            "latched_fault": self.effective_fault(),
            "pi_proto": PI_VPS_PROTO,
            "versions": {"esp_fw": self.fw, "esp_proto": self.esp_proto, "pi_fw": PI_FW},
        }

    async def run(self) -> None:
        """Reconnect loop. Run as a background task."""
        while True:
            try:
                self._reader, self._writer = await serial_asyncio.open_serial_connection(
                    url=self.port, baudrate=self.baud
                )
                self.connected = True
                log.info("ESP serial CONNECTED on %s", self.port)
                await self._read_loop()
            except Exception as e:
                log.warning("ESP serial error: %s — retrying in 2s", e)
            finally:
                self.connected = False
                self.chute_state = None
                self.tag_pending = None
                self.last_tag = None
                self._ready_event.clear()
                self._writer = None
                self._reader = None
            await asyncio.sleep(2)

    async def _read_loop(self) -> None:
        assert self._reader is not None
        while True:
            line = await self._reader.readline()
            if not line:
                raise ConnectionError("ESP closed the link")
            try:
                payload = json.loads(line.decode("utf-8").strip())
            except (UnicodeDecodeError, json.JSONDecodeError) as e:
                log.warning("ESP bad frame: %s (%r)", e, line)
                continue
            msg = EspMessage(
                type=payload.get("type", ""),
                data=payload.get("data") or {},
                seq=payload.get("seq"),
            )
            # Update latch mirror before queuing so consumers reading
            # `latched_fault` see consistent state.
            if msg.type == "ready":
                self.latched_fault = payload.get("fault")
                self.fw = payload.get("fw")
                self.esp_proto = payload.get("proto")
                self._ready_seen = True
                self._ready_event.set()
            elif msg.type == "verdict":
                # The firmware latches internally on no_read / no_exit and
                # reports it INSIDE the verdict, not as a separate `fault`
                # frame. Nothing else updated this mirror, so the Pi believed
                # the chute was healthy while the ESP sat in BLOCKED: /health
                # answered ok, the turn FSM stopped refusing turn_start, and
                # every turn ran until the ESP bounced the arm with
                # still_blocked. Same mapping central applies downstream.
                kind = {"no_read": "rfid_failed",
                        "no_exit": "exit_timeout"}.get((msg.data or {}).get("outcome"))
                if kind:
                    self.latched_fault = kind
            elif msg.type == "fault":
                # ESP only emits `fault` for new latches; still_blocked
                # (a re-emit on arm during latch) does NOT change state.
                if msg.data.get("reason") != "still_blocked":
                    self.latched_fault = msg.data.get("kind")
            elif msg.type == "pong":
                # Liveness reply — resolve the matching ping() waiter and don't
                # surface it to the FSM (it'd be an unexpected verdict). It also
                # carries the chute snapshot, so every /health probe refreshes
                # where the ESP is for free.
                # Version rides every pong now. Treat it exactly like a
                # `ready` for version purposes: without this the Pi stays
                # blind to a board it is actively talking to, and version_ok()
                # returns True against an unknown peer rather than checking it.
                if payload.get("proto") is not None:
                    self.fw = payload.get("fw")
                    self.esp_proto = payload.get("proto")
                    self._ready_seen = True
                self.chute_state = payload.get("state")
                self.tag_pending = payload.get("tag_pending")
                self.last_tag = payload.get("last_tag")
                fut = self._pong_waiters.get(payload.get("seq"))
                if fut is not None and not fut.done():
                    fut.set_result(True)
                continue
            elif msg.type == "log":
                log.info("ESP log: %s", payload.get("msg"))
                continue  # do not surface log frames to consumers
            # Diagnostic test-arm: capture the verdict instead of routing it to
            # the FSM. Only active during arm_and_wait() (gated on idle).
            if self._verdict_waiter is not None and not self._verdict_waiter.done() \
                    and msg.type in ("verdict", "fault"):
                self._verdict_waiter.set_result(msg)
                continue
            await self._queue.put(msg)

    async def send(self, type_: str, data: Optional[dict] = None) -> bool:
        if not self.connected or self._writer is None:
            log.warning("esp.send(%s) dropped — link down", type_)
            return False
        frame = {"type": type_}
        if data is not None:
            frame.update(data)
        try:
            self._writer.write((json.dumps(frame) + "\n").encode("utf-8"))
            await self._writer.drain()
            if type_ in ("fault_clear", "reset"):
                # Optimistic local clear — the ESP doesn't currently ack.
                # `reset` forces the chute back to IDLE, which also drops any
                # latch, so the mirror has to follow for both.
                self.latched_fault = None
            return True
        except Exception as e:
            log.warning("esp.send(%s) failed: %s", type_, e)
            return False

    async def events(self) -> AsyncIterator[EspMessage]:
        while True:
            yield await self._queue.get()

    def drain(self) -> list:
        """Discard everything queued here and hand back what was dropped.

        Synchronous ON PURPOSE. Frames reach the turn FSM through two queues in
        series, this one and the FSM's own, with `_esp_pump` between them. The
        pump has no yield point between taking from here and putting there, so
        a caller that drains this queue and the FSM's without awaiting in
        between cannot be overtaken mid-transfer. Add an await between the two
        drains and that guarantee is gone.
        """
        dropped = []
        while not self._queue.empty():
            dropped.append(self._queue.get_nowait())
        return dropped

    async def ping(self, timeout: float = 2.0) -> bool:
        """Liveness probe: send a ping and wait for the matching pong. False if
        the link is down or the ESP doesn't answer in time (port-open alone
        doesn't mean the firmware is responsive)."""
        if not self.connected or self._writer is None:
            return False
        self._ping_seq += 1
        seq = self._ping_seq
        fut: "asyncio.Future" = asyncio.get_event_loop().create_future()
        self._pong_waiters[seq] = fut
        try:
            if not await self.send("ping", {"seq": seq}):
                return False
            await asyncio.wait_for(fut, timeout)
            return True
        except asyncio.TimeoutError:
            return False
        finally:
            self._pong_waiters.pop(seq, None)

    async def arm_and_wait(self, timeout: float = 15.0) -> Optional[EspMessage]:
        """Arm the chute and wait for the single verdict frame (or a fault).
        Runs the real ESP sequence (break-beams, RFID, solenoid). Returns the
        verdict frame, or None on timeout / link down. Caller MUST ensure the
        cabinet is idle — the verdict is captured here, not given to the FSM."""
        if not self.connected or self._writer is None:
            return None
        self._verdict_waiter = asyncio.get_event_loop().create_future()
        try:
            if not await self.send("arm"):
                return None
            return await asyncio.wait_for(self._verdict_waiter, timeout)
        except asyncio.TimeoutError:
            return None
        finally:
            self._verdict_waiter = None

    async def wait_ready(self, timeout: Optional[float] = None) -> bool:
        try:
            await asyncio.wait_for(self._ready_event.wait(), timeout=timeout)
            return True
        except asyncio.TimeoutError:
            return False
