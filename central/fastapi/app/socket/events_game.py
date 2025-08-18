import app.state as state

from .sio_instance import sio
# from ..state import current_player, sid_to_addr
from ..pi_client import safe_pi_emit
from ..logging import log

@sio.on("move")
async def move(sid, data):
    if state.sid_to_addr.get(sid) == state.current_player:
        if not await safe_pi_emit("move", data):
            log.warning("Pi offline: 'move' not sent")
    else:
        log.info(f"Current address missmatch, current player: {state.current_player}, sid to addr: {state.sid_to_addr}, sid: {sid}")
