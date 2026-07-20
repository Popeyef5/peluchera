"""Is the machine fit to take another turn?

Two independent reasons it might not be:

  - the chute is jammed (state.cabinet_fault, set from the ESP verdict), or
  - a ball in the machine has a prize we couldn't actually hand over
    (state.inventory_fault).

Both pause the queue the same way and stay paused until an operator resolves
them. Treating the inventory problem as just another "machine not fit" fault —
rather than as a special case — is what lets it reuse the gate, the pause and the
admin-clears-it flow we already have for the chute.

The inventory check looks at STATE, not at transitions: it asks "is every loaded
ball winnable right now", so it catches every way the machine could have got into
that condition, including ones nobody has guarded (a direct DB edit, a bulk
import, an endpoint written next year).
"""
from typing import Optional

from . import state
from . import win_transitions as wt
from .deps import async_session
from .logging import log
from .notifier import alertBot
from .socket.sio_instance import sio


async def refresh_inventory_fault() -> Optional[dict]:
    """Recompute the inventory fault. Returns it, or None if the machine is fit.

    Emits (and alerts) only on a change, so a paused machine doesn't spam.
    """
    async with async_session() as db:
        bad = await wt.unclaimable_loaded_balls(db)

    if not bad:
        if state.inventory_fault:
            log.info("Inventory fault cleared — every loaded ball is claimable again")
            state.inventory_fault = None
            await sio.emit("cabinet_fault", None)
        return None

    fault = {
        "kind": "unclaimable_prizes",
        "reason": f"{len(bad)} loaded ball(s) cannot be claimed",
        "balls": bad,
    }
    if state.inventory_fault != fault:
        state.inventory_fault = fault
        detail = ", ".join(f"{b['serial']} ({b['reason']})" for b in bad)
        log.error("Machine NOT fit to play — %s: %s", fault["reason"], detail)
        await sio.emit("cabinet_fault", fault)
        try:
            await alertBot.send_plain(
                "Garra: queue PAUSED — a loaded ball has no claimable prize.\n\n"
                f"{detail}\n\nVoid or rebind these balls to resume."
            )
        except Exception:
            log.exception("could not send the inventory-fault alert")
    return fault


async def blocked() -> Optional[dict]:
    """Why the machine must not start another turn — None if it's fit.

    Call this immediately before starting a turn. A player must never be able to
    pay for a play the machine cannot honour.
    """
    if state.version_fault:
        return state.version_fault
    if state.cabinet_fault:
        return state.cabinet_fault
    return await refresh_inventory_fault()
