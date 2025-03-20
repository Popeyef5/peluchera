import cv2
import eventlet
from flask import Flask, render_template, Response, send_file, make_response
from flask_socketio import SocketIO
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

# Flask setup
app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins="*")

# USB Webcam setup
camera = cv2.VideoCapture(1)

def generate_frames():
    """ Continuously capture frames from the webcam. """
    while True:
        success, frame = camera.read()
        if not success:
            break
        else:
            _, buffer = cv2.imencode('.jpg', frame)
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + buffer.tobytes() + b'\r\n')

@app.route('/')
def index():
    """ Serve the web interface. """
    return render_template('index.html')

@app.route('/video_feed')
def video_feed():
    """ Stream the webcam feed. """
    return send_file("placeholder.jpg", mimetype="image/jpeg")
    print(frame)
    if frame:
      print("frame here", frame)
      return make_response(frame)
    else:
      return send_file("placeholder.jpg", mimetype="image/jpeg")


@socketio.on('move')
def handle_movement(data):
    """ Handle movement commands from the client. """
    value = data.get("bitmask", 0)  # Get encoded movement value

    # Resolve movement directions by summing active values
    horizontal = 0
    vertical = 0
    actions = []

    for bit, pin in PINS.items():
        if value & bit:  # Check if the direction is active
            print("bit:", bit, "value:", value)
            # if bit in (-2, 2):  # Horizontal movement
            #     horizontal += bit
            # elif bit in (-4, 4):  # Vertical movement
            #     vertical += bit
            # else:  # Actions (grab, credit)
            GPIO.output(pin, GPIO.HIGH)
        else:
            GPIO.output(pin, GPIO.LOW)


if __name__ == '__main__':
    # import time

    # print("COIN")
    # GPIO.output(COIN, GPIO.HIGH)
    # time.sleep(0.5)
    # GPIO.output(COIN, GPIO.LOW)
    # time.sleep(1)

    # print("MOVE")
    # GPIO.output(D, GPIO.HIGH)
    # time.sleep(3)
    # GPIO.output(D, GPIO.LOW)
    # GPIO.output(W, GPIO.HIGH)
    # time.sleep(2)
    # GPIO.output(W, GPIO.LOW)
    # GPIO.output(A, GPIO.HIGH)
    # time.sleep(1)
    # GPIO.output(A, GPIO.LOW)
    # GPIO.output(S, GPIO.HIGH)
    # time.sleep(1)
    # GPIO.output(S, GPIO.LOW)
    # time.sleep(1)

    # print("GRAB")
    # GPIO.output(GRAB, GPIO.HIGH)
    # time.sleep(0.5)
    # GPIO.output(GRAB, GPIO.LOW)

    socketio.run(app, host='0.0.0.0', port=5001, debug=True)
