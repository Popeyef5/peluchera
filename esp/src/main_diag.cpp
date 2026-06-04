// Diagnostic firmware. Plain-text REPL on the USB serial port for
// bringing up chute hardware one component at a time without the FSM,
// the JSON wire protocol, OTA, or WiFi.
//
// Build/upload:
//   pio run -e esp32dev_diag -t upload
//   pio device monitor -e esp32dev_diag --filter send_on_enter
//
// Commands (one per line, terminated by '\n'):
//   help                  - list commands
//   status                - dump everything in one go
//   bb                    - read both break beams once (level + ISR edge)
//   wait <ms>             - block up to N ms for any BB edge; print which
//   sol on | off | pulse  - drive the solenoid pin (pulse = 500ms then off)
//   fdxb                  - non-blocking poll for a tag
//   fdxb on | off         - toggle the 134.2 kHz carrier
//   fdxb status           - carrier on?, ISR edges since boot, last tag seen
//   fdxb test [secs]      - turn carrier on, count edges for N seconds,
//                           report the last tag if any (default 3s)
//   read <gpio>           - digitalRead arbitrary pin
//   write <gpio> <0|1>    - digitalWrite arbitrary pin (use with care)
//   reset                 - reboot the ESP32
//
// All output is plain text. The break beams use the same sensors module
// as prod, so the ISR + 5 ms debounce path is exercised identically.

#include <Arduino.h>

#include "fdxb_reader.h"
#include "pins.h"
#include "sensors.h"

static String rx_buf;

// --- helpers ---------------------------------------------------------------

static const char *level_str(int v) { return v ? "HIGH" : "LOW"; }
static const char *bb_str(int v)    { return v ? "HIGH (clear)" : "LOW (broken)"; }

static void show_help() {
    Serial.println(F("commands:"));
    Serial.println(F("  help"));
    Serial.println(F("  status"));
    Serial.println(F("  bb"));
    Serial.println(F("  wait <ms>"));
    Serial.println(F("  sol on|off|pulse"));
    Serial.println(F("  fdxb                  - non-blocking poll for a decoded tag"));
    Serial.println(F("  fdxb on | off         - toggle the 134.2 kHz carrier"));
    Serial.println(F("  fdxb status           - carrier?, ISR edges, last tag seen"));
    Serial.println(F("  fdxb test [secs]      - count edges for N s; report any tag (default 3)"));
    Serial.println(F("  read <gpio>"));
    Serial.println(F("  write <gpio> <0|1>"));
    Serial.println(F("  reset"));
}

static void show_status() {
    Serial.printf("entry BB (GPIO %d): %s   edge-since-last: %s\n",
        PIN_ENTRY_BB, bb_str(digitalRead(PIN_ENTRY_BB)),
        sensors::take_entry() ? "YES" : "no");
    Serial.printf("exit  BB (GPIO %d): %s   edge-since-last: %s\n",
        PIN_EXIT_BB, bb_str(digitalRead(PIN_EXIT_BB)),
        sensors::take_exit() ? "YES" : "no");
    Serial.printf("solenoid (GPIO %d): %s\n",
        PIN_SOLENOID,
        digitalRead(PIN_SOLENOID) ? "ENERGIZED (chute clear)" : "released (blocking)");
    Serial.printf("fdxb carrier (GPIO %d): %s\n",
        PIN_FDXB_PWM, fdxb::carrier_is_on() ? "ON (134.2 kHz)" : "off");
    Serial.printf("fdxb ISR edges so far: %lu\n", (unsigned long)fdxb::isr_edge_count());
    char last[17];
    if (fdxb::last_tag_hex(last)) Serial.printf("fdxb last tag seen: %s\n", last);
    else                          Serial.println("fdxb last tag seen: (none since boot)");
}

static void cmd_bb() {
    show_status();   // bb is a subset of status; printing both is harmless
}

static void cmd_wait(uint32_t timeout_ms) {
    Serial.printf("waiting up to %lums for any BB edge…\n", timeout_ms);
    // Drain stale edges before we start waiting.
    (void)sensors::take_entry();
    (void)sensors::take_exit();
    uint32_t deadline = millis() + timeout_ms;
    while ((int32_t)(millis() - deadline) < 0) {
        if (sensors::take_entry()) { Serial.println("ENTRY edge"); return; }
        if (sensors::take_exit())  { Serial.println("EXIT edge");  return; }
        delay(2);
    }
    Serial.println("(timeout, no edge)");
}

static void cmd_sol(const String &arg) {
    if (arg == "on") {
        digitalWrite(PIN_SOLENOID, HIGH);
        Serial.println("solenoid ENERGIZED");
    } else if (arg == "off") {
        digitalWrite(PIN_SOLENOID, LOW);
        Serial.println("solenoid released");
    } else if (arg == "pulse") {
        Serial.println("solenoid pulse: 500ms ON…");
        digitalWrite(PIN_SOLENOID, HIGH);
        delay(500);
        digitalWrite(PIN_SOLENOID, LOW);
        Serial.println("solenoid released");
    } else {
        Serial.println("usage: sol on|off|pulse");
    }
}

// Parse "<sub> [rest]" out of args; rest may itself contain spaces.
static void split_one(const String &args, String &sub, String &rest) {
    int sp = args.indexOf(' ');
    sub  = (sp < 0) ? args : args.substring(0, sp);
    rest = (sp < 0) ? String("") : args.substring(sp + 1);
    rest.trim();
}

static int parse_idx_default0(const String &s) {
    if (s.length() == 0) return 0;
    return s.toInt();
}

static void cmd_fdxb(const String &args) {
    String sub, rest;
    split_one(args, sub, rest);

    if (sub.length() == 0 || sub == "scan") {
        // Non-blocking peek of the parser task's latest decoded tag.
        char uid_hex[17];
        if (fdxb::try_read_once(uid_hex)) {
            Serial.printf("FDX-B hit: %s\n", uid_hex);
        } else {
            Serial.println("no tag");
        }
        return;
    }
    if (sub == "on") {
        fdxb::carrier_on();
        Serial.println("carrier ON (134.2 kHz)");
        return;
    }
    if (sub == "off") {
        fdxb::carrier_off();
        Serial.println("carrier off");
        return;
    }
    if (sub == "status") {
        Serial.printf("carrier: %s\n", fdxb::carrier_is_on() ? "ON" : "off");
        Serial.printf("ISR edges so far: %lu\n", (unsigned long)fdxb::isr_edge_count());
        char last[17];
        if (fdxb::last_tag_hex(last)) Serial.printf("last tag seen: %s\n", last);
        else                          Serial.println("last tag seen: (none since boot)");
        return;
    }
    if (sub == "test") {
        uint32_t secs = rest.length() ? (uint32_t)rest.toInt() : 3;
        if (secs == 0) secs = 3;
        if (!fdxb::carrier_is_on()) { fdxb::carrier_on(); Serial.println("(carrier turned on)"); }
        uint32_t before = fdxb::isr_edge_count();
        // Drain any stale tag captured before we started counting.
        char tmp[17];
        (void)fdxb::try_read_once(tmp);
        Serial.printf("counting edges + listening for tag for %lus…\n", (unsigned long)secs);
        delay(secs * 1000);
        uint32_t after = fdxb::isr_edge_count();
        Serial.printf("ISR edges in window: %lu (%.1f /s)\n",
            (unsigned long)(after - before),
            (float)(after - before) / (float)secs);
        if (fdxb::try_read_once(tmp)) Serial.printf("  -> HIT  UID=%s\n", tmp);
        else                          Serial.println("  -> no tag decoded");
        return;
    }

    Serial.printf("unknown fdxb subcommand: %s\n", sub.c_str());
    Serial.println("try: fdxb | fdxb on | fdxb off | fdxb status | fdxb test [secs]");
}

static void cmd_read(int pin) {
    pinMode(pin, INPUT);
    Serial.printf("GPIO %d: %s\n", pin, level_str(digitalRead(pin)));
}

static void cmd_write(int pin, int val) {
    pinMode(pin, OUTPUT);
    digitalWrite(pin, val ? HIGH : LOW);
    Serial.printf("GPIO %d <- %s\n", pin, level_str(val));
}

// --- command dispatch ------------------------------------------------------

static void handle_line(const String &line_in) {
    String line = line_in;
    line.trim();
    if (line.length() == 0) return;
    Serial.printf("> %s\n", line.c_str());

    int sp = line.indexOf(' ');
    String cmd = (sp < 0) ? line : line.substring(0, sp);
    String rest = (sp < 0) ? String("") : line.substring(sp + 1);
    rest.trim();

    if      (cmd == "help" || cmd == "?") show_help();
    else if (cmd == "status")             show_status();
    else if (cmd == "bb")                 cmd_bb();
    else if (cmd == "wait")               cmd_wait(rest.length() ? rest.toInt() : 5000);
    else if (cmd == "sol")                cmd_sol(rest);
    else if (cmd == "fdxb")               cmd_fdxb(rest);
    else if (cmd == "read")               cmd_read(rest.toInt());
    else if (cmd == "write") {
        int sp2 = rest.indexOf(' ');
        if (sp2 < 0) { Serial.println("usage: write <gpio> <0|1>"); return; }
        cmd_write(rest.substring(0, sp2).toInt(), rest.substring(sp2 + 1).toInt());
    }
    else if (cmd == "reset")              ESP.restart();
    else                                  Serial.printf("unknown: %s (try `help`)\n", cmd.c_str());
}

// --- main ------------------------------------------------------------------

void setup() {
    Serial.begin(115200);
    delay(50);
    Serial.println();
    Serial.println("=== garra chute diagnostic firmware ===");

    pinMode(PIN_SOLENOID, OUTPUT);
    digitalWrite(PIN_SOLENOID, LOW);   // safe default

    sensors::install();
    fdxb::install();

    Serial.println("ready. type `help` for commands.");
}

void loop() {
    while (Serial.available()) {
        char c = (char)Serial.read();
        // Treat CR or LF as line-end. Picocom and most terminals send only
        // \r on Enter; accepting both keeps the firmware terminal-agnostic.
        if (c == '\r' || c == '\n') {
            String line = rx_buf;
            rx_buf = "";
            if (line.length() > 0) handle_line(line);
        } else if (rx_buf.length() < 256) {
            rx_buf += c;
        }
    }
}
