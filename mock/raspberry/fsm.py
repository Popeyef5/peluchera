"""COPIED FROM raspberry/server/fsm.py — keep in sync.

The mock simulates at the hardware boundary (the EspLink serial port), so
it runs the exact same Pi-side FSM the cabinet does. If this drifts from
the prod copy, the simulation stops exercising production code.

Per-turn state machine for the cabinet.

Since the chute identification subsystem moved to the ESP32 (see esp_link.py
and esp/), this FSM only owns the claw side of the turn:

States
------
  IDLE     - no turn in progress; accepts turn_start (and fault_clear if a
             fault is latched on the ESP32).
  PLAYING  - turn_start received, COIN+UP pulsed; waiting for the claw
             optocoupler rising edge.
  AWAITING - opto fired, turn_end broadcast, ESP32 armed; waiting for the
             ESP32 to report the outcome (prize_won | fault | no_fall).

Outbound protocol (Pi → central):
  {"type": "turn_end"}
  {"type": "prize_won", "data": {"ball_serial": "<hex>"}}
  {"type": "fault",     "data": {"kind": "...", "reason"?: "..."}}

Inbound protocol (central → Pi):
  turn_start, fault_clear, move.
"""

import asyncio
import logging
from dataclasses import dataclass
from enum import Enum
from typing import Awaitable, Callable, Optional

from esp_link import EspLink, EspMessage

log = logging.getLogger("rpi.fsm")


class State(Enum):
    IDLE     = "idle"
    PLAYING  = "playing"
    AWAITING = "awaiting"


EV_OPTO = "opto"

EV_TURN_START  = "turn_start"
EV_FAULT_CLEAR = "fault_clear"

ESP_VERDICT_TIMEOUT = 15.0


@dataclass
class FSMHooks:
    broadcast: Callable[[dict], Awaitable[None]]
    start_turn_pulse: Callable[[], Awaitable[None]]


class FSM:
    def __init__(
        self,
        events: "asyncio.Queue[str]",
        esp_events: "asyncio.Queue[EspMessage]",
        esp: EspLink,
        hooks: FSMHooks,
    ):
        self.events = events
        self.esp_events = esp_events
        self.esp = esp
        self.hooks = hooks
        self.state = State.IDLE

    async def run(self) -> None:
        log.info("FSM start")
        while True:
            await self._run_idle()
            try:
                await self._run_turn()
            except Exception:
                log.exception("turn errored")
                await self.hooks.broadcast({
                    "type": "fault",
                    "data": {"kind": "internal_error"},
                })

    @property
    def fault_kind(self) -> Optional[str]:
        return self.esp.latched_fault

    async def _run_idle(self) -> None:
        self.state = State.IDLE
        while True:
            ev = await self.events.get()
            if ev == EV_FAULT_CLEAR:
                await self.esp.send("fault_clear")
                continue
            if ev == EV_TURN_START:
                if self.esp.latched_fault:
                    await self.hooks.broadcast({
                        "type": "fault",
                        "data": {
                            "kind": self.esp.latched_fault,
                            "reason": "still_blocked",
                        },
                    })
                    continue
                return
            log.debug("drop %s in IDLE", ev)

    async def _run_turn(self) -> None:
        self.state = State.PLAYING
        await self.hooks.start_turn_pulse()

        await self._await_opto()
        log.info("opto fired -> broadcasting turn_end, arming chute ESP")
        await self.hooks.broadcast({"type": "turn_end"})

        self.state = State.AWAITING
        armed = await self.esp.send("arm")
        log.info("arm sent to chute ESP (delivered=%s); awaiting verdict", armed)
        await self._await_verdict()

    async def _await_opto(self) -> None:
        while True:
            ev = await self.events.get()
            if ev == EV_OPTO:
                return
            log.debug("drop %s in PLAYING", ev)

    async def _await_verdict(self) -> None:
        try:
            msg: EspMessage = await asyncio.wait_for(
                self.esp_events.get(), timeout=ESP_VERDICT_TIMEOUT
            )
        except asyncio.TimeoutError:
            log.warning("ESP verdict timeout — emitting internal_error")
            await self.hooks.broadcast({
                "type": "fault",
                "data": {"kind": "internal_error", "reason": "esp_timeout"},
            })
            return

        log.info("chute verdict: %s %s", msg.type, msg.data or "")
        if msg.type == "prize_won":
            await self.hooks.broadcast({
                "type": "prize_won",
                "data": msg.data,
            })
        elif msg.type == "fault":
            await self.hooks.broadcast({
                "type": "fault",
                "data": msg.data,
            })
        elif msg.type == "no_fall":
            return
        elif msg.type == "ready":
            await self.hooks.broadcast({
                "type": "fault",
                "data": {"kind": "internal_error", "reason": "esp_reset"},
            })
        else:
            log.warning("unexpected ESP verdict %r", msg)
