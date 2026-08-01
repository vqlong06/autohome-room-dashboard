export const DEFAULT_LATEST_MAX_AGE_MS = 3 * 60 * 1000;
export const DEFAULT_HISTORY_MAX_AGE_MS = 20 * 60 * 1000;
export const DEFAULT_FUTURE_TOLERANCE_MS = 60 * 1000;
export const DEFAULT_HISTORY_CADENCE_WINDOW_MS = 40 * 60 * 1000;
export const DEFAULT_HISTORY_MIN_GAP_MS = 9 * 60 * 1000;
export const DEFAULT_HISTORY_MIN_SAMPLES = 3;
export const DEFAULT_HISTORY_MAX_ROWS = 100;
export const DEFAULT_HISTORY_BOOT_TOLERANCE_MS = 30 * 1000;

const APP_VERSION_PATTERN = /^longos-sensor-[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*$/;

function requireNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function requireRecord(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function requireNonNegativeNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative finite number`);
  }
  return value;
}

function requirePositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return value;
}

function requireNonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
  return value;
}

function validateRoom(row, label, roomId) {
  if (row.room_id !== roomId) {
    throw new Error(`${label}.room_id does not match the configured room`);
  }
}

function validateAppVersion(row, label) {
  if (typeof row.app_version !== 'string' || !APP_VERSION_PATTERN.test(row.app_version)) {
    throw new Error(`${label}.app_version must use the longos-sensor- format`);
  }
  return row.app_version;
}

function validateExpectedAppVersion(value, label = 'expectedAppVersion') {
  const version = requireNonEmptyString(value, label);
  if (!APP_VERSION_PATTERN.test(version)) {
    throw new Error(`${label} must use the longos-sensor- format`);
  }
  return version;
}

function requireOnline(row, label, field) {
  if (row[field] !== true) {
    throw new Error(`${label}.${field} must be true`);
  }
}

function validateTimestamp(row, label, field, nowMs, maxAgeMs, futureToleranceMs) {
  const timestamp = row[field];
  if (typeof timestamp !== 'string' || timestamp.trim() === '') {
    throw new Error(`${label}.${field} must be a valid timestamp`);
  }

  const timestampMs = Date.parse(timestamp);
  if (!Number.isFinite(timestampMs)) {
    throw new Error(`${label}.${field} must be a valid timestamp`);
  }

  const ageMs = nowMs - timestampMs;
  if (ageMs < -futureToleranceMs) {
    throw new Error(`${label}.${field} is too far in the future`);
  }
  if (ageMs > maxAgeMs) {
    throw new Error(`${label}.${field} is stale`);
  }

  return Math.max(0, ageMs);
}

export function validateCloudHealth({
  roomId,
  latest,
  history,
  nowMs = Date.now(),
  latestMaxAgeMs = DEFAULT_LATEST_MAX_AGE_MS,
  historyMaxAgeMs = DEFAULT_HISTORY_MAX_AGE_MS,
  futureToleranceMs = DEFAULT_FUTURE_TOLERANCE_MS,
  expectedAppVersion = ''
} = {}) {
  const configuredRoomId = requireNonEmptyString(roomId, 'roomId');
  const latestRow = requireRecord(latest, 'latest');
  const historyRow = requireRecord(history, 'history');
  const validatedNowMs = requireNonNegativeNumber(nowMs, 'nowMs');
  const validatedLatestMaxAgeMs = requireNonNegativeNumber(latestMaxAgeMs, 'latestMaxAgeMs');
  const validatedHistoryMaxAgeMs = requireNonNegativeNumber(historyMaxAgeMs, 'historyMaxAgeMs');
  const validatedFutureToleranceMs = requireNonNegativeNumber(futureToleranceMs, 'futureToleranceMs');
  const expectedVersion = expectedAppVersion === '' || expectedAppVersion === undefined
    ? ''
    : validateExpectedAppVersion(expectedAppVersion);

  validateRoom(latestRow, 'latest', configuredRoomId);
  validateRoom(historyRow, 'history', configuredRoomId);
  const appVersion = validateAppVersion(latestRow, 'latest');
  const historyAppVersion = validateAppVersion(historyRow, 'history');
  if (expectedVersion) {
    if (appVersion !== expectedVersion) {
      throw new Error('latest.app_version does not match expectedAppVersion');
    }
    if (historyAppVersion !== expectedVersion) {
      throw new Error('history.app_version does not match expectedAppVersion');
    }
  }

  requireOnline(latestRow, 'latest', 'device_online');
  requireOnline(latestRow, 'latest', 'wifi_connected');
  requireOnline(latestRow, 'latest', 'sensor_online');
  requireOnline(historyRow, 'history', 'sensor_online');

  const latestAgeMs = validateTimestamp(
    latestRow,
    'latest',
    'updated_at',
    validatedNowMs,
    validatedLatestMaxAgeMs,
    validatedFutureToleranceMs
  );
  const historyAgeMs = validateTimestamp(
    historyRow,
    'history',
    'recorded_at',
    validatedNowMs,
    validatedHistoryMaxAgeMs,
    validatedFutureToleranceMs
  );

  return { latestAgeMs, historyAgeMs, appVersion };
}

export function validateHistoryCadence({
  roomId,
  rows,
  expectedAppVersion,
  nowMs = Date.now(),
  windowMs = DEFAULT_HISTORY_CADENCE_WINDOW_MS,
  minGapMs = DEFAULT_HISTORY_MIN_GAP_MS,
  minSamples = DEFAULT_HISTORY_MIN_SAMPLES,
  maxRows = DEFAULT_HISTORY_MAX_ROWS,
  futureToleranceMs = DEFAULT_FUTURE_TOLERANCE_MS,
  expectedBootEpochMs,
  bootEpochToleranceMs = DEFAULT_HISTORY_BOOT_TOLERANCE_MS
} = {}) {
  const configuredRoomId = requireNonEmptyString(roomId, 'roomId');
  const expectedVersion = validateExpectedAppVersion(expectedAppVersion);
  const validatedNowMs = requireNonNegativeNumber(nowMs, 'nowMs');
  const validatedWindowMs = requireNonNegativeNumber(windowMs, 'windowMs');
  const validatedMinGapMs = requireNonNegativeNumber(minGapMs, 'minGapMs');
  const validatedMinSamples = requirePositiveInteger(minSamples, 'minSamples');
  const validatedMaxRows = requirePositiveInteger(maxRows, 'maxRows');
  const validatedFutureToleranceMs = requireNonNegativeNumber(futureToleranceMs, 'futureToleranceMs');
  const validatedExpectedBootEpochMs = requireNonNegativeNumber(expectedBootEpochMs, 'expectedBootEpochMs');
  const validatedBootEpochToleranceMs = requireNonNegativeNumber(bootEpochToleranceMs, 'bootEpochToleranceMs');

  if (!Array.isArray(rows)) {
    throw new Error('rows must be an array');
  }
  if (validatedMinSamples < 2) {
    throw new Error('minSamples must be at least 2');
  }
  if (validatedMaxRows <= validatedMinSamples) {
    throw new Error('maxRows must be greater than minSamples');
  }
  const requiredSpanMs = (validatedMinSamples - 1) * validatedMinGapMs;
  if (!Number.isSafeInteger(requiredSpanMs) || validatedWindowMs < requiredSpanMs) {
    throw new Error('windowMs cannot contain minSamples at the configured minGapMs');
  }
  if (rows.length >= validatedMaxRows) {
    throw new Error('history cadence result reached maxRows and may be truncated');
  }
  const parsedSamples = rows.map((value, index) => {
    const row = requireRecord(value, `rows[${index}]`);
    validateRoom(row, `rows[${index}]`, configuredRoomId);
    const version = validateAppVersion(row, `rows[${index}]`);
    if (version !== expectedVersion) {
      throw new Error(`rows[${index}].app_version does not match expectedAppVersion`);
    }
    const uptimeMs = requireNonNegativeInteger(row.uptime_ms, `rows[${index}].uptime_ms`);
    const ageMs = validateTimestamp(
      row,
      `rows[${index}]`,
      'recorded_at',
      validatedNowMs,
      validatedWindowMs,
      validatedFutureToleranceMs
    );
    return {
      timestampMs: Date.parse(row.recorded_at),
      ageMs,
      uptimeMs,
      sensorOnline: row.sensor_online,
      bootEpochMs: Date.parse(row.recorded_at) - uptimeMs
    };
  }).sort((left, right) => right.timestampMs - left.timestampMs);

  const samples = [];
  let maximumBootEpochDeviationMs = 0;
  let ignoredPreviousBootSamples = 0;
  for (const sample of parsedSamples) {
    const deviationMs = Math.abs(sample.bootEpochMs - validatedExpectedBootEpochMs);
    if (deviationMs <= validatedBootEpochToleranceMs) {
      if (sample.sensorOnline !== true) {
        throw new Error('same-boot history cadence sample sensor_online must be true');
      }
      samples.push(sample);
      maximumBootEpochDeviationMs = Math.max(maximumBootEpochDeviationMs, deviationMs);
    } else if (sample.timestampMs >= validatedExpectedBootEpochMs) {
      throw new Error('history cadence contains a different device boot after the current boot started');
    } else {
      ignoredPreviousBootSamples += 1;
    }
  }
  if (samples.length < validatedMinSamples) {
    throw new Error(`history cadence requires at least ${validatedMinSamples} same-boot samples`);
  }

  let minimumGapMs = Infinity;
  for (let index = 1; index < samples.length; index += 1) {
    const gapMs = samples[index - 1].timestampMs - samples[index].timestampMs;
    if (gapMs < validatedMinGapMs) {
      throw new Error(`history cadence gap is below ${validatedMinGapMs} ms`);
    }
    minimumGapMs = Math.min(minimumGapMs, gapMs);
  }

  return {
    sampleCount: samples.length,
    newestAgeMs: samples[0].ageMs,
    observedSpanMs: samples[0].timestampMs - samples[samples.length - 1].timestampMs,
    minimumGapMs,
    maximumBootEpochDeviationMs,
    ignoredPreviousBootSamples,
    appVersion: expectedVersion
  };
}
