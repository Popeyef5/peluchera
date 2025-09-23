import asyncio
# import socketio
import json
import logging
import pigpio
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, WebSocketException

# GPIO Setup
pi = pigpio.pi()

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("rpi")

COIN = 16
GRAB = 26
W = 12
A = 5
S = 6
D = 13
BB = 17
CLAW = 27


class GameState:
    def __init__(self):
        self.processing_turn = False


game_state = GameState()

# Define GPIO pins with signed values for cancellation logic
OUTPUT_PINS = {
    1 << 0: A,  # Left
    1 << 1: D,  # Right
    1 << 2: W,  # Up
    1 << 3: S,  # Down
    1 << 4: GRAB,  # Grab
    1 << 5: COIN,  # Credit
}

for pin in OUTPUT_PINS.values():
    pi.set_mode(pin, pigpio.OUTPUT)
    pi.write(pin, 0)

for pin in (BB, CLAW):
    pi.set_mode(pin, pigpio.INPUT)
    pi.set_pull_up_down(pin, pigpio.PUD_UP)

GLITCH = 100
pi.set_glitch_filter(BB, GLITCH)  # kill sub-GLITCH blips
pi.set_glitch_filter(CLAW, 100 * GLITCH)

# App setup
# sio = socketio.AsyncServer(
#     async_mode="asgi",
#     cors_allowed_origins="*",
#     # ping_timeout=50, # 60
#     # ping_interval=60, # 30
#     transports=["websocket"],
# )
app = FastAPI()
# app = socketio.ASGIApp(sio, fast_app)

async def on_move(websocket, message):
    """Handle movement commands from the client."""
    mask = message.get("bitmask", 0)  # Get encoded movement value
    for bit, pin in OUTPUT_PINS.items():
        pi.write(pin, 1 if mask & bit else 0)


async def on_turn_start(websocket, message):
    log.info("Turn start")
    game_state.processing_turn = False
    pi.wave_clear()
    pulses = [
        pigpio.pulse(1 << COIN, 0, 100_000),
        pigpio.pulse(0, 1 << COIN, 100_000),
        pigpio.pulse(1 << W, 0, 100_000),
        pigpio.pulse(0, 1 << W, 100_000),
    ]
    pi.wave_add_generic(pulses)
    pi.wave_send_once(pi.wave_create())
    

MESSAGE_HANDLERS = {
    "move": on_move,
    "turn_start": on_turn_start
}

class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        try:
            self.active_connections.remove(websocket)
        except Exception as e:
            log.warning(f"Error removing connection: {e}")

    async def send_personal_message(self, message: str, websocket: WebSocket):
        await websocket.send_text(message)

    async def broadcast(self, message: str):
        for connection in self.active_connections:
            try:
                await connection.send_text(message)
            except Exception as e:
                log.warning(f"Error sending message to connection: {e}")

manager = ConnectionManager()
    
@app.websocket("/")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    log.info(f"WebSocket connected")
    
    try:
        while True:
            data = await websocket.receive_text()
            try:
                # Parse JSON message
                message = json.loads(data)
                message_type = message.get("type")
                message_data = message.get("data")
                
                # Check if message type is supported
                if message_type in MESSAGE_HANDLERS:
                    # Call appropriate handler
                    await MESSAGE_HANDLERS[message_type](websocket, message_data)
                else:
                    # Send error for unknown message type
                    error_response = {
                        "type": "error",
                        "message": f"Unknown message type: {message_type}",
                        "supported_types": list(MESSAGE_HANDLERS.keys())
                    }
                    await websocket.send_text(json.dumps(error_response))
                    
            except json.JSONDecodeError:
                # Handle invalid JSON
                error_response = {
                    "type": "error",
                    "message": "Invalid JSON format"
                }
                await websocket.send_text(json.dumps(error_response))
    
    except (WebSocketDisconnect, WebSocketException) as e:
        manager.disconnect(websocket)
        log.warning("WebSocket disconnected")
        log.warning(e)


loop = asyncio.get_event_loop()  # grab the main loop once

def prize_won(gpio, level, tick):
    if level == 0:
        if not game_state.processing_turn:
            return
        log.info("Prize won")
        loop.call_soon_threadsafe(asyncio.create_task, manager.broadcast(json.dumps({"type": "prize_won"})))
        game_state.processing_turn = False


def turn_end(gpio, level, tick):
    if level == 1:
        log.info("Turn end")
        game_state.processing_turn = True
        loop.call_soon_threadsafe(asyncio.create_task, manager.broadcast(json.dumps({"type": "turn_end"})))


pi.callback(BB, pigpio.FALLING_EDGE, prize_won)
pi.callback(CLAW, pigpio.RISING_EDGE, turn_end)

if __name__ == "__main__":
    import fastapi
    fastapi.run(app, host="0.0.0.0", port=5001, debug=True)
