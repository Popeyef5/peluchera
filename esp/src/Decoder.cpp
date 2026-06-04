#include "FdxB.h"

FdxB::Decoder::Decoder(uint32_t carrierHz, uint8_t bufferSize) {
  // RFID tags use the carrier frequency as a clock signal.
  // That causes the data rate to be a function of the carrier frequency.
  // Determine the period of one clock cycle in milliseconds.
  float carrierPeriod = 1 / (carrierHz / 1000000.0);
  mBaud = carrierPeriod * 16;
  mFifo = new Fifo(bufferSize);
}

FdxB::Decoder::~Decoder() {
  delete mFifo;
}

void FdxB::Decoder::putStateChange(uint16_t time) {
  // This is expected to be called repeated from a pin change interrupt.
  // We'll do some minimal processing here to reduce
  // the amount of data that needs to be buffered.

  // Determine the time in microseconds since the previous interrupt.
  if (time < mMicros)
    // The microseconds counter has overflowed so the math is different.
    mMicros = time + (~mMicros);
  else
    mMicros = time - mMicros;

  if (mMicros > (uint8_t) -1)
    // The time between interrupts is greater than an unsigned 8-bit int.
    // It's probably garbage data or RF noise.
    // We'll let the parser deal with it later.
    mFifo->push((uint8_t) -1);
  else
    mFifo->push((uint8_t) mMicros);

  mMicros = time;
}

bool FdxB::Decoder::getBit(uint8_t *value) {
  getDelta(value);
  uint8_t periods = (uint8_t)round((float)*value / (float)mBaud);

  switch (periods) {
    case 1:
      getDelta(value);
      if (round(*value / mBaud) == 1)
        *value = 0;
      else
        return false;
      break;
    case 2:
      *value = 1;
      break;
    default:
      return false;
      break;
  }
  return true;
}

void FdxB::Decoder::getDelta(uint8_t *value) {
  while (mFifo->empty())
    // Yield to the FreeRTOS scheduler while the FIFO is empty. The original
    // delayMicroseconds() was a busy-wait that hogs Core 0 and starves
    // IDLE0 — the task watchdog trips after ~5s with the parser pinned to
    // its own core. vTaskDelay(1) waits one tick (~1ms), which is plenty:
    // during a tag burst the FIFO is never empty (edges arrive every ~120µs
    // and the ISR pushes faster than we pop). The 1ms latency only matters
    // before a burst starts — we lose the first few bits but the parser
    // auto-resyncs via findHeader().
    vTaskDelay(1);
  mFifo->pop(value);
}
