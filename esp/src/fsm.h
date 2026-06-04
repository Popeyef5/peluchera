// Per-turn state machine for the chute identification flow.
//
// Mirrors the legacy Pi-side FSM (raspberry/server/fsm.py before the
// ESP32 split):
//   IDLE          - waiting for an `arm` or `enroll` from the Pi.
//   AWAITING_FALL - armed; waiting up to T_FALL for the entry BB.
//                   Timeout → no_fall (ordinary lose). Edge → IDENTIFYING.
//   IDENTIFYING   - entry BB tripped. Solenoid stays default-blocking, so
//                   the prize is held physically. Cycle the RFID pool up
//                   to T_ID.
//   CLEARING      - UID acquired. Solenoid energized to release the prize;
//                   waiting up to T_EXIT for the exit BB.
//   ENROLL        - admin tag-registration window. Polls the FDXB reader
//                   independent of break-beams; emits tag_scanned on first
//                   hit or enroll_timeout when the window elapses.
//   BLOCKED       - latched fault. Refuses `arm` until `fault_clear`.
#pragma once

#include "protocol.h"

namespace fsm {

enum class State { IDLE, AWAITING_FALL, IDENTIFYING, CLEARING, ENROLL, BLOCKED };

void install();           // call once at boot.
void on_inbound(const proto::Parsed &m);
void tick();              // call from loop() at ~1 kHz.

State        state();
const char  *latched_fault();   // nullptr unless BLOCKED.

}  // namespace fsm
