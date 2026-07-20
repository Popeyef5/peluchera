#include "protocol.h"

namespace proto {

static String rx_buf;

bool poll(Parsed &out) {
    while (Serial.available()) {
        char c = (char)Serial.read();
        if (c == '\n') {
            String line = rx_buf;
            rx_buf = "";
            if (line.length() == 0) continue;

            JsonDocument doc;
            DeserializationError err = deserializeJson(doc, line);
            if (err) {
                Serial.printf("{\"type\":\"log\",\"msg\":\"bad-json: %s\"}\n", err.c_str());
                continue;
            }
            const char *t = doc["type"] | "";
            if (strcmp(t, "arm") == 0)              out.kind = Inbound::ARM;
            else if (strcmp(t, "fault_clear") == 0) out.kind = Inbound::FAULT_CLEAR;
            else if (strcmp(t, "ping") == 0)        out.kind = Inbound::PING;
            else if (strcmp(t, "enroll") == 0)      out.kind = Inbound::ENROLL;
            else                                    out.kind = Inbound::UNKNOWN;
            out.seq        = doc["seq"] | 0L;
            out.timeout_ms = (uint32_t)(doc["timeout_ms"] | 10000U);
            return true;
        }
        if (rx_buf.length() < 512) rx_buf += c;  // discard runaway garbage
    }
    return false;
}

static void writeln(const JsonDocument &doc) {
    serializeJson(doc, Serial);
    Serial.write('\n');
}

void emit_ready(const char *fw_version, const char *latched_fault_or_null) {
    JsonDocument d;
    d["type"]  = "ready";
    d["fw"]    = fw_version;
    d["proto"] = ESP_PI_PROTOCOL;   // Pi checks this against its ESP_PI_PROTO
    if (latched_fault_or_null) d["fault"] = latched_fault_or_null;
    else                       d["fault"] = nullptr;
    writeln(d);
}

void emit_verdict(const char *outcome, const char *uid_hex_or_null) {
    JsonDocument d;
    d["type"] = "verdict";
    d["data"]["outcome"] = outcome;
    if (uid_hex_or_null && uid_hex_or_null[0]) {
        d["data"]["ball_serial"] = uid_hex_or_null;
    } else {
        d["data"]["ball_serial"] = nullptr;   // explicit null, never omitted
    }
    writeln(d);
}

void emit_fault(const char *kind, const char *reason_or_null) {
    JsonDocument d;
    d["type"] = "fault";
    d["data"]["kind"] = kind;
    if (reason_or_null) d["data"]["reason"] = reason_or_null;
    writeln(d);
}

void emit_pong(long seq) {
    JsonDocument d;
    d["type"] = "pong";
    d["seq"]  = seq;
    writeln(d);
}

void emit_tag_scanned(const char *uid_hex) {
    JsonDocument d;
    d["type"] = "tag_scanned";
    d["data"]["ball_serial"] = uid_hex;
    writeln(d);
}

void emit_enroll_timeout() {
    JsonDocument d;
    d["type"] = "enroll_timeout";
    writeln(d);
}

}  // namespace proto
