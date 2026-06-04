"""Standalone serial REPL for the chute ESP32.

Talks the same newline-JSON protocol the Pi uses (esp_link.py), so you can
exercise the firmware from a laptop without running the rest of the stack.

Setup:
    pip install pyserial
    python esp/tools/repl.py                    # defaults to /dev/ttyUSB0
    python esp/tools/repl.py /dev/ttyACM0
    python esp/tools/repl.py COM5               # Windows

Shortcuts (just type the letter + Enter):
    a / arm           → {"type":"arm"}
    c / clear         → {"type":"fault_clear"}
    p / ping          → {"type":"ping","seq":<n>}
    q / quit          → exit

Any other input is forwarded as-is. If it parses as JSON it's sent verbatim;
otherwise it's wrapped as {"type":"<input>"}.

Incoming frames are pretty-printed with timestamps. Useful test sequence
for bringing up one reader:
    a   →  expect "no_fall" 3s later  (no entry BB wired)
    short ENTRY_BB to GND while AWAITING_FALL  →  expect prize_won or
        fault rfid_failed depending on whether a tag was near the antenna
"""

import json
import sys
import threading
import time

import serial

DEFAULT_PORT = "/dev/ttyUSB0"
BAUD = 115200


def rx_loop(ser: serial.Serial) -> None:
    while True:
        try:
            line = ser.readline().decode("utf-8", errors="replace").strip()
        except serial.SerialException:
            print("\n[link dropped]")
            return
        if not line:
            continue
        ts = time.strftime("%H:%M:%S")
        try:
            payload = json.loads(line)
            print(f"\n[{ts}] ← {json.dumps(payload)}\n> ", end="", flush=True)
        except json.JSONDecodeError:
            print(f"\n[{ts}] ← (raw) {line!r}\n> ", end="", flush=True)


def send(ser: serial.Serial, frame: dict) -> None:
    line = json.dumps(frame) + "\n"
    ser.write(line.encode("utf-8"))
    print(f"        → {json.dumps(frame)}")


def main(port: str) -> int:
    print(f"Opening {port} @ {BAUD} 8N1 …")
    ser = serial.Serial(port, BAUD, timeout=0.2)
    # On most ESP32 dev boards, the USB-serial bridge's DTR/RTS lines drive
    # EN (reset) and IO0 (boot) through two transistors. pyserial's default
    # opens with both lines asserted, which can hold the chip stuck in
    # download mode. Drive a clean reset pulse the way esptool does it:
    # RTS deasserted (no boot), DTR pulsed (reset asserted then released).
    ser.setRTS(False)
    ser.setDTR(True);  time.sleep(0.1)
    ser.setDTR(False); time.sleep(0.1)

    threading.Thread(target=rx_loop, args=(ser,), daemon=True).start()

    seq = 0
    print(
        "REPL ready. Shortcuts: a=arm, c=fault_clear, p=ping, q=quit. "
        "Or paste any JSON.\n"
    )
    try:
        while True:
            try:
                line = input("> ").strip()
            except EOFError:
                break
            if not line:
                continue
            low = line.lower()
            if low in ("q", "quit", "exit"):
                break
            if low in ("a", "arm"):
                send(ser, {"type": "arm"})
                continue
            if low in ("c", "clear", "fault_clear"):
                send(ser, {"type": "fault_clear"})
                continue
            if low in ("p", "ping"):
                seq += 1
                send(ser, {"type": "ping", "seq": seq})
                continue
            try:
                send(ser, json.loads(line))
            except json.JSONDecodeError:
                send(ser, {"type": line})
    finally:
        ser.close()
    return 0


if __name__ == "__main__":
    port = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_PORT
    sys.exit(main(port))
