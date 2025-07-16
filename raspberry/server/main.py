import asyncio
import socketio
import logging
# import RPi.GPIO as GPIO
import pigpio
import time

# GPIO Setup
pi = pigpio.pi()
# GPIO.setmode(GPIO.BCM)

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

# Define GPIO pins with signed values for cancellation logic
OUTPUT_PINS = {
    1 << 0: A,  # Left
    1 << 1: D,   # Right
    1 << 2: W,   # Updata
    1 << 3: S,  # Down
    1 << 4: GRAB,  # Grab
    1 << 5: COIN   # Credit
}


for pin in OUTPUT_PINS.values():
    pi.set_mode(pin, pigpio.OUTPUT)
    pi.write(pin, 0)
    # GPIO.setup(pin, GPIO.OUT)
    # GPIO.output(pin, GPIO.LOW)
    
for pin in (BB, CLAW):
    pi.set_mode(pin, pigpio.INPUT)
    pi.set_pull_up_down(pin, pigpio.PUD_UP)
    
GLITCH = 100
pi.set_glitch_filter(BB, GLITCH)         # kill sub-GLITCH blips
pi.set_glitch_filter(CLAW, 10*GLITCH)

# App setup
sio  = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins="*")
app = socketio.ASGIApp(sio)

@sio.on('move')
def handle_movement(sid, data):
    """ Handle movement commands from the client. """
    mask = data.get("bitmask", 0)  # Get encoded movement value
    for bit, pin in OUTPUT_PINS.items():
        pi.write(pin, 1 if mask & bit else 0)
        # if value & bit:  # Check if the direction is active
        #     log.info(f"Pin: {pin}")
        #     GPIO.output(pin, GPIO.HIGH)
        # else:
        #     GPIO.output(pin, GPIO.LOW)


@sio.on("turn_start")
def on_turn_start(data):
    pi.wave_clear()
    pulses = [pigpio.pulse(1<<COIN, 0, 100_000),
              pigpio.pulse(0, 1<<COIN, 100_000),
              pigpio.pulse(1<<W,   0, 100_000),
              pigpio.pulse(0, 1<<W, 100_000)]
    pi.wave_add_generic(pulses)
    pi.wave_send_once(pi.wave_create())
    # GPIO.output(COIN, GPIO.HIGH)
    # time.sleep(0.1)
    # GPIO.output(COIN, GPIO.LOW)
    # time.sleep(0.1)
    # GPIO.output(W, GPIO.HIGH)
    # time.sleep(0.1)
    # GPIO.output(W, GPIO.LOW)
    
loop = asyncio.get_event_loop()   # grab the main loop once

def prize_won(gpio, level, tick):
    if level == 0:
        log.info("Prize won")
        loop.call_soon_threadsafe(
            asyncio.create_task, sio.emit("prize_won")
        )

def turn_end(gpio, level, tick):
    if level == 1:
        log.info("Turn end")
        loop.call_soon_threadsafe(
            asyncio.create_task, sio.emit("turn_end")
        )
        
pi.callback(BB, pigpio.FALLING_EDGE, prize_won)
pi.callback(CLAW, pigpio.RISING_EDGE, turn_end)

if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=5001, debug=True)