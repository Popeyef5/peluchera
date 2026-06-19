"""GPIO pin map, claw outputs, and claw optocoupler sensor.

After the chute subsystem moved to the ESP32 (see esp/ and esp_link.py),
the Pi only owns the claw side: motor coils, COIN/GRAB outputs, and the
optocoupler that signals end-of-turn. Break beams, solenoid, and PN5180
readers all live on the ESP32 now.

Targets the Pi 5 (BCM numbering), via lgpio.
"""

import asyncio
import logging
import os
from dataclasses import dataclass
from typing import Optional

import lgpio

log = logging.getLogger("rpi.hw")

# --- Cabinet outputs --------------------------------------------------------
# Custom PCB hat (BCM). Outputs have 15kΩ external pulldowns so they idle low
# even on boot-HIGH pins (5, 6). d moved off BCM 0 (HAT-ID EEPROM pin) to 5.
COIN = 19
GRAB = 6
W = 22
A = 10
S = 11
D = 5

OUTPUT_PINS = {
    1 << 0: A,   # Left
    1 << 1: D,   # Right
    1 << 2: W,   # Up
    1 << 3: S,   # Down
    1 << 4: GRAB,
    1 << 5: COIN,
}

# --- Claw optocoupler -------------------------------------------------------
# Pin / edge / pull are env-overridable so a polarity change (e.g. after a PSU
# swap) can be fixed without a code change: set CLAW_OPTO_EDGE=falling (or
# `both` to confirm edges happen at all) and restart `socket`. Defaults are the
# historical rising-edge / pull-up.
CLAW_OPTO = int(os.getenv("CLAW_OPTO_PIN", "3"))   # BCM 3 (custom hat); 1.8k on-board pull-up

_EDGES = {
    "rising": lgpio.RISING_EDGE,
    "falling": lgpio.FALLING_EDGE,
    "both": lgpio.BOTH_EDGES,
}
_PULLS = {
    "up": lgpio.SET_PULL_UP,
    "down": lgpio.SET_PULL_DOWN,
    "none": lgpio.SET_PULL_NONE,
}
CLAW_OPTO_EDGE_NAME = os.getenv("CLAW_OPTO_EDGE", "rising").lower()
CLAW_OPTO_PULL_NAME = os.getenv("CLAW_OPTO_PULL", "up").lower()
CLAW_OPTO_EDGE = _EDGES.get(CLAW_OPTO_EDGE_NAME, lgpio.RISING_EDGE)
CLAW_OPTO_PULL = _PULLS.get(CLAW_OPTO_PULL_NAME, lgpio.SET_PULL_UP)

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
        # MUST be claim_alert (not claim_input): lgpio only delivers edge
        # callbacks on a pin claimed for alerts. claim_input supports gpio_read
        # (polling) only — which is exactly the trap that made the opto look
        # "dead" to the app while a multimeter and gpio_test (polling) saw it.
        lgpio.gpio_claim_alert(self.h, CLAW_OPTO, CLAW_OPTO_EDGE, CLAW_OPTO_PULL)
        lgpio.gpio_set_debounce_micros(self.h, CLAW_OPTO, GLITCH_US_CLAW)
        log.info(
            "claw opto: GPIO %d, edge=%s, pull=%s (alert)",
            CLAW_OPTO, CLAW_OPTO_EDGE_NAME, CLAW_OPTO_PULL_NAME,
        )
        self._claw_cb = lgpio.callback(
            self.h, CLAW_OPTO, CLAW_OPTO_EDGE,
            lambda *_: self._push("opto"))

    def _push(self, kind: str) -> None:
        if self.loop is None:
            log.warning("sensor edge %s before loop bound — dropped", kind)
            return
        log.info("claw opto RISING edge on GPIO %d -> %s", CLAW_OPTO, kind)
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
