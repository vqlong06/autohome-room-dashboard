import assert from 'node:assert/strict';

import {
  certifiedDeviceVersion,
  createDeviceSoakCheckpoint,
  DeviceSoakTracker,
  runDeviceSoak,
  validateCheckpointContinuity,
  validateDeviceObservation,
  vietnamDayKey
} from './lib/device-soak.mjs';

const version = 'longos-sensor-2026-08-02.1';
const validHealth = { ok: true, appVersion: version };
const validReadings = {
  appVersion: version,
  deviceOnline: true,
  wifiConnected: true,
  wifiMode: 'STA',
  ip: '192.168.1.50',
  sensorOnline: true,
  uptimeMs: 1000,
  cloudEnabled: true,
  cloudUploadOk: true,
  cloudStatusCode: 201,
  cloudHistoryOk: true,
  cloudHistoryStatusCode: 201,
  stats: {
    timeSynced: true,
    todaySamples: 100,
    daysStored: 2
  }
};

const observe = (overrides = {}, requirements = {}) => validateDeviceObservation({
  health: { ...validHealth, ...(overrides.health || {}) },
  readings: {
    ...validReadings,
    ...(overrides.readings || {}),
    stats: { ...validReadings.stats, ...(overrides.stats || {}) }
  },
  expectedVersion: version,
  ...requirements
});

assert.equal(certifiedDeviceVersion(version), version);
assert.equal(certifiedDeviceVersion(version, version), version);
assert.throws(
  () => certifiedDeviceVersion(version, 'longos-sensor-2026-08-01.3'),
  /must match APP_VERSION/
);
assert.equal(vietnamDayKey(Date.parse('2026-08-01T16:59:59Z')), '2026-08-01');
assert.equal(vietnamDayKey(Date.parse('2026-08-01T17:00:00Z')), '2026-08-02');

assert.deepEqual(observe({}, {
  requireSensor: true,
  requireCloud: true,
  requireTimeSynced: true,
  requireWifiConnected: true
}), {
  appVersion: version,
  uptimeMs: 1000,
  todaySamples: 100,
  daysStored: 2,
  wifiConnected: true,
  wifiMode: 'STA',
  ip: '192.168.1.50',
  sensorOnline: true,
  timeSynced: true,
  cloudEnabled: true,
  cloudUploadOk: true,
  cloudHistoryOk: true,
  cloudStatusCode: 201,
  cloudHistoryStatusCode: 201
});

assert.throws(() => observe({ health: { appVersion: 'longos-sensor-old' } }), /health\.appVersion/);
assert.throws(() => observe({ readings: { appVersion: 'longos-sensor-old' } }), /readings\.appVersion/);
assert.throws(() => observe({ readings: { deviceOnline: false } }), /deviceOnline/);
assert.throws(() => observe({ readings: { sensorOnline: false } }, { requireSensor: true }), /sensorOnline/);
assert.throws(() => observe({ readings: { wifiConnected: 'true' } }), /wifiConnected must be a boolean/);
assert.throws(() => observe({ readings: { wifiMode: 'OFF' } }), /wifiMode/);
assert.throws(
  () => observe({ readings: { wifiConnected: false, wifiMode: 'AP', ip: '192.168.4.1' } }, { requireWifiConnected: true }),
  /station-only/
);
assert.throws(() => observe({}, { requireAccessPoint: true }), /fallback AP/);
assert.throws(
  () => observe({ readings: { wifiMode: 'AP+STA' } }, { requireWifiConnected: true }),
  /station-only/
);
assert.throws(() => observe({}, { requireAccessPoint: true, requireWifiConnected: true }), /mutually exclusive/);
assert.throws(() => observe({ stats: { timeSynced: false } }, { requireTimeSynced: true }), /timeSynced/);
assert.throws(() => observe({ readings: { cloudHistoryOk: false } }, { requireCloud: true }), /last reported cloud/);
assert.throws(() => observe({ readings: { cloudHistoryStatusCode: 401 } }, { requireCloud: true }), /status codes must be 2xx/);
assert.throws(() => observe({ readings: { cloudStatusCode: '201' } }), /status codes must be integers/);

const apSnapshot = observe({
  readings: { wifiConnected: false, wifiMode: 'AP', ip: '192.168.4.1' }
}, {
  requireAccessPoint: true,
  requireSensor: true,
  requireTimeSynced: true
});
assert.equal(apSnapshot.wifiMode, 'AP');

const checkpoint = createDeviceSoakCheckpoint({
  snapshot: observe(),
  wallClockMs: Date.parse('2026-08-01T00:00:00Z'),
  localDayKey: '2026-08-01'
});
assert.deepEqual(checkpoint, {
  schema: 'longos-device-soak-checkpoint-v1',
  appVersion: version,
  wallClockMs: Date.parse('2026-08-01T00:00:00Z'),
  localDayKey: '2026-08-01',
  uptimeMs: 1000,
  todaySamples: 100,
  daysStored: 2
});
assert.equal(/temperature|humidity|cloud|ip/i.test(JSON.stringify(checkpoint)), false);
assert.deepEqual(validateCheckpointContinuity({
  checkpoint,
  snapshot: { ...observe(), uptimeMs: 61000, todaySamples: 160 },
  wallClockMs: checkpoint.wallClockMs + 60000,
  localDayKey: '2026-08-01'
}), {
  wallDeltaMs: 60000,
  uptimeDeltaMs: 60000,
  sampleGrowth: 60,
  dayRollover: false
});
assert.throws(
  () => validateCheckpointContinuity({
    checkpoint,
    snapshot: { ...observe(), uptimeMs: 500 },
    wallClockMs: checkpoint.wallClockMs + 60000,
    localDayKey: '2026-08-01'
  }),
  /uptime did not continue/
);
assert.throws(
  () => validateCheckpointContinuity({
    checkpoint,
    snapshot: { ...observe(), appVersion: 'longos-sensor-2026-08-01.3', uptimeMs: 61000 },
    wallClockMs: checkpoint.wallClockMs + 60000,
    localDayKey: '2026-08-01'
  }),
  /firmware version/
);
assert.throws(
  () => validateCheckpointContinuity({
    checkpoint,
    snapshot: { ...observe(), uptimeMs: 61000, todaySamples: 1 },
    wallClockMs: checkpoint.wallClockMs + 60000,
    localDayKey: '2026-08-01'
  }),
  /sample count decreased/
);
assert.throws(
  () => validateCheckpointContinuity({
    checkpoint,
    snapshot: { ...observe(), uptimeMs: 10000 },
    wallClockMs: checkpoint.wallClockMs + 10 * 60 * 1000,
    localDayKey: '2026-08-01'
  }),
  /may have rebooted/
);
const midnightCheckpoint = createDeviceSoakCheckpoint({
  snapshot: { ...observe(), uptimeMs: 100000, todaySamples: 86400, daysStored: 21 },
  wallClockMs: Date.parse('2026-08-01T16:59:50Z'),
  localDayKey: '2026-08-01'
});
assert.equal(validateCheckpointContinuity({
  checkpoint: midnightCheckpoint,
  snapshot: { ...observe(), uptimeMs: 120000, todaySamples: 5, daysStored: 21 },
  wallClockMs: Date.parse('2026-08-01T17:00:10Z'),
  localDayKey: '2026-08-02'
}).dayRollover, true);
assert.throws(
  () => validateCheckpointContinuity({
    checkpoint,
    snapshot: { ...observe(), uptimeMs: 2 * 24 * 60 * 60 * 1000 + 1000 },
    wallClockMs: checkpoint.wallClockMs + 2 * 24 * 60 * 60 * 1000,
    localDayKey: '2026-08-03'
  }),
  /same or next local day/
);
assert.throws(
  () => validateCheckpointContinuity({
    checkpoint: { ...checkpoint, localDayKey: '2026-02-31' },
    snapshot: { ...observe(), uptimeMs: 61000 },
    wallClockMs: checkpoint.wallClockMs + 60000,
    localDayKey: '2026-08-01'
  }),
  /valid calendar day/
);

const dayOne = '2026-08-01';
const dayTwo = '2026-08-02';
const tracker = new DeviceSoakTracker({
  requireSampleGrowth: true,
  minimumObservedDurationMs: 20000
});
tracker.observe({ ...observe(), uptimeMs: 1000, todaySamples: 100 }, 10000, dayOne);
tracker.observe({ ...observe(), uptimeMs: 11000, todaySamples: 110 }, 20000, dayOne);
tracker.observe({ ...observe(), uptimeMs: 21000, todaySamples: 120 }, 30000, dayOne);
assert.deepEqual(tracker.finish(), {
  observationCount: 3,
  observedDurationMs: 20000,
  uptimeGrowthMs: 20000,
  sampleGrowth: 20,
  dayRollovers: 0
});
assert.deepEqual(tracker.finish(), tracker.finish(), 'finish must be idempotent');
assert.throws(() => tracker.observe({ ...observe(), uptimeMs: 31000 }, 40000, dayOne), /already finished/);

const reboot = new DeviceSoakTracker();
reboot.observe({ ...observe(), uptimeMs: 50000 }, 10000, dayOne);
assert.throws(() => reboot.observe({ ...observe(), uptimeMs: 1000 }, 20000, dayOne), /uptime must increase/);

const nearStalledUptime = new DeviceSoakTracker();
nearStalledUptime.observe({ ...observe(), uptimeMs: 1000 }, 10000, dayOne);
assert.throws(
  () => nearStalledUptime.observe({ ...observe(), uptimeMs: 1001 }, 20000, dayOne),
  /uptime progression diverges/
);

const cumulativeDrift = new DeviceSoakTracker();
cumulativeDrift.observe({ ...observe(), uptimeMs: 1000 }, 10000, dayOne);
cumulativeDrift.observe({ ...observe(), uptimeMs: 13000 }, 20000, dayOne);
assert.throws(
  () => cumulativeDrift.observe({ ...observe(), uptimeMs: 25000 }, 30000, dayOne),
  /cumulative observation time/
);

const sampleStall = new DeviceSoakTracker({ requireSampleGrowth: true });
sampleStall.observe({ ...observe(), uptimeMs: 1000, todaySamples: 100 }, 0, dayOne);
sampleStall.observe({ ...observe(), uptimeMs: 11000, todaySamples: 100 }, 10000, dayOne);
sampleStall.observe({ ...observe(), uptimeMs: 21000, todaySamples: 100 }, 20000, dayOne);
assert.throws(
  () => sampleStall.observe({ ...observe(), uptimeMs: 31000, todaySamples: 100 }, 30000, dayOne),
  /sample count stalled/
);

const insufficientCoverage = new DeviceSoakTracker({
  requireSampleGrowth: true,
  minimumObservedDurationMs: 10000
});
insufficientCoverage.observe({ ...observe(), uptimeMs: 1000, todaySamples: 100 }, 0, dayOne);
insufficientCoverage.observe({ ...observe(), uptimeMs: 11000, todaySamples: 101 }, 10000, dayOne);
assert.throws(() => insufficientCoverage.finish(), /below required 5/);

const midnight = new DeviceSoakTracker({ requireSampleGrowth: true });
midnight.observe({ ...observe(), uptimeMs: 1000, todaySamples: 86400, daysStored: 21 }, 10000, dayOne);
midnight.observe({ ...observe(), uptimeMs: 11000, todaySamples: 5, daysStored: 21 }, 20000, dayTwo);
midnight.observe({ ...observe(), uptimeMs: 21000, todaySamples: 15, daysStored: 21 }, 30000, dayTwo);
assert.equal(midnight.finish().dayRollovers, 1);

const falseRollover = new DeviceSoakTracker();
falseRollover.observe({ ...observe(), uptimeMs: 1000, todaySamples: 500, daysStored: 3 }, 10000, dayOne);
assert.throws(
  () => falseRollover.observe({ ...observe(), uptimeMs: 11000, todaySamples: 1, daysStored: 3 }, 20000, dayOne),
  /verified local day rollover/
);

const unsafeRollover = new DeviceSoakTracker();
unsafeRollover.observe({ ...observe(), uptimeMs: 1000, todaySamples: 100, daysStored: 3 }, 10000, dayOne);
assert.throws(
  () => unsafeRollover.observe({ ...observe(), uptimeMs: 11000, todaySamples: 1, daysStored: 2 }, 20000, dayTwo),
  /verified local day rollover/
);

const tooShort = new DeviceSoakTracker({ minimumObservedDurationMs: 20000 });
tooShort.observe(observe(), 10000, dayOne);
tooShort.observe({ ...observe(), uptimeMs: 11000 }, 20000, dayOne);
assert.throws(() => tooShort.finish(), /configured soak duration/);

const invalidOrder = new DeviceSoakTracker();
invalidOrder.observe(observe(), 10000, dayOne);
assert.throws(() => invalidOrder.observe({ ...observe(), uptimeMs: 11000 }, 10000, dayOne), /observation time must increase/);

async function runFixture({ durationMs = 20000, maxConsecutiveErrors = 0, fetchSteps = [] } = {}) {
  let nowMs = 0;
  let fetchCount = 0;
  let firstValidationCount = 0;
  const runTracker = new DeviceSoakTracker({
    requireSampleGrowth: true,
    minimumObservedDurationMs: durationMs
  });
  const result = await runDeviceSoak({
    durationMs,
    intervalMs: 10000,
    maxConsecutiveErrors,
    fetchObservation: async () => {
      const step = fetchSteps[fetchCount];
      fetchCount += 1;
      if (step instanceof Error) throw step;
      return step || {};
    },
    validateObservation: () => ({
      ...observe(),
      uptimeMs: 1000 + nowMs,
      todaySamples: 100 + Math.floor(nowMs / 1000)
    }),
    tracker: runTracker,
    monotonicNow: () => nowMs,
    wallClockNow: () => Date.parse('2026-08-01T00:00:00Z') + nowMs,
    sleep: async (milliseconds) => {
      nowMs += milliseconds;
    },
    validateFirstObservation: () => {
      firstValidationCount += 1;
    }
  });
  return { fetchCount, firstValidationCount, result };
}

const normalRun = await runFixture();
assert.equal(normalRun.fetchCount, 3);
assert.equal(normalRun.firstValidationCount, 1);
assert.equal(normalRun.result.observedDurationMs, 20000);
assert.equal(normalRun.result.requestErrorCount, 0);

const lateRequestError = await runFixture({
  maxConsecutiveErrors: 1,
  fetchSteps: [{}, {}, new Error('temporary request failure'), {}]
});
assert.equal(lateRequestError.fetchCount, 4);
assert.equal(lateRequestError.firstValidationCount, 1);
assert.equal(lateRequestError.result.observedDurationMs, 30000);
assert.equal(lateRequestError.result.requestErrorCount, 1);

await assert.rejects(
  runFixture({ fetchSteps: [new Error('fatal request failure')] }),
  /fatal request failure/
);

let validationFetches = 0;
await assert.rejects(
  runDeviceSoak({
    durationMs: 10000,
    intervalMs: 10000,
    maxConsecutiveErrors: 2,
    fetchObservation: async () => {
      validationFetches += 1;
      return {};
    },
    validateObservation: () => {
      throw new Error('fatal validation failure');
    },
    tracker: new DeviceSoakTracker(),
    monotonicNow: () => 0,
    wallClockNow: () => 0,
    sleep: async () => {}
  }),
  /fatal validation failure/
);
assert.equal(validationFetches, 1, 'validation failures must never be retried as transport failures');

console.log('LongOS device soak validator tests: OK');
