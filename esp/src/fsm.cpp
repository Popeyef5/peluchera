#include "fsm.h"
#include "fdxb_reader.h"
#include "pins.h"
#include "sensors.h"

#include <Arduino.h>

namespace fsm {

// Timers (ms). Match the legacy Pi-side constants T_FALL/T_ID/T_EXIT.
static constexpr uint32_t T_FALL_MS = 3000;
static constexpr uint32_t T_ID_MS   = 2000;
static constexpr uint32_t T_EXIT_MS = 2000;

static State       s_state = State::IDLE;
static const char *s_fault = nullptr;
static uint32_t    s_deadline_ms = 0;
static char        s_pending_uid[17] = {0};  // captured in IDENTIFYING, emitted on clean exit

static void solenoid_release() { digitalWrite(PIN_SOLENOID, LOW);  }
static void solenoid_engage()  { digitalWrite(PIN_SOLENOID, HIGH); }

static void enter_blocked(const char *kind) {
    s_state = State::BLOCKED;
    s_fault = kind;
    solenoid_release();   // never leave the chute open on fault
    proto::emit_fault(kind, nullptr);
}

void install() {
    pinMode(PIN_SOLENOID, OUTPUT);
    solenoid_release();
    s_state = State::IDLE;
    s_fault = nullptr;
    // Drain any stale ISR flags from boot.
    (void)sensors::take_entry();
    (void)sensors::take_exit();
}

void on_inbound(const proto::Parsed &m) {
    switch (m.kind) {
        case proto::Inbound::PING:
            proto::emit_pong(m.seq);
            return;

        case proto::Inbound::FAULT_CLEAR:
            if (s_state == State::BLOCKED) {
                s_fault = nullptr;
                s_state = State::IDLE;
            }
            return;

        case proto::Inbound::ARM:
            if (s_state == State::BLOCKED) {
                proto::emit_fault(s_fault, proto::REASON_STILL_BLOCKED);
                return;
            }
            if (s_state != State::IDLE) {
                // Stray arm during an active turn or enroll — drop, defense-in-depth.
                return;
            }
            // Clear any sensor edges that landed before arming.
            (void)sensors::take_entry();
            (void)sensors::take_exit();
            s_state = State::AWAITING_FALL;
            s_deadline_ms = millis() + T_FALL_MS;
            return;

        case proto::Inbound::ENROLL:
            // Only enterable from IDLE — refuse silently mid-turn / mid-fault.
            // Central gates this against current_player/queue, so reaching
            // here mid-turn would already be a backend bug.
            if (s_state != State::IDLE) return;
            // Drain any stale tag the reader may have parsed before now.
            {
                char dummy[17];
                (void)fdxb::try_read_once(dummy);
            }
            s_state = State::ENROLL;
            s_deadline_ms = millis() + (m.timeout_ms ? m.timeout_ms : 10000U);
            return;

        case proto::Inbound::UNKNOWN:
        default:
            return;
    }
}

void tick() {
    uint32_t now = millis();

    switch (s_state) {
        case State::IDLE:
        case State::BLOCKED:
            return;

        case State::AWAITING_FALL:
            if (sensors::take_entry()) {
                s_state = State::IDENTIFYING;
                s_deadline_ms = now + T_ID_MS;
                return;
            }
            if ((int32_t)(now - s_deadline_ms) >= 0) {
                s_state = State::IDLE;
                proto::emit_no_fall();
            }
            return;

        case State::IDENTIFYING: {
            char uid_hex[17];
            if (fdxb::try_read_once(uid_hex)) {
                memcpy(s_pending_uid, uid_hex, sizeof(s_pending_uid));
                solenoid_engage();
                s_state = State::CLEARING;
                s_deadline_ms = now + T_EXIT_MS;
                return;
            }
            if ((int32_t)(now - s_deadline_ms) >= 0) {
                enter_blocked(proto::FAULT_RFID_FAILED);
            }
            return;
        }

        case State::CLEARING:
            if (sensors::take_exit()) {
                solenoid_release();
                s_state = State::IDLE;
                proto::emit_prize_won(s_pending_uid);
                return;
            }
            if ((int32_t)(now - s_deadline_ms) >= 0) {
                solenoid_release();
                enter_blocked(proto::FAULT_EXIT_TIMEOUT);
            }
            return;

        case State::ENROLL: {
            char uid_hex[17];
            if (fdxb::try_read_once(uid_hex)) {
                s_state = State::IDLE;
                proto::emit_tag_scanned(uid_hex);
                return;
            }
            if ((int32_t)(now - s_deadline_ms) >= 0) {
                s_state = State::IDLE;
                proto::emit_enroll_timeout();
            }
            return;
        }
    }
}

State        state()         { return s_state; }
const char  *latched_fault() { return s_fault; }

}  // namespace fsm
