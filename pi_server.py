import cv2
from flask import Flask, Response, send_file
from flask_socketio import SocketIO
# import RPi.GPIO as GPIO

# GPIO Setup (uncomment when deploying on hardware)
# PINS = { ... }  # Same mapping as before

app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins="*")

# Setup webcam
camera = cv2.VideoCapture(1)

def generate_frames():
    while True:
        success, frame = camera.read()
        if not success:
            break
        else:
            ret, buffer = cv2.imencode('.jpg', frame)
            frame_bytes = buffer.tobytes()
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')

@app.route('/video_feed')
def video_feed():
    return send_file("placeholder.jpg", mimetype="image/jpeg")
    return Response(generate_frames(),
                    mimetype='multipart/x-mixed-replace; boundary=frame')

@socketio.on('move')
def handle_movement(data):
    value = data.get("bitmask", 0)
    # Handle GPIO output based on value
    # for bit, pin in PINS.items():
    #     if value & bit:
    #         GPIO.output(pin, GPIO.HIGH)
    #     else:
    #         GPIO.output(pin, GPIO.LOW)
    print("Received move command on Pi server:", value)

if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=5001, debug=True)
