import socketio, asyncio
from .config import PI_SERVER_URL
from .logging import log

pi_client = socketio.AsyncClient()

async def connect_pi():
    while True:
        try:
            await pi_client.connect(PI_SERVER_URL)
            log.info("Pi socket connected")
            break
        except Exception as e:
            log.warning("Pi connect error: %s", e)
            await asyncio.sleep(5)
            
            
@pi_client.on("turn_end")
async def turn_end(data):
    pass


@pi_client.on("win")
async def on_turn_win(data):
    pass
