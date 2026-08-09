const ROOT_KEYS = new Set(["schemaVersion", "requestId", "installationId", "buckets"]);
const BUCKET_KEYS = new Set([
  "metric",
  "start",
  "end",
  "localDate",
  "timezoneId",
  "utcOffsetMinutes",
  "value",
  "unit",
  "algorithmVersion",
  "sourceUpdatedAt"
]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_FUTURE_MS = 10 * 60 * 1000;
const MAX_AGE_MS = 400 * 24 * 60 * 60 * 1000;

export class ContractError extends Error {
  constructor(code = "invalid_request") {
    super(code);
    this.name = "ContractError";
    this.code = code;
  }
}

export function parseHealthIngestRequest(input, now = new Date()) {
  assertPlainObject(input);
  assertExactKeys(input, ROOT_KEYS);
  if (Object.keys(input).some((key) => key.toLowerCase() === "userid")) {
    throw new ContractError();
  }
  if (input.schemaVersion !== 1) throw new ContractError("unsupported_schema");
  const requestId = parseUUID(input.requestId);
  const installationId = parseUUID(input.installationId);
  if (!Array.isArray(input.buckets) || input.buckets.length < 1 || input.buckets.length > 500) {
    throw new ContractError();
  }

  const identities = new Set();
  const buckets = input.buckets.map((bucket) => {
    assertPlainObject(bucket);
    assertExactKeys(bucket, BUCKET_KEYS);
    if (bucket.metric !== "steps" || bucket.unit !== "count" || bucket.algorithmVersion !== 1) {
      throw new ContractError();
    }
    if (!Number.isSafeInteger(bucket.value) || bucket.value < 0 || bucket.value > 2_000_000) {
      throw new ContractError();
    }
    if (!Number.isInteger(bucket.utcOffsetMinutes) || bucket.utcOffsetMinutes < -900 || bucket.utcOffsetMinutes > 900) {
      throw new ContractError();
    }

    const start = parseInstant(bucket.start);
    const end = parseInstant(bucket.end);
    const sourceUpdatedAt = parseInstant(bucket.sourceUpdatedAt);
    if (end <= start || end - start > 24 * 60 * 60 * 1000) throw new ContractError();
    if (end > now.getTime() + MAX_FUTURE_MS || start < now.getTime() - MAX_AGE_MS) {
      throw new ContractError();
    }
    if (sourceUpdatedAt > now.getTime() + MAX_FUTURE_MS) throw new ContractError();
    parseLocalDate(bucket.localDate);
    parseTimeZone(bucket.timezoneId);

    const identity = [bucket.metric, start, end, bucket.algorithmVersion].join("|");
    if (identities.has(identity)) throw new ContractError();
    identities.add(identity);

    return {
      metric: "steps",
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
      localDate: bucket.localDate,
      timezoneId: bucket.timezoneId,
      utcOffsetMinutes: bucket.utcOffsetMinutes,
      value: bucket.value,
      unit: "count",
      algorithmVersion: 1,
      sourceUpdatedAt: new Date(sourceUpdatedAt).toISOString()
    };
  });

  buckets.sort((a, b) => a.start.localeCompare(b.start));
  return { schemaVersion: 1, requestId, installationId, buckets };
}

export function canonicalPayload(payload) {
  return JSON.stringify({
    schemaVersion: payload.schemaVersion,
    requestId: payload.requestId,
    installationId: payload.installationId,
    buckets: payload.buckets
  });
}

export function databaseBuckets(payload) {
  return payload.buckets.map((bucket) => ({
    metric_key: bucket.metric,
    bucket_start: bucket.start,
    bucket_end: bucket.end,
    local_date: bucket.localDate,
    timezone_id: bucket.timezoneId,
    utc_offset_minutes: bucket.utcOffsetMinutes,
    value_integer: bucket.value,
    unit: bucket.unit,
    algorithm_version: bucket.algorithmVersion,
    provenance: "healthkit_statistics",
    source_updated_at: bucket.sourceUpdatedAt
  }));
}

export async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function assertPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ContractError();
  }
}

function assertExactKeys(value, allowed) {
  const keys = Object.keys(value);
  if (keys.length !== allowed.size || keys.some((key) => !allowed.has(key))) {
    throw new ContractError();
  }
}

function parseUUID(value) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value) || value === "00000000-0000-0000-0000-000000000000") {
    throw new ContractError();
  }
  return value.toLowerCase();
}

function parseInstant(value) {
  if (typeof value !== "string" || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) throw new ContractError();
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new ContractError();
  return timestamp;
}

function parseLocalDate(value) {
  if (typeof value !== "string" || !LOCAL_DATE_PATTERN.test(value)) throw new ContractError();
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new ContractError();
  }
}

function parseTimeZone(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 64) throw new ContractError();
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date(0));
  } catch {
    throw new ContractError();
  }
}
