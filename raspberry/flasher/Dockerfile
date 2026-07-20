# PlatformIO flasher for the chute ESP32.
#
# Used only as a one-off, profile-gated container driven by ../flash.sh —
# never part of `docker compose up`. It builds the firmware in esp/ (mounted at
# /project) and uploads it either over WiFi (espota) or the USB cable.
#
# Toolchains (xtensa-esp32) and the package cache live in the garra_pio_cache
# volume, so only the first flash pays the download cost.
FROM python:3.12-slim

# build-essential + the -dev headers are needed because on ARM (the real Pi)
# some of esptool's deps (cffi, bitarray) have no prebuilt wheels and compile
# from source. Without a compiler the flash dies with "gcc: No such file or
# directory". x86 dev boxes have wheels, so this only bites on the Pi.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      git curl ca-certificates \
      build-essential python3-dev libffi-dev libssl-dev \
 && rm -rf /var/lib/apt/lists/*

# platformio drives OTA/USB builds on a box where the xtensa toolchain works
# (x86/arm64). esptool is installed explicitly so the --prebuilt upload path
# works on this 32-bit Pi WITHOUT ever invoking the (missing) cross-compiler:
# it just writes firmware built off-Pi. Its console scripts land on PATH.
RUN pip install --no-cache-dir platformio esptool

WORKDIR /project
# `docker compose run flasher run -e <env> -t upload ...` => `pio run ...`
ENTRYPOINT ["pio"]
CMD ["--version"]
