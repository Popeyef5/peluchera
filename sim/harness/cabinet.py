"""Drive the physical cabinet — via the mock Pi's scenario API.

This is the hardware boundary. Everything downstream of it (backend, DB) is the
real production code path; we only choose what the machine *does*.
"""
import httpx

from .config import CABINET_URL


class Cabinet:
    def __init__(self, base_url: str = CABINET_URL):
        self._c = httpx.AsyncClient(base_url=base_url, timeout=10.0)

    async def aclose(self) -> None:
        await self._c.aclose()

    async def _post(self, path: str) -> dict:
        r = await self._c.post(path)
        r.raise_for_status()
        return r.json()

    # --- outcome selection ---------------------------------------------
    async def always_win(self) -> dict:
        return await self._post("/scenarios/always-win")

    async def always_lose(self) -> dict:
        return await self._post("/scenarios/always-lose")

    async def rfid_fail(self) -> dict:
        """Ball enters the chute but the RFID never reads -> latched fault."""
        return await self._post("/scenarios/rfid-fail")

    async def exit_stuck(self) -> dict:
        """RFID reads but the ball never clears the chute -> latched fault."""
        return await self._post("/scenarios/exit-stuck")

    async def random(self, *, win_rate: float = 0.5,
                     rfid_fail_rate: float = 0.0,
                     exit_stuck_rate: float = 0.0) -> dict:
        r = await self._c.post("/scenarios/odds", json={
            "win_rate": win_rate,
            "rfid_fail_rate": rfid_fail_rate,
            "exit_stuck_rate": exit_stuck_rate,
        })
        r.raise_for_status()
        return r.json()

    # --- which ball falls ----------------------------------------------
    async def next_ball(self, serial: str) -> dict:
        """Force the serial reported on the next win. Pair with always_win() to
        get a deterministic prize (the serial must be a seeded Ball, else the
        backend raises BallNotAvailable and mints no prize)."""
        return await self._post(f"/scenarios/next-tag/{serial}")

    async def win_with(self, serial: str) -> None:
        """Convenience: the next turn wins, dropping exactly `serial`."""
        await self.always_win()
        await self.next_ball(serial)

    async def chute_delay(self, seconds: float) -> dict:
        """Make the chute slow to report (a sticky ball, an RFID retry).

        This is the condition the old code got wrong: the verdict lands after
        the next turn has already begun.
        """
        return await self._post(f"/scenarios/chute-delay/{seconds}")

    # --- fault handling -------------------------------------------------
    async def clear_fault(self) -> dict:
        """Clear a latched fault. Essential between tests: once the chute latches
        (rfid_failed / exit_timeout) every later arm returns 'still_blocked', so
        one stray fault would poison every subsequent win."""
        return await self._post("/scenarios/fault-clear")

    async def report_version(self, pi_proto: int) -> dict:
        """Make the Pi report a given Pi<->VPS protocol version to the VPS."""
        return await self._post(f"/scenarios/report-version/{pi_proto}")

    async def state(self) -> dict:
        r = await self._c.get("/scenarios/state")
        r.raise_for_status()
        return r.json()
