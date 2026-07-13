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
        self._arm_gen = 0
        self._arm_task: Optional[asyncio.Task] = None
        self.fw = "garra-chute-mock-0.1.0"   # mirrors the real ESP's `ready.fw`
        self._ready_event = asyncio.Event()
        self._ready_event.set()
        self._verdict_waiter: Optional["asyncio.Future"] = None

    async def run(self) -> None:
        # Real impl manages a reconnect loop here; nothing to do for the mock.
        await self._queue_message(EspMessage(type="ready", data={}))
        # Sleep forever — the lifespan task is what keeps this around.
        while True:
            await asyncio.sleep(3600)

    async def send(self, type_: str, data: Optional[dict] = None) -> bool:
        if type_ == "arm":
            # This is the path the turn FSM actually uses. Supersede any arm
            # still running from a previous turn: without the generation bump
            # its late verdict would be emitted into the shared queue and the
            # next turn would pop it as its own outcome.
            prev = self._arm_task
            if prev is not None and not prev.done():
                prev.cancel()
            self._arm_gen += 1
            self._arm_task = asyncio.create_task(self._simulate_arm())
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

    async def ping(self, timeout: float = 2.0) -> bool:
        # The in-process mock is always responsive while "connected".
        return self.connected

    async def wait_ready(self, timeout: Optional[float] = None) -> bool:
        return True

    async def arm_and_wait(self, timeout: float = 15.0) -> Optional[EspMessage]:
        """Mirror of the real EspLink.arm_and_wait: run one simulated chute
        sequence (per the active scenario) and capture its verdict.

        Each arm gets a generation number. A previous arm can still be sleeping
        out its chute timings when the next turn arms (the no_fall path alone
        waits T_FALL_SEC), and without this its late verdict would satisfy the
        NEW arm's waiter — an always-win turn would mysteriously report no_fall,
        and the ball chosen via /scenarios/next-tag would be handed to the wrong
        turn. Stale arms are cancelled, and any verdict they still emit is
        dropped by the generation check in `_simulate_arm`.
        """
        prev = self._arm_task
        if prev is not None and not prev.done():
            prev.cancel()

        self._arm_gen += 1
        self._verdict_waiter = asyncio.get_event_loop().create_future()
        self._arm_task = asyncio.create_task(self._simulate_arm())
        try:
            return await asyncio.wait_for(self._verdict_waiter, timeout)
        except asyncio.TimeoutError:
            return None
        finally:
            self._verdict_waiter = None

    async def _queue_message(self, msg: EspMessage) -> None:
        w = self._verdict_waiter
        if w is not None and not w.done() and msg.type in ("verdict", "fault"):
            w.set_result(msg)
            return
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
        gen = self._arm_gen

        async def emit(msg: EspMessage) -> None:
            # A verdict only counts for the arm that produced it.
            if gen != self._arm_gen:
                log.info("dropping stale chute verdict from a superseded arm: %s", msg.type)
                return
            await self._queue_message(msg)

        if self.latched_fault:
            # Refusing to arm is not the outcome of an arm — still a `fault`.
            await emit(EspMessage(
                type="fault",
                data={"kind": self.latched_fault, "reason": "still_blocked"},
            ))
            return

        outcome = self._draw_outcome()

        if outcome == "no_fall":
            # AWAITING_FALL times out without an entry edge: an ordinary loss,
            # chute healthy. Reported explicitly — never inferred from silence.
            await asyncio.sleep(T_FALL_SEC)
            await emit(EspMessage(
                type="verdict", data={"outcome": "no_fall", "ball_serial": None},
            ))
            return

        # Entry edge after a short delay (well inside T_FALL).
        await asyncio.sleep(ENTRY_DELAY_SEC)

        # IDENTIFYING phase.
        if outcome == "rfid_failed":
            await asyncio.sleep(T_ID_SEC)
            self.latched_fault = "rfid_failed"
            await emit(EspMessage(
                type="verdict", data={"outcome": "no_read", "ball_serial": None},
            ))
            return

        await asyncio.sleep(RFID_DELAY_SEC)
        uid = self.state.next_uid()

        # CLEARING phase.
        if outcome == "exit_timeout":
            await asyncio.sleep(T_EXIT_SEC)
            self.latched_fault = "exit_timeout"
            # Jammed on the way out — the chute is blocked and the queue has to
            # stop, but we DID read the tag, so report it: the player still finds
            # out what they won.
            await emit(EspMessage(
                type="verdict", data={"outcome": "no_exit", "ball_serial": uid},
            ))
            return

        await asyncio.sleep(EXIT_DELAY_SEC)
        await emit(EspMessage(
            type="verdict", data={"outcome": "ok", "ball_serial": uid},
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
