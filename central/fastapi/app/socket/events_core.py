from .sio_instance import sio
from ..logging import log
from ..state import sid_to_addr, game_state

@sio.event
async def connect(sid, environ):
    await sio.emit("game_state", data={"state": game_state}, to=sid)

@sio.event
async def disconnect(sid):
    old_address = sid_to_addr.get(sid)
    if old_address:
        await sio.leave_room(sid, old_address)
    sid_to_addr[sid] = None
