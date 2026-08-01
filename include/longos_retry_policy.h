#pragma once

#include <stdint.h>

namespace longos {

struct PeriodicRetryTimer {
  bool initialized = false;
  uint32_t referenceMs = 0;
  uint8_t consecutiveFailures = 0;

  static uint32_t elapsedMs(uint32_t now, uint32_t reference) {
    return static_cast<uint32_t>(now - reference);
  }

  uint32_t retryDelayMs(uint32_t initialRetryMs, uint32_t maxRetryMs) const {
    if (maxRetryMs == 0 || initialRetryMs >= maxRetryMs) {
      return maxRetryMs;
    }

    uint32_t delayMs = initialRetryMs;
    uint8_t remainingDoublings = consecutiveFailures > 0 ? consecutiveFailures - 1 : 0;
    while (remainingDoublings > 0 && delayMs < maxRetryMs) {
      if (delayMs > maxRetryMs - delayMs) {
        return maxRetryMs;
      }
      delayMs *= 2;
      remainingDoublings -= 1;
    }
    return delayMs > maxRetryMs ? maxRetryMs : delayMs;
  }

  bool due(
    uint32_t now,
    bool force,
    uint32_t successIntervalMs,
    uint32_t initialRetryMs,
    uint32_t maxRetryMs
  ) const {
    if (force || !initialized) {
      return true;
    }

    uint32_t intervalMs = consecutiveFailures == 0
      ? successIntervalMs
      : retryDelayMs(initialRetryMs, maxRetryMs);
    return elapsedMs(now, referenceMs) >= intervalMs;
  }

  void defer(uint32_t now) {
    initialized = true;
    referenceMs = now;
    consecutiveFailures = 0;
  }

  void recordResult(uint32_t now, bool success) {
    initialized = true;
    referenceMs = now;
    if (success) {
      consecutiveFailures = 0;
    } else if (consecutiveFailures < UINT8_MAX) {
      consecutiveFailures += 1;
    }
  }
};

}  // namespace longos
