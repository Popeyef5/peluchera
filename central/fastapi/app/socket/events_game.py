import app.state as state

from .sio_instance import sio
# from ..state import current_player, sid_to_addr
from ..pi_client import pi_client
from ..logging import log

@sio.on("move")
async def move(sid, data):
    log.info(f"Received data: {data}")
    if state.sid_to_addr.get(sid) == state.current_player:
        await pi_client.emit("move", data)
    else:
        log.info(f"Current address missmatch, current player: {state.current_player}, sid to addr: {state.sid_to_addr}, sid: {sid}")
