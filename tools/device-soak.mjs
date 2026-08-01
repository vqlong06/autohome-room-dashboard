import assert from 'node:assert/strict';
import { chmod, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import {
  certifiedDeviceVersion,
  createDeviceSoakCheckpoint,
  DeviceSoakTracker,
  runDeviceSoak,
  validateCheckpointContinuity,
  validateDeviceObservation
} from './lib/device-soak.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_DURATION_MS = 12 * 60 * 60 * 1000;
const MAX_INTERVAL_MS = 5 * 60 * 1000;
const MAX_TIMEOUT_MS = 60 * 1000;
const MAX_CONSECUTIVE_ERRORS = 100;

function boundedInteger(value, label, { minimum, maximum }) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} must be a safe integer from ${minimum} to ${maximum}`);
  }
  return parsed;
}

function parseOptions(args) {
  const options = {
    baseUrl: process.env.LONGOS_DEVICE_URL || 'http://longos-sensor.local',
    expectedVersion: process.env.LONGOS_EXPECTED_VERSION || '',
    durationMs: boundedInteger(process.env.LONGOS_DEVICE_SOAK_DURATION_MS || '300000', 'duration', {
      minimum: 1,
      maximum: MAX_DURATION_MS
    }),
    intervalMs: boundedInteger(process.env.LONGOS_DEVICE_SOAK_INTERVAL_MS || '10000', 'interval', {
      minimum: 1,
      maximum: MAX_INTERVAL_MS
    }),
    timeoutMs: boundedInteger(process.env.LONGOS_DEVICE_TIMEOUT_MS || '8000', 'timeout', {
      minimum: 1,
      maximum: MAX_TIMEOUT_MS
    }),
    maxConsecutiveErrors: boundedInteger(
      process.env.LONGOS_DEVICE_SOAK_MAX_ERRORS || '2',
      'maximum consecutive errors',
      { minimum: 0, maximum: MAX_CONSECUTIVE_ERRORS }
    ),
    writeCheckpoint: process.env.LONGOS_DEVICE_SOAK_WRITE_CHECKPOINT || '',
    resumeCheckpoint: process.env.LONGOS_DEVICE_SOAK_RESUME_CHECKPOINT || '',
    requireSensor: false,
    requireCloud: false,
    requireTimeSynced: false,
    requireWifiConnected: false,
    requireAccessPoint: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const nextValue = () => {
      index += 1;
      if (index >= args.length) throw new Error(`${argument} requires a value`);
      return args[index];
    };

    if (argument === '--url') options.baseUrl = nextValue();
    else if (argument === '--expected-version') options.expectedVersion = nextValue();
    else if (argument === '--duration-ms') {
      options.durationMs = boundedInteger(nextValue(), 'duration', { minimum: 1, maximum: MAX_DURATION_MS });
    } else if (argument === '--interval-ms') {
      options.intervalMs = boundedInteger(nextValue(), 'interval', { minimum: 1, maximum: MAX_INTERVAL_MS });
    } else if (argument === '--timeout-ms') {
      options.timeoutMs = boundedInteger(nextValue(), 'timeout', { minimum: 1, maximum: MAX_TIMEOUT_MS });
    } else if (argument === '--max-consecutive-errors') {
      options.maxConsecutiveErrors = boundedInteger(nextValue(), 'maximum consecutive errors', {
        minimum: 0,
        maximum: MAX_CONSECUTIVE_ERRORS
      });
    } else if (argument === '--write-checkpoint') options.writeCheckpoint = nextValue();
    else if (argument === '--resume-checkpoint') options.resumeCheckpoint = nextValue();
    else if (argument === '--require-sensor') options.requireSensor = true;
    else if (argument === '--require-cloud') options.requireCloud = true;
    else if (argument === '--require-time-synced') options.requireTimeSynced = true;
    else if (argument === '--require-wifi') options.requireWifiConnected = true;
    else if (argument === '--require-ap') options.requireAccessPoint = true;
    else if (argument === '--help' || argument === '-h') {
      console.log(`Usage: node tools/device-soak.mjs [options]

Options:
  --url <url>                 Device base URL (default: http://longos-sensor.local)
  --expected-version <ver>    Must equal APP_VERSION in src/main.cpp
  --duration-ms <ms>          Successful observation duration (default: 300000)
  --interval-ms <ms>          Delay between observations (default: 10000)
  --timeout-ms <ms>           Timeout for each request (default: 8000)
  --max-consecutive-errors <n> Tolerated request errors only (default: 2)
  --write-checkpoint <path>   Write final non-sensitive continuity metadata
  --resume-checkpoint <path>  Require continuity from a prior soak checkpoint
  --require-sensor            Require SHT30 online throughout
  --require-cloud             Require last reported latest/history uploads healthy
  --require-time-synced       Require local history clock throughout
  --require-wifi              Require station-only Wi-Fi throughout
  --require-ap                Require fallback AP at 192.168.4.1 throughout
  -h, --help                  Show this help

Environment overrides: LONGOS_DEVICE_URL, LONGOS_EXPECTED_VERSION,
LONGOS_DEVICE_SOAK_DURATION_MS, LONGOS_DEVICE_SOAK_INTERVAL_MS,
LONGOS_DEVICE_TIMEOUT_MS, LONGOS_DEVICE_SOAK_MAX_ERRORS,
LONGOS_DEVICE_SOAK_WRITE_CHECKPOINT, LONGOS_DEVICE_SOAK_RESUME_CHECKPOINT`);
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }

  const parsedUrl = new URL(options.baseUrl);
  assert.match(parsedUrl.protocol, /^https?:$/, '--url must use HTTP or HTTPS');
  assert.equal(parsedUrl.username, '', '--url must not contain credentials');
  assert.equal(parsedUrl.password, '', '--url must not contain credentials');
  assert.ok(options.durationMs >= options.intervalMs, '--duration-ms must be at least --interval-ms');
  assert.equal(
    options.requireWifiConnected && options.requireAccessPoint,
    false,
    '--require-wifi and --require-ap are mutually exclusive'
  );
  assert.equal(
    options.requireCloud && options.requireAccessPoint,
    false,
    '--require-cloud cannot prove a live upload while the station is offline'
  );
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
    if (error?.name === 'AbortError') {
      throw new Error(`${path} timed out after ${timeoutMs} ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

const sleep = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
const options = parseOptions(process.argv.slice(2));
const sourceAppVersion = await sourceVersion();
const expectedVersion = certifiedDeviceVersion(sourceAppVersion, options.expectedVersion);
let resumeCheckpoint = null;
if (options.resumeCheckpoint) {
  try {
    resumeCheckpoint = JSON.parse(await readFile(options.resumeCheckpoint, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read soak checkpoint ${options.resumeCheckpoint}: ${error.message}`);
  }
}
const requireSampleGrowth = options.requireSensor && options.requireTimeSynced;
const tracker = new DeviceSoakTracker({
  requireSampleGrowth,
  minimumObservedDurationMs: options.durationMs
});
let lastEvidence = null;

const result = await runDeviceSoak({
  durationMs: options.durationMs,
  intervalMs: options.intervalMs,
  maxConsecutiveErrors: options.maxConsecutiveErrors,
  fetchObservation: async () => {
    const [health, readings] = await Promise.all([
      fetchJson(options.baseUrl, '/health', options.timeoutMs),
      fetchJson(options.baseUrl, '/api/readings', options.timeoutMs)
    ]);
    return { health, readings };
  },
  validateObservation: ({ health, readings }) => validateDeviceObservation({
    health,
    readings,
    expectedVersion,
    requireSensor: options.requireSensor,
    requireCloud: options.requireCloud,
    requireTimeSynced: options.requireTimeSynced,
    requireWifiConnected: options.requireWifiConnected,
    requireAccessPoint: options.requireAccessPoint
  }),
  tracker,
  monotonicNow: () => performance.now(),
  wallClockNow: () => Date.now(),
  sleep,
  validateFirstObservation: ({ snapshot, wallClockMs, localDayKey }) => {
    if (!resumeCheckpoint) return;
    const continuity = validateCheckpointContinuity({
      checkpoint: resumeCheckpoint,
      snapshot,
      wallClockMs,
      localDayKey
    });
    console.log(
      `Reconnect checkpoint: OK (uptime +${Math.round(continuity.uptimeDeltaMs / 1000)}s, ` +
      `local samples +${continuity.sampleGrowth})`
    );
  },
  onSample: ({ snapshot, observationCount, elapsedMs, wallClockMs, localDayKey }) => {
    lastEvidence = { snapshot, wallClockMs, localDayKey };
    console.log(
      `Soak sample ${observationCount}: elapsed ${Math.round(elapsedMs / 1000)}s, ` +
      `uptime ${Math.round(snapshot.uptimeMs / 1000)}s, today ${snapshot.todaySamples}, ` +
      `Wi-Fi ${snapshot.wifiMode}, cloud ${snapshot.cloudStatusCode}/${snapshot.cloudHistoryStatusCode}`
    );
  },
  onRequestError: ({ error, consecutiveErrors, maxConsecutiveErrors }) => {
    console.warn(`Transient soak request failure ${consecutiveErrors}/${maxConsecutiveErrors}: ${error.message}`);
  }
});

if (options.writeCheckpoint) {
  assert.ok(lastEvidence, 'cannot write a checkpoint without a successful observation');
  const checkpoint = createDeviceSoakCheckpoint(lastEvidence);
  await writeFile(options.writeCheckpoint, `${JSON.stringify(checkpoint, null, 2)}\n`, { mode: 0o600 });
  await chmod(options.writeCheckpoint, 0o600);
  console.log(`Continuity checkpoint: ${options.writeCheckpoint}`);
}

console.log('LongOS certified device soak: OK');
console.log(`Device: ${options.baseUrl}`);
console.log(`Firmware: ${expectedVersion}`);
console.log(
  `Evidence: ${result.observationCount} observations, ${Math.round(result.observedDurationMs / 1000)}s, ` +
  `uptime +${Math.round(result.uptimeGrowthMs / 1000)}s, local samples +${result.sampleGrowth}, ` +
  `request errors ${result.requestErrorCount}`
);
