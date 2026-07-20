#!/usr/bin/env bash
#
# flash.sh — update the chute ESP32 firmware from the Pi.
#
# Usage:
#   ./flash.sh --ota                 OTA over WiFi (PRIMARY). Serial link to the
#                                    cabinet stays up; only the ESP's reboot
#                                    blips it. Needs the ESP on WiFi + a working
#                                    OTA-capable firmware already on it.
#   ./flash.sh --usb                 Cable flash (FALLBACK / recovery). Stops the
#                                    `socket` container to free /dev/garra-esp,
#                                    flashes, restarts it. ~30s cabinet-down.
#   ./flash.sh --prebuilt [dir]      Cable flash bins BUILT OFF-PI (default dir:
#                                    ./prebuilt-fw). USE THIS ON THE PI: its
#                                    32-bit userland has no working xtensa
#                                    cross-compiler, so --usb/--ota (which
#                                    compile) fail. Build on an x86/arm64 box
#                                    (`pio run -e esp32dev`), scp the 4 bins over,
#                                    and this just esptool-writes them. ~30s down.
#   ./flash.sh --ota --host 10.0.0.42  Skip mDNS, target the ESP by IP.
#
# Flags:
#   --host <ip|host>   OTA target override (default: resolve garra-chute.local)
#   --env <pio-env>    PlatformIO env override (default: esp32dev_ota / esp32dev)
#   --fw <dir>         --prebuilt bins dir (default: ./prebuilt-fw). Must hold
#                      bootloader.bin partitions.bin boot_app0.bin firmware.bin
#   --yes, -y          Skip the "cabinet must be idle" confirmation
#
# Prereqs:
#   - ../esp/include/secrets.h present (WiFi + OTA creds; gitignored)
#   - GARRA_OTA_PASSWORD set (here or in .env) for --ota
#   - the chute ESP plugged into the Pi (always true on a real cabinet)
#
# SAFETY: both paths reboot the ESP. Run only when the cabinet is IDLE — a
# reboot mid-turn orphans the turn (and a fresh-boot `ready` can be misread as a
# turn verdict). The confirmation prompt guards this unless you pass --yes.
set -euo pipefail
cd "$(dirname "$0")"

MODE=""; HOST=""; ENV_OVERRIDE=""; ASSUME_YES=0; FW_DIR="./prebuilt-fw"
while [ $# -gt 0 ]; do
  case "$1" in
    --ota) MODE=ota ;;
    --usb) MODE=usb ;;
    --prebuilt) MODE=prebuilt
                # optional positional dir (anything not starting with '-')
                case "${2:-}" in -*|"") ;; *) FW_DIR="$2"; shift ;; esac ;;
    --host) HOST="${2:?--host needs a value}"; shift ;;
    --env)  ENV_OVERRIDE="${2:?--env needs a value}"; shift ;;
    --fw)   FW_DIR="${2:?--fw needs a value}"; shift ;;
    --yes|-y) ASSUME_YES=1 ;;
    -h|--help) sed -n '2,40p' "$0" | sed 's/^#\s\?//'; exit 0 ;;
    *) echo "flash.sh: unknown argument '$1' (try --help)" >&2; exit 2 ;;
  esac
  shift
done
[ -n "$MODE" ] || { echo "flash.sh: specify --ota or --usb (try --help)" >&2; exit 2; }

# docker compose v2 ("docker compose") vs legacy v1 ("docker-compose")
if docker compose version >/dev/null 2>&1; then COMPOSE="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then COMPOSE="docker-compose"
else echo "flash.sh: docker compose not found" >&2; exit 1; fi

# Pull in ESP_PORT / GARRA_OTA_PASSWORD if defined locally.
if [ -f .env ]; then set -a; . ./.env; set +a; fi

if [ ! -f ../esp/include/secrets.h ]; then
  echo "flash.sh: ../esp/include/secrets.h missing." >&2
  echo "          cp ../esp/include/secrets.h.example ../esp/include/secrets.h and fill it in." >&2
  exit 1
fi

confirm_idle() {
  [ "$ASSUME_YES" -eq 1 ] && return 0
  echo "Flashing reboots the chute ESP32 — the cabinet MUST be idle (no active turn)."
  read -r -p "Continue? [y/N] " ans
  case "$ans" in y|Y|yes|YES) return 0 ;; *) echo "aborted."; exit 1 ;; esac
}

resolve_esp_ip() {
  local ip=""
  if command -v avahi-resolve >/dev/null 2>&1; then
    ip=$(avahi-resolve -4 -n garra-chute.local 2>/dev/null | awk '{print $2}')
  fi
  [ -n "$ip" ] || ip=$(getent hosts garra-chute.local 2>/dev/null | awk '{print $1}')
  printf '%s' "$ip"
}

flash_ota() {
  local target="$HOST"
  [ -n "$target" ] || target=$(resolve_esp_ip)
  [ -n "$target" ] || { echo "flash.sh: couldn't resolve garra-chute.local — pass --host <ip>" >&2; exit 1; }
  [ -n "${GARRA_OTA_PASSWORD:-}" ] || { echo "flash.sh: GARRA_OTA_PASSWORD not set (export it or add to .env)" >&2; exit 1; }
  local env="${ENV_OVERRIDE:-esp32dev_ota}"
  echo ">> OTA flash → $target  (env $env). The serial link stays up."
  $COMPOSE --profile flash run --rm flasher run -e "$env" -t upload --upload-port "$target"
  echo ">> OTA complete. The ESP reboots into the new image and re-announces on serial."
  echo "   Watch it land:  $COMPOSE logs -f socket"
}

flash_usb() {
  local env="${ENV_OVERRIDE:-esp32dev}"
  # Guarantee the cabinet comes back even if the flash fails midway.
  trap '$COMPOSE start socket >/dev/null 2>&1 || true' EXIT
  echo ">> Stopping 'socket' to release /dev/garra-esp (cabinet offline ~30s)..."
  $COMPOSE stop socket
  echo ">> USB flash over /dev/garra-esp (env $env)..."
  $COMPOSE --profile flash run --rm flasher run -e "$env" -t upload --upload-port /dev/garra-esp
  echo ">> Flash complete. Restarting 'socket'..."
  $COMPOSE start socket
  trap - EXIT
  echo ">> Waiting for the ESP to reconnect..."
  timeout 25 $COMPOSE logs -f socket 2>&1 | grep -m1 -iE "ESP serial CONNECTED|ready" || \
    echo "   (no reconnect line seen yet — check '$COMPOSE logs -f socket')"
}

flash_prebuilt() {
  # Upload firmware built off-Pi. No compiler involved — just esptool writing
  # the 4 bins at the offsets PlatformIO uses for an esp32 arduino image.
  local dir; dir="$(cd "$FW_DIR" 2>/dev/null && pwd)" \
    || { echo "flash.sh: --fw dir '$FW_DIR' not found." >&2; exit 1; }
  local missing=""
  for f in bootloader.bin partitions.bin boot_app0.bin firmware.bin; do
    [ -f "$dir/$f" ] || missing="$missing $f"
  done
  [ -z "$missing" ] || {
    echo "flash.sh: $dir is missing:$missing" >&2
    echo "          Build on an x86/arm64 box and copy them over, e.g.:" >&2
    echo "            pio run -e esp32dev        # in ../esp on the dev box" >&2
    echo "            scp <bins> pi@<pi>:$FW_DIR/" >&2
    exit 1
  }
  # Guarantee the cabinet comes back even if the flash fails midway.
  trap '$COMPOSE start socket >/dev/null 2>&1 || true' EXIT
  echo ">> Stopping 'socket' to release /dev/garra-esp (cabinet offline ~30s)..."
  $COMPOSE stop socket
  echo ">> Writing prebuilt firmware over /dev/garra-esp (from $dir)..."
  $COMPOSE --profile flash run --rm -v "$dir":/fw:ro --entrypoint python flasher \
    -m esptool --chip esp32 --port /dev/garra-esp --baud 921600 \
    --before default_reset --after hard_reset \
    write_flash -z --flash_mode dio --flash_freq 40m --flash_size 4MB \
    0x1000 /fw/bootloader.bin \
    0x8000 /fw/partitions.bin \
    0xe000 /fw/boot_app0.bin \
    0x10000 /fw/firmware.bin
  echo ">> Flash complete. Restarting 'socket'..."
  $COMPOSE start socket
  trap - EXIT
  echo ">> Waiting for the ESP to reconnect..."
  timeout 25 $COMPOSE logs -f socket 2>&1 | grep -m1 -iE "ESP serial CONNECTED|ready" || \
    echo "   (no reconnect line seen yet — check '$COMPOSE logs -f socket')"
}

confirm_idle
echo ">> Building flasher image (first run installs esptool + toolchain; later runs are cached)..."
$COMPOSE --profile flash build flasher

case "$MODE" in
  ota) flash_ota ;;
  usb) flash_usb ;;
  prebuilt) flash_prebuilt ;;
esac
echo ">> Done."
