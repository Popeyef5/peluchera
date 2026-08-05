"""Dev-only socket events backing the /test-win ball picker.

Gated behind config.DEV_TOOLS (false in production — there is no /test-win in
prod). These do NOT shortcut the win path: `dev_win_ball` forces the *mock
chute* to drop a chosen ball (the hardware boundary) via its scenario HTTP
controls, then enqueues through the production `confirm_payment` seam. The real
scheduler starts the turn, the mock reports the forced ball, and the normal
win path fires `player_win` — exactly as a real grab would.
"""
import secrets

import httpx
from sqlalchemy import select

from .sio_instance import sio
from ..config import DEV_TOOLS, PI_SERVER_URL
from ..deps import async_session
from ..logging import log
from ..models import Ball, BallStatus, PrizeKind, PaymentMethod
from ..payments import already_in_queue, current_round, initiate_payment, confirm_payment
from ..state import sid_to_addr
from .. import machine


def _ball_sku(b: Ball):
    """The catalog SKU behind a loaded ball's prize (relationships are
    lazy='selectin')."""
    if b.prize_kind == PrizeKind.OPENED_BOOSTER:
        return b.opened_booster.sku if b.opened_booster else None
    if b.prize_kind == PrizeKind.CLOSED_BOOSTER:
        return b.closed_booster.sku if b.closed_booster else None
    if b.prize_card and b.prize_card.card_type:
        return b.prize_card.card_type.sku
    return None


async def _force_mock_next_ball(serial: str) -> bool:
    """Drive the mock chute's scenario controls: force the given ball serial as
    the next tag read, and pin the win rate to 1 so the next arm is a win."""
    base = (PI_SERVER_URL or "").rstrip("/")
    if not base:
        return False
    try:
        async with httpx.AsyncClient(timeout=4.0) as c:
            r1 = await c.post(f"{base}/scenarios/next-tag/{serial}")
            r2 = await c.post(f"{base}/scenarios/always-win")
        return r1.is_success and r2.is_success
    except Exception as e:
        log.warning("dev: could not reach mock scenario controls: %s", e)
        return False


@sio.on("dev_loaded_balls")
async def dev_loaded_balls(sid, data=None):
    """List loaded balls for the picker: serial, prize kind, and prize SKU."""
    if not DEV_TOOLS:
        return {"status": "error", "error": "dev tools disabled"}
    async with async_session() as db:
        balls = (await db.execute(
            select(Ball).where(Ball.status == BallStatus.LOADED).order_by(Ball.serial)
        )).scalars().all()
        return {
            "status": "ok",
            "balls": [
                {
                    "serial": b.serial,
                    "prize_kind": b.prize_kind.value,
                    "sku": _ball_sku(b),
                }
                for b in balls
            ],
        }


@sio.on("dev_win_ball")
async def dev_win_ball(sid, data):
    """Force a real turn that wins the chosen ball.

    Forces the mock chute to drop `serial`, then enqueues the caller through the
    production pay seam. The scheduler starts the turn, the mock reports the
    ball, and the normal win path animates it back to this session.
    """
    if not DEV_TOOLS:
        return {"status": "error", "error": "dev tools disabled"}
    serial = (data or {}).get("serial")
    if not serial:
        return {"status": "error", "error": "missing serial"}

    # A dev tool may be hit before any wallet_connected — mint a throwaway
    # identity and room it so player_win reaches this session.
    addr = sid_to_addr.get(sid)
    if not addr:
        addr = "0x" + secrets.token_hex(20)
        sid_to_addr[sid] = addr
        await sio.enter_room(sid, addr)

    fault = await machine.blocked()
    if fault:
        return {"status": "error", "error": f"machine unavailable: {fault.get('reason')}"}

    if not await _force_mock_next_ball(serial):
        return {"status": "error", "error": "mock chute unreachable (is mock-pi running?)"}

    async with async_session() as db:
        round_ = await current_round(db)
        if await already_in_queue(db, addr, round_.id):
            return {"status": "error", "error": "already in queue"}
        payment = await initiate_payment(db, addr, PaymentMethod.COMP, 0)
        position = await confirm_payment(db, payment, secrets.token_bytes(32))

    log.info("dev_win_ball: forced %s, enqueued %s (position %s)", serial, addr, position)
    return {"status": "ok", "position": position}
