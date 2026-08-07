import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  certifyRetentionCapture,
  DEFAULT_CAPTURE_DURATION_MS,
  DEFAULT_MAX_POSTBOOT_UPTIME_MS,
  MIN_POSTBOOT_UPTIME_MS,
  readRetentionCheckpoint,
  validateRetentionObservation,
  verifyRetentionEvidence,
  vietnamDayKey,
  vietnamDayRemainingMs,
  writeRetentionCheckpoint
} from './lib/nvs-retention.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_CAPTURE_DURATION_MS = 12 * 60 * 60 * 1000;
const MAX_INTERVAL_MS = 5 * 60 * 1000;
const MAX_TIMEOUT_MS = 60 * 1000;

function boundedInteger(value, label, { minimum, maximum }) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} must be a safe integer from ${minimum} to ${maximum}`);
  }
  return parsed;
}

function parseOptions(args) {
  const command = args[0];
  if (command === '--help' || command === '-h' || command === undefined) {
    console.log(`Usage:
  node tools/nvs-retention.mjs capture [options]
  node tools/nvs-retention.mjs verify [options]

Capture options:
  --before-version <ver>       Exact firmware currently on the device (required)
  --duration-ms <ms>           Observation duration (default: ${DEFAULT_CAPTURE_DURATION_MS})
  --interval-ms <ms>           Delay between observations (default: 10000)

Verify options:
  --max-postboot-uptime-ms <ms> Maximum target uptime; minimum observation is ${MIN_POSTBOOT_UPTIME_MS} ms (default: ${DEFAULT_MAX_POSTBOOT_UPTIME_MS})
  --verify-interval-ms <ms>      Delay between two post-flash observations (default: 5000)

Common options:
  --url <url>                  Device base URL (default: http://longos-sensor.local)
  --checkpoint <path>          Mode-0600 evidence file (required)
  --timeout-ms <ms>            Timeout for each request (default: 8000)
  -h, --help                   Show this help

The target version is always read from APP_VERSION in src/main.cpp. Capture
observes the old firmware for one complete 15-minute NVS save cadence plus a
one-minute margin. Verify is same-day, aggregate history-retention evidence;
it is not a byte-for-byte NVS dump or cryptographic attestation.

Environment overrides: LONGOS_DEVICE_URL, LONGOS_NVS_RETENTION_CHECKPOINT,
LONGOS_NVS_BEFORE_VERSION, LONGOS_NVS_CAPTURE_DURATION_MS,
LONGOS_NVS_CAPTURE_INTERVAL_MS, LONGOS_DEVICE_TIMEOUT_MS,
LONGOS_NVS_MAX_POSTBOOT_UPTIME_MS, LONGOS_NVS_VERIFY_INTERVAL_MS`);
    process.exit(0);
  }
  if (!['capture', 'verify'].includes(command)) {
    throw new Error('First argument must be capture or verify');
  }

  const options = {
    command,
    baseUrl: process.env.LONGOS_DEVICE_URL || 'http://longos-sensor.local',
    checkpoint: process.env.LONGOS_NVS_RETENTION_CHECKPOINT || '',
    beforeVersion: process.env.LONGOS_NVS_BEFORE_VERSION || '',
    durationMs: boundedInteger(
      process.env.LONGOS_NVS_CAPTURE_DURATION_MS || String(DEFAULT_CAPTURE_DURATION_MS),
      'capture duration',
      { minimum: DEFAULT_CAPTURE_DURATION_MS, maximum: MAX_CAPTURE_DURATION_MS }
    ),
    intervalMs: boundedInteger(
      process.env.LONGOS_NVS_CAPTURE_INTERVAL_MS || '10000',
      'capture interval',
      { minimum: 1000, maximum: MAX_INTERVAL_MS }
    ),
    timeoutMs: boundedInteger(process.env.LONGOS_DEVICE_TIMEOUT_MS || '8000', 'request timeout', {
      minimum: 1,
      maximum: MAX_TIMEOUT_MS
    }),
    maxPostbootUptimeMs: boundedInteger(
      process.env.LONGOS_NVS_MAX_POSTBOOT_UPTIME_MS || String(DEFAULT_MAX_POSTBOOT_UPTIME_MS),
      'maximum postboot uptime',
      { minimum: MIN_POSTBOOT_UPTIME_MS, maximum: DEFAULT_MAX_POSTBOOT_UPTIME_MS }
    ),
    verifyIntervalMs: boundedInteger(
      process.env.LONGOS_NVS_VERIFY_INTERVAL_MS || '5000',
      'verify interval',
      { minimum: 1000, maximum: 60 * 1000 }
    )
  };

  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    const nextValue = () => {
      index += 1;
      if (index >= args.length) throw new Error(`${argument} requires a value`);
      return args[index];
    };
    if (argument === '--url') options.baseUrl = nextValue();
    else if (argument === '--checkpoint') options.checkpoint = nextValue();
    else if (argument === '--before-version') options.beforeVersion = nextValue();
    else if (argument === '--duration-ms') {
      options.durationMs = boundedInteger(nextValue(), 'capture duration', {
        minimum: DEFAULT_CAPTURE_DURATION_MS,
        maximum: MAX_CAPTURE_DURATION_MS
      });
    } else if (argument === '--interval-ms') {
      options.intervalMs = boundedInteger(nextValue(), 'capture interval', {
        minimum: 1000,
        maximum: MAX_INTERVAL_MS
      });
    } else if (argument === '--timeout-ms') {
      options.timeoutMs = boundedInteger(nextValue(), 'request timeout', {
        minimum: 1,
        maximum: MAX_TIMEOUT_MS
      });
    } else if (argument === '--max-postboot-uptime-ms') {
      options.maxPostbootUptimeMs = boundedInteger(nextValue(), 'maximum postboot uptime', {
        minimum: MIN_POSTBOOT_UPTIME_MS,
        maximum: DEFAULT_MAX_POSTBOOT_UPTIME_MS
      });
    } else if (argument === '--verify-interval-ms') {
      options.verifyIntervalMs = boundedInteger(nextValue(), 'verify interval', {
        minimum: 1000,
        maximum: 60 * 1000
      });
    } else if (argument === '--help' || argument === '-h') {
      process.argv.splice(2, process.argv.length - 2, '--help');
      parseOptions(['--help']);
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }

  assert.ok(options.checkpoint, '--checkpoint is required');
  if (command === 'capture') assert.ok(options.beforeVersion, '--before-version is required for capture');
  assert.ok(options.durationMs >= options.intervalMs, '--duration-ms must be at least --interval-ms');
  const parsedUrl = new URL(options.baseUrl);
  assert.match(parsedUrl.protocol, /^https?:$/, '--url must use HTTP or HTTPS');
  assert.equal(parsedUrl.username, '', '--url must not contain credentials');
  assert.equal(parsedUrl.password, '', '--url must not contain credentials');
  return options;
}

async function sourceVersion() {
  const firmware = await readFile(resolve(root, 'src/main.cpp'), 'utf8');
  const match = firmware.match(/const char \*APP_VERSION = "([^"]+)";/);
  assert.ok(match, 'APP_VERSION is missing from src/main.cpp');
  return match[1];
}

function endpointUrl(baseUrl, path) {
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return new URL(path.replace(/^\//, ''), normalizedBase);
}

async function fetchJson(baseUrl, path, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpointUrl(baseUrl, path), {
      headers: { Accept: 'application/json' },
      signal: controller.signal
    });
    assert.ok(response.ok, `${path} returned HTTP ${response.status}`);
    assert.match(response.headers.get('content-type') || '', /^application\/json\b/i, `${path} must return JSON`);
    return await response.json();
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error(`${path} timed out after ${timeoutMs} ms`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchSnapshot(options, expectedVersion, requireSensor = false) {
  const [health, readings] = await Promise.all([
    fetchJson(options.baseUrl, '/health', options.timeoutMs),
    fetchJson(options.baseUrl, '/api/readings', options.timeoutMs)
  ]);
  return validateRetentionObservation({ health, readings, expectedVersion, requireSensor });
}

const sleep = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
const options = parseOptions(process.argv.slice(2));
const targetVersion = await sourceVersion();

if (options.command === 'capture') {
  assert.notEqual(options.beforeVersion, targetVersion, '--before-version must differ from target APP_VERSION');
  const preflightWallClockMs = Date.now();
  if (vietnamDayRemainingMs(preflightWallClockMs) <= options.durationMs + options.intervalMs) {
    throw new Error('INCONCLUSIVE: not enough time remains before Vietnam local midnight for a safe capture');
  }
  const observations = [];
  while (true) {
    const snapshot = await fetchSnapshot(options, options.beforeVersion, true);
    const wallClockMs = Date.now();
    const localDayKey = vietnamDayKey(wallClockMs);
    observations.push({ snapshot, wallClockMs, localDayKey });
    const elapsedMs = wallClockMs - observations[0].wallClockMs;
    console.log(
      `Retention capture ${observations.length}: elapsed ${Math.round(elapsedMs / 1000)}s, ` +
      `uptime ${Math.round(snapshot.uptimeMs / 1000)}s, today ${snapshot.counters.todaySamples}, ` +
      `${snapshot.counters.daysStored} days stored`
    );
    if (observations.length >= 2 && elapsedMs >= options.durationMs) break;
    await sleep(options.intervalMs);
  }

  const checkpoint = certifyRetentionCapture({
    observations,
    targetVersion,
    minimumDurationMs: options.durationMs
  });
  await writeRetentionCheckpoint(options.checkpoint, checkpoint);
  console.log('LongOS history retention capture: OK');
  console.log(`Transition: ${checkpoint.beforeVersion} -> ${checkpoint.targetVersion}`);
  console.log(`Checkpoint: ${resolve(options.checkpoint)} (0600)`);
  console.log('Evidence stores counters only; no temperature, humidity, IP, credentials or cloud secrets.');
} else {
  const checkpoint = await readRetentionCheckpoint(options.checkpoint);
  const observations = [];
  for (let index = 0; index < 2; index += 1) {
    const snapshot = await fetchSnapshot(options, targetVersion);
    const wallClockMs = Date.now();
    observations.push({ snapshot, wallClockMs, localDayKey: vietnamDayKey(wallClockMs) });
    if (index === 0) await sleep(options.verifyIntervalMs);
  }
  const result = verifyRetentionEvidence({
    checkpoint,
    observations,
    expectedTargetVersion: targetVersion,
    maxPostbootUptimeMs: options.maxPostbootUptimeMs
  });
  console.log('LongOS history retention evidence: OK');
  console.log(`Transition: ${result.beforeVersion} -> ${result.targetVersion}`);
  console.log(
    `Evidence: retained floor ${result.retainedTodaySamples} today samples, ` +
    `post-flash growth ${result.postFlashSampleGrowth}, ${result.daysStored} days stored, ` +
    `uptime ${Math.round(result.postbootUptimeMs / 1000)}s`
  );
  console.log('This verifies API-level aggregate continuity, not byte-for-byte NVS contents or binary identity.');
}
