"""Async UART link to the chute ESP32.

Wire format: newline-delimited JSON, 115200 8N1. Symmetric with the
central↔Pi websocket so debugging is uniform — a stray `cat /dev/ttyUSB0`
on the Pi shows the same shape of frames you'd see in the central log.

Pi  → ESP:  arm | fault_clear | ping
ESP → Pi :  ready | verdict | fault | pong | log

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
        self._ready_event = asyncio.Event()
        self._ping_seq = 0
        self._pong_waiters: "dict[int, asyncio.Future]" = {}
        # When set (by arm_and_wait), the next verdict frame resolves it and is
        # NOT forwarded to the turn FSM — used by the admin "test win" probe.
        self._verdict_waiter: Optional["asyncio.Future"] = None

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
                self._ready_event.set()
            elif msg.type == "fault":
                # ESP only emits `fault` for new latches; still_blocked
                # (a re-emit on arm during latch) does NOT change state.
                if msg.data.get("reason") != "still_blocked":
                    self.latched_fault = msg.data.get("kind")
            elif msg.type == "pong":
                # Liveness reply — resolve the matching ping() waiter and don't
                # surface it to the FSM (it'd be an unexpected verdict).
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
            if type_ == "fault_clear":
                # Optimistic local clear — the ESP doesn't currently ack.
                self.latched_fault = None
            return True
        except Exception as e:
            log.warning("esp.send(%s) failed: %s", type_, e)
            return False

    async def events(self) -> AsyncIterator[EspMessage]:
        while True:
            yield await self._queue.get()

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
