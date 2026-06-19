#!/usr/bin/env python3
"""Interactive GPIO bring-up test for the claw hat.

The `socket` container owns these pins, so stop it first, then run this in a
one-off container of the same image (so lgpio + the pin map + the gpiochip
device are all present), then bring socket back:

    cd ~/peluchera/raspberry
    docker compose stop socket
    docker compose run --rm socket python gpio_test.py
    docker compose start socket

It imports hardware.py, so it always matches what the app drives (incl. any
CLAW_OPTO_EDGE/PULL overrides from the environment).

WARNING: this physically actuates the claw — motors, COIN, GRAB. Make sure
that's safe (nothing/no one in the way) before driving outputs.
"""
import time

import lgpio

import hardware as hw

# (label, pin) in a sensible test order. Bit→pin mapping lives in hardware.py;
# here we just exercise each named output.
OUTPUTS = [
    ("W  (Up)",    hw.W),
    ("A  (Left)",  hw.A),
    ("S  (Down)",  hw.S),
    ("D  (Right)", hw.D),
    ("GRAB",       hw.GRAB),
    ("COIN",       hw.COIN),
]


def pulse(h, name, pin, secs):
    print(f"  {name} (GPIO {pin}) -> HIGH for {secs:.1f}s ...", flush=True)
    lgpio.gpio_write(h, pin, 1)
    try:
        time.sleep(secs)
    finally:
        lgpio.gpio_write(h, pin, 0)
    print("  ...back LOW")


def watch_opto(h, secs=20):
    print(f"\nWatching CLAW_OPTO (GPIO {hw.CLAW_OPTO}, pull={hw.CLAW_OPTO_PULL_NAME}, "
          f"app edge={hw.CLAW_OPTO_EDGE_NAME}) for {secs}s.")
    print("Trigger the claw home / run a cycle and watch the level flip. Ctrl-C to stop.\n")
    last = lgpio.gpio_read(h, hw.CLAW_OPTO)
    print(f"  start level = {last} ({'HIGH' if last else 'LOW'})")
    t0 = time.time()
    edges = 0
    try:
        while time.time() - t0 < secs:
            lvl = lgpio.gpio_read(h, hw.CLAW_OPTO)
            if lvl != last:
                edge = "RISING " if lvl > last else "FALLING"
                edges += 1
                print(f"  {edge}  {last} -> {lvl}   (this edge {'WOULD' if (edge.strip().lower()==hw.CLAW_OPTO_EDGE_NAME) else 'would NOT'} arm the ESP)", flush=True)
                last = lvl
            time.sleep(0.02)
    except KeyboardInterrupt:
        pass
    print(f"  done — {edges} edge(s) seen.")


def main():
    h = hw.open_gpiochip()
    for _, pin in OUTPUTS:
        lgpio.gpio_claim_output(h, pin, 0)
    lgpio.gpio_claim_input(h, hw.CLAW_OPTO, hw.CLAW_OPTO_PULL)
    print("Claimed pins.")
    print("  outputs:", ", ".join(f"{n.strip()}=GPIO{p}" for n, p in OUTPUTS))
    print(f"  input:   CLAW_OPTO=GPIO{hw.CLAW_OPTO}")
    try:
        while True:
            print("\n--- claw GPIO test ---")
            for i, (n, p) in enumerate(OUTPUTS, 1):
                print(f"  {i}) pulse {n}  (GPIO {p})")
            print("  o) watch opto input")
            print("  s) sweep all outputs (0.5s each)")
            print("  q) quit")
            try:
                choice = input("> ").strip().lower()
            except EOFError:
                break
            if choice == "q":
                break
            elif choice == "o":
                watch_opto(h)
            elif choice == "s":
                for n, p in OUTPUTS:
                    pulse(h, n, p, 0.5)
                    time.sleep(0.3)
            elif choice.isdigit() and 1 <= int(choice) <= len(OUTPUTS):
                n, p = OUTPUTS[int(choice) - 1]
                pulse(h, n, p, 0.6)
            else:
                print("  ? unknown option")
    finally:
        for _, pin in OUTPUTS:
            try:
                lgpio.gpio_write(h, pin, 0)
            except Exception:
                pass
        lgpio.gpiochip_close(h)
        print("Released pins.")


if __name__ == "__main__":
    main()
