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
constexpr int PIN_ENTRY_BB = 33;
constexpr int PIN_EXIT_BB  = 32;

// --- Solenoid (LOW = blocking, HIGH = path clear) -------------------------
constexpr int PIN_SOLENOID = 25;

// --- FDX-B RFID reader (single custom antenna) ----------------------------
// PWM-driven 134.2 kHz carrier on PIN_FDXB_PWM; demodulated tag response
// returns on PIN_FDXB_INPUT (pin-change ISR). One antenna replaces the
// four-PN5180 pool — VSPI bus + the various NSS/BUSY/RST pins are now free
// for future use.
constexpr int PIN_FDXB_PWM   = 4;    // D4 — drives the carrier transistor
constexpr int PIN_FDXB_INPUT = 18;   // D18 — demodulated edges in

// --- Onboard LED (debug; many esp32dev boards wire it to GPIO 2) ----------
constexpr int PIN_STATUS_LED = 2;
