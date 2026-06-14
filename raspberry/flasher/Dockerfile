# PlatformIO flasher for the chute ESP32.
#
# Used only as a one-off, profile-gated container driven by ../flash.sh —
# never part of `docker compose up`. It builds the firmware in esp/ (mounted at
# /project) and uploads it either over WiFi (espota) or the USB cable.
#
# Toolchains (xtensa-esp32) and the package cache live in the garra_pio_cache
# volume, so only the first flash pays the download cost.
FROM python:3.12-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends git curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir platformio

WORKDIR /project
# `docker compose run flasher run -e <env> -t upload ...` => `pio run ...`
ENTRYPOINT ["pio"]
CMD ["--version"]
