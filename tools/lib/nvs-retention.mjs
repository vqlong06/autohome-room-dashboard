import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, link, open, stat, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';

const APP_VERSION_PATTERN = /^longos-sensor-[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*$/;

export const HISTORY_RETENTION_CHECKPOINT_SCHEMA = 'longos-history-retention-evidence-v1';
export const HISTORY_SAVE_INTERVAL_MS = 15 * 60 * 1000;
export const DEFAULT_CAPTURE_DURATION_MS = HISTORY_SAVE_INTERVAL_MS + 60 * 1000;
export const DEFAULT_MAX_POSTBOOT_UPTIME_MS = 10 * 60 * 1000;
export const MIN_POSTBOOT_UPTIME_MS = 15 * 1000;
export const HISTORY_SAMPLE_INTERVAL_MS = 1000;

const OBSERVATION_DRIFT_TOLERANCE_MS = 2000;

const FRESH_SAMPLE_MARGIN = 5;
const COUNTER_NAMES = [
  'daysStored',
  'todaySamples',
  'yesterdaySamples',
  'currentWeekSamples',
  'previousWeekSamples'
];
const SNAPSHOT_KEYS = ['appVersion', 'uptimeMs', 'timeSynced', 'counters'];
const CHECKPOINT_KEYS = [
  'schema',
  'beforeVersion',
  'targetVersion',
  'capturedAtMs',
  'certifiedAtMs',
  'localDayKey',
  'captureDurationMs',
  'beforeUptimeMs',
  'certifiedUptimeMs',
  'counters'
];

function requireRecord(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function requireExactKeys(value, expectedKeys, label) {
  const actual = Object.keys(requireRecord(value, label)).sort();
  const expected = [...expectedKeys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} has unsupported or missing fields`);
  }
}

function requireBoolean(value, label) {
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean`);
  return value;
}

function requireNonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
  return value;
}

function requirePositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return value;
}

function requireVersion(value, label) {
  if (typeof value !== 'string' || !APP_VERSION_PATTERN.test(value)) {
    throw new Error(`${label} must use the longos-sensor- format`);
  }
  return value;
}

function requireDayKey(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} must use YYYY-MM-DD`);
  }
  const parsed = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} must be a valid calendar day`);
  }
  return value;
}

function validateCounters(value, label) {
  const counters = requireRecord(value, label);
  requireExactKeys(counters, COUNTER_NAMES, label);
  return Object.fromEntries(
    COUNTER_NAMES.map((name) => [name, requireNonNegativeInteger(counters[name], `${label}.${name}`)])
  );
}

function validateSnapshot(value, label = 'snapshot') {
  const snapshot = requireRecord(value, label);
  requireExactKeys(snapshot, SNAPSHOT_KEYS, label);
  return {
    appVersion: requireVersion(snapshot.appVersion, `${label}.appVersion`),
    uptimeMs: requireNonNegativeInteger(snapshot.uptimeMs, `${label}.uptimeMs`),
    timeSynced: requireBoolean(snapshot.timeSynced, `${label}.timeSynced`),
    counters: validateCounters(snapshot.counters, `${label}.counters`)
  };
}

function assertCertifiableSnapshot(snapshot, label) {
  if (!snapshot.timeSynced) throw new Error(`${label}.timeSynced must be true`);
  if (snapshot.counters.daysStored < 1 || snapshot.counters.todaySamples < 1) {
    throw new Error(`${label} must contain synchronized local history samples`);
  }
}

function allowedDriftMs(wallDeltaMs) {
  return Math.max(OBSERVATION_DRIFT_TOLERANCE_MS, wallDeltaMs * 0.1);
}

function assertUptimeDrift(previous, current, label) {
  const wallDeltaMs = current.wallClockMs - previous.wallClockMs;
  const uptimeDeltaMs = current.snapshot.uptimeMs - previous.snapshot.uptimeMs;
  if (Math.abs(uptimeDeltaMs - wallDeltaMs) > allowedDriftMs(wallDeltaMs)) {
    throw new Error(`device uptime diverged from ${label} wall-clock duration`);
  }
}

function maximumFreshSamples(uptimeMs) {
  return Math.floor(uptimeMs / HISTORY_SAMPLE_INTERVAL_MS) + FRESH_SAMPLE_MARGIN;
}

function assertInformativeBaseline(counters, maxPostbootUptimeMs) {
  const hasCompletedDayAnchor = counters.daysStored >= 2 && (
    counters.yesterdaySamples > 0 || counters.previousWeekSamples > 0
  );
  const hasLargeTodayFloor = counters.todaySamples > maximumFreshSamples(maxPostbootUptimeMs);
  if (!hasCompletedDayAnchor && !hasLargeTodayFloor) {
    throw new Error(
      'INCONCLUSIVE: history baseline lacks a completed-day anchor or a large same-day sample floor'
    );
  }
  return { hasCompletedDayAnchor, hasLargeTodayFloor };
}

export function vietnamDayKey(wallClockMs) {
  requireNonNegativeInteger(wallClockMs, 'wallClockMs');
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date(wallClockMs));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function vietnamDayRemainingMs(wallClockMs) {
  const current = requireNonNegativeInteger(wallClockMs, 'wallClockMs');
  const dayKey = vietnamDayKey(current);
  const nextLocalMidnightMs = Date.parse(`${dayKey}T17:00:00Z`);
  if (!Number.isFinite(nextLocalMidnightMs) || nextLocalMidnightMs <= current) {
    throw new Error('cannot determine the next Vietnam local midnight');
  }
  return nextLocalMidnightMs - current;
}

export async function writeRetentionCheckpoint(path, checkpoint) {
  if (typeof path !== 'string' || path.length === 0) throw new Error('checkpoint path must not be empty');
  const canonical = validateRetentionCheckpoint(checkpoint);
  const destination = resolve(path);
  const temporary = `${destination}.tmp-${process.pid}-${randomUUID()}`;
  let handle;
  let destinationCreated = false;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(canonical, null, 2)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await chmod(temporary, 0o600);
    await link(temporary, destination);
    destinationCreated = true;
    await unlink(temporary);
    const metadata = await stat(destination);
    if (!metadata.isFile()) throw new Error('checkpoint destination must be a regular file');
    if ((metadata.mode & 0o777) !== 0o600) throw new Error('checkpoint permissions must be 0600');
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await unlink(temporary).catch(() => {});
    if (destinationCreated) await unlink(destination).catch(() => {});
    throw error;
  }
}

export async function readRetentionCheckpoint(path) {
  if (typeof path !== 'string' || path.length === 0) throw new Error('checkpoint path must not be empty');
  const source = resolve(path);
  let handle;
  try {
    handle = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
    const metadata = await handle.stat();
    if (!metadata.isFile()) throw new Error('checkpoint must be a regular file');
    if ((metadata.mode & 0o777) !== 0o600) throw new Error('checkpoint permissions must be 0600');
    return validateRetentionCheckpoint(JSON.parse(await handle.readFile('utf8')));
  } catch (error) {
    if (error?.code === 'ELOOP') {
      throw new Error('checkpoint must not be a symbolic link', { cause: error });
    }
    throw error;
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

export function validateRetentionObservation({ health, readings, expectedVersion, requireSensor = false } = {}) {
  const healthRow = requireRecord(health, 'health');
  const reading = requireRecord(readings, 'readings');
  const version = requireVersion(expectedVersion, 'expectedVersion');
  if (healthRow.ok !== true) throw new Error('health.ok must be true');
  if (healthRow.appVersion !== version) throw new Error('health.appVersion does not match expectedVersion');
  if (reading.appVersion !== version) throw new Error('readings.appVersion does not match expectedVersion');
  if (reading.deviceOnline !== true) throw new Error('readings.deviceOnline must be true');
  const sensorOnline = requireBoolean(reading.sensorOnline, 'readings.sensorOnline');
  if (requireSensor && !sensorOnline) throw new Error('readings.sensorOnline must be true during capture');

  const stats = requireRecord(reading.stats, 'readings.stats');
  const snapshot = {
    appVersion: version,
    uptimeMs: requireNonNegativeInteger(reading.uptimeMs, 'readings.uptimeMs'),
    timeSynced: requireBoolean(stats.timeSynced, 'readings.stats.timeSynced'),
    counters: Object.fromEntries(
      COUNTER_NAMES.map((name) => [name, requireNonNegativeInteger(stats[name], `readings.stats.${name}`)])
    )
  };
  assertCertifiableSnapshot(snapshot, 'readings');
  return snapshot;
}

export function certifyRetentionCapture({
  observations,
  targetVersion,
  minimumDurationMs = DEFAULT_CAPTURE_DURATION_MS,
  minimumSampleCoverage = 0.5,
  maximumSampleStallMs = 30000
} = {}) {
  if (!Array.isArray(observations) || observations.length < 2) {
    throw new Error('capture requires at least two observations');
  }
  const target = requireVersion(targetVersion, 'targetVersion');
  requirePositiveInteger(minimumDurationMs, 'minimumDurationMs');
  if (minimumDurationMs < DEFAULT_CAPTURE_DURATION_MS) {
    throw new Error(`minimumDurationMs must be at least ${DEFAULT_CAPTURE_DURATION_MS}`);
  }
  if (!Number.isFinite(minimumSampleCoverage) || minimumSampleCoverage <= 0 || minimumSampleCoverage > 1) {
    throw new Error('minimumSampleCoverage must be above 0 and at most 1');
  }
  requirePositiveInteger(maximumSampleStallMs, 'maximumSampleStallMs');

  let previous = null;
  let first = null;
  let lastSampleGrowthAtMs = null;
  for (let index = 0; index < observations.length; index += 1) {
    const raw = requireRecord(observations[index], `observations[${index}]`);
    requireExactKeys(raw, ['snapshot', 'wallClockMs', 'localDayKey'], `observations[${index}]`);
    const observation = {
      snapshot: validateSnapshot(raw.snapshot, `observations[${index}].snapshot`),
      wallClockMs: requireNonNegativeInteger(raw.wallClockMs, `observations[${index}].wallClockMs`),
      localDayKey: requireDayKey(raw.localDayKey, `observations[${index}].localDayKey`)
    };
    if (observation.localDayKey !== vietnamDayKey(observation.wallClockMs)) {
      throw new Error(`observations[${index}].localDayKey does not match its wall-clock time`);
    }
    assertCertifiableSnapshot(observation.snapshot, `observations[${index}].snapshot`);
    if (observation.snapshot.appVersion === target) {
      throw new Error('capture firmware version must differ from targetVersion');
    }

    if (!first) {
      first = observation;
      lastSampleGrowthAtMs = observation.wallClockMs;
    } else {
      if (observation.snapshot.appVersion !== first.snapshot.appVersion) {
        throw new Error('capture firmware version changed during observation');
      }
      if (observation.localDayKey !== first.localDayKey) {
        throw new Error('capture must finish on the same Vietnam local day');
      }
      if (observation.wallClockMs <= previous.wallClockMs) {
        throw new Error('capture wall-clock time must increase');
      }
      if (observation.snapshot.uptimeMs <= previous.snapshot.uptimeMs) {
        throw new Error('capture device uptime must increase without reboot');
      }
      assertUptimeDrift(previous, observation, 'adjacent capture');
      assertUptimeDrift(first, observation, 'cumulative capture');

      const prior = previous.snapshot.counters;
      const current = observation.snapshot.counters;
      if (current.daysStored < prior.daysStored) throw new Error('daysStored decreased during capture');
      if (current.todaySamples < prior.todaySamples) throw new Error('todaySamples decreased during capture');
      if (current.currentWeekSamples < prior.currentWeekSamples) {
        throw new Error('currentWeekSamples decreased during capture');
      }
      if (current.yesterdaySamples !== prior.yesterdaySamples) {
        throw new Error('yesterdaySamples changed during same-day capture');
      }
      if (current.previousWeekSamples !== prior.previousWeekSamples) {
        throw new Error('previousWeekSamples changed during same-day capture');
      }
      const todayGrowth = current.todaySamples - prior.todaySamples;
      const weekGrowth = current.currentWeekSamples - prior.currentWeekSamples;
      if (todayGrowth !== weekGrowth) {
        throw new Error('today and current-week sample growth diverged during capture');
      }
      if (todayGrowth > 0) {
        lastSampleGrowthAtMs = observation.wallClockMs;
      } else if (observation.wallClockMs - lastSampleGrowthAtMs >= maximumSampleStallMs) {
        throw new Error('local history sample count stalled during capture');
      }
    }
    previous = observation;
  }

  const last = previous;
  const durationMs = last.wallClockMs - first.wallClockMs;
  if (durationMs < minimumDurationMs) {
    throw new Error('capture did not cover the full NVS save cadence and safety margin');
  }
  const sampleGrowth = last.snapshot.counters.todaySamples - first.snapshot.counters.todaySamples;
  const requiredGrowth = Math.max(
    1,
    Math.ceil((durationMs / HISTORY_SAMPLE_INTERVAL_MS) * minimumSampleCoverage)
  );
  if (sampleGrowth < requiredGrowth) {
    throw new Error(`capture sample growth ${sampleGrowth} is below required ${requiredGrowth}`);
  }
  assertInformativeBaseline(first.snapshot.counters, DEFAULT_MAX_POSTBOOT_UPTIME_MS);

  return {
    schema: HISTORY_RETENTION_CHECKPOINT_SCHEMA,
    beforeVersion: first.snapshot.appVersion,
    targetVersion: target,
    capturedAtMs: first.wallClockMs,
    certifiedAtMs: last.wallClockMs,
    localDayKey: first.localDayKey,
    captureDurationMs: durationMs,
    beforeUptimeMs: first.snapshot.uptimeMs,
    certifiedUptimeMs: last.snapshot.uptimeMs,
    counters: { ...first.snapshot.counters }
  };
}

export function validateRetentionCheckpoint(value) {
  const checkpoint = requireRecord(value, 'checkpoint');
  requireExactKeys(checkpoint, CHECKPOINT_KEYS, 'checkpoint');
  if (checkpoint.schema !== HISTORY_RETENTION_CHECKPOINT_SCHEMA) {
    throw new Error('checkpoint schema is unsupported');
  }
  const beforeVersion = requireVersion(checkpoint.beforeVersion, 'checkpoint.beforeVersion');
  const targetVersion = requireVersion(checkpoint.targetVersion, 'checkpoint.targetVersion');
  if (beforeVersion === targetVersion) throw new Error('checkpoint must describe a firmware version transition');
  const capturedAtMs = requireNonNegativeInteger(checkpoint.capturedAtMs, 'checkpoint.capturedAtMs');
  const certifiedAtMs = requireNonNegativeInteger(checkpoint.certifiedAtMs, 'checkpoint.certifiedAtMs');
  if (certifiedAtMs <= capturedAtMs) throw new Error('checkpoint certification time must follow capture time');
  const captureDurationMs = requirePositiveInteger(checkpoint.captureDurationMs, 'checkpoint.captureDurationMs');
  if (captureDurationMs !== certifiedAtMs - capturedAtMs || captureDurationMs < DEFAULT_CAPTURE_DURATION_MS) {
    throw new Error('checkpoint capture duration is inconsistent or too short');
  }
  const beforeUptimeMs = requireNonNegativeInteger(checkpoint.beforeUptimeMs, 'checkpoint.beforeUptimeMs');
  const certifiedUptimeMs = requireNonNegativeInteger(checkpoint.certifiedUptimeMs, 'checkpoint.certifiedUptimeMs');
  if (certifiedUptimeMs <= beforeUptimeMs) throw new Error('checkpoint uptime did not advance during capture');
  const uptimeDeltaMs = certifiedUptimeMs - beforeUptimeMs;
  if (Math.abs(uptimeDeltaMs - captureDurationMs) > allowedDriftMs(captureDurationMs)) {
    throw new Error('checkpoint uptime diverges from its capture duration');
  }
  const counters = validateCounters(checkpoint.counters, 'checkpoint.counters');
  if (counters.daysStored < 1 || counters.todaySamples < 1) {
    throw new Error('checkpoint must contain synchronized local history samples');
  }
  assertInformativeBaseline(counters, DEFAULT_MAX_POSTBOOT_UPTIME_MS);

  const localDayKey = requireDayKey(checkpoint.localDayKey, 'checkpoint.localDayKey');
  if (vietnamDayKey(capturedAtMs) !== localDayKey || vietnamDayKey(certifiedAtMs) !== localDayKey) {
    throw new Error('checkpoint localDayKey does not match its capture timestamps');
  }

  return {
    schema: HISTORY_RETENTION_CHECKPOINT_SCHEMA,
    beforeVersion,
    targetVersion,
    capturedAtMs,
    certifiedAtMs,
    localDayKey,
    captureDurationMs,
    beforeUptimeMs,
    certifiedUptimeMs,
    counters
  };
}

export function verifyRetentionEvidence({
  checkpoint,
  observations,
  expectedTargetVersion,
  maxPostbootUptimeMs = DEFAULT_MAX_POSTBOOT_UPTIME_MS
} = {}) {
  const saved = validateRetentionCheckpoint(checkpoint);
  const expected = requireVersion(expectedTargetVersion, 'expectedTargetVersion');
  if (saved.targetVersion !== expected) {
    throw new Error('checkpoint targetVersion does not match the local source firmware');
  }
  requirePositiveInteger(maxPostbootUptimeMs, 'maxPostbootUptimeMs');
  if (maxPostbootUptimeMs > DEFAULT_MAX_POSTBOOT_UPTIME_MS) {
    throw new Error(`maxPostbootUptimeMs must not exceed ${DEFAULT_MAX_POSTBOOT_UPTIME_MS}`);
  }
  if (!Array.isArray(observations) || observations.length < 2) {
    throw new Error('post-flash verification requires at least two observations');
  }

  let first = null;
  let previous = null;
  for (let index = 0; index < observations.length; index += 1) {
    const raw = requireRecord(observations[index], `observations[${index}]`);
    requireExactKeys(raw, ['snapshot', 'wallClockMs', 'localDayKey'], `observations[${index}]`);
    const observation = {
      snapshot: validateSnapshot(raw.snapshot, `observations[${index}].snapshot`),
      wallClockMs: requireNonNegativeInteger(raw.wallClockMs, `observations[${index}].wallClockMs`),
      localDayKey: requireDayKey(raw.localDayKey, `observations[${index}].localDayKey`)
    };
    if (observation.localDayKey !== vietnamDayKey(observation.wallClockMs)) {
      throw new Error(`observations[${index}].localDayKey does not match its wall-clock time`);
    }
    assertCertifiableSnapshot(observation.snapshot, `observations[${index}].snapshot`);
    if (observation.snapshot.appVersion !== expected) {
      throw new Error('post-flash firmware does not match expectedTargetVersion');
    }
    if (observation.snapshot.appVersion === saved.beforeVersion) {
      throw new Error('firmware version did not transition across flash');
    }
    if (observation.wallClockMs <= saved.certifiedAtMs) {
      throw new Error('post-flash observation must follow checkpoint certification');
    }
    if (observation.localDayKey !== saved.localDayKey) {
      throw new Error('retention evidence must be verified on the same Vietnam local day');
    }
    if (observation.snapshot.uptimeMs > maxPostbootUptimeMs) {
      throw new Error('post-flash uptime exceeds the evidence window; verify immediately after flashing');
    }
    if (observation.snapshot.uptimeMs < MIN_POSTBOOT_UPTIME_MS) {
      throw new Error('post-flash uptime is too short to establish a stable verification window');
    }
    const bootEpochMs = observation.wallClockMs - observation.snapshot.uptimeMs;
    if (bootEpochMs < saved.certifiedAtMs) {
      throw new Error('post-flash boot epoch predates checkpoint certification');
    }
    if (!first) {
      first = observation;
    } else {
      if (observation.wallClockMs <= previous.wallClockMs) {
        throw new Error('post-flash observation time must increase');
      }
      if (observation.snapshot.uptimeMs <= previous.snapshot.uptimeMs) {
        throw new Error('post-flash uptime must increase without reboot or stall');
      }
      assertUptimeDrift(previous, observation, 'adjacent post-flash');
      assertUptimeDrift(first, observation, 'cumulative post-flash');
      const prior = previous.snapshot.counters;
      const currentCounters = observation.snapshot.counters;
      if (currentCounters.daysStored < prior.daysStored) {
        throw new Error('stored local history days decreased between post-flash observations');
      }
      if (currentCounters.todaySamples < prior.todaySamples) {
        throw new Error('today sample count decreased between post-flash observations');
      }
      if (currentCounters.currentWeekSamples < prior.currentWeekSamples) {
        throw new Error('current-week sample count decreased between post-flash observations');
      }
      if (currentCounters.yesterdaySamples !== prior.yesterdaySamples) {
        throw new Error('completed yesterday sample count changed between post-flash observations');
      }
      if (currentCounters.previousWeekSamples !== prior.previousWeekSamples) {
        throw new Error('completed previous-week sample count changed between post-flash observations');
      }
      if (
        currentCounters.todaySamples - prior.todaySamples !==
        currentCounters.currentWeekSamples - prior.currentWeekSamples
      ) {
        throw new Error('today and current-week sample growth diverged between post-flash observations');
      }
    }
    previous = observation;
  }

  const floor = saved.counters;
  const current = previous.snapshot;
  const after = current.counters;
  if (after.daysStored < floor.daysStored) throw new Error('stored local history days decreased after flash');
  if (after.todaySamples < floor.todaySamples) throw new Error('today sample count decreased after flash');
  if (after.currentWeekSamples < floor.currentWeekSamples) {
    throw new Error('current-week sample count decreased after flash');
  }
  if (after.yesterdaySamples !== floor.yesterdaySamples) {
    throw new Error('completed yesterday sample count changed after flash');
  }
  if (after.previousWeekSamples !== floor.previousWeekSamples) {
    throw new Error('completed previous-week sample count changed after flash');
  }
  const todayGrowth = after.todaySamples - floor.todaySamples;
  const weekGrowth = after.currentWeekSamples - floor.currentWeekSamples;
  if (todayGrowth !== weekGrowth) {
    throw new Error('today and current-week retained sample growth diverged after flash');
  }

  const evidence = assertInformativeBaseline(floor, current.uptimeMs);
  return {
    beforeVersion: saved.beforeVersion,
    targetVersion: saved.targetVersion,
    daysStored: after.daysStored,
    retainedTodaySamples: floor.todaySamples,
    postFlashSampleGrowth: todayGrowth,
    completedDayAnchorEvidence: evidence.hasCompletedDayAnchor,
    freshBootBoundEvidence: evidence.hasLargeTodayFloor,
    postbootUptimeMs: current.uptimeMs,
    postbootEpochMs: previous.wallClockMs - current.uptimeMs
  };
}
