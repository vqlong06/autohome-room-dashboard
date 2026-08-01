#include <assert.h>
#include <stdint.h>
#include <stdio.h>

#include "longos_retry_policy.h"

namespace {

constexpr uint32_t kNormalIntervalMs = 10U * 60U * 1000U;
constexpr uint32_t kInitialRetryMs = 30U * 1000U;
constexpr uint32_t kMaxRetryMs = 5U * 60U * 1000U;

bool due(const longos::PeriodicRetryTimer &timer, uint32_t now, bool force = false) {
  return timer.due(now, force, kNormalIntervalMs, kInitialRetryMs, kMaxRetryMs);
}

}  // namespace

int main() {
  longos::PeriodicRetryTimer timer;
  assert(due(timer, 0));
  assert(due(timer, 0, true));

  timer.recordResult(0, true);
  assert(!due(timer, kNormalIntervalMs - 1));
  assert(due(timer, kNormalIntervalMs));
  assert(due(timer, 1, true));

  timer.recordResult(kNormalIntervalMs, false);
  assert(!due(timer, kNormalIntervalMs + kInitialRetryMs - 1));
  assert(due(timer, kNormalIntervalMs + kInitialRetryMs));

  timer.recordResult(kNormalIntervalMs + kInitialRetryMs, false);
  assert(!due(timer, kNormalIntervalMs + kInitialRetryMs + 2 * kInitialRetryMs - 1));
  assert(due(timer, kNormalIntervalMs + kInitialRetryMs + 2 * kInitialRetryMs));

  longos::PeriodicRetryTimer backoff;
  const uint32_t expectedBackoffMs[] = {30000U, 60000U, 120000U, 240000U, 300000U, 300000U};
  uint32_t failureAtMs = 1000U;
  for (uint32_t expectedDelayMs : expectedBackoffMs) {
    backoff.recordResult(failureAtMs, false);
    assert(backoff.retryDelayMs(kInitialRetryMs, kMaxRetryMs) == expectedDelayMs);
    assert(!due(backoff, failureAtMs + expectedDelayMs - 1));
    assert(due(backoff, failureAtMs + expectedDelayMs));
    failureAtMs += 1000000U;
  }

  timer.recordResult(1234, true);
  assert(timer.consecutiveFailures == 0);
  assert(!due(timer, 1234 + kNormalIntervalMs - 1));
  assert(due(timer, 1234 + kNormalIntervalMs));

  backoff.defer(7777U);
  assert(backoff.consecutiveFailures == 0);
  assert(!due(backoff, 7777U + kNormalIntervalMs - 1));
  assert(due(backoff, 7777U + kNormalIntervalMs));

  timer.defer(0xFFFFFFF0U);
  assert(!timer.due(0x0000000FU, false, 32U, 1U, 16U));
  assert(timer.due(0x00000010U, false, 32U, 1U, 16U));

  timer.recordResult(0xFFFFFFF0U, false);
  assert(!timer.due(0x0000000FU, false, 100U, 32U, 64U));
  assert(timer.due(0x00000010U, false, 100U, 32U, 64U));

  puts("LongOS firmware retry policy tests: OK");
  return 0;
}
