import cv2
import eventlet
from flask import Flask, render_template, Response
from flask_socketio import SocketIO
import RPi.GPIO as GPIO

# GPIO Setup
GPIO.setmode(GPIO.BCM)

# Define GPIO pins with signed values for cancellation logic
PINS = {
    -2: 17,  # Left
    2: 27,   # Right
    4: 22,   # Up
    -4: 23,  # Down
    16: 24,  # Grab
    32: 25   # Credit
}

for pin in PINS.values():
    GPIO.setup(pin, GPIO.OUT)
    GPIO.output(pin, GPIO.LOW)

# Flask setup
app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins="*")

# USB Webcam setup
camera = cv2.VideoCapture(0)

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
    return Response(generate_frames(), mimetype='multipart/x-mixed-replace; boundary=frame')

@socketio.on('move')
def handle_movement(data):
    """ Handle movement commands from the client. """
    value = data.get("value", 0)  # Get encoded movement value

    # Resolve movement directions by summing active values
    horizontal = 0
    vertical = 0
    actions = []

    for bit, pin in PINS.items():
        if value & abs(bit):  # Check if the direction is active
            if bit in (-2, 2):  # Horizontal movement
                horizontal += bit
            elif bit in (-4, 4):  # Vertical movement
                vertical += bit
            else:  # Actions (grab, credit)
                actions.append(pin)

    # Determine final movements (cancelling out opposites)
    final_pins = []
    if horizontal != 0:
        final_pins.append(PINS[horizontal])
    if vertical != 0:
        final_pins.append(PINS[vertical])
    final_pins.extend(actions)

    # Activate selected pins
    for pin in final_pins:
        GPIO.output(pin, GPIO.HIGH)

    eventlet.sleep(0.2)  # Small delay for better control

    # Turn off all pins after movement
    for pin in final_pins:
        GPIO.output(pin, GPIO.LOW)

if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=5000, debug=True)
