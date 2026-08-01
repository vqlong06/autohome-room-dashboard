import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parseOptions(args) {
  const options = {
    baseUrl: process.env.LONGOS_DEVICE_URL || 'http://longos-sensor.local',
    expectedVersion: process.env.LONGOS_EXPECTED_VERSION || '',
    timeoutMs: Number(process.env.LONGOS_DEVICE_TIMEOUT_MS || 8000),
    requireSensor: false,
    requireCloud: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--url') {
      options.baseUrl = args[++index];
    } else if (argument === '--expected-version') {
      options.expectedVersion = args[++index];
    } else if (argument === '--timeout-ms') {
      options.timeoutMs = Number(args[++index]);
    } else if (argument === '--require-sensor') {
      options.requireSensor = true;
    } else if (argument === '--require-cloud') {
      options.requireCloud = true;
    } else if (argument === '--help' || argument === '-h') {
      console.log(`Usage: node tools/test-device-smoke.mjs [options]

Options:
  --url <url>               Device base URL (default: http://longos-sensor.local)
  --expected-version <ver>  Firmware version (default: APP_VERSION in src/main.cpp)
  --timeout-ms <ms>         Timeout for each request (default: 8000)
  --require-sensor          Require an online sensor with valid readings
  --require-cloud           Require successful latest/history cloud uploads
  -h, --help                Show this help

Environment overrides: LONGOS_DEVICE_URL, LONGOS_EXPECTED_VERSION,
LONGOS_DEVICE_TIMEOUT_MS`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  assert.ok(options.baseUrl, '--url must not be empty');
  assert.ok(Number.isFinite(options.timeoutMs) && options.timeoutMs > 0, '--timeout-ms must be a positive number');
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

async function fetchResource(baseUrl, path, timeoutMs, accept) {
  const url = endpointUrl(baseUrl, path);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: { Accept: accept },
      signal: controller.signal
    });
    assert.ok(response.ok, `${path} returned HTTP ${response.status}`);
    const body = Buffer.from(await response.arrayBuffer());
    return { response, body };
  } catch (error) {
    if (error?.name === 'AbortError') {
      assert.fail(`${path} timed out after ${timeoutMs} ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(baseUrl, path, timeoutMs) {
  const { response, body } = await fetchResource(baseUrl, path, timeoutMs, 'application/json');
  assert.match(response.headers.get('content-type') || '', /^application\/json\b/i, `${path} must return JSON`);

  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    assert.fail(`${path} returned invalid JSON`);
  }
}

function contentLength(response, name) {
  const value = Number(response.headers.get('content-length'));
  assert.ok(Number.isInteger(value) && value > 0, `${name} must return a positive Content-Length`);
  return value;
}

async function validateWebAssets(baseUrl, timeoutMs) {
  const [expectedHtml, expectedFavicon, expectedAppleTouchIcon] = await Promise.all([
    readFile(resolve(root, 'web/index.html')),
    readFile(resolve(root, 'web/favicon.svg')),
    readFile(resolve(root, 'web/apple-touch-icon.png'))
  ]);

  const index = await fetchResource(baseUrl, '/', timeoutMs, 'text/html');
  assert.match(index.response.headers.get('content-type') || '', /^text\/html\b/i, '/ must return HTML');
  assert.equal(index.response.headers.get('content-encoding'), 'gzip', '/ must use gzip content encoding');
  assert.match(index.response.headers.get('vary') || '', /\bAccept-Encoding\b/i, '/ must vary by Accept-Encoding');
  assert.match(index.response.headers.get('cache-control') || '', /\bno-store\b/i, '/ must disable caching');
  assert.ok(contentLength(index.response, '/') < expectedHtml.length / 2, '/ compressed body must stay below 50% of its source');
  assert.deepEqual(index.body, expectedHtml, 'served dashboard must match web/index.html');

  const favicon = await fetchResource(baseUrl, '/favicon.svg', timeoutMs, 'image/svg+xml');
  assert.match(favicon.response.headers.get('content-type') || '', /^image\/svg\+xml\b/i, 'favicon must return SVG');
  assert.equal(favicon.response.headers.get('content-encoding'), 'gzip', 'favicon must use gzip content encoding');
  assert.match(favicon.response.headers.get('vary') || '', /\bAccept-Encoding\b/i, 'favicon must vary by Accept-Encoding');
  assert.match(favicon.response.headers.get('cache-control') || '', /\bimmutable\b/i, 'favicon must be immutable');
  assert.ok(contentLength(favicon.response, 'favicon') < expectedFavicon.length, 'favicon gzip must be smaller than its source');
  assert.deepEqual(favicon.body, expectedFavicon, 'served favicon must match web/favicon.svg');

  const appleTouchIcon = await fetchResource(baseUrl, '/apple-touch-icon.png', timeoutMs, 'image/png');
  assert.match(appleTouchIcon.response.headers.get('content-type') || '', /^image\/png\b/i, 'Apple icon must return PNG');
  assert.equal(appleTouchIcon.response.headers.get('content-encoding'), null, 'Apple icon must not claim gzip encoding');
  assert.match(appleTouchIcon.response.headers.get('cache-control') || '', /\bimmutable\b/i, 'Apple icon must be immutable');
  assert.equal(contentLength(appleTouchIcon.response, 'Apple icon'), expectedAppleTouchIcon.length, 'Apple icon Content-Length is wrong');
  assert.deepEqual(appleTouchIcon.body, expectedAppleTouchIcon, 'served Apple icon must match web/apple-touch-icon.png');
}

function assertBoolean(value, name) {
  assert.equal(typeof value, 'boolean', `${name} must be a boolean`);
}

function assertNumber(value, name, { nullable = false, minimum = -Infinity } = {}) {
  if (nullable && value === null) {
    return;
  }
  assert.equal(typeof value, 'number', `${name} must be a number${nullable ? ' or null' : ''}`);
  assert.ok(Number.isFinite(value), `${name} must be finite`);
  assert.ok(value >= minimum, `${name} must be at least ${minimum}`);
}

function assertNonNegativeInteger(value, name) {
  assert.ok(Number.isInteger(value) && value >= 0, `${name} must be a non-negative integer`);
}

function assertInteger(value, name) {
  assert.ok(Number.isInteger(value), `${name} must be an integer`);
}

function validateReadings(readings, expectedVersion, options) {
  assert.equal(readings.appVersion, expectedVersion, 'readings appVersion does not match the local firmware');
  assert.equal(readings.deviceOnline, true, 'deviceOnline must be true for a local response');
  assertBoolean(readings.wifiConnected, 'wifiConnected');
  assert.ok(['STA', 'AP', 'AP+STA'].includes(readings.wifiMode), 'wifiMode must be STA, AP, or AP+STA');
  assertNumber(readings.wifiRssi, 'wifiRssi', { nullable: true });
  if (readings.wifiConnected) {
    assertNumber(readings.wifiRssi, 'wifiRssi');
  }
  assertNumber(readings.freeHeap, 'freeHeap', { minimum: 1 });
  assertNumber(readings.chipTemperatureC, 'chipTemperatureC', { nullable: true });
  assertNumber(readings.lastSensorOkMs, 'lastSensorOkMs', { nullable: true, minimum: 0 });
  assertNumber(readings.temperatureC, 'temperatureC', { nullable: true });
  assertNumber(readings.humidity, 'humidity', { nullable: true, minimum: 0 });
  assertBoolean(readings.sensorOnline, 'sensorOnline');
  assert.equal(typeof readings.source, 'string', 'source must be a string');
  assertNumber(readings.uptimeMs, 'uptimeMs', { minimum: 0 });
  assert.equal(typeof readings.ip, 'string', 'ip must be a string');
  assert.ok(readings.ip.length > 0, 'ip must not be empty');

  if (readings.sensorOnline) {
    assertNumber(readings.temperatureC, 'temperatureC');
    assertNumber(readings.humidity, 'humidity', { minimum: 0 });
    assert.equal(readings.source, 'SHT30', 'online sensor source must be SHT30');
  } else {
    assert.equal(readings.temperatureC, null, 'offline sensor temperatureC must be null');
    assert.equal(readings.humidity, null, 'offline sensor humidity must be null');
  }

  if (options.requireSensor) {
    assert.equal(readings.sensorOnline, true, 'sensor is required but offline');
  }

  assertBoolean(readings.cloudEnabled, 'cloudEnabled');
  assertBoolean(readings.cloudUploadOk, 'cloudUploadOk');
  assertInteger(readings.cloudStatusCode, 'cloudStatusCode');
  assertBoolean(readings.cloudHistoryOk, 'cloudHistoryOk');
  assertInteger(readings.cloudHistoryStatusCode, 'cloudHistoryStatusCode');

  if (options.requireCloud) {
    assert.equal(readings.cloudEnabled, true, 'cloud is required but not configured');
    assert.equal(readings.cloudUploadOk, true, `latest cloud upload failed with HTTP ${readings.cloudStatusCode}`);
    assert.ok(readings.cloudStatusCode >= 200 && readings.cloudStatusCode < 300, 'latest cloud status must be 2xx');
    assert.equal(readings.cloudHistoryOk, true, `history cloud upload failed with HTTP ${readings.cloudHistoryStatusCode}`);
    assert.ok(readings.cloudHistoryStatusCode >= 200 && readings.cloudHistoryStatusCode < 300, 'history cloud status must be 2xx');
  }

  assert.ok(readings.stats && typeof readings.stats === 'object' && !Array.isArray(readings.stats), 'stats must be an object');
  assertBoolean(readings.stats.timeSynced, 'stats.timeSynced');
  assertNonNegativeInteger(readings.stats.daysStored, 'stats.daysStored');

  for (const name of [
    'todayAvgC',
    'yesterdayAvgC',
    'currentWeekAvgC',
    'previousWeekAvgC',
    'todayMinC',
    'todayMaxC',
    'todayMinHumidity',
    'todayMaxHumidity',
    'temperatureTrend1hC',
    'humidityTrend1h'
  ]) {
    assertNumber(readings.stats[name], `stats.${name}`, { nullable: true });
  }

  for (const name of [
    'todaySamples',
    'yesterdaySamples',
    'currentWeekSamples',
    'previousWeekSamples'
  ]) {
    assertNonNegativeInteger(readings.stats[name], `stats.${name}`);
  }
}

const options = parseOptions(process.argv.slice(2));
const expectedVersion = options.expectedVersion || await sourceVersion();
const [health, readings] = await Promise.all([
  fetchJson(options.baseUrl, '/health', options.timeoutMs),
  fetchJson(options.baseUrl, '/api/readings', options.timeoutMs)
]);

assert.equal(health.ok, true, 'health ok must be true');
assert.equal(health.appVersion, expectedVersion, 'health appVersion does not match the local firmware');
validateReadings(readings, expectedVersion, options);
await validateWebAssets(options.baseUrl, options.timeoutMs);

console.log('LongOS device smoke test: OK');
console.log(`Device: ${options.baseUrl}`);
console.log(`Firmware: ${readings.appVersion}`);
console.log(`Wi-Fi: ${readings.wifiMode}, RSSI ${readings.wifiRssi ?? 'n/a'} dBm`);
console.log(`Sensor: ${readings.sensorOnline ? `${readings.temperatureC} C, ${readings.humidity}%` : 'offline'}`);
console.log(`Cloud: latest ${readings.cloudStatusCode}, history ${readings.cloudHistoryStatusCode}`);
console.log('Web assets: gzip HTML/SVG and PNG OK');
