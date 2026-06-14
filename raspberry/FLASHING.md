# Flashing the chute ESP32 from the Pi

The chute firmware lives in `esp/` (PlatformIO). It's flashed from the Pi via
`./flash.sh`, which drives a profile-gated `flasher` container (PlatformIO +
toolchain). Two transports:

| | `--ota` (primary) | `--usb` (fallback / recovery) |
|---|---|---|
| Transport | WiFi → `garra-chute.local` (espota) | USB cable → `/dev/garra-esp` (esptool) |
| Cabinet downtime | just the ESP reboot (~1–2s) | ~30s (`socket` stopped to free the port) |
| Needs WiFi | yes | no |
| Recovers a brick | no | yes (talks straight to the bootloader) |
| Touches serial link | no | yes (stops/starts `socket`) |

```bash
./flash.sh --ota                  # everyday updates
./flash.sh --ota --host 10.0.0.42 # if mDNS can't resolve garra-chute.local
./flash.sh --usb                  # ESP off WiFi / OTA broken / bricked
./flash.sh --usb --yes            # skip the idle confirmation
```

## How each works
- **OTA**: builds the firmware, `pio run -e esp32dev_ota -t upload --upload-port <ip>`
  pushes it into the ESP's inactive app slot; the ESP verifies, reboots into it,
  and re-announces on serial. The `socket` container keeps `/dev/garra-esp` open
  the whole time — only the reboot blips it (EspLink auto-reconnects).
- **USB**: `stop socket` (frees the port) → `pio run -t upload` over the cable →
  `start socket`. A trap restarts `socket` even if the flash fails, so the
  cabinet always comes back.

## Prereqs
- `esp/include/secrets.h` present (WiFi SSID/pass + OTA hostname/password) — copy
  from `secrets.h.example`. Gitignored.
- `GARRA_OTA_PASSWORD` exported or in `raspberry/.env` (for `--ota`; must match
  what's compiled into the firmware).
- The chute ESP plugged into the Pi (the `flasher`, like `socket`, maps the USB
  device, so it must exist — true on any real cabinet).
- First flash downloads the xtensa toolchain into the `garra_pio_cache` volume;
  later flashes are fast.

## Safety
Both transports reboot the ESP, so **flash only when the cabinet is idle** — a
reboot mid-turn orphans the turn (and a fresh-boot `ready` can be misread as a
turn verdict). `flash.sh` prompts to confirm unless you pass `--yes`.
