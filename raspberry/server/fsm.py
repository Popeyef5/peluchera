"""Per-turn state machine for the cabinet.

Since the chute identification subsystem moved to the ESP32 (see esp_link.py
and esp/), this FSM only owns the claw side of the turn:

States
------
  IDLE     - no turn in progress; accepts turn_start (and fault_clear if a
             fault is latched on the ESP32).
  PLAYING  - turn_start received, COIN+UP pulsed; waiting for the claw
             optocoupler rising edge.
  AWAITING - opto fired, turn_end broadcast, ESP32 armed; waiting for the
             ESP32 to report its single verdict (no_fall | no_read | no_exit | ok).

The CHUTE_BLOCKED latch lives on the ESP32. The Pi reads `esp.latched_fault`
to refuse `turn_start` while latched, emitting a fault re-broadcast so the
operator gets prompted again instead of burning a turn.

Outbound protocol (Pi → central) is unchanged:
  {"type": "turn_end"}
  {"type": "verdict",   "data": {"outcome": "...", "ball_serial": "<hex>"|null}}
  {"type": "fault",     "data": {"kind": "...", "reason"?: "..."}}

Inbound protocol (central → Pi) is unchanged:
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


# Claw-side sensor edges (still on the Pi).
EV_OPTO = "opto"

# Inbound websocket events.
EV_TURN_START  = "turn_start"
EV_FAULT_CLEAR = "fault_clear"

# Ceiling on how long we'll wait for an ESP32 verdict after arming. Must
# exceed T_FALL + T_ID + T_EXIT on the firmware side (3+2+2 = 7s today) by
# a comfortable margin. If we hit this, the ESP32 is non-responsive — emit
# an internal_error fault to central rather than hanging the turn.
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
        # Compatibility shim: legacy callers (e.g. mock state endpoint)
        # read fsm.fault_kind. Source of truth is the ESP latch mirror.
        return self.esp.latched_fault

    async def _run_idle(self) -> None:
        self.state = State.IDLE
        while True:
            ev = await self.events.get()
            if ev == EV_FAULT_CLEAR:
                # Forward to ESP regardless of local view — operator just
                # told us the chute is physically cleared.
                await self.esp.send("fault_clear")
                # Mirror the (now cleared) latch back to central. Without this
                # central's cabinet_fault stays set forever and — since a fault
                # now pauses the queue — the machine would never resume.
                await self.hooks.broadcast({
                    "type": "esp_status",
                    "data": self.esp.status_data(),
                })
                continue
            if ev == EV_TURN_START:
                if self.esp.effective_fault():
                    await self.hooks.broadcast({
                        "type": "fault",
                        "data": {
                            "kind": self.esp.effective_fault(),
                            "reason": "still_blocked",
                        },
                    })
                    continue
                return
            log.debug("drop %s in IDLE", ev)

    async def _run_turn(self) -> None:
        self.state = State.PLAYING
        await self.hooks.start_turn_pulse()

        # Opto rising edge can take as long as the player wants — no timeout.
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
        """Block until the ESP32 reports its single verdict for this arm, or the
        ceiling elapses.

        The ESP emits exactly one `verdict` per arm, carrying the outcome and —
        whenever a tag was actually read — the ball_serial. Central needs two
        facts (did the player win, is the chute still usable) and derives both
        from that one message, so we forward it untouched.

        Note a loss is now *reported* (outcome=no_fall) rather than left to be
        inferred downstream from a timeout, and outcome=no_exit carries the
        ball_serial: the chute is jammed and the queue must stop, but the player
        still finds out what they won.
        """
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
        if msg.type == "verdict":
            await self.hooks.broadcast({
                "type": "verdict",
                "data": msg.data,
            })
        elif msg.type == "fault":
            # Not the outcome of an arm (still_blocked / internal_error).
            await self.hooks.broadcast({
                "type": "fault",
                "data": msg.data,
            })
        elif msg.type == "ready":
            # ESP reset mid-turn. Surface as a fault so the operator can
            # investigate; the prize (if any) is now unaccounted for.
            await self.hooks.broadcast({
                "type": "fault",
                "data": {"kind": "internal_error", "reason": "esp_reset"},
            })
        else:
            log.warning("unexpected ESP verdict %r", msg)
