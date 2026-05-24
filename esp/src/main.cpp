// ESP32 entry point. Owns sensors + RFID + solenoid; talks to the Pi over
// the USB serial link using newline-delimited JSON. WiFi-only side effect
// is ArduinoOTA — the chute FSM remains live whether or not WiFi is up.
//
// Wire protocol with the Pi is documented in src/protocol.h. The chute
// sub-FSM mirrors the legacy Pi-side AWAITING_FALL → IDENTIFYING →
// CLEARING phases (see src/fsm.h).

#include <Arduino.h>
#include <SPI.h>

#include "fsm.h"
#include "ota.h"
#include "protocol.h"
#include "rfid_pool.h"
#include "sensors.h"

static constexpr const char *FW_VERSION = "garra-chute-0.1.0";

void setup() {
    Serial.begin(115200);
    delay(50);
    Serial.println("{\"type\":\"log\",\"msg\":\"boot: serial up\"}");

    SPI.begin();           // VSPI defaults: SCK=18, MISO=19, MOSI=23.
    Serial.println("{\"type\":\"log\",\"msg\":\"boot: spi up\"}");

    sensors::install();
    Serial.println("{\"type\":\"log\",\"msg\":\"boot: sensors up\"}");

    rfid::install();
    Serial.println("{\"type\":\"log\",\"msg\":\"boot: rfid up\"}");

    fsm::install();
    Serial.println("{\"type\":\"log\",\"msg\":\"boot: fsm up\"}");

    ota::install();
    Serial.println("{\"type\":\"log\",\"msg\":\"boot: ota up\"}");

    // Announce boot. `fault` is nullptr unless we somehow latched during
    // install() — at the moment we never do, but mirroring the field keeps
    // the Pi-side reconcile logic correct if that changes.
    proto::emit_ready(FW_VERSION, fsm::latched_fault());
}

void loop() {
    ota::tick();

    proto::Parsed msg;
    if (proto::poll(msg)) {
        fsm::on_inbound(msg);
    }

    fsm::tick();

    // Yield to WiFi/BLE tasks. Don't delay() heavily — RFID inventory
    // already takes ~20ms per reader and would starve the loop otherwise.
    delay(1);
}
