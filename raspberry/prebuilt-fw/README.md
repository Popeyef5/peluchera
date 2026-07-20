# Prebuilt chute-ESP32 firmware

These four `.bin`s are the compiled chute firmware, checked in **on purpose**.

The Raspberry Pi cannot compile ESP32 firmware: it has a 32-bit (armv7l)
userland, and PlatformIO's `xtensa-esp32` GCC has no working armv7l host binary
(and an arm64 flasher image would have to be QEMU-emulated by the Pi's 32-bit
Docker daemon, which dies in `apt` with SIGSYS). So `flash.sh --usb`/`--ota`,
which build, fail on the Pi.

Instead we build off-Pi and let the Pi only **upload** (pure-Python `esptool`,
no cross-compiler). Git is the transport — the Pi already `git pull`s.

## Flashing on the Pi

```bash
cd ~/peluchera/raspberry
git pull --ff-only
./flash.sh --prebuilt          # writes these bins over /dev/garra-esp
```

## Refreshing these bins (whenever the firmware changes)

On an **x86 / arm64** box with a working PlatformIO toolchain:

```bash
cd esp
pio run -e esp32dev
cp .pio/build/esp32dev/{bootloader.bin,partitions.bin,firmware.bin} \
   ../raspberry/prebuilt-fw/
cp ~/.platformio/packages/framework-arduinoespressif32/tools/partitions/boot_app0.bin \
   ../raspberry/prebuilt-fw/
git commit -am "prebuilt-fw: rebuild chute firmware"
```

Offsets (baked into `flash.sh --prebuilt`, standard esp32 arduino layout):
`0x1000` bootloader · `0x8000` partitions · `0xe000` boot_app0 · `0x10000` firmware.
