export const DEFAULT_LATEST_MAX_AGE_MS = 3 * 60 * 1000;
export const DEFAULT_HISTORY_MAX_AGE_MS = 20 * 60 * 1000;
export const DEFAULT_FUTURE_TOLERANCE_MS = 60 * 1000;

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
  futureToleranceMs = DEFAULT_FUTURE_TOLERANCE_MS
} = {}) {
  const configuredRoomId = requireNonEmptyString(roomId, 'roomId');
  const latestRow = requireRecord(latest, 'latest');
  const historyRow = requireRecord(history, 'history');
  const validatedNowMs = requireNonNegativeNumber(nowMs, 'nowMs');
  const validatedLatestMaxAgeMs = requireNonNegativeNumber(latestMaxAgeMs, 'latestMaxAgeMs');
  const validatedHistoryMaxAgeMs = requireNonNegativeNumber(historyMaxAgeMs, 'historyMaxAgeMs');
  const validatedFutureToleranceMs = requireNonNegativeNumber(futureToleranceMs, 'futureToleranceMs');

  validateRoom(latestRow, 'latest', configuredRoomId);
  validateRoom(historyRow, 'history', configuredRoomId);
  const appVersion = validateAppVersion(latestRow, 'latest');
  validateAppVersion(historyRow, 'history');

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
