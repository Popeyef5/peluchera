// Break-beam edge detection.
//
// Both beams are wired with input pull-up; beam-broken pulls the line low,
// so we trigger on FALLING. The ISR sets a volatile flag the main loop
// consumes — minimal work in interrupt context.
#pragma once

#include <stdint.h>

namespace sensors {

void install();

// Returns true if an entry/exit edge was observed since the last call,
// and clears the flag atomically.
bool take_entry();
bool take_exit();

}  // namespace sensors
