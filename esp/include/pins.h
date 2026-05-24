// GPIO assignments for the chute subsystem.
//
// Avoids ESP32 strapping pins on outputs (0, 2, 5, 12, 15) and the
// flash-reserved range (6-11). PN5180 readers share VSPI; per-reader
// NSS+BUSY, shared active-low RST.
//
// Wiring invariants (must match the Pi-era contract):
//   SOLENOID default LOW = de-energized = blocking. Energized only in
//   the CLEARING phase; any crash/reboot/brownout therefore leaves the
//   prize physically held.
#pragma once

// --- Break beams (active-low, falling edge = beam broken) -----------------
constexpr int PIN_ENTRY_BB = 32;
constexpr int PIN_EXIT_BB  = 33;

// --- Solenoid (LOW = blocking, HIGH = path clear) -------------------------
constexpr int PIN_SOLENOID = 25;

// --- PN5180 RFID pool -----------------------------------------------------
// SPI bus: VSPI (Arduino default on ESP32: SCK=18, MISO=19, MOSI=23).
//
// For incremental hardware bring-up, override the count from platformio.ini
// (e.g. `build_flags = -DRFID_COUNT=1`). Whatever count you build with,
// readers 0..count-1 from the pin tables below are initialized.
#ifndef RFID_COUNT
#define RFID_COUNT 4
#endif
constexpr int PIN_RFID_NSS [4] = {16, 17, 21, 22};
constexpr int PIN_RFID_BUSY[4] = {27, 14, 13,  4};
constexpr int PIN_RFID_RST     = 26;  // shared, active-low

// --- Onboard LED (debug; many esp32dev boards wire it to GPIO 2) ----------
constexpr int PIN_STATUS_LED = 2;
