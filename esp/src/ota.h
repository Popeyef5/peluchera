// ArduinoOTA wrapper. WiFi creds + OTA password come from secrets.h.
//
// Boot sequence:
//   1. Connect to WiFi (best-effort, non-blocking after ~10s).
//   2. Start ArduinoOTA on the configured hostname.
//   3. Caller pumps ArduinoOTA.handle() from the main loop.
//
// If WiFi never associates, the cabinet still works — OTA is just disabled
// until the next boot reaches a working AP.
#pragma once

namespace ota {

void install();   // begins WiFi connect + ArduinoOTA listener.
void tick();      // call from loop().

bool wifi_up();   // for status reporting.

}  // namespace ota
