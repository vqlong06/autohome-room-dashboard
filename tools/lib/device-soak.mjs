const APP_VERSION_PATTERN = /^longos-sensor-[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*$/;
export const DEVICE_SOAK_CHECKPOINT_SCHEMA = 'longos-device-soak-checkpoint-v1';

function requireRecord(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function requireBoolean(value, label) {
  if (typeof value !== 'boolean') {
    throw new Error(`${label} must be a boolean`);
  }
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

function requireNonNegativeNumber(value, label) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative finite number`);
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
  return value;
}

export function certifiedDeviceVersion(sourceVersion, requestedVersion = '') {
  const source = requireVersion(sourceVersion, 'sourceVersion');
  if (requestedVersion === '' || requestedVersion === undefined) return source;
  const requested = requireVersion(requestedVersion, 'requestedVersion');
  if (requested !== source) {
    throw new Error('certified device soak version must match APP_VERSION in src/main.cpp');
  }
  return source;
}

export function vietnamDayKey(wallClockMs) {
  requireNonNegativeNumber(wallClockMs, 'wallClockMs');
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date(wallClockMs));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function dayKeyEpochMs(dayKey, label) {
  requireDayKey(dayKey, label);
  const parsed = Date.parse(`${dayKey}T00:00:00Z`);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== dayKey) {
    throw new Error(`${label} must be a valid calendar day`);
  }
  return parsed;
}

export function createDeviceSoakCheckpoint({ snapshot, wallClockMs, localDayKey } = {}) {
  const value = requireRecord(snapshot, 'snapshot');
  return {
    schema: DEVICE_SOAK_CHECKPOINT_SCHEMA,
    appVersion: requireVersion(value.appVersion, 'snapshot.appVersion'),
    wallClockMs: requireNonNegativeInteger(wallClockMs, 'wallClockMs'),
    localDayKey: requireDayKey(localDayKey, 'localDayKey'),
    uptimeMs: requireNonNegativeInteger(value.uptimeMs, 'snapshot.uptimeMs'),
    todaySamples: requireNonNegativeInteger(value.todaySamples, 'snapshot.todaySamples'),
    daysStored: requireNonNegativeInteger(value.daysStored, 'snapshot.daysStored')
  };
}

export function validateCheckpointContinuity({
  checkpoint,
  snapshot,
  wallClockMs,
  localDayKey,
  uptimeToleranceMs = 30000,
  uptimeToleranceRatio = 0.1
} = {}) {
  const saved = requireRecord(checkpoint, 'checkpoint');
  const current = requireRecord(snapshot, 'snapshot');
  if (saved.schema !== DEVICE_SOAK_CHECKPOINT_SCHEMA) {
    throw new Error('checkpoint schema is unsupported');
  }
  const savedVersion = requireVersion(saved.appVersion, 'checkpoint.appVersion');
  const currentVersion = requireVersion(current.appVersion, 'snapshot.appVersion');
  if (currentVersion !== savedVersion) {
    throw new Error('checkpoint firmware version does not match the current device');
  }

  const savedWallClockMs = requireNonNegativeInteger(saved.wallClockMs, 'checkpoint.wallClockMs');
  const currentWallClockMs = requireNonNegativeInteger(wallClockMs, 'wallClockMs');
  if (currentWallClockMs <= savedWallClockMs) {
    throw new Error('checkpoint wall-clock time must precede the resumed observation');
  }
  const savedDayKey = requireDayKey(saved.localDayKey, 'checkpoint.localDayKey');
  const currentDayKey = requireDayKey(localDayKey, 'localDayKey');
  const dayDeltaMs = dayKeyEpochMs(currentDayKey, 'localDayKey') - dayKeyEpochMs(savedDayKey, 'checkpoint.localDayKey');
  if (dayDeltaMs < 0 || dayDeltaMs > 24 * 60 * 60 * 1000) {
    throw new Error('checkpoint must be resumed on the same or next local day');
  }

  const savedUptimeMs = requireNonNegativeInteger(saved.uptimeMs, 'checkpoint.uptimeMs');
  const currentUptimeMs = requireNonNegativeInteger(current.uptimeMs, 'snapshot.uptimeMs');
  if (currentUptimeMs <= savedUptimeMs) {
    throw new Error('device uptime did not continue across the checkpoint');
  }
  requireNonNegativeNumber(uptimeToleranceMs, 'uptimeToleranceMs');
  if (!Number.isFinite(uptimeToleranceRatio) || uptimeToleranceRatio < 0 || uptimeToleranceRatio > 1) {
    throw new Error('uptimeToleranceRatio must be between 0 and 1');
  }
  const wallDeltaMs = currentWallClockMs - savedWallClockMs;
  const uptimeDeltaMs = currentUptimeMs - savedUptimeMs;
  const allowedDriftMs = Math.max(uptimeToleranceMs, wallDeltaMs * uptimeToleranceRatio);
  if (Math.abs(uptimeDeltaMs - wallDeltaMs) > allowedDriftMs) {
    throw new Error('device uptime diverged across the checkpoint and may have rebooted');
  }

  const savedSamples = requireNonNegativeInteger(saved.todaySamples, 'checkpoint.todaySamples');
  const currentSamples = requireNonNegativeInteger(current.todaySamples, 'snapshot.todaySamples');
  const savedDaysStored = requireNonNegativeInteger(saved.daysStored, 'checkpoint.daysStored');
  const currentDaysStored = requireNonNegativeInteger(current.daysStored, 'snapshot.daysStored');
  if (currentDaysStored < savedDaysStored) {
    throw new Error('stored local history decreased across the checkpoint');
  }
  const dayRollover = currentDayKey !== savedDayKey;
  if (!dayRollover && currentSamples < savedSamples) {
    throw new Error('today sample count decreased across the reconnect checkpoint');
  }

  return {
    wallDeltaMs,
    uptimeDeltaMs,
    sampleGrowth: dayRollover ? currentSamples : currentSamples - savedSamples,
    dayRollover
  };
}

export function validateDeviceObservation({
  health,
  readings,
  expectedVersion,
  requireSensor = false,
  requireCloud = false,
  requireTimeSynced = false,
  requireWifiConnected = false,
  requireAccessPoint = false
} = {}) {
  const healthRow = requireRecord(health, 'health');
  const reading = requireRecord(readings, 'readings');
  const version = requireVersion(expectedVersion, 'expectedVersion');

  if (requireWifiConnected && requireAccessPoint) {
    throw new Error('Wi-Fi connected and access-point requirements are mutually exclusive');
  }
  if (healthRow.ok !== true) {
    throw new Error('health.ok must be true');
  }
  if (healthRow.appVersion !== version) {
    throw new Error('health.appVersion does not match expectedVersion');
  }
  if (reading.appVersion !== version) {
    throw new Error('readings.appVersion does not match expectedVersion');
  }
  if (reading.deviceOnline !== true) {
    throw new Error('readings.deviceOnline must be true');
  }

  const wifiConnected = requireBoolean(reading.wifiConnected, 'readings.wifiConnected');
  if (!['STA', 'AP', 'AP+STA'].includes(reading.wifiMode)) {
    throw new Error('readings.wifiMode must be STA, AP, or AP+STA');
  }
  if (typeof reading.ip !== 'string' || reading.ip.length === 0) {
    throw new Error('readings.ip must be a non-empty string');
  }
  if (requireWifiConnected && (!wifiConnected || reading.wifiMode !== 'STA')) {
    throw new Error('readings must use station-only Wi-Fi after reconnect');
  }
  if (requireAccessPoint && (wifiConnected || reading.wifiMode !== 'AP' || reading.ip !== '192.168.4.1')) {
    throw new Error('readings must use fallback AP at 192.168.4.1 with station disconnected');
  }

  const sensorOnline = requireBoolean(reading.sensorOnline, 'readings.sensorOnline');
  if (requireSensor && !sensorOnline) {
    throw new Error('readings.sensorOnline must be true');
  }

  const stats = requireRecord(reading.stats, 'readings.stats');
  const timeSynced = requireBoolean(stats.timeSynced, 'readings.stats.timeSynced');
  if (requireTimeSynced && !timeSynced) {
    throw new Error('readings.stats.timeSynced must be true');
  }

  const cloudEnabled = requireBoolean(reading.cloudEnabled, 'readings.cloudEnabled');
  const cloudUploadOk = requireBoolean(reading.cloudUploadOk, 'readings.cloudUploadOk');
  const cloudHistoryOk = requireBoolean(reading.cloudHistoryOk, 'readings.cloudHistoryOk');
  const cloudStatusCode = reading.cloudStatusCode;
  const cloudHistoryStatusCode = reading.cloudHistoryStatusCode;
  if (!Number.isInteger(cloudStatusCode) || !Number.isInteger(cloudHistoryStatusCode)) {
    throw new Error('cloud status codes must be integers');
  }
  if (requireCloud) {
    if (!cloudEnabled || !cloudUploadOk || !cloudHistoryOk) {
      throw new Error('last reported cloud latest/history status must be healthy');
    }
    if (cloudStatusCode < 200 || cloudStatusCode >= 300 || cloudHistoryStatusCode < 200 || cloudHistoryStatusCode >= 300) {
      throw new Error('cloud latest/history status codes must be 2xx');
    }
  }

  return {
    appVersion: version,
    uptimeMs: requireNonNegativeInteger(reading.uptimeMs, 'readings.uptimeMs'),
    todaySamples: requireNonNegativeInteger(stats.todaySamples, 'readings.stats.todaySamples'),
    daysStored: requireNonNegativeInteger(stats.daysStored, 'readings.stats.daysStored'),
    wifiConnected,
    wifiMode: reading.wifiMode,
    ip: reading.ip,
    sensorOnline,
    timeSynced,
    cloudEnabled,
    cloudUploadOk,
    cloudHistoryOk,
    cloudStatusCode,
    cloudHistoryStatusCode
  };
}

export class DeviceSoakTracker {
  constructor({
    requireSampleGrowth = false,
    uptimeToleranceMs = 2000,
    uptimeToleranceRatio = 0.1,
    minimumObservedDurationMs = 0,
    sampleIntervalMs = 1000,
    minimumSampleCoverage = 0.5,
    maximumSampleStallMs = 30000
  } = {}) {
    if (typeof requireSampleGrowth !== 'boolean') {
      throw new Error('requireSampleGrowth must be a boolean');
    }
    requireNonNegativeNumber(uptimeToleranceMs, 'uptimeToleranceMs');
    if (!Number.isFinite(uptimeToleranceRatio) || uptimeToleranceRatio < 0 || uptimeToleranceRatio > 1) {
      throw new Error('uptimeToleranceRatio must be between 0 and 1');
    }
    requireNonNegativeInteger(minimumObservedDurationMs, 'minimumObservedDurationMs');
    requirePositiveInteger(sampleIntervalMs, 'sampleIntervalMs');
    if (!Number.isFinite(minimumSampleCoverage) || minimumSampleCoverage <= 0 || minimumSampleCoverage > 1) {
      throw new Error('minimumSampleCoverage must be above 0 and at most 1');
    }
    requirePositiveInteger(maximumSampleStallMs, 'maximumSampleStallMs');

    this.requireSampleGrowth = requireSampleGrowth;
    this.uptimeToleranceMs = uptimeToleranceMs;
    this.uptimeToleranceRatio = uptimeToleranceRatio;
    this.minimumObservedDurationMs = minimumObservedDurationMs;
    this.sampleIntervalMs = sampleIntervalMs;
    this.minimumSampleCoverage = minimumSampleCoverage;
    this.maximumSampleStallMs = maximumSampleStallMs;
    this.first = null;
    this.last = null;
    this.lastSampleGrowthAtMs = null;
    this.observationCount = 0;
    this.sampleGrowth = 0;
    this.dayRollovers = 0;
    this.finishedResult = null;
  }

  assertUptimeDrift(older, newer, label) {
    const observationDeltaMs = newer.observedAtMs - older.observedAtMs;
    const uptimeDeltaMs = newer.uptimeMs - older.uptimeMs;
    const allowedDriftMs = Math.max(this.uptimeToleranceMs, observationDeltaMs * this.uptimeToleranceRatio);
    if (Math.abs(uptimeDeltaMs - observationDeltaMs) > allowedDriftMs) {
      throw new Error(`device uptime progression diverges from ${label} observation time`);
    }
  }

  observe(snapshot, observedAtMs, localDayKey) {
    if (this.finishedResult) {
      throw new Error('device soak tracker is already finished');
    }
    const value = requireRecord(snapshot, 'snapshot');
    requireNonNegativeNumber(observedAtMs, 'observedAtMs');
    requireDayKey(localDayKey, 'localDayKey');
    requireNonNegativeInteger(value.uptimeMs, 'snapshot.uptimeMs');
    requireNonNegativeInteger(value.todaySamples, 'snapshot.todaySamples');
    requireNonNegativeInteger(value.daysStored, 'snapshot.daysStored');

    const observation = { ...value, observedAtMs, localDayKey };
    if (this.last) {
      if (observedAtMs <= this.last.observedAtMs) {
        throw new Error('observation time must increase');
      }
      if (value.uptimeMs <= this.last.uptimeMs) {
        throw new Error('device uptime must increase without reboot or stall');
      }
      this.assertUptimeDrift(this.last, observation, 'adjacent');
      this.assertUptimeDrift(this.first, observation, 'cumulative');

      let growth = 0;
      if (value.todaySamples >= this.last.todaySamples) {
        growth = value.todaySamples - this.last.todaySamples;
      } else {
        if (localDayKey === this.last.localDayKey || this.dayRollovers >= 1 || value.daysStored < this.last.daysStored) {
          throw new Error('today sample count decreased outside one verified local day rollover');
        }
        this.dayRollovers += 1;
        growth = value.todaySamples;
      }

      this.sampleGrowth += growth;
      if (growth > 0) {
        this.lastSampleGrowthAtMs = observedAtMs;
      } else if (
        this.requireSampleGrowth &&
        observedAtMs - this.lastSampleGrowthAtMs >= this.maximumSampleStallMs
      ) {
        throw new Error('local history sample count stalled during soak');
      }
    } else {
      this.first = observation;
      this.lastSampleGrowthAtMs = observedAtMs;
    }

    this.last = observation;
    this.observationCount += 1;
    return observation;
  }

  finish() {
    if (this.finishedResult) return this.finishedResult;
    if (this.observationCount < 2 || !this.first || !this.last) {
      throw new Error('device soak requires at least two successful observations');
    }

    const observedDurationMs = this.last.observedAtMs - this.first.observedAtMs;
    if (observedDurationMs < this.minimumObservedDurationMs) {
      throw new Error('successful device observations did not cover the configured soak duration');
    }
    if (this.requireSampleGrowth) {
      const expectedSamples = Math.floor(observedDurationMs / this.sampleIntervalMs);
      const requiredGrowth = Math.max(1, Math.ceil(expectedSamples * this.minimumSampleCoverage));
      if (this.sampleGrowth < requiredGrowth) {
        throw new Error(`local history sample growth ${this.sampleGrowth} is below required ${requiredGrowth}`);
      }
    }

    this.finishedResult = {
      observationCount: this.observationCount,
      observedDurationMs,
      uptimeGrowthMs: this.last.uptimeMs - this.first.uptimeMs,
      sampleGrowth: this.sampleGrowth,
      dayRollovers: this.dayRollovers
    };
    return this.finishedResult;
  }
}

export async function runDeviceSoak({
  durationMs,
  intervalMs,
  maxConsecutiveErrors,
  fetchObservation,
  validateObservation,
  tracker,
  monotonicNow,
  wallClockNow,
  sleep,
  onSample = () => {},
  onRequestError = () => {},
  validateFirstObservation = () => {}
} = {}) {
  requirePositiveInteger(durationMs, 'durationMs');
  requirePositiveInteger(intervalMs, 'intervalMs');
  requireNonNegativeInteger(maxConsecutiveErrors, 'maxConsecutiveErrors');
  for (const [value, label] of [
    [fetchObservation, 'fetchObservation'],
    [validateObservation, 'validateObservation'],
    [monotonicNow, 'monotonicNow'],
    [wallClockNow, 'wallClockNow'],
    [sleep, 'sleep'],
    [onSample, 'onSample'],
    [onRequestError, 'onRequestError'],
    [validateFirstObservation, 'validateFirstObservation']
  ]) {
    if (typeof value !== 'function') throw new Error(`${label} must be a function`);
  }
  if (!(tracker instanceof DeviceSoakTracker)) {
    throw new Error('tracker must be a DeviceSoakTracker');
  }

  let firstObservedAtMs = null;
  let consecutiveErrors = 0;
  let requestErrorCount = 0;

  while (true) {
    let payload;
    try {
      payload = await fetchObservation();
    } catch (error) {
      consecutiveErrors += 1;
      requestErrorCount += 1;
      onRequestError({ error, consecutiveErrors, maxConsecutiveErrors });
      if (consecutiveErrors > maxConsecutiveErrors) throw error;
      await sleep(intervalMs);
      continue;
    }

    const observedAtMs = requireNonNegativeNumber(monotonicNow(), 'monotonicNow result');
    const wallClockMs = requireNonNegativeInteger(wallClockNow(), 'wallClockNow result');
    const dayKey = vietnamDayKey(wallClockMs);
    const snapshot = validateObservation(payload);
    if (tracker.observationCount === 0) {
      validateFirstObservation({ snapshot, observedAtMs, wallClockMs, localDayKey: dayKey });
    }
    tracker.observe(snapshot, observedAtMs, dayKey);
    consecutiveErrors = 0;
    if (firstObservedAtMs === null) firstObservedAtMs = observedAtMs;
    onSample({
      snapshot,
      observationCount: tracker.observationCount,
      elapsedMs: observedAtMs - firstObservedAtMs,
      wallClockMs,
      localDayKey: dayKey
    });

    if (observedAtMs - firstObservedAtMs >= durationMs) break;
    await sleep(intervalMs);
  }

  return { ...tracker.finish(), requestErrorCount };
}
