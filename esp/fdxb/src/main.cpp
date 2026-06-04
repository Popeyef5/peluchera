#include <Arduino.h>
#include <FdxB.h>

#define RFID_INPUT_PIN   18   // D18 / GPIO18
#define CARRIER_PWM_PIN  4    // D4  / GPIO4

#define CARRIER_FREQ     134200
#define PWM_RESOLUTION   8
#define PWM_CHANNEL      0

FdxB::Parser parser;

void IRAM_ATTR pinChangeInterrupt() {
  parser.putStateChange();
}

void setupPwmSquareWave() {
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  // Arduino-ESP32 core v3.x
  ledcAttachChannel(CARRIER_PWM_PIN, CARRIER_FREQ, PWM_RESOLUTION, PWM_CHANNEL);
  ledcWrite(CARRIER_PWM_PIN, 128); // 50% duty for 8-bit resolution
#else
  // Arduino-ESP32 core v2.x, common with PlatformIO
  ledcSetup(PWM_CHANNEL, CARRIER_FREQ, PWM_RESOLUTION);
  ledcAttachPin(CARRIER_PWM_PIN, PWM_CHANNEL);
  ledcWrite(PWM_CHANNEL, 128); // 50% duty for 8-bit resolution
#endif
}

void setupPinChangeInterrupt() {
  pinMode(RFID_INPUT_PIN, INPUT);

  attachInterrupt(
    digitalPinToInterrupt(RFID_INPUT_PIN),
    pinChangeInterrupt,
    CHANGE
  );
}

void setup() {
  Serial.begin(115200);
  delay(1000);

  setupPwmSquareWave();
  setupPinChangeInterrupt();

  Serial.println("Ready!");
}

void loop() {
  FdxB::tag_t tag;

  if (!parser.getTag(&tag)) {
    return;
  }

  Serial.println("Success!");

  char buffer[32];

  uint32_t idMsd = tag.id / 1000000000;
  uint32_t idLsd = tag.id % 1000000000;

  sprintf(buffer, "%03u%03lu%09lu", (uint16_t)tag.country, idMsd, idLsd);
  Serial.println(buffer);

  if (tag.flags & FdxB::Flag::APPLICATION) {
    Serial.print("This tag is intended for animal use ");
  } else {
    Serial.print("This tag is NOT intended for animal use ");
  }

  if (tag.flags & FdxB::Flag::DATA) {
    Serial.println("and contains extra data.");
    sprintf(buffer, "0x%02X%02X%02X", tag.data[0], tag.data[1], tag.data[2]);
    Serial.println(buffer);
  } else {
    Serial.println("and does not contain extra data.");
  }

  Serial.println("========================================");
}