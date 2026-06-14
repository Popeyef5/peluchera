"""Mock EspLink — in-process simulation of the chute ESP32.

The Pi-side hardware boundary is now the serial port to the chute ESP32
(see raspberry/server/esp_link.py). For local dev we don't open a real
serial port; instead we expose the same public interface
(`send`, `events`, `latched_fault`, `connected`, `wait_ready`) backed by
an asyncio-driven simulation of the firmware's sub-FSM.

This keeps the simulation at the (new) hardware boundary, so the real
Pi-side fsm.py runs unchanged against it — same code path as production,
just a different EspLink impl.

Scenarios route through MockState (see mock_hardware.py) and bend the
simulated chute behavior the way the legacy mock's `is_win()`/RFID_FAIL/
EXIT_STUCK switches did.
"""

import asyncio
import logging
import random
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, AsyncIterator, Optional

# Avoid a circular import at module load: mock_hardware imports fsm, which
# imports this module. The runtime references to Scenario are deferred to
# inside _simulate_arm; MockState is only used as a type hint.
if TYPE_CHECKING:
    from mock_hardware import MockState

log = logging.getLogger("mock-rpi.esp_link")

# Simulated timing — chosen to land well inside the firmware's real
# T_FALL/T_ID/T_EXIT bounds so the Pi-side verdict timeout is exercised
# only by genuinely stuck scenarios.
ENTRY_DELAY_SEC = 0.3
RFID_DELAY_SEC  = 0.3
EXIT_DELAY_SEC  = 0.3
T_FALL_SEC      = 3.0
T_ID_SEC        = 2.0
T_EXIT_SEC      = 2.0


@dataclass
class EspMessage:
    type: str
    data: dict = field(default_factory=dict)
    seq: Optional[int] = None


class EspLink:
    """Mock implementation. Shape-compatible with raspberry/server/esp_link.EspLink."""

    def __init__(self, state: "MockState"):
        self.state = state
        self._queue: "asyncio.Queue[EspMessage]" = asyncio.Queue()
        self.connected = True
        self.latched_fault: Optional[str] = None
        self._ready_event = asyncio.Event()
        self._ready_event.set()

    async def run(self) -> None:
        # Real impl manages a reconnect loop here; nothing to do for the mock.
        await self._queue_message(EspMessage(type="ready", data={}))
        # Sleep forever — the lifespan task is what keeps this around.
        while True:
            await asyncio.sleep(3600)

    async def send(self, type_: str, data: Optional[dict] = None) -> bool:
        if type_ == "arm":
            asyncio.create_task(self._simulate_arm())
        elif type_ == "fault_clear":
            self.latched_fault = None
        elif type_ == "ping":
            seq = (data or {}).get("seq", 0)
            await self._queue_message(EspMessage(type="pong", seq=seq))
        elif type_ == "enroll":
            timeout_ms = (data or {}).get("timeout_ms", 10000)
            asyncio.create_task(self._simulate_enroll(timeout_ms / 1000.0))
        return True

    async def events(self) -> AsyncIterator[EspMessage]:
        while True:
            yield await self._queue.get()

    async def wait_ready(self, timeout: Optional[float] = None) -> bool:
        return True

    async def _queue_message(self, msg: EspMessage) -> None:
        await self._queue.put(msg)

    def _draw_outcome(self) -> str:
        """Decide what the chute will do this arm. Returns one of:
        "win" | "no_fall" | "rfid_failed" | "exit_timeout".

        Deterministic scenarios map to a fixed outcome. RANDOM mode draws a
        single uniform and partitions it: win_rate, then rfid_fail_rate, then
        exit_stuck_rate, with the remainder a clean `no_fall` (ordinary lose).
        The three rates are kept summing to <= 1.0 by the /scenarios/odds
        validation, so the partition never overlaps.
        """
        from mock_hardware import Scenario   # deferred (see top-of-file note)

        mode = self.state.mode
        if mode == Scenario.ALWAYS_WIN:
            return "win"
        if mode == Scenario.ALWAYS_LOSE:
            return "no_fall"
        if mode == Scenario.RFID_FAIL:
            return "rfid_failed"
        if mode == Scenario.EXIT_STUCK:
            return "exit_timeout"

        # RANDOM
        r = random.random()
        win = self.state.win_rate
        rfid = self.state.rfid_fail_rate
        exit_stuck = self.state.exit_stuck_rate
        if r < win:
            return "win"
        if r < win + rfid:
            return "rfid_failed"
        if r < win + rfid + exit_stuck:
            return "exit_timeout"
        return "no_fall"

    async def _simulate_arm(self) -> None:
        if self.latched_fault:
            await self._queue_message(EspMessage(
                type="fault",
                data={"kind": self.latched_fault, "reason": "still_blocked"},
            ))
            return

        outcome = self._draw_outcome()

        if outcome == "no_fall":
            # AWAITING_FALL times out without an entry edge.
            await asyncio.sleep(T_FALL_SEC)
            await self._queue_message(EspMessage(type="no_fall"))
            return

        # Entry edge after a short delay (well inside T_FALL).
        await asyncio.sleep(ENTRY_DELAY_SEC)

        # IDENTIFYING phase.
        if outcome == "rfid_failed":
            await asyncio.sleep(T_ID_SEC)
            self.latched_fault = "rfid_failed"
            await self._queue_message(EspMessage(
                type="fault", data={"kind": "rfid_failed"},
            ))
            return

        await asyncio.sleep(RFID_DELAY_SEC)
        uid = self.state.next_uid()

        # CLEARING phase.
        if outcome == "exit_timeout":
            await asyncio.sleep(T_EXIT_SEC)
            self.latched_fault = "exit_timeout"
            await self._queue_message(EspMessage(
                type="fault", data={"kind": "exit_timeout"},
            ))
            return

        await asyncio.sleep(EXIT_DELAY_SEC)
        await self._queue_message(EspMessage(
            type="prize_won", data={"ball_serial": uid},
        ))

    async def _simulate_enroll(self, timeout_s: float) -> None:
        """Pretend the admin waves a tag in front of the antenna. Returns a
        UID from the mock pool after a short delay; /scenarios/next-tag/<uid>
        overrides flow through state.next_uid() so admin tests can use the
        same scenario hooks as gameplay tests."""
        await asyncio.sleep(min(1.5, timeout_s * 0.5))
        uid = self.state.next_uid()
        await self._queue_message(EspMessage(
            type="tag_scanned", data={"ball_serial": uid},
        ))
