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

// Latch the chute as blocked WITHOUT emitting anything. The caller emits the
// single verdict for this arm, which reports the outcome (and the tag, if we
// managed to read one) — emitting a fault here as well would put two messages
// on the wire for one arm.
// Empty the FDX-B reader's one-slot tag latch.
//
// The parser task runs continuously with the carrier always on, so that slot
// holds whatever tag last passed the antenna whether or not the chute is
// armed: the previous turn's ball, one resting in the chute after a jam, a tag
// in the operator's hand. Nothing else clears it — only a successful
// try_read_once does. Leave it and IDENTIFYING returns that stale UID the
// instant the entry beam breaks, the solenoid fires, the exit beam clears, and
// we report a textbook `ok` carrying the WRONG ball_serial. The read then
// clears the slot, the current ball lands in it, and the lag repeats forever.
static void drain_tag_latch() {
    char dummy[17];
    (void)fdxb::try_read_once(dummy);
}

static void latch_blocked(const char *kind) {
    s_state = State::BLOCKED;
    s_fault = kind;
    solenoid_release();   // never leave the chute open on fault
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
        case proto::Inbound::PING: {
            // Answer with a state snapshot, not just liveness — see emit_pong.
            char last[17];
            const bool have_last = fdxb::last_tag_hex(last);
            proto::emit_pong(m.seq, state_name(), fdxb::tag_pending(),
                             have_last ? last : nullptr);
            return;
        }

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
            // Drop the previous arm's tag — a verdict must never report a
            // stale ball_serial from an earlier turn. Both halves matter: our
            // own copy AND the reader's latch behind it, which ENROLL has
            // always drained and ARM used to leave alone.
            s_pending_uid[0] = '\0';
            drain_tag_latch();
            s_state = State::AWAITING_FALL;
            s_deadline_ms = millis() + T_FALL_MS;
            return;

        case proto::Inbound::ENROLL:
            // Only enterable from IDLE — refuse silently mid-turn / mid-fault.
            // Central gates this against current_player/queue, so reaching
            // here mid-turn would already be a backend bug.
            if (s_state != State::IDLE) return;
            // Drain any stale tag the reader may have parsed before now.
            drain_tag_latch();
            s_state = State::ENROLL;
            s_deadline_ms = millis() + (m.timeout_ms ? m.timeout_ms : 10000U);
            return;

        case proto::Inbound::RESET:
            // Operator override: put the chute back in a state we know.
            //
            // fault_clear only lifts the BLOCKED latch, so it cannot recover a
            // chute stuck part-way through a sequence, and it never touches the
            // hidden state — the beam flags and the reader's tag latch — that
            // lets a healthy-looking chute report the wrong thing. Accepted
            // from ANY state, that being the point.
            //
            // Deliberately silent: an arm in flight is abandoned rather than
            // answered, because a verdict here would belong to no turn. The Pi
            // empties its own queues alongside this and mirrors the cleared
            // latch, so both ends land on IDLE together.
            solenoid_release();
            s_state = State::IDLE;
            s_fault = nullptr;
            s_pending_uid[0] = '\0';
            (void)sensors::take_entry();
            (void)sensors::take_exit();
            drain_tag_latch();
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
                // Nothing came down the chute: an ordinary loss, chute healthy.
                s_state = State::IDLE;
                proto::emit_verdict(proto::VERDICT_NO_FALL, nullptr);
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
                // Something fell but we never read a tag — we cannot say what
                // they won, and the chute needs a human.
                latch_blocked(proto::FAULT_RFID_FAILED);
                proto::emit_verdict(proto::VERDICT_NO_READ, nullptr);
            }
            return;
        }

        case State::CLEARING:
            if (sensors::take_exit()) {
                solenoid_release();
                s_state = State::IDLE;
                proto::emit_verdict(proto::VERDICT_OK, s_pending_uid);
                return;
            }
            if ((int32_t)(now - s_deadline_ms) >= 0) {
                // Jammed on the way out — but we DID read the tag, so report it.
                // The queue has to stop, yet the player still learns what they won.
                latch_blocked(proto::FAULT_EXIT_TIMEOUT);
                proto::emit_verdict(proto::VERDICT_NO_EXIT, s_pending_uid);
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

const char *state_name() {
    switch (s_state) {
        case State::IDLE:          return "idle";
        case State::AWAITING_FALL: return "awaiting_fall";
        case State::IDENTIFYING:   return "identifying";
        case State::CLEARING:      return "clearing";
        case State::ENROLL:        return "enroll";
        case State::BLOCKED:       return "blocked";
    }
    return "unknown";
}

}  // namespace fsm
