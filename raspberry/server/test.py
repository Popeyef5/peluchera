"""
Manual hardware test for the Pi server.

Usage:
    python3 test.py                       # connects to ws://localhost:5000/
    python3 test.py wss://peluchera.ngrok.app/

Sequence: turn_start (coin + W pulse) → Left → Right → Up → Down → Grab → release.
Any incoming messages (turn_end, prize_won) are printed as they arrive.
"""

import asyncio
import json
import sys

import websockets

A    = 1 << 0  # Left
D    = 1 << 1  # Right
W    = 1 << 2  # Up
S    = 1 << 3  # Down
GRAB = 1 << 4
COIN = 1 << 5

HOLD_MS = 800   # how long to hold each direction
GAP_MS  = 300   # pause between steps


async def send_move(ws, bitmask, label):
    print(f"  → move {label:<8} bitmask={bitmask:06b}")
    await ws.send(json.dumps({"type": "move", "data": {"bitmask": bitmask}}))


async def reader(ws):
    try:
        async for raw in ws:
            try:
                msg = json.loads(raw)
                print(f"  ← {msg}")
            except json.JSONDecodeError:
                print(f"  ← (non-json) {raw!r}")
    except websockets.ConnectionClosed:
        pass


async def run(url):
    print(f"Connecting to {url}")
    async with websockets.connect(url) as ws:
        print("Connected.")
        rx = asyncio.create_task(reader(ws))

        print("Step 1: turn_start (pulses COIN, then W)")
        await ws.send(json.dumps({"type": "turn_start", "data": {}}))
        await asyncio.sleep(1.0)

        for label, bit in [("LEFT", A), ("RIGHT", D), ("UP", W), ("DOWN", S)]:
            print(f"Step: {label}")
            await send_move(ws, bit, label)
            await asyncio.sleep(HOLD_MS / 1000)
            await send_move(ws, 0, "release")
            await asyncio.sleep(GAP_MS / 1000)

        print("Step: GRAB")
        await send_move(ws, GRAB, "GRAB")
        await asyncio.sleep(HOLD_MS / 1000)
        await send_move(ws, 0, "release")
        await asyncio.sleep(GAP_MS / 1000)

        # let any pending sensor messages drain
        await asyncio.sleep(0.5)
        rx.cancel()
        print("Done.")


if __name__ == "__main__":
    url = sys.argv[1] if len(sys.argv) > 1 else "ws://localhost:5000/"
    asyncio.run(run(url))
