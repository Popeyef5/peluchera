// JSON-over-UART protocol with the Pi.
//
// Wire format: newline-delimited JSON, one message per line, no framing
// other than '\n'. Matches the shape the Pi forwards to central, so
// prize_won / fault payloads pass through untouched.
//
// Inbound  (Pi  → ESP):  {"type":"arm"} | {"type":"fault_clear"} | {"type":"ping","seq":N}
// Outbound (ESP → Pi ):  ready / prize_won / fault / no_fall / pong
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

// Inbound message kinds.
enum class Inbound { UNKNOWN, ARM, FAULT_CLEAR, PING };

struct Parsed {
    Inbound kind;
    long    seq;  // populated for PING
};

// Reads at most one line from Serial and parses it. Non-blocking; returns
// false if no complete line is ready yet.
bool poll(Parsed &out);

// Outbound emitters.
void emit_ready(const char *fw_version, const char *latched_fault_or_null);
void emit_prize_won(const char *uid_hex);
void emit_fault(const char *kind, const char *reason_or_null);
void emit_no_fall();
void emit_pong(long seq);

}  // namespace proto
