from .sio_instance import sio
from ..logging import log
from ..state import sid_to_addr, global_sync

@sio.event
async def connect(sid, environ):
    log.info("Sending global sync on connect")
    await sio.emit("global_sync", data=await global_sync(), to=sid)


@sio.event
async def disconnect(sid):
    old_address = sid_to_addr.get(sid)
    if old_address:
        await sio.leave_room(sid, old_address)
    sid_to_addr[sid] = None
