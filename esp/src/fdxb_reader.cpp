#include "fdxb_reader.h"

#include <Arduino.h>
#include <FdxB.h>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>
#include <freertos/task.h>

#include "pins.h"

namespace fdxb {

static constexpr uint32_t CARRIER_HZ        = 134200;   // ISO 11784/11785
static constexpr uint8_t  PWM_RESOLUTION    = 8;
static constexpr uint8_t  PWM_CHANNEL       = 0;        // ledc ch0; nothing else uses it
static constexpr UBaseType_t PARSER_TASK_PRIO = 1;
static constexpr uint32_t PARSER_TASK_STACK  = 4096;
static constexpr BaseType_t PARSER_TASK_CORE = 0;       // Arduino loop runs on Core 1

static FdxB::Parser     *s_parser = nullptr;
static SemaphoreHandle_t s_tag_mutex = nullptr;
static FdxB::tag_t       s_latest_tag = {};
static volatile bool     s_tag_pending = false;     // set by task, cleared by reader
static volatile bool     s_carrier_on = false;
static volatile uint32_t s_isr_edges = 0;
static char              s_last_tag_hex[17] = {0};  // sticky copy for diagnostics

// --- helpers --------------------------------------------------------------

static void tag_to_hex(const FdxB::tag_t &tag, char *out_hex) {
    // The first 8 bytes of the packed struct cover country (10b) + id (38b)
    // + flags (16b) — uniquely identifies the tag. Same hex shape the
    // PN5180 stack used to emit, so the Pi protocol doesn't change.
    const uint8_t *bytes = reinterpret_cast<const uint8_t *>(&tag);
    static const char H[] = "0123456789ABCDEF";
    for (int i = 0; i < 8; i++) {
        out_hex[2 * i]     = H[(bytes[i] >> 4) & 0xF];
        out_hex[2 * i + 1] = H[ bytes[i]       & 0xF];
    }
    out_hex[16] = '\0';
}

static void IRAM_ATTR pin_change_isr() {
    s_isr_edges++;
    if (s_parser) s_parser->putStateChange();
}

static void parser_task(void *) {
    FdxB::tag_t tag;
    while (true) {
        // Blocks until a valid tag with good CRC arrives. By design — that's
        // why it lives on its own task. When a tag lands, hand it to the
        // main loop through the mutex and immediately loop back to keep
        // listening (next tag overwrites previous if main hasn't consumed).
        if (s_parser->getTag(&tag)) {
            xSemaphoreTake(s_tag_mutex, portMAX_DELAY);
            s_latest_tag = tag;
            s_tag_pending = true;
            tag_to_hex(tag, s_last_tag_hex);
            xSemaphoreGive(s_tag_mutex);
        }
        // getTag returned false on a CRC or framing failure; loop and resync.
        // Tiny yield so the watchdog stays happy on long quiet periods.
        vTaskDelay(1);
    }
}

// --- public API -----------------------------------------------------------

void install() {
    if (s_parser) return;   // idempotent

    s_parser = new FdxB::Parser(CARRIER_HZ);
    s_tag_mutex = xSemaphoreCreateMutex();

    // Carrier: 134.2 kHz square wave, 50% duty.
#if ESP_ARDUINO_VERSION_MAJOR >= 3
    ledcAttachChannel(PIN_FDXB_PWM, CARRIER_HZ, PWM_RESOLUTION, PWM_CHANNEL);
    ledcWrite(PIN_FDXB_PWM, 128);
#else
    ledcSetup(PWM_CHANNEL, CARRIER_HZ, PWM_RESOLUTION);
    ledcAttachPin(PIN_FDXB_PWM, PWM_CHANNEL);
    ledcWrite(PWM_CHANNEL, 128);
#endif
    s_carrier_on = true;

    // Demodulated tag signal in on PIN_FDXB_INPUT. Pin-change ISR feeds the
    // parser's microsecond ring buffer.
    pinMode(PIN_FDXB_INPUT, INPUT);
    attachInterrupt(digitalPinToInterrupt(PIN_FDXB_INPUT),
                    pin_change_isr, CHANGE);

    xTaskCreatePinnedToCore(
        parser_task, "fdxb_parser",
        PARSER_TASK_STACK, nullptr, PARSER_TASK_PRIO,
        nullptr, PARSER_TASK_CORE);
}

bool try_read_once(char *out_uid_hex) {
    if (!s_tag_mutex) return false;
    bool got = false;
    xSemaphoreTake(s_tag_mutex, portMAX_DELAY);
    if (s_tag_pending) {
        tag_to_hex(s_latest_tag, out_uid_hex);
        s_tag_pending = false;
        got = true;
    }
    xSemaphoreGive(s_tag_mutex);
    return got;
}

void carrier_on() {
#if ESP_ARDUINO_VERSION_MAJOR >= 3
    ledcWrite(PIN_FDXB_PWM, 128);
#else
    ledcWrite(PWM_CHANNEL, 128);
#endif
    s_carrier_on = true;
}

void carrier_off() {
#if ESP_ARDUINO_VERSION_MAJOR >= 3
    ledcWrite(PIN_FDXB_PWM, 0);
#else
    ledcWrite(PWM_CHANNEL, 0);
#endif
    s_carrier_on = false;
}

bool carrier_is_on() { return s_carrier_on; }

uint32_t isr_edge_count() { return s_isr_edges; }

bool last_tag_hex(char *out) {
    if (s_last_tag_hex[0] == '\0') return false;
    memcpy(out, s_last_tag_hex, sizeof(s_last_tag_hex));
    return true;
}

}  // namespace fdxb
