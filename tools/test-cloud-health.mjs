import assert from 'node:assert/strict';

import {
  DEFAULT_FUTURE_TOLERANCE_MS,
  DEFAULT_HISTORY_MAX_AGE_MS,
  DEFAULT_LATEST_MAX_AGE_MS,
  validateCloudHealth
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

assert.deepEqual(validate(), {
  latestAgeMs: 2 * 60 * 1000,
  historyAgeMs: 15 * 60 * 1000,
  appVersion: 'longos-sensor-2026-08-01.3'
});

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

console.log('LongOS cloud health validator tests: OK');
