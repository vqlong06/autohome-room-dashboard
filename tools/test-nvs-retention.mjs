import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  certifyRetentionCapture,
  DEFAULT_CAPTURE_DURATION_MS,
  DEFAULT_MAX_POSTBOOT_UPTIME_MS,
  HISTORY_RETENTION_CHECKPOINT_SCHEMA,
  MIN_POSTBOOT_UPTIME_MS,
  readRetentionCheckpoint,
  validateRetentionCheckpoint,
  validateRetentionObservation,
  verifyRetentionEvidence,
  vietnamDayKey,
  vietnamDayRemainingMs,
  writeRetentionCheckpoint
} from './lib/nvs-retention.mjs';

const beforeVersion = 'longos-sensor-2026-08-01.3';
const targetVersion = 'longos-sensor-2026-08-02.1';
const startMs = Date.parse('2026-08-07T01:00:00Z');
const localDayKey = '2026-08-07';

const validHealth = { ok: true, appVersion: beforeVersion };
const validReadings = {
  appVersion: beforeVersion,
  deviceOnline: true,
  sensorOnline: true,
  uptimeMs: 1_000_000,
  temperatureC: 27.5,
  humidity: 71,
  ip: '192.168.1.50',
  cloudEnabled: true,
  stats: {
    timeSynced: true,
    daysStored: 3,
    todaySamples: 1000,
    yesterdaySamples: 80_000,
    currentWeekSamples: 161_000,
    previousWeekSamples: 300_000,
    todayAvgC: 27.5
  }
};

const observationSnapshot = (overrides = {}) => ({
  appVersion: beforeVersion,
  uptimeMs: 1_000_000,
  timeSynced: true,
  counters: {
    daysStored: 3,
    todaySamples: 1000,
    yesterdaySamples: 80_000,
    currentWeekSamples: 161_000,
    previousWeekSamples: 300_000
  },
  ...overrides,
  counters: {
    daysStored: 3,
    todaySamples: 1000,
    yesterdaySamples: 80_000,
    currentWeekSamples: 161_000,
    previousWeekSamples: 300_000,
    ...(overrides.counters || {})
  }
});

function timedSnapshot(uptimeMs, todaySamples, currentWeekSamples, overrides = {}) {
  return observationSnapshot({
    ...overrides,
    uptimeMs: overrides.uptimeMs ?? uptimeMs,
    counters: {
      todaySamples,
      currentWeekSamples,
      ...(overrides.counters || {})
    }
  });
}

const captureObservations = (overrides = {}) => [
  {
    snapshot: timedSnapshot(1_000_000, 1000, 161_000, overrides.firstSnapshot),
    wallClockMs: startMs,
    localDayKey
  },
  {
    snapshot: timedSnapshot(1_480_000, 1480, 161_480, overrides.middleSnapshot),
    wallClockMs: startMs + 8 * 60 * 1000,
    localDayKey: overrides.middleDayKey || localDayKey
  },
  {
    snapshot: timedSnapshot(1_960_000, 1960, 161_960, overrides.lastSnapshot),
    wallClockMs: overrides.lastWallClockMs ?? startMs + DEFAULT_CAPTURE_DURATION_MS,
    localDayKey: overrides.lastDayKey || localDayKey
  }
];

assert.equal(vietnamDayKey(Date.parse('2026-08-06T16:59:59Z')), '2026-08-06');
assert.equal(vietnamDayKey(Date.parse('2026-08-06T17:00:00Z')), '2026-08-07');
assert.equal(vietnamDayRemainingMs(Date.parse('2026-08-07T16:59:00Z')), 60_000);

const validatedObservation = validateRetentionObservation({
  health: validHealth,
  readings: validReadings,
  expectedVersion: beforeVersion,
  requireSensor: true
});
assert.deepEqual(validatedObservation, observationSnapshot());
assert.equal(/temperature|humidity|\bip\b|cloud|secret/i.test(JSON.stringify(validatedObservation)), false);
assert.deepEqual(validateRetentionObservation({
  health: validHealth,
  readings: { ...validReadings, sensorOnline: false },
  expectedVersion: beforeVersion
}), observationSnapshot(), 'Post-flash retention observations must not depend on sensor health');

for (const [payload, message] of [
  [{ health: { ...validHealth, ok: false }, readings: validReadings, expectedVersion: beforeVersion }, /health\.ok/],
  [{ health: { ...validHealth, appVersion: targetVersion }, readings: validReadings, expectedVersion: beforeVersion }, /health\.appVersion/],
  [{ health: validHealth, readings: { ...validReadings, appVersion: targetVersion }, expectedVersion: beforeVersion }, /readings\.appVersion/],
  [{ health: validHealth, readings: { ...validReadings, deviceOnline: false }, expectedVersion: beforeVersion }, /deviceOnline/],
  [{ health: validHealth, readings: { ...validReadings, sensorOnline: false }, expectedVersion: beforeVersion, requireSensor: true }, /sensorOnline/],
  [{ health: validHealth, readings: { ...validReadings, uptimeMs: -1 }, expectedVersion: beforeVersion }, /uptimeMs/],
  [{ health: validHealth, readings: { ...validReadings, stats: { ...validReadings.stats, timeSynced: false } }, expectedVersion: beforeVersion }, /timeSynced/],
  [{ health: validHealth, readings: { ...validReadings, stats: { ...validReadings.stats, todaySamples: 0 } }, expectedVersion: beforeVersion }, /synchronized local history/]
]) {
  assert.throws(() => validateRetentionObservation(payload), message);
}

const checkpoint = certifyRetentionCapture({
  observations: captureObservations(),
  targetVersion
});
assert.deepEqual(checkpoint, {
  schema: HISTORY_RETENTION_CHECKPOINT_SCHEMA,
  beforeVersion,
  targetVersion,
  capturedAtMs: startMs,
  certifiedAtMs: startMs + DEFAULT_CAPTURE_DURATION_MS,
  localDayKey,
  captureDurationMs: DEFAULT_CAPTURE_DURATION_MS,
  beforeUptimeMs: 1_000_000,
  certifiedUptimeMs: 1_960_000,
  counters: {
    daysStored: 3,
    todaySamples: 1000,
    yesterdaySamples: 80_000,
    currentWeekSamples: 161_000,
    previousWeekSamples: 300_000
  }
});
assert.deepEqual(validateRetentionCheckpoint(checkpoint), checkpoint);
assert.equal(/temperature|humidity|\bip\b|cloud|secret/i.test(JSON.stringify(checkpoint)), false);

const fixtureDirectory = await mkdtemp(join(tmpdir(), 'longos-retention-'));
try {
  const checkpointPath = join(fixtureDirectory, 'checkpoint.json');
  await writeRetentionCheckpoint(checkpointPath, checkpoint);
  assert.equal((await stat(checkpointPath)).mode & 0o777, 0o600);
  assert.deepEqual(await readRetentionCheckpoint(checkpointPath), checkpoint);
  assert.equal(/temperature|humidity|\bip\b|cloud|secret/i.test(await readFile(checkpointPath, 'utf8')), false);
  await assert.rejects(() => writeRetentionCheckpoint(checkpointPath, checkpoint), /EEXIST|exist/i);
  await chmod(checkpointPath, 0o644);
  await assert.rejects(() => readRetentionCheckpoint(checkpointPath), /permissions must be 0600/);
  await chmod(checkpointPath, 0o600);
  const aliasPath = join(fixtureDirectory, 'checkpoint-alias.json');
  await symlink(checkpointPath, aliasPath);
  await assert.rejects(() => readRetentionCheckpoint(aliasPath), /symbolic link/);
} finally {
  await rm(fixtureDirectory, { recursive: true, force: true });
}

assert.throws(
  () => certifyRetentionCapture({ observations: captureObservations(), targetVersion: beforeVersion }),
  /must differ/
);
assert.throws(
  () => certifyRetentionCapture({ observations: captureObservations().slice(0, 2), targetVersion }),
  /full NVS save cadence/
);
assert.throws(
  () => certifyRetentionCapture({
    observations: captureObservations({ lastDayKey: '2026-08-08' }),
    targetVersion
  }),
  /does not match its wall-clock time/
);
assert.throws(
  () => certifyRetentionCapture({
    observations: captureObservations({
      lastDayKey: '2026-08-08',
      lastWallClockMs: Date.parse('2026-08-07T17:00:00Z')
    }),
    targetVersion
  }),
  /same Vietnam local day/
);
assert.throws(
  () => certifyRetentionCapture({
    observations: captureObservations({ middleSnapshot: { uptimeMs: 100 } }),
    targetVersion
  }),
  /uptime must increase/
);
assert.throws(
  () => certifyRetentionCapture({
    observations: captureObservations({ lastSnapshot: { appVersion: 'longos-sensor-unexpected' } }),
    targetVersion
  }),
  /version changed/
);
assert.throws(
  () => certifyRetentionCapture({
    observations: captureObservations({
      middleSnapshot: { counters: { todaySamples: 1000, currentWeekSamples: 161_000 } },
      lastSnapshot: { counters: { todaySamples: 1000, currentWeekSamples: 161_000 } }
    }),
    targetVersion
  }),
  /sample count stalled/
);
assert.throws(
  () => certifyRetentionCapture({
    observations: captureObservations({ middleSnapshot: { counters: { yesterdaySamples: 79_999 } } }),
    targetVersion
  }),
  /yesterdaySamples changed/
);
assert.throws(
  () => certifyRetentionCapture({
    observations: captureObservations({ middleSnapshot: { counters: { currentWeekSamples: 161_479 } } }),
    targetVersion
  }),
  /growth diverged/
);
assert.throws(
  () => certifyRetentionCapture({
    observations: captureObservations({
      firstSnapshot: { counters: { daysStored: 1, todaySamples: 100, yesterdaySamples: 0, currentWeekSamples: 160_100, previousWeekSamples: 0 } },
      middleSnapshot: { counters: { daysStored: 1, todaySamples: 580, yesterdaySamples: 0, currentWeekSamples: 160_580, previousWeekSamples: 0 } },
      lastSnapshot: { counters: { daysStored: 1, todaySamples: 1060, yesterdaySamples: 0, currentWeekSamples: 161_060, previousWeekSamples: 0 } }
    }),
    targetVersion
  }),
  /INCONCLUSIVE/
);

const postFlashSnapshot = {
  ...observationSnapshot({
    appVersion: targetVersion,
    uptimeMs: 65_000,
    counters: { todaySamples: 1065, currentWeekSamples: 161_065 }
  })
};
const postFlashObservations = (firstSnapshot = postFlashSnapshot, secondOverrides = {}) => [
  {
    snapshot: structuredClone(firstSnapshot),
    wallClockMs: checkpoint.certifiedAtMs + 80_000,
    localDayKey
  },
  {
    snapshot: {
      ...structuredClone(firstSnapshot),
      uptimeMs: firstSnapshot.uptimeMs + 5000,
      counters: {
        ...structuredClone(firstSnapshot.counters),
        todaySamples: firstSnapshot.counters.todaySamples + 5,
        currentWeekSamples: firstSnapshot.counters.currentWeekSamples + 5
      },
      ...secondOverrides,
      counters: {
        ...structuredClone(firstSnapshot.counters),
        todaySamples: firstSnapshot.counters.todaySamples + 5,
        currentWeekSamples: firstSnapshot.counters.currentWeekSamples + 5,
        ...(secondOverrides.counters || {})
      }
    },
    wallClockMs: checkpoint.certifiedAtMs + 85_000,
    localDayKey
  }
];
const evidence = verifyRetentionEvidence({
  checkpoint,
  observations: postFlashObservations(),
  expectedTargetVersion: targetVersion
});
assert.deepEqual(evidence, {
  beforeVersion,
  targetVersion,
  daysStored: 3,
  retainedTodaySamples: 1000,
  postFlashSampleGrowth: 70,
  completedDayAnchorEvidence: true,
  freshBootBoundEvidence: true,
  postbootUptimeMs: 70_000,
  postbootEpochMs: checkpoint.certifiedAtMs + 15_000
});

const oneDayCheckpoint = structuredClone(checkpoint);
oneDayCheckpoint.counters.daysStored = 1;
const oneDaySnapshot = structuredClone(postFlashSnapshot);
oneDaySnapshot.counters.daysStored = 1;
assert.equal(verifyRetentionEvidence({
  checkpoint: oneDayCheckpoint,
  observations: postFlashObservations(oneDaySnapshot),
  expectedTargetVersion: targetVersion
}).freshBootBoundEvidence, true);

function expectVerifyRejected(change, message) {
  const args = {
    checkpoint: structuredClone(checkpoint),
    observations: postFlashObservations(),
    expectedTargetVersion: targetVersion,
    maxPostbootUptimeMs: DEFAULT_MAX_POSTBOOT_UPTIME_MS
  };
  change(args);
  assert.throws(() => verifyRetentionEvidence(args), message);
}

expectVerifyRejected((args) => { args.expectedTargetVersion = 'longos-sensor-other'; }, /targetVersion does not match/);
expectVerifyRejected((args) => { args.maxPostbootUptimeMs = DEFAULT_MAX_POSTBOOT_UPTIME_MS + 1; }, /must not exceed/);
expectVerifyRejected((args) => { args.observations[0].snapshot.appVersion = 'longos-sensor-other'; }, /post-flash firmware/);
expectVerifyRejected((args) => { args.observations[0].wallClockMs = checkpoint.certifiedAtMs; }, /must follow/);
expectVerifyRejected((args) => { args.observations[0].localDayKey = '2026-08-08'; }, /does not match its wall-clock time/);
expectVerifyRejected((args) => {
  for (const row of args.observations) {
    row.wallClockMs += 24 * 60 * 60 * 1000;
    row.localDayKey = '2026-08-08';
  }
}, /same Vietnam local day/);
expectVerifyRejected((args) => { args.observations[0].snapshot.uptimeMs = DEFAULT_MAX_POSTBOOT_UPTIME_MS + 1; }, /uptime exceeds/);
expectVerifyRejected((args) => { args.observations[0].snapshot.uptimeMs = MIN_POSTBOOT_UPTIME_MS - 1; }, /too short/);
expectVerifyRejected((args) => { for (const row of args.observations) row.snapshot.counters.daysStored = 2; }, /history days decreased/);
expectVerifyRejected((args) => {
  for (const row of args.observations) {
    row.snapshot.counters.todaySamples = 999;
    row.snapshot.counters.currentWeekSamples = 160_999;
  }
}, /today sample count decreased/);
expectVerifyRejected((args) => {
  for (const row of args.observations) {
    row.snapshot.counters.todaySamples = 1000;
    row.snapshot.counters.currentWeekSamples = 160_999;
  }
}, /current-week sample count decreased/);
expectVerifyRejected((args) => { for (const row of args.observations) row.snapshot.counters.yesterdaySamples += 1; }, /yesterday sample count changed/);
expectVerifyRejected((args) => { for (const row of args.observations) row.snapshot.counters.previousWeekSamples += 1; }, /previous-week sample count changed/);
expectVerifyRejected((args) => { args.observations[1].snapshot.counters.currentWeekSamples += 1; }, /growth diverged/);
expectVerifyRejected((args) => {
  args.observations[0].wallClockMs = checkpoint.certifiedAtMs + args.observations[0].snapshot.uptimeMs - 1;
  args.observations[1].wallClockMs = checkpoint.certifiedAtMs + args.observations[1].snapshot.uptimeMs - 1;
}, /boot epoch predates/);
expectVerifyRejected((args) => { args.observations = args.observations.slice(0, 1); }, /at least two observations/);
expectVerifyRejected((args) => { args.observations[1].snapshot.uptimeMs = args.observations[0].snapshot.uptimeMs; }, /uptime must increase/);
expectVerifyRejected((args) => { args.observations[1].snapshot.uptimeMs = args.observations[0].snapshot.uptimeMs + 1; }, /uptime diverged/);

const unsupportedCheckpoint = { ...checkpoint, temperatureC: 27.5 };
assert.throws(() => validateRetentionCheckpoint(unsupportedCheckpoint), /unsupported or missing fields/);
assert.throws(
  () => validateRetentionCheckpoint({ ...checkpoint, schema: 'longos-history-retention-evidence-v2' }),
  /schema is unsupported/
);
assert.throws(
  () => validateRetentionCheckpoint({ ...checkpoint, captureDurationMs: 1 }),
  /duration is inconsistent or too short/
);
assert.throws(
  () => validateRetentionCheckpoint({ ...checkpoint, localDayKey: '2026-08-08' }),
  /does not match its capture timestamps/
);
assert.throws(
  () => validateRetentionCheckpoint({
    ...checkpoint,
    counters: { ...checkpoint.counters, humidity: 71 }
  }),
  /unsupported or missing fields/
);

console.log('LongOS history retention evidence tests: OK');
