"""Mock claw + opto driver.

The chute subsystem (break beams, solenoid, RFID) moved to the ESP32 and
is simulated by mock_esp.py. This file only mocks what still lives on the
Pi: the claw move bitmask, the COIN+UP start pulse, and the optocoupler
rising edge that signals end-of-turn.
"""

import asyncio
import itertools
import logging
import os
import random
from typing import Optional

from fsm import EV_OPTO

log = logging.getLogger("mock-rpi.hw")

DEFAULT_WIN_RATE = float(os.getenv("MOCK_WIN_RATE", "1.0"))
TURN_DURATION_MIN = float(os.getenv("MOCK_TURN_MIN_SEC", "2.0"))
TURN_DURATION_MAX = float(os.getenv("MOCK_TURN_MAX_SEC", "4.0"))

DEFAULT_TAG_UIDS = (
    "E007000012345600,E007000012345601,E007000012345602,"
    "E007000012345603,E007000012345604,E007000012345605"
)
TAG_UIDS = [s.strip() for s in os.getenv("MOCK_TAG_UIDS", DEFAULT_TAG_UIDS).split(",") if s.strip()]


class Scenario:
    RANDOM = "random"
    ALWAYS_WIN = "always-win"
    ALWAYS_LOSE = "always-lose"
    RFID_FAIL = "rfid-fail"      # entry edge fires but RFID never reads
    EXIT_STUCK = "exit-stuck"    # RFID reads but exit edge never fires


class MockState:
    def __init__(self):
        self.mode: str = Scenario.RANDOM
        self.win_rate: float = DEFAULT_WIN_RATE
        self._uid_cycle = itertools.cycle(TAG_UIDS) if TAG_UIDS else None
        self.next_uid_override: Optional[str] = None

    def next_uid(self) -> Optional[str]:
        if self.next_uid_override is not None:
            uid = self.next_uid_override
            self.next_uid_override = None
            return uid
        return next(self._uid_cycle) if self._uid_cycle else None


class MockClawOutputs:
    """No physical claw. The COIN/UP pulse returns immediately and schedules
    the simulated opto edge after a random delay."""

    def __init__(self, state: MockState, events: "asyncio.Queue[str]"):
        self.state = state
        self.events = events

    def apply_move_bitmask(self, mask: int) -> None:
        log.debug("move bitmask=%06b", mask)

    async def start_turn_pulse(self) -> None:
        asyncio.create_task(self._simulate_opto())

    async def _simulate_opto(self) -> None:
        duration = random.uniform(TURN_DURATION_MIN, TURN_DURATION_MAX)
        log.info("simulating turn: duration=%.2fs mode=%s", duration, self.state.mode)
        await asyncio.sleep(duration)
        self.events.put_nowait(EV_OPTO)
