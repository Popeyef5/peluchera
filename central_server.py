import time
import threading
from flask import Flask, render_template, Response, request
from flask_socketio import SocketIO, emit
import requests
import socketio  # Python Socket.IO client

# For signature verification
from eth_account.messages import encode_defunct
from eth_account import Account

# Connect to the Pi server via Socket.IO client
pi_socket = socketio.Client()
PI_SERVER_URL = 'http://localhost:5001'  # Update with your Pi server's address

@pi_socket.event
def connect():
    print("Connected to Pi server")

@pi_socket.event
def disconnect():
    print("Disconnected from Pi server")

pi_socket.connect(PI_SERVER_URL)

app = Flask(__name__)
socketio_server = SocketIO(app, cors_allowed_origins="*")

# Simple queue management
queue = []
active_sid = None

@app.route('/')
def index():
    return render_template('index.html')

# Global variables for video feed caching
latest_frame = None
frame_lock = threading.Lock()

def video_feed_background():
    global latest_frame
    pi_feed_url = f'{PI_SERVER_URL}/video_feed'
    try:
        with requests.get(pi_feed_url, stream=True) as r:
            r.raise_for_status()
            bytes_buffer = b""
            for chunk in r.iter_content(chunk_size=1024):
                bytes_buffer += chunk
                a = bytes_buffer.find(b'\xff\xd8')  # JPEG start
                b = bytes_buffer.find(b'\xff\xd9')  # JPEG end
                if a != -1 and b != -1 and b > a:
                    jpg = bytes_buffer[a:b+2]
                    with frame_lock:
                        latest_frame = jpg
                    bytes_buffer = bytes_buffer[b+2:]
    except Exception as e:
        print("Error in video_feed_background:", e)

threading.Thread(target=video_feed_background, daemon=True).start()

def generate_frames():
    while True:
        with frame_lock:
            frame = latest_frame
        if frame is not None:
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + frame + b'\r\n')
        time.sleep(0.1)

@app.route('/video_feed')
def video_feed():
    return Response(generate_frames(),
                    mimetype='multipart/x-mixed-replace; boundary=frame')

@socketio_server.on('join_queue')
def handle_join_queue(data):
    # Expect wallet address and signature from client
    wallet = data.get("wallet")
    signature = data.get("signature")
    message = "Join queue fee payment: 0.001 ETH"
    try:
        encoded_message = encode_defunct(text=message)
        recovered_address = Account.recover_message(encoded_message, signature=signature)
        if recovered_address.lower() != wallet.lower():
            emit('auth_error', {'error': 'Signature verification failed'})
            return
    except Exception as e:
        emit('auth_error', {'error': 'Error during signature verification: ' + str(e)})
        return
    # Payment accepted, add to queue.
    global active_sid
    sid = request.sid
    if sid not in queue:
        queue.append(sid)
    emit('queue_update', {'count': len(queue)}, broadcast=True)
    if active_sid is None and queue:
        start_turn()

def start_turn():
    global active_sid
    if queue:
        active_sid = queue.pop(0)
        socketio_server.emit('your_turn', room=active_sid)
        socketio_server.emit('queue_update', {'count': len(queue)}, broadcast=True)
        threading.Thread(target=turn_timer, args=(active_sid,), daemon=True).start()

def turn_timer(sid):
    time.sleep(60)
    if sid == active_sid:
        socketio_server.emit('end_turn', room=sid)
        end_turn()

def end_turn():
    global active_sid
    active_sid = None
    if queue:
        start_turn()

@socketio_server.on('move')
def handle_move(data):
    if request.sid == active_sid:
        pi_socket.emit('move', data)
        print("Forwarded move command to Pi server:", data)
    else:
        print("Ignored move command from non-active user.")

if __name__ == '__main__':
    socketio_server.run(app, host='0.0.0.0', port=5000, debug=True)
