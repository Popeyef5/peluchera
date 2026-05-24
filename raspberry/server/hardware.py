"""GPIO pin map, claw outputs, and claw optocoupler sensor.

After the chute subsystem moved to the ESP32 (see esp/ and esp_link.py),
the Pi only owns the claw side: motor coils, COIN/GRAB outputs, and the
optocoupler that signals end-of-turn. Break beams, solenoid, and PN5180
readers all live on the ESP32 now.

Targets the Pi 5 (BCM numbering), via lgpio.
"""

import asyncio
import logging
from dataclasses import dataclass
from typing import Optional

import lgpio

log = logging.getLogger("rpi.hw")

# --- Cabinet outputs --------------------------------------------------------
COIN = 16
GRAB = 26
W = 12
A = 5
S = 6
D = 13

OUTPUT_PINS = {
    1 << 0: A,   # Left
    1 << 1: D,   # Right
    1 << 2: W,   # Up
    1 << 3: S,   # Down
    1 << 4: GRAB,
    1 << 5: COIN,
}

# --- Claw optocoupler -------------------------------------------------------
CLAW_OPTO = 27   # rising edge = end-of-turn

# Glitch filter preserved from the legacy driver: longer than the BBs since
# the inductor decay is slow.
GLITCH_US_CLAW = 10_000


def open_gpiochip() -> int:
    """Pi 5 RP1 header: gpiochip0 on current Bookworm; gpiochip4 on early
    Pi 5 kernels. Try both."""
    last_err: Optional[Exception] = None
    for chip in (0, 4):
        try:
            return lgpio.gpiochip_open(chip)
        except lgpio.error as e:
            last_err = e
    raise RuntimeError(f"No usable gpiochip found (tried 0 and 4): {last_err}")


# --- Sensors ----------------------------------------------------------------

@dataclass
class Sensors:
    """Pushes the opto rising edge onto an asyncio.Queue from the lgpio
    worker thread. The owning event loop must be set via `bind_loop()`
    before `install()` arms the callback."""
    h: int
    events: "asyncio.Queue[str]"
    loop: Optional[asyncio.AbstractEventLoop] = None
    _claw_cb: object = None

    def bind_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self.loop = loop

    def install(self) -> None:
        lgpio.gpio_claim_input(self.h, CLAW_OPTO, lgpio.SET_PULL_UP)
        lgpio.gpio_set_debounce_micros(self.h, CLAW_OPTO, GLITCH_US_CLAW)
        self._claw_cb = lgpio.callback(
            self.h, CLAW_OPTO, lgpio.RISING_EDGE,
            lambda *_: self._push("opto"))

    def _push(self, kind: str) -> None:
        if self.loop is None:
            log.warning("sensor edge %s before loop bound — dropped", kind)
            return
        self.loop.call_soon_threadsafe(self.events.put_nowait, kind)


# --- Claw outputs -----------------------------------------------------------

class ClawOutputs:
    """Move-bitmask → GPIO writes plus the COIN+UP pulse that physically
    starts a turn (sequence preserved from legacy main.py)."""

    def __init__(self, h: int):
        self.h = h
        for pin in OUTPUT_PINS.values():
            lgpio.gpio_claim_output(h, pin, 0)

    def apply_move_bitmask(self, mask: int) -> None:
        for bit, pin in OUTPUT_PINS.items():
            lgpio.gpio_write(self.h, pin, 1 if mask & bit else 0)

    async def start_turn_pulse(self) -> None:
        lgpio.gpio_write(self.h, COIN, 1)
        await asyncio.sleep(0.1)
        lgpio.gpio_write(self.h, COIN, 0)
        await asyncio.sleep(0.1)
        lgpio.gpio_write(self.h, W, 1)
        await asyncio.sleep(0.1)
        lgpio.gpio_write(self.h, W, 0)
