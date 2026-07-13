// JSON-over-UART protocol with the Pi.
//
// Wire format: newline-delimited JSON, one message per line, no framing
// other than '\n'. Matches the shape the Pi forwards to central, so
// prize_won / fault payloads pass through untouched.
//
// Inbound  (Pi  → ESP):  arm | fault_clear | ping | enroll
// Outbound (ESP → Pi ):  ready | verdict | fault | pong |
//                        tag_scanned | enroll_timeout
//
// Exactly ONE `verdict` is emitted per `arm`. It carries everything the server
// needs to decide both questions at once — did the player win, and is the chute
// still usable — so there is no multi-message outcome to reassemble:
//
//   outcome    ball_serial   player won?   chute healthy?
//   no_fall    null          no            yes  (ordinary loss)
//   no_read    null          unknown       NO   (fell, tag unreadable)
//   no_exit    SET           YES           NO   (read, then jammed — we still
//                                                know what they won)
//   ok         SET           yes           yes
//
// `fault` remains for things that are not the outcome of an arm: refusing to
// arm while latched (still_blocked), internal errors, and the latch reported in
// `ready` after a reset.
#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>

namespace proto {

// Fault kinds — kept identical to the legacy Pi→central contract so the
// downstream socket layer doesn't need to remap.
constexpr const char *FAULT_RFID_FAILED   = "rfid_failed";
constexpr const char *FAULT_EXIT_TIMEOUT  = "exit_timeout";
constexpr const char *FAULT_INTERNAL      = "internal_error";

constexpr const char *REASON_STILL_BLOCKED = "still_blocked";

// Chute verdict outcomes — exactly one per arm. See the table at the top.
constexpr const char *VERDICT_NO_FALL = "no_fall";
constexpr const char *VERDICT_NO_READ = "no_read";
constexpr const char *VERDICT_NO_EXIT = "no_exit";
constexpr const char *VERDICT_OK      = "ok";

// Inbound message kinds.
enum class Inbound { UNKNOWN, ARM, FAULT_CLEAR, PING, ENROLL };

struct Parsed {
    Inbound  kind;
    long     seq;          // populated for PING
    uint32_t timeout_ms;   // populated for ENROLL
};

// Reads at most one line from Serial and parses it. Non-blocking; returns
// false if no complete line is ready yet.
bool poll(Parsed &out);

// Outbound emitters.
void emit_ready(const char *fw_version, const char *latched_fault_or_null);
// The single per-arm verdict. `uid_hex_or_null` is set for no_exit and ok —
// note no_exit carries it too, so a jam never costs the player the knowledge of
// what they won.
void emit_verdict(const char *outcome, const char *uid_hex_or_null);
void emit_fault(const char *kind, const char *reason_or_null);
void emit_pong(long seq);
// Admin enrollment outbound: tag_scanned carries the UID of the first tag
// presented during the enroll window; enroll_timeout signals that the
// window ended with no tag detected.
void emit_tag_scanned(const char *uid_hex);
void emit_enroll_timeout();

}  // namespace proto
