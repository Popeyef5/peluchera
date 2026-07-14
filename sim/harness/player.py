"""A virtual player: a Socket.IO client speaking exactly the event vocabulary
the real frontend uses (see central/next/components/providers/ClawProvider.tsx).

Nothing here is a test hook — every emit below is an event the production
backend already listens for, and every listener is one the real UI binds.
"""
import asyncio
import secrets
from typing import Any, Dict, List, Optional

import socketio

from .config import BACKEND_URL, TURN_TIMEOUT

# Movement bit-mask, mirroring KEYMAP in ClawProvider.tsx
LEFT, RIGHT, UP, DOWN, GRAB = 0b0001, 0b0010, 0b0100, 0b1000, 0b0001_0000


def guest_address() -> str:
    """A synthetic wallet address, same shape the frontend mints in bypass mode."""
    return "0x" + secrets.token_hex(20)


class VirtualPlayer:
    def __init__(self, address: Optional[str] = None, name: str = "player"):
        self.address = address or guest_address()
        self.name = name
        self.sio = socketio.AsyncClient(logger=False, engineio_logger=False)
        self.events: List[Dict[str, Any]] = []
        self._arrived = asyncio.Event()
        self.position: int = -1
        self.balance: float = 0.0
        self.pending_win: Optional[dict] = None
        self.free_play: bool = False

        for name_ in (
            "player_queued", "turn_start", "turn_end", "player_win",
            "turn_result", "personal_sync", "global_sync", "balance",
            "payment_confirmed", "payment_failed", "claw_connection_change",
            "cabinet_fault",
        ):
            self.sio.on(name_, self._recorder(name_))

    # --- plumbing -------------------------------------------------------
    def _recorder(self, event: str):
        async def handler(data=None):
            self.events.append({"event": event, "data": data})
            if event == "player_win":
                self.pending_win = data
            elif event in ("personal_sync", "payment_confirmed") and isinstance(data, dict):
                self.position = data.get("position", self.position)
            self._arrived.set()
        return handler

    def mark(self) -> int:
        """Index into the event log. Pass to wait_for(since=...) to ignore
        anything that arrived earlier."""
        return len(self.events)

    async def wait_for(self, event: str, timeout: float = TURN_TIMEOUT,
                       since: Optional[int] = None) -> Any:
        """Block until `event` arrives *after* `since` (default: now).

        The `since` cursor matters: the backend emits `turn_end` both when a turn
        genuinely ends AND as a pre-turn broadcast before the next `turn_start`.
        Matching against the whole history would happily return a stale one and
        we'd read the DB before the turn had actually been recorded.
        """
        start = self.mark() if since is None else since
        deadline = asyncio.get_running_loop().time() + timeout
        while True:
            for e in self.events[start:]:
                if e["event"] == event:
                    return e["data"]
            remaining = deadline - asyncio.get_running_loop().time()
            if remaining <= 0:
                raise TimeoutError(
                    f"{self.name}: '{event}' never arrived in {timeout}s. "
                    f"Saw since mark: {[e['event'] for e in self.events[start:]]}"
                )
            self._arrived.clear()
            try:
                await asyncio.wait_for(self._arrived.wait(), remaining)
            except asyncio.TimeoutError:
                pass  # loop re-checks and raises with a useful message

    def saw(self, event: str) -> bool:
        return any(e["event"] == event for e in self.events)

    # --- session --------------------------------------------------------
    async def connect(self) -> dict:
        await self.sio.connect(BACKEND_URL, transports=["websocket"])
        res = await self.sio.call("wallet_connected", {"address": self.address}, timeout=10)
        if res.get("status") == "ok":
            data = res["data"]
            self.free_play = bool(data.get("free_play"))
            self.position = data["position"]
            self.balance = data["balance"]
        return res

    async def disconnect(self) -> None:
        if self.sio.connected:
            await self.sio.disconnect()

    # --- paying ---------------------------------------------------------
    async def pay_crypto(self, tx_hash: Optional[str] = None) -> dict:
        """Crypto rail. In BYPASS_PAYMENT the backend skips the receipt check,
        so tx_hash is unused; pass one to exercise the replay guard."""
        payload: Dict[str, Any] = {"address": self.address}
        if tx_hash:
            payload["tx_hash"] = tx_hash
        res = await self.sio.call("pay_crypto", payload, timeout=30)
        if res.get("status") == "ok":
            self.position = res["position"]
        return res

    async def pay_free(self) -> dict:
        """Comped play (FREE_PLAY): straight to the queue, nobody is charged."""
        res = await self.sio.call("pay_free", {}, timeout=30)
        if res.get("status") == "ok":
            self.position = res["position"]
        return res

    async def card_setup(self) -> dict:
        return await self.sio.call("card_setup", {}, timeout=30)

    async def pay_card(self) -> dict:
        res = await self.sio.call("pay_card", {}, timeout=60)
        if res.get("status") == "ok":
            self.position = res["position"]
        return res

    # --- playing --------------------------------------------------------
    async def move(self, mask: int) -> None:
        await self.sio.emit("move", {"bitmask": mask})

    async def play_a_turn(self, timeout: float = TURN_TIMEOUT) -> None:
        """Wait for our turn, jiggle the claw, grab, and wait for the real outcome.

        The turn_end we care about is the one AFTER our turn_start (the scheduler
        also fires a turn_end just *before* each turn), hence the cursor.
        """
        await self.wait_for("turn_start", timeout)
        after_start = self.mark()
        for mask in (RIGHT, UP, 0):
            await self.move(mask)
            await asyncio.sleep(0.2)
        await self.move(GRAB)
        await asyncio.sleep(0.2)
        await self.move(0)
        await self.wait_for("turn_end", timeout, since=after_start)

    # --- inventory / settlement ----------------------------------------
    async def inventory(self) -> dict:
        return await self.sio.call("get_inventory", {}, timeout=20)

    async def open_booster(self, win_id: str) -> dict:
        return await self.sio.call("open_booster_win", {"win_id": win_id}, timeout=20)

    async def resell_booster(self, win_id: str) -> dict:
        return await self.sio.call("resell_booster_win", {"win_id": win_id}, timeout=20)

    async def keep_card(self, win_id: str) -> dict:
        return await self.sio.call("keep_card_win", {"win_id": win_id}, timeout=20)

    async def resell_card(self, win_id: str) -> dict:
        return await self.sio.call("resell_card_win", {"win_id": win_id}, timeout=20)

    async def resell_from_collection(self, card_id: str) -> dict:
        return await self.sio.call(
            "resell_card_from_collection", {"card_id": card_id}, timeout=20
        )

    # --- money ----------------------------------------------------------
    async def check_balance(self) -> dict:
        # NOTE: the backend event name really is misspelled "ckeck_balance".
        res = await self.sio.call("ckeck_balance", {}, timeout=20)
        if res.get("status") == "ok":
            self.balance = res["balance"]
        return res

    async def withdraw(self) -> dict:
        return await self.sio.call("withdraw", {}, timeout=60)
