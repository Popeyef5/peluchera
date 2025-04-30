import socketio
import RPi.GPIO as GPIO

# GPIO Setup
GPIO.setmode(GPIO.BCM)

COIN = 16
GRAB = 26
W = 12
A = 5
S = 6
D = 13

# Define GPIO pins with signed values for cancellation logic
PINS = {
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

@app.on('move')
def handle_movement(data):
    """ Handle movement commands from the client. """
    value = data.get("bitmask", 0)  # Get encoded movement value

    for bit, pin in PINS.items():
        if value & bit:  # Check if the direction is active
            GPIO.output(pin, GPIO.HIGH)
        else:
            GPIO.output(pin, GPIO.LOW)

@app.on("turn_start")
def turn_start():
    pass

if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=5001, debug=True)