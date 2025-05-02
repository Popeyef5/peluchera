import socketio
from fastapi import FastAPI

sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins="*")

def sio_app(fastapi_app: FastAPI):
    return socketio.ASGIApp(sio, other_asgi_app=fastapi_app)
