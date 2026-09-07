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
             ESP32 to report its single verdict (no_fall | no_read | no_exit | ok).

Outbound protocol (Pi → central):
  {"type": "turn_end"}
  {"type": "verdict",   "data": {"outcome": "...", "ball_serial": "<hex>"|null}}
  {"type": "fault",     "data": {"kind": "...", "reason"?: "..."}}

Inbound protocol (central → Pi):
  turn_start, fault_clear, move.
"""

import asyncio
import logging
import time
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
# Direction-tagged variants. The claw line is high at rest and low for the
# duration of the grab, so a turn ends on the LOW -> HIGH transition. Bare
# EV_OPTO remains the fallback for a source that cannot report the level.
EV_OPTO_LOW  = "opto_low"
EV_OPTO_HIGH = "opto_high"

# Ceiling on one claw cycle. Generous: the player chooses when to grab, and the
# turn itself is only 30s. Exists so a cycle that never completes cannot wedge
# the FSM in PLAYING, swallowing every later turn_start.
OPTO_TIMEOUT = 45.0

# The claw must hold the line low for at least this long before a return to
# high counts as the release. Chatter around a single transition carries edges
# in BOTH directions, so without this a burst at the grab could deliver a low
# and a high milliseconds apart and satisfy the sequence on its own — the very
# failure the sequence exists to prevent. A measured grab lasts about five
# seconds, so this is two orders of magnitude of headroom, and it means the
# logic no longer depends on the debounce filter being tuned correctly.
MIN_GRAB_SEC = 0.25

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
                # Mirror the (now cleared) latch back to central — a fault
                # pauses the queue, so central must learn it's been cleared.
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

        await self._await_opto()
        log.info("opto fired -> broadcasting turn_end, arming chute ESP")
        await self.hooks.broadcast({"type": "turn_end"})

        self.state = State.AWAITING

        # Anything queued here predates this arm: the `ready` the firmware
        # emits at boot and again whenever the Pi opens the serial port, a
        # verdict that arrived after ESP_VERDICT_TIMEOUT gave up, a fault
        # raised while idle. _await_verdict does exactly one get per arm, so a
        # single leftover shifts every later read by one and the machine
        # reports the previous turn's outcome forever after. Since the verdict
        # carries the ball serial, that hands a player someone else's prize.
        self.drain_stale()

        armed = await self.esp.send("arm")
        log.info("arm sent to chute ESP (delivered=%s); awaiting verdict", armed)
        await self._await_verdict()

    def drain_stale(self) -> None:
        """Empty both ESP queues so the next arm's verdict is unambiguous.

        Synchronous, and the link queue goes first. `_esp_pump` moves frames
        from the link's queue to ours with no yield point in between, so a
        caller that drains source then sink without awaiting cannot be
        overtaken mid-transfer. Put an await between these two loops and a
        frame can slip past.
        """
        for msg in self.esp.drain():
            log.info("dropping stale ESP message before arming: %s", msg.type)
        while not self.esp_events.empty():
            stale = self.esp_events.get_nowait()
            log.info("dropping stale ESP message before arming: %s", stale.type)

    async def _await_opto(self) -> None:
        """Wait for the claw to FINISH, which is the opto line returning high.

        The line is low for the whole grab and high at rest, so one cycle is
        exactly two transitions: falling when the claw engages, rising when it
        releases. Taking the first edge of a turn therefore ended the turn at
        the grab, several seconds early, and armed the chute long before the
        ball could reach it.

        Requiring a low BEFORE the high is what makes this robust, rather than
        a blanking window or a filter tuned to one cabinet. Everything that
        used to trip us early — the COIN and UP pulses, the player's move
        commands, chatter around a transition — happens before or during the
        grab, and none of it can satisfy "the line went low and then came back
        up". No timing assumption, so it survives a different cabinet.
        """
        engaged_at: Optional[float] = None
        while True:
            try:
                ev = await asyncio.wait_for(self.events.get(), timeout=OPTO_TIMEOUT)
            except asyncio.TimeoutError:
                # The cycle never completed. Ending the turn yields a clean
                # no_fall downstream, which is a far better failure than
                # sitting here forever swallowing the next turn_start.
                log.warning("no claw cycle within %ss — ending the turn anyway",
                            OPTO_TIMEOUT)
                return
            if ev == EV_OPTO_LOW:
                if engaged_at is None:
                    log.info("claw engaged (opto low) — waiting for release")
                    engaged_at = time.monotonic()
            elif ev == EV_OPTO_HIGH:
                if engaged_at is None:
                    log.debug("opto high before the claw engaged — ignoring")
                    continue
                held = time.monotonic() - engaged_at
                if held >= MIN_GRAB_SEC:
                    return
                # Too fast to be a grab. This is chatter around one transition,
                # so drop back and keep waiting for the real thing.
                log.debug("opto high after only %.0fms low — chatter, ignoring", held * 1000)
                engaged_at = None
            elif ev == EV_OPTO:
                # Level unknown (an lgpio build whose callback omits it).
                # Fall back to the old first-edge behaviour rather than
                # waiting for a pair that will never arrive.
                log.warning("opto edge carried no level — using first-edge fallback")
                return
            else:
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
