import assert from "node:assert/strict";
import test from "node:test";

import {
  ContractError,
  canonicalPayload,
  databaseBuckets,
  parseHealthIngestRequest,
  sha256Hex,
} from "../functions/health-ingest/domain.mjs";

const now = new Date("2026-08-07T12:00:00.000Z");
const valid = () => ({
  schemaVersion: 1,
  requestId: "00000000-0000-4000-8000-000000000001",
  installationId: "00000000-0000-4000-8000-000000000002",
  buckets: [{
    metric: "steps",
    start: "2026-08-07T00:00:00.000Z",
    end: "2026-08-07T01:00:00.000Z",
    localDate: "2026-08-07",
    timezoneId: "Asia/Ho_Chi_Minh",
    utcOffsetMinutes: 420,
    value: 312,
    unit: "count",
    algorithmVersion: 1,
    sourceUpdatedAt: "2026-08-07T01:05:00.000Z",
  }],
});

test("accepts and canonicalizes the Steps contract", async () => {
  const parsed = parseHealthIngestRequest(valid(), now);
  assert.equal(parsed.buckets[0].value, 312);
  assert.equal(databaseBuckets(parsed)[0].provenance, "healthkit_statistics");
  assert.match(await sha256Hex(canonicalPayload(parsed)), /^[0-9a-f]{64}$/);
});

test("accepts Active Energy and daily Sleep summaries", () => {
  const energy = valid();
  energy.buckets[0].metric = "active_energy";
  energy.buckets[0].unit = "kcal";
  energy.buckets[0].value = 87;
  const parsedEnergy = parseHealthIngestRequest(energy, now);
  assert.equal(parsedEnergy.buckets[0].metric, "active_energy");
  assert.equal(databaseBuckets(parsedEnergy)[0].provenance, "healthkit_statistics");

  const sleep = valid();
  sleep.buckets[0].metric = "sleep";
  sleep.buckets[0].unit = "minute";
  sleep.buckets[0].start = "2026-08-06T16:00:00.000Z";
  sleep.buckets[0].end = "2026-08-06T23:00:00.000Z";
  sleep.buckets[0].value = 405;
  const parsedSleep = parseHealthIngestRequest(sleep, now);
  assert.equal(parsedSleep.buckets[0].metric, "sleep");
  assert.equal(databaseBuckets(parsedSleep)[0].provenance, "healthkit_sleep_summary");
});

test("accepts recovery, sleep-stage and Workout summaries", () => {
  const cases = [
    ["hrv_sdnn", "ms", 52, "healthkit_statistics_daily"],
    ["resting_heart_rate", "bpm", 61, "healthkit_statistics_daily"],
    ["sleep_rem", "minute", 95, "healthkit_sleep_stage_summary"],
    ["sleep_deep", "minute", 72, "healthkit_sleep_stage_summary"],
    ["workout_duration", "minute", 45, "healthkit_workout_summary"],
  ];
  for (const [metric, unit, value, provenance] of cases) {
    const payload = valid();
    payload.buckets[0].metric = metric;
    payload.buckets[0].unit = unit;
    payload.buckets[0].value = value;
    const parsed = parseHealthIngestRequest(payload, now);
    assert.equal(parsed.buckets[0].metric, metric);
    assert.equal(databaseBuckets(parsed)[0].provenance, provenance);
  }
});

test("accepts uppercase UUIDs emitted by Foundation and normalizes them", () => {
  const payload = valid();
  payload.requestId = "A1B2C3D4-E5F6-4A7B-8C9D-A1B2C3D4E5F6";
  payload.installationId = "F0E1D2C3-B4A5-4F67-9A8B-C7D6E5F4A3B2";

  const parsed = parseHealthIngestRequest(payload, now);
  assert.equal(parsed.requestId, payload.requestId.toLowerCase());
  assert.equal(parsed.installationId, payload.installationId.toLowerCase());
});

test("rejects userId and every unknown root key", () => {
  assert.throws(() => parseHealthIngestRequest({ ...valid(), userId: crypto.randomUUID() }, now), ContractError);
  assert.throws(() => parseHealthIngestRequest({ ...valid(), rawSamples: [] }, now), ContractError);
});

test("rejects unknown bucket keys, metrics and mismatched units", () => {
  const extra = valid();
  extra.buckets[0].device = "watch";
  assert.throws(() => parseHealthIngestRequest(extra, now), ContractError);

  const unknown = valid();
  unknown.buckets[0].metric = "distance";
  assert.throws(() => parseHealthIngestRequest(unknown, now), ContractError);

  const mismatched = valid();
  mismatched.buckets[0].metric = "sleep";
  assert.throws(() => parseHealthIngestRequest(mismatched, now), ContractError);
});

test("rejects invalid numbers, dates, UUIDs and timezones", () => {
  for (const value of [-1, 1.5, 2_000_001, Number.NaN]) {
    const payload = valid();
    payload.buckets[0].value = value;
    assert.throws(() => parseHealthIngestRequest(payload, now), ContractError);
  }

  const badDate = valid();
  badDate.buckets[0].localDate = "2026-02-30";
  assert.throws(() => parseHealthIngestRequest(badDate, now), ContractError);

  const badUUID = valid();
  badUUID.requestId = "00000000-0000-0000-0000-000000000000";
  assert.throws(() => parseHealthIngestRequest(badUUID, now), ContractError);

  const badTimezone = valid();
  badTimezone.buckets[0].timezoneId = "Not/A_Real_Zone";
  assert.throws(() => parseHealthIngestRequest(badTimezone, now), ContractError);
});

test("rejects duplicate bucket identities", () => {
  const payload = valid();
  payload.buckets.push(structuredClone(payload.buckets[0]));
  assert.throws(() => parseHealthIngestRequest(payload, now), ContractError);

  const duplicateSleepDay = valid();
  duplicateSleepDay.buckets[0].metric = "sleep";
  duplicateSleepDay.buckets[0].unit = "minute";
  duplicateSleepDay.buckets[0].value = 405;
  const secondSleep = structuredClone(duplicateSleepDay.buckets[0]);
  secondSleep.start = "2026-08-07T02:00:00.000Z";
  secondSleep.end = "2026-08-07T03:00:00.000Z";
  duplicateSleepDay.buckets.push(secondSleep);
  assert.throws(() => parseHealthIngestRequest(duplicateSleepDay, now), ContractError);

  const duplicateHRVDay = valid();
  duplicateHRVDay.buckets[0].metric = "hrv_sdnn";
  duplicateHRVDay.buckets[0].unit = "ms";
  duplicateHRVDay.buckets[0].value = 50;
  const secondHRV = structuredClone(duplicateHRVDay.buckets[0]);
  secondHRV.start = "2026-08-07T02:00:00.000Z";
  secondHRV.end = "2026-08-07T03:00:00.000Z";
  duplicateHRVDay.buckets.push(secondHRV);
  assert.throws(() => parseHealthIngestRequest(duplicateHRVDay, now), ContractError);
});

test("rejects zero-minute Sleep summaries", () => {
  const payload = valid();
  payload.buckets[0].metric = "sleep";
  payload.buckets[0].unit = "minute";
  payload.buckets[0].value = 0;
  assert.throws(() => parseHealthIngestRequest(payload, now), ContractError);
});
