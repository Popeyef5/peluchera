#include "rfid_pool.h"
#include "pins.h"

#include <Arduino.h>
#include <PN5180.h>
#include <PN5180ISO15693.h>

namespace rfid {

// PN5180ISO15693 owns SPI configuration internally; instances share the bus
// and select via their per-reader NSS pin.
static PN5180ISO15693 *readers[RFID_COUNT] = {};   // value-init = all nullptr

// Wait up to `timeout_ms` for BUSY on the given pin to go low. Returns
// true if the chip eventually presented "idle, ready for commands".
static bool wait_busy_low(int busy_pin, uint32_t timeout_ms) {
    uint32_t deadline = millis() + timeout_ms;
    while ((int32_t)(millis() - deadline) < 0) {
        if (digitalRead(busy_pin) == LOW) return true;
        delay(1);
    }
    return false;
}

void install() {
    // Two-pass init: begin() configures per-reader pins without touching
    // RST level. Pulse the shared RST line once manually, then setupRF
    // every reader that's actually responsive. Doing reset() per-reader
    // inside the loop would wipe earlier readers' RF config (shared RST
    // line resets all of them).
    for (int i = 0; i < RFID_COUNT; i++) {
        readers[i] = new PN5180ISO15693(
            PIN_RFID_NSS[i], PIN_RFID_BUSY[i], PIN_RFID_RST);
        readers[i]->begin();
    }

    pinMode(PIN_RFID_RST, OUTPUT);
    digitalWrite(PIN_RFID_RST, LOW);
    delay(2);
    digitalWrite(PIN_RFID_RST, HIGH);
    delay(10);   // PN5180 datasheet: allow ~3 ms post-rise before commands

    // Probe each reader's BUSY line before talking to it. ATrappmann's
    // setupRF() has no timeout on its busy-wait, so an unpowered or
    // miswired reader would hang boot here forever. If we can't see BUSY
    // settle low within 200ms after reset, mark the reader as absent and
    // continue — the FSM will see no reader hits at runtime and surface
    // a normal rfid_failed fault instead of bricking the cabinet.
    for (int i = 0; i < RFID_COUNT; i++) {
        if (!wait_busy_low(PIN_RFID_BUSY[i], 200)) {
            Serial.printf(
                "{\"type\":\"log\",\"msg\":\"rfid[%d] BUSY stuck high — skipped\"}\n",
                i);
            delete readers[i];
            readers[i] = nullptr;
            continue;
        }
        readers[i]->setupRF();
        Serial.printf("{\"type\":\"log\",\"msg\":\"rfid[%d] ready\"}\n", i);
    }
}

static void bytes_to_hex_upper(const uint8_t *src, size_t n, char *dst) {
    static const char H[] = "0123456789ABCDEF";
    for (size_t i = 0; i < n; i++) {
        dst[2 * i]     = H[(src[i] >> 4) & 0xF];
        dst[2 * i + 1] = H[ src[i]       & 0xF];
    }
    dst[2 * n] = '\0';
}

bool try_read_once(char *out_uid_hex) {
    uint8_t uid_lsb[8];
    for (int i = 0; i < RFID_COUNT; i++) {
        PN5180ISO15693 *r = readers[i];
        if (!r) continue;
        ISO15693ErrorCode rc = r->getInventory(uid_lsb);
        if (rc == ISO15693_EC_OK) {
            // ATrappmann returns LSB-first; reverse to match the Pi-era
            // upper-case hex convention.
            uint8_t uid_msb[8];
            for (int k = 0; k < 8; k++) uid_msb[k] = uid_lsb[7 - k];
            bytes_to_hex_upper(uid_msb, 8, out_uid_hex);
            return true;
        }
    }
    return false;
}

}  // namespace rfid
