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
