// Non-blocking facade around the FdxB parser.
//
// The parser itself is blocking (Decoder::getDelta delayMicroseconds() until
// the FIFO has data, Parser::findHeader spins until a header arrives). To
// keep the main loop responsive for serial/FSM/OTA, we run that blocking
// loop on a dedicated FreeRTOS task pinned to Core 0. The Arduino loop on
// Core 1 just polls `try_read_once()`, which non-blockingly hands back the
// most recent decoded tag (if any).
//
// Wire-side tag UID: the first 8 bytes of FdxB::tag_t (the packed country/
// id/flags field) serialized to 16-char upper-case hex. Same shape the
// PN5180 stack used, so the Pi protocol and central's Ball.serial lookup
// don't change.
#pragma once

#include <stdint.h>

namespace fdxb {

void install();   // pwm + ISR + parser task. Call once after Serial.begin().

// Non-blocking. Writes 16-char upper-case hex into out_uid_hex (≥17 bytes)
// on success and returns true. Returns false if no new tag has been parsed
// since the previous successful call.
bool try_read_once(char *out_uid_hex);

// Carrier (134.2 kHz PWM) control. Default on after install().
void carrier_on();
void carrier_off();
bool carrier_is_on();

// Diagnostics.
uint32_t isr_edge_count();         // total pin-change edges since boot
bool     last_tag_hex(char *out);  // most recent decoded tag, peeked (no consume)

}  // namespace fdxb
