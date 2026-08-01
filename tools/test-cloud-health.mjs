import assert from 'node:assert/strict';

import {
  DEFAULT_FUTURE_TOLERANCE_MS,
  DEFAULT_HISTORY_BOOT_TOLERANCE_MS,
  DEFAULT_HISTORY_CADENCE_WINDOW_MS,
  DEFAULT_HISTORY_MAX_ROWS,
  DEFAULT_HISTORY_MAX_AGE_MS,
  DEFAULT_HISTORY_MIN_GAP_MS,
  DEFAULT_HISTORY_MIN_SAMPLES,
  DEFAULT_LATEST_MAX_AGE_MS,
  validateCloudHealth,
  validateHistoryCadence
} from './lib/cloud-health.mjs';

const roomId = 'longos-room-01';
const nowMs = Date.parse('2026-08-02T12:00:00.000Z');

const validLatest = {
  room_id: roomId,
  updated_at: new Date(nowMs - 2 * 60 * 1000).toISOString(),
  app_version: 'longos-sensor-2026-08-01.3',
  device_online: true,
  wifi_connected: true,
  sensor_online: true
};

const validHistory = {
  room_id: roomId,
  recorded_at: new Date(nowMs - 15 * 60 * 1000).toISOString(),
  app_version: 'longos-sensor-2026-08-01.3',
  sensor_online: true
};

const validate = (overrides = {}) => validateCloudHealth({
  roomId,
  latest: { ...validLatest },
  history: { ...validHistory },
  nowMs,
  ...overrides
});

assert.equal(DEFAULT_LATEST_MAX_AGE_MS, 3 * 60 * 1000);
assert.equal(DEFAULT_HISTORY_MAX_AGE_MS, 20 * 60 * 1000);
assert.equal(DEFAULT_FUTURE_TOLERANCE_MS, 60 * 1000);
assert.equal(DEFAULT_HISTORY_CADENCE_WINDOW_MS, 40 * 60 * 1000);
assert.equal(DEFAULT_HISTORY_MIN_GAP_MS, 9 * 60 * 1000);
assert.equal(DEFAULT_HISTORY_MIN_SAMPLES, 3);
assert.equal(DEFAULT_HISTORY_MAX_ROWS, 100);
assert.equal(DEFAULT_HISTORY_BOOT_TOLERANCE_MS, 30 * 1000);

assert.deepEqual(validate(), {
  latestAgeMs: 2 * 60 * 1000,
  historyAgeMs: 15 * 60 * 1000,
  appVersion: 'longos-sensor-2026-08-01.3'
});

assert.deepEqual(validate({ expectedAppVersion: 'longos-sensor-2026-08-01.3' }), {
  latestAgeMs: 2 * 60 * 1000,
  historyAgeMs: 15 * 60 * 1000,
  appVersion: 'longos-sensor-2026-08-01.3'
});
assert.throws(
  () => validate({ expectedAppVersion: 'longos-sensor-2026-08-02.1' }),
  /latest\.app_version does not match expectedAppVersion/
);
assert.throws(
  () => validate({
    latest: { ...validLatest, app_version: 'longos-sensor-2026-08-02.1' },
    expectedAppVersion: 'longos-sensor-2026-08-02.1'
  }),
  /history\.app_version does not match expectedAppVersion/
);
assert.throws(
  () => validate({ expectedAppVersion: 'not-longos' }),
  /expectedAppVersion must use the longos-sensor- format/
);

assert.throws(
  () => validate({
    latest: {
      ...validLatest,
      updated_at: new Date(nowMs - DEFAULT_LATEST_MAX_AGE_MS - 1).toISOString()
    }
  }),
  /latest\.updated_at is stale/
);

assert.throws(
  () => validate({
    history: {
      ...validHistory,
      recorded_at: new Date(nowMs - DEFAULT_HISTORY_MAX_AGE_MS - 1).toISOString()
    }
  }),
  /history\.recorded_at is stale/
);

assert.throws(
  () => validate({
    latest: {
      ...validLatest,
      updated_at: new Date(nowMs + DEFAULT_FUTURE_TOLERANCE_MS + 1).toISOString()
    }
  }),
  /latest\.updated_at is too far in the future/
);

assert.throws(
  () => validate({ latest: { ...validLatest, room_id: 'wrong-room' } }),
  /latest\.room_id does not match/
);
assert.throws(
  () => validate({ history: { ...validHistory, room_id: 'wrong-room' } }),
  /history\.room_id does not match/
);

for (const field of ['device_online', 'wifi_connected', 'sensor_online']) {
  assert.throws(
    () => validate({ latest: { ...validLatest, [field]: false } }),
    new RegExp(`latest\\.${field} must be true`)
  );
}
assert.throws(
  () => validate({ history: { ...validHistory, sensor_online: false } }),
  /history\.sensor_online must be true/
);

assert.throws(
  () => validate({ latest: { ...validLatest, app_version: 'autohome-sensor-1' } }),
  /latest\.app_version must use the longos-sensor- format/
);
assert.throws(
  () => validate({ history: { ...validHistory, app_version: 'longos-sensor-' } }),
  /history\.app_version must use the longos-sensor- format/
);

assert.throws(
  () => validate({ latest: { ...validLatest, updated_at: 'not-a-timestamp' } }),
  /latest\.updated_at must be a valid timestamp/
);
assert.throws(
  () => validate({ history: { ...validHistory, recorded_at: '' } }),
  /history\.recorded_at must be a valid timestamp/
);

assert.deepEqual(
  validate({
    latest: {
      ...validLatest,
      updated_at: new Date(nowMs + DEFAULT_FUTURE_TOLERANCE_MS).toISOString()
    }
  }),
  {
    latestAgeMs: 0,
    historyAgeMs: 15 * 60 * 1000,
    appVersion: 'longos-sensor-2026-08-01.3'
  }
);

const cadenceVersion = 'longos-sensor-2026-08-02.1';
const cadenceBootEpochMs = nowMs - 60 * 60 * 1000;
const cadenceRow = (ageMs, overrides = {}) => ({
  room_id: roomId,
  recorded_at: new Date(nowMs - ageMs).toISOString(),
  app_version: cadenceVersion,
  sensor_online: true,
  uptime_ms: nowMs - ageMs - cadenceBootEpochMs,
  ...overrides
});
const validCadenceRows = [
  cadenceRow(1 * 60 * 1000),
  cadenceRow(11 * 60 * 1000),
  cadenceRow(21 * 60 * 1000)
];
const cadence = (overrides = {}) => validateHistoryCadence({
  roomId,
  rows: validCadenceRows.map((row) => ({ ...row })),
  expectedAppVersion: cadenceVersion,
  expectedBootEpochMs: cadenceBootEpochMs,
  nowMs,
  ...overrides
});

assert.deepEqual(cadence(), {
  sampleCount: 3,
  newestAgeMs: 1 * 60 * 1000,
  observedSpanMs: 20 * 60 * 1000,
  minimumGapMs: 10 * 60 * 1000,
  maximumBootEpochDeviationMs: 0,
  ignoredPreviousBootSamples: 0,
  appVersion: cadenceVersion
});
assert.deepEqual(cadence({ rows: [...validCadenceRows].reverse() }), cadence());
assert.equal(cadence({
  rows: [cadenceRow(0), cadenceRow(9 * 60 * 1000), cadenceRow(18 * 60 * 1000)]
}).minimumGapMs, 9 * 60 * 1000);
assert.equal(cadence({
  rows: [cadenceRow(0), cadenceRow(20 * 60 * 1000), cadenceRow(40 * 60 * 1000)]
}).observedSpanMs, 40 * 60 * 1000);

for (const rows of [
  [cadenceRow(0), cadenceRow(9 * 60 * 1000 - 1), cadenceRow(20 * 60 * 1000)],
  [cadenceRow(0), cadenceRow(30 * 1000), cadenceRow(10 * 60 * 1000)],
  [cadenceRow(0), cadenceRow(0), cadenceRow(10 * 60 * 1000)]
]) {
  assert.throws(() => cadence({ rows }), /history cadence gap is below/);
}
assert.throws(() => cadence({ rows: validCadenceRows.slice(0, 2) }), /requires at least 3 same-boot samples/);
assert.throws(
  () => cadence({ rows: [cadenceRow(0), cadenceRow(10 * 60 * 1000), cadenceRow(40 * 60 * 1000 + 1)] }),
  /recorded_at is stale/
);
assert.throws(
  () => cadence({ rows: [cadenceRow(-DEFAULT_FUTURE_TOLERANCE_MS - 1), cadenceRow(10 * 60 * 1000), cadenceRow(20 * 60 * 1000)] }),
  /recorded_at is too far in the future/
);
assert.throws(
  () => cadence({ rows: [cadenceRow(0, { room_id: 'wrong-room' }), ...validCadenceRows.slice(1)] }),
  /room_id does not match/
);
assert.throws(
  () => cadence({ rows: [cadenceRow(0, { app_version: 'longos-sensor-legacy' }), ...validCadenceRows.slice(1)] }),
  /app_version does not match expectedAppVersion/
);
assert.throws(
  () => cadence({ rows: [cadenceRow(0, { sensor_online: false }), ...validCadenceRows.slice(1)] }),
  /sensor_online must be true/
);
assert.throws(
  () => cadence({ rows: [cadenceRow(0, { uptime_ms: 60 * 1000 }), ...validCadenceRows.slice(1)] }),
  /different device boot after the current boot started/
);
assert.throws(
  () => cadence({ rows: [cadenceRow(0, { uptime_ms: '3600000' }), ...validCadenceRows.slice(1)] }),
  /uptime_ms must be a non-negative safe integer/
);
assert.throws(
  () => cadence({ rows: [cadenceRow(0, { recorded_at: 'invalid' }), ...validCadenceRows.slice(1)] }),
  /recorded_at must be a valid timestamp/
);
assert.throws(
  () => cadence({ rows: Array.from({ length: DEFAULT_HISTORY_MAX_ROWS }, (_, index) => cadenceRow(index * 10 * 60 * 1000)) }),
  /reached maxRows and may be truncated/
);
assert.throws(() => cadence({ rows: null }), /rows must be an array/);
assert.throws(() => cadence({ maxRows: 3 }), /maxRows must be greater than minSamples/);
assert.throws(
  () => cadence({ windowMs: 17 * 60 * 1000 }),
  /windowMs cannot contain minSamples/
);

const recentBootEpochMs = nowMs - 30 * 60 * 1000;
const recentBootRow = (ageMs, bootEpochMs = recentBootEpochMs, overrides = {}) => {
  const timestampMs = nowMs - ageMs;
  return cadenceRow(ageMs, {
    uptime_ms: timestampMs - bootEpochMs,
    ...overrides
  });
};
const recentCurrentRows = [
  recentBootRow(1 * 60 * 1000),
  recentBootRow(11 * 60 * 1000),
  recentBootRow(21 * 60 * 1000)
];
const previousBootRow = recentBootRow(
  30 * 60 * 1000 + 10 * 1000,
  nowMs - 90 * 60 * 1000,
  { sensor_online: false }
);
const mixedBootProof = cadence({
  expectedBootEpochMs: recentBootEpochMs,
  rows: [...recentCurrentRows, previousBootRow]
});
assert.equal(mixedBootProof.sampleCount, 3);
assert.equal(mixedBootProof.ignoredPreviousBootSamples, 1);
assert.throws(
  () => cadence({
    expectedBootEpochMs: recentBootEpochMs,
    rows: [...recentCurrentRows.slice(0, 2), previousBootRow]
  }),
  /requires at least 3 same-boot samples/
);
assert.equal(cadence({
  expectedBootEpochMs: recentBootEpochMs,
  rows: [
    ...recentCurrentRows,
    previousBootRow,
    recentBootRow(30 * 60 * 1000 + 11 * 1000, nowMs - 90 * 60 * 1000)
  ]
}).sampleCount, 3, 'short gaps from the previous boot must not affect the current boot proof');

console.log('LongOS cloud health validator tests: OK');
