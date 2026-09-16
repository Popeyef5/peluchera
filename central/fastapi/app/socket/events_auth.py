"""Socket events for player sign-in (SIWX). See app/player_auth.py."""
import asyncio

from .sio_instance import sio
from .. import player_auth
from ..logging import log


@sio.on("auth_nonce")
async def auth_nonce(sid, data=None):
    return {"status": "ok", "nonce": player_auth.issue_nonce()}


@sio.on("auth_verify")
async def auth_verify(sid, data=None):
    data = data or {}
    try:
        address = await player_auth.verify_login(
            data.get("message") or "",
            data.get("signature") or "",
            asyncio.get_running_loop(),
        )
    except player_auth.AuthError as e:
        log.info("sign-in refused: %s", e)
        return {"status": "error", "error": str(e)}
    except Exception:
        log.exception("sign-in verification crashed")
        return {"status": "error", "error": "Sign-in could not be verified. Try again."}

    session = player_auth.mint_session(address)
    log.info("Player %s signed in", address)
    return {"status": "ok", "address": address, **session}


@sio.on("auth_check")
async def auth_check(sid, data=None):
    """Is this stored session still good for this address?

    The browser keeps the token so returning players skip the signature prompt.
    But a token can die without the browser knowing (the secret rotated, or no
    secret is configured and the server restarted). Checked before reusing one,
    so a dead session triggers a fresh sign-in instead of a player who looks
    signed in while every action is refused.
    """
    data = data or {}
    proven = player_auth.session_address(data.get("token"))
    claimed = (data.get("address") or "").lower()
    ok = proven is not None and proven == claimed
    return {"status": "ok" if ok else "error"}
