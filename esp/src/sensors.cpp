#include "sensors.h"
#include "pins.h"
#include <Arduino.h>

namespace sensors {

static volatile bool entry_flag = false;
static volatile bool exit_flag  = false;

// Software debounce inside the ISR: ignore edges within 5 ms of the last.
// The beam-broken event is a single edge, so debouncing here is cheap and
// avoids latching on contact bounce / EMI from the solenoid coil.
static constexpr uint32_t DEBOUNCE_US = 5000;
static volatile uint32_t last_entry_us = 0;
static volatile uint32_t last_exit_us  = 0;

static void IRAM_ATTR on_entry() {
    uint32_t now = micros();
    if (now - last_entry_us < DEBOUNCE_US) return;
    last_entry_us = now;
    entry_flag = true;
}

static void IRAM_ATTR on_exit() {
    uint32_t now = micros();
    if (now - last_exit_us < DEBOUNCE_US) return;
    last_exit_us = now;
    exit_flag = true;
}

void install() {
    pinMode(PIN_ENTRY_BB, INPUT_PULLUP);
    pinMode(PIN_EXIT_BB,  INPUT_PULLUP);
    attachInterrupt(digitalPinToInterrupt(PIN_ENTRY_BB), on_entry, FALLING);
    attachInterrupt(digitalPinToInterrupt(PIN_EXIT_BB),  on_exit,  FALLING);
}

bool take_entry() {
    noInterrupts();
    bool v = entry_flag;
    entry_flag = false;
    interrupts();
    return v;
}

bool take_exit() {
    noInterrupts();
    bool v = exit_flag;
    exit_flag = false;
    interrupts();
    return v;
}

}  // namespace sensors
