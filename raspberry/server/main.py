import socketio
import logging
import RPi.GPIO as GPIO
import time

# GPIO Setup
GPIO.setmode(GPIO.BCM)

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("rpi")

COIN = 16
GRAB = 26
W = 12
A = 5
S = 6
D = 13

# Define GPIO pins with signed values for cancellation logic
PINS = {pass
    1 << 0: A,  # Left
    1 << 1: D,   # Right
    1 << 2: W,   # Updata
    1 << 3: S,  # Down
    1 << 4: GRAB,  # Grab
    1 << 5: COIN   # Credit
}

for pin in PINS.values():
    GPIO.setup(pin, GPIO.OUT)
    GPIO.output(pin, GPIO.LOW)

# App setup
sio  = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins="*")
app = socketio.ASGIApp(sio)

@sio.on('move')
def handle_movement(sid, data):
    """ Handle movement commands from the client. """
    value = data.get("bitmask", 0)  # Get encoded movement value
    for bit, pin in PINS.items():
        if value & bit:  # Check if the direction is active
            log.info(f"Pin: {pin}")
            GPIO.output(pin, GPIO.HIGH)
        else:
            GPIO.output(pin, GPIO.LOW)

@sio.on("turn_start")
def on_turn_start(data):
    GPIO.output(COIN, GPIO.HIGH)
    time.sleep(0.1)
    GPIO.output(COIN, GPIO.LOW)
    time.sleep(0.1)
    GPIO.output(W, GPIO.HIGH)
    time.sleep(0.1)
    GPIO.output(W, GPIO.LOW)
    

if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=5001, debug=True)