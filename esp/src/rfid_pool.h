// Multi-reader PN5180 wrapper.
//
// The chute solenoid holds the prize stationary in front of the reader
// array, so any of N readers can win the race. We cycle them on the
// shared SPI bus, giving each one a single inventory attempt per pass,
// and return the first hit.
#pragma once

#include <stdint.h>

namespace rfid {

void install();   // resets every reader; call once after SPI.begin().

// One inventory pass across all readers. Writes 16-char upper-case hex UID
// into out_uid_hex (must hold 17+ bytes) on success.
// Returns true if a tag responded on any reader.
bool try_read_once(char *out_uid_hex);

}  // namespace rfid
