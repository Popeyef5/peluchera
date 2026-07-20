"""Protocol-compatibility checks across the three moving parts.

What actually breaks between ESP32, Pi and VPS is the WIRE CONTRACT, not the
software version — two pieces at different feature-versions are fine as long as
they speak the same protocol. So we version the contracts, one integer each,
bumped only on an incompatible change:

    ESP_PI_PROTO   ESP32  <-> Pi  (UART JSON: arm / verdict / ready)
    PI_VPS_PROTO   Pi     <-> VPS (websocket: turn_end / verdict / move)

Each is checked at its own handshake and must be EQUAL — no range negotiation
(that's machinery for running many cabinets at scattered versions; we don't).
This module owns the VPS end: it validates what the Pi reports on connect, and a
mismatch rides the same "machine not fit to play" gate as a jammed chute — the
queue pauses (see machine.blocked) and the operator is told on Telegram, once
immediately and then periodically until it's fixed (a reflash / redeploy).

To bump: change the constant here AND in raspberry/server/protocol_version.py
(and the ESP firmware for ESP_PI_PROTO). The repo test keeps the two ends of
each interface honest at commit time; this handshake catches deploy-time drift
(VPS pulled + restarted, ESP not reflashed).
"""
import asyncio
from typing import Optional

from . import state
from .logging import log
from .notifier import alertBot

# Bump on any incompatible Pi<->VPS websocket change. Must equal the value in
# raspberry/server/protocol_version.py.
PI_VPS_PROTO = 1

# Re-nag interval while a mismatch persists.
VERSION_RENAG_SECONDS = 1800  # 30 min


def evaluate(pi_proto: Optional[int], esp_version_bad: bool, versions: dict) -> Optional[dict]:
    """Turn a Pi handshake into a version fault, or None if everything agrees."""
    problems = []

    if pi_proto is None:
        problems.append(
            f"the Pi did not report a protocol version (VPS speaks {PI_VPS_PROTO}) "
            "— its build predates version checking; redeploy it"
        )
    elif pi_proto != PI_VPS_PROTO:
        problems.append(
            f"Pi<->VPS protocol mismatch: Pi speaks {pi_proto}, VPS speaks "
            f"{PI_VPS_PROTO}. Pull + ./update.sh, or roll the Pi to match."
        )

    if esp_version_bad:
        problems.append(
            "ESP firmware protocol mismatch: the chute firmware is out of date "
            f"(esp_fw={versions.get('esp_fw')}). Reflash with raspberry/flash.sh."
        )

    if not problems:
        return None
    return {"kind": "version_mismatch", "problems": problems, "versions": versions}


async def on_handshake(pi_proto: Optional[int], esp_version_bad: bool, versions: dict) -> None:
    """Called from pi_client.on_esp_status on every (re)connect."""
    await _set(evaluate(pi_proto, esp_version_bad, versions))


async def _set(fault: Optional[dict]) -> None:
    prev = state.version_fault
    state.version_fault = fault
    if fault and fault != prev:
        await _alert(fault)          # first time we see this exact mismatch
    elif prev and not fault:
        log.info("Versions back in sync")
        try:
            await alertBot.send_plain("Garra: versions back in sync ✓ — queue resumed.")
        except Exception:
            log.exception("could not send version-resolved alert")


async def _alert(fault: dict) -> None:
    body = "Garra: QUEUE PAUSED — version mismatch.\n\n" + "\n".join(
        f"- {p}" for p in fault["problems"]
    )
    log.error("VERSION MISMATCH — queue paused: %s", fault["problems"])
    try:
        await alertBot.send_plain(body)
    except Exception:
        log.exception("could not send version-mismatch alert")


async def version_watch() -> None:
    """Re-nag on Telegram while a mismatch persists — a paused queue you forgot
    about is worse than a repeated ping."""
    while True:
        await asyncio.sleep(VERSION_RENAG_SECONDS)
        if state.version_fault:
            await _alert(state.version_fault)
