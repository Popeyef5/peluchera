#include "ota.h"
#include "pins.h"
#include "secrets.h"

#include <Arduino.h>
#include <ArduinoOTA.h>
#include <WiFi.h>

namespace ota {

static bool wifi_connected = false;
static bool ota_started    = false;

void install() {
    WiFi.mode(WIFI_STA);
    WiFi.setHostname(OTA_HOSTNAME);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

    // Don't block the boot. Caller is the chute FSM — it needs to be live
    // even if WiFi is down.
    uint32_t deadline = millis() + 10000;
    while (WiFi.status() != WL_CONNECTED && millis() < deadline) {
        delay(100);
    }
    wifi_connected = (WiFi.status() == WL_CONNECTED);

    if (wifi_connected) {
        ArduinoOTA.setHostname(OTA_HOSTNAME);
        ArduinoOTA.setPassword(OTA_PASSWORD);
        pinMode(PIN_STATUS_LED, OUTPUT);
        ArduinoOTA.onStart([]() {
            // Drop into a safe state for the duration of the flash — the
            // FSM tick won't run while ArduinoOTA owns the loop.
            digitalWrite(PIN_STATUS_LED, HIGH);
        });
        ArduinoOTA.begin();
        ota_started = true;
    } else {
        // Initial connect failed. The WiFi driver would otherwise keep
        // rescanning and spam NO_AP_FOUND every few seconds. Shut the radio
        // down — OTA wasn't going to work anyway, and the FSM runs fine
        // without it. Power-cycle is the way to retry OTA.
        WiFi.disconnect(true, true);
        WiFi.mode(WIFI_OFF);
    }
}

void tick() {
    if (ota_started) ArduinoOTA.handle();

    // Cheap reconnect: if WiFi drops, the OTA listener stops being
    // reachable until the next boot. Not worth a runtime reconnect loop —
    // the device runs fine without OTA, and a power cycle re-installs it.
}

bool wifi_up() { return wifi_connected; }

}  // namespace ota
