import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const smokeScript = new URL('./test-pages-smoke.mjs', import.meta.url);
const siteOrigin = 'https://pages.example';
const siteBaseUrl = `${siteOrigin}/longos/`;
const supabaseOrigin = 'https://supabase.example';
const roomId = 'main-room';
const appVersion = 'longos-sensor-2026-08-01.3';
const strictAppVersion = 'longos-sensor-2026-08-02.1';

const [sourceHtml, manifest, favicon, appleIcon, icon192, icon512] = await Promise.all([
  readFile(resolve(root, 'public/index.html'), 'utf8'),
  readFile(resolve(root, 'public/manifest.webmanifest')),
  readFile(resolve(root, 'public/favicon.svg')),
  readFile(resolve(root, 'public/apple-touch-icon.png')),
  readFile(resolve(root, 'public/icon-192.png')),
  readFile(resolve(root, 'public/icon-512.png'))
]);

const buildMatch = sourceHtml.match(/<meta\s+name=["']longos-build["']\s+content=["']([^"']+)["']/i);
assert.ok(buildMatch, 'public/index.html must contain a LongOS build marker');
const expectedBuild = buildMatch[1];
const deployedHtml = sourceHtml
  .replace(/const SUPABASE_URL = '[^']+';/, `const SUPABASE_URL = '${supabaseOrigin}';`)
  .replace(/const SUPABASE_PUBLISHABLE_KEY = '[^']+';/, "const SUPABASE_PUBLISHABLE_KEY = 'test-publishable-key';")
  .replace(/const SUPABASE_ROOM_ID = '[^']+';/, `const SUPABASE_ROOM_ID = '${roomId}';`);

function response(body, { status = 200, contentType = 'text/plain', headers = {} } = {}) {
  return new Response(body, {
    status,
    headers: {
      'content-type': contentType,
      ...headers
    }
  });
}

function createFetchMock({
  staleLatest = false,
  staleHistory = false,
  privateSchemaExposed = false,
  privateSchemaErrorCode = 'PGRST106',
  latestVersion = appVersion,
  historyVersion = appVersion,
  cadenceVersion = strictAppVersion,
  cadenceAgesMs = [60 * 1000, 11 * 60 * 1000, 21 * 60 * 1000],
  cadenceBootEpochOffsetsMs = [],
  fixtureBootAgeMs = 60 * 60 * 1000
} = {}) {
  const calls = [];
  const fixtureNowMs = Date.now();
  const fixtureBootEpochMs = fixtureNowMs - fixtureBootAgeMs;
  const latestUpdatedAtMs = fixtureNowMs - (staleLatest ? 4 * 60 * 1000 : 30 * 1000);
  const latest = {
    room_id: roomId,
    updated_at: new Date(latestUpdatedAtMs).toISOString(),
    app_version: latestVersion,
    device_online: true,
    wifi_connected: true,
    sensor_online: true,
    uptime_ms: latestUpdatedAtMs - fixtureBootEpochMs
  };
  const history = {
    room_id: roomId,
    recorded_at: new Date(fixtureNowMs - (staleHistory ? 21 * 60 * 1000 : 10 * 60 * 1000)).toISOString(),
    app_version: historyVersion,
    sensor_online: true
  };
  const cadenceRows = cadenceAgesMs.map((ageMs, index) => {
    const recordedAtMs = fixtureNowMs - ageMs;
    return {
      room_id: roomId,
      recorded_at: new Date(recordedAtMs).toISOString(),
      app_version: cadenceVersion,
      sensor_online: true,
      uptime_ms: recordedAtMs - (fixtureBootEpochMs + (cadenceBootEpochOffsetsMs[index] || 0))
    };
  });

  const fetchMock = async (target, init = {}) => {
    const url = new URL(String(target));
    const headers = new Headers(init.headers || {});
    calls.push({ url, headers });

    if (url.origin === supabaseOrigin) {
      if (headers.get('Accept-Profile') === 'longos_private') {
        return privateSchemaExposed
          ? response(JSON.stringify([]), { contentType: 'application/json' })
          : response(JSON.stringify({ code: privateSchemaErrorCode }), {
            status: 406,
            contentType: 'application/json'
          });
      }

      const cloudHeaders = {
        'access-control-allow-origin': '*'
      };
      if (url.searchParams.get('room_id') !== `eq.${roomId}`) {
        return response(JSON.stringify({ code: 'TEST_ROOM_FILTER_MISSING' }), {
          status: 400,
          contentType: 'application/json',
          headers: cloudHeaders
        });
      }
      if (url.pathname === '/rest/v1/room_latest') {
        return response(JSON.stringify([latest]), { contentType: 'application/json', headers: cloudHeaders });
      }
      if (url.pathname === '/rest/v1/room_readings') {
        const rows = url.searchParams.get('limit') === '100' ? cadenceRows : [history];
        return response(JSON.stringify(rows), { contentType: 'application/json', headers: cloudHeaders });
      }
    }

    if (url.origin === siteOrigin && url.pathname.startsWith('/longos/')) {
      const path = url.pathname.slice('/longos/'.length);
      if (path === '' || path === 'index.html') return response(deployedHtml, { contentType: 'text/html' });
      if (path === 'manifest.webmanifest') {
        return response(manifest, { contentType: 'application/manifest+json' });
      }
      if (path === 'favicon.svg') return response(favicon, { contentType: 'image/svg+xml' });
      if (path === 'apple-touch-icon.png') return response(appleIcon, { contentType: 'image/png' });
      if (path === 'icon-192.png') return response(icon192, { contentType: 'image/png' });
      if (path === 'icon-512.png') return response(icon512, { contentType: 'image/png' });
      if (path === '.nojekyll') return response('');
      return response('Not found', { status: 404 });
    }

    throw new Error(`Unexpected smoke request: ${url.href}`);
  };

  return { calls, fetchMock };
}

async function runScenario(name, fixture = {}, cli = {}) {
  const originalArgv = process.argv;
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  const logs = [];
  const { calls, fetchMock } = createFetchMock(fixture);
  process.argv = [process.execPath, fileURLToPath(smokeScript),
    '--url', siteBaseUrl,
    '--expected-build', expectedBuild,
    '--attempts', '1',
    '--require-cloud-health'];
  if (cli.expectedCloudVersion) {
    process.argv.push('--expected-cloud-version', cli.expectedCloudVersion);
  }
  if (cli.requireHistoryCadence) {
    process.argv.push('--require-history-cadence');
  }
  globalThis.fetch = fetchMock;
  console.log = (...values) => logs.push(values.join(' '));

  let error = null;
  try {
    await import(`${smokeScript.href}?scenario=${encodeURIComponent(name)}`);
  } catch (caught) {
    error = caught;
  } finally {
    process.argv = originalArgv;
    globalThis.fetch = originalFetch;
    console.log = originalLog;
  }

  return { calls, error, logs };
}

const passing = await runScenario('pass');
assert.equal(passing.error, null);
assert.ok(passing.logs.includes('LongOS Pages smoke test: OK'));
assert.ok(passing.logs.some((line) => line.startsWith('Cloud health: OK')));
assert.ok(passing.logs.includes('Cloud private schema: hidden'));
assert.ok(passing.logs.every((line) => !line.includes('test-publishable-key')));

const latestCall = passing.calls.find((call) =>
  call.url.pathname === '/rest/v1/room_latest' && call.headers.get('Accept-Profile') === null
);
assert.ok(latestCall, 'health smoke must query room_latest');
assert.equal(
  latestCall.url.searchParams.get('select'),
  'room_id,updated_at,app_version,device_online,wifi_connected,sensor_online,uptime_ms'
);
assert.equal(latestCall.url.searchParams.get('room_id'), `eq.${roomId}`);
assert.equal(latestCall.url.searchParams.get('limit'), '1');
const historyCall = passing.calls.find((call) => call.url.pathname === '/rest/v1/room_readings');
assert.ok(historyCall, 'health smoke must query room_readings');
assert.equal(historyCall.url.searchParams.get('select'), 'room_id,recorded_at,app_version,sensor_online');
assert.equal(historyCall.url.searchParams.get('room_id'), `eq.${roomId}`);
assert.equal(historyCall.url.searchParams.get('order'), 'recorded_at.desc');
assert.equal(historyCall.url.searchParams.get('limit'), '1');
assert.ok(passing.calls.some((call) => call.headers.get('Accept-Profile') === 'longos_private'));
assert.equal([...latestCall.url.searchParams.values()].some((value) => /temperature|humidity/i.test(value)), false);
assert.equal([...historyCall.url.searchParams.values()].some((value) => /temperature|humidity/i.test(value)), false);

const staleLatest = await runScenario('stale-latest', { staleLatest: true });
assert.match(staleLatest.error?.message || '', /latest\.updated_at is stale/);

const staleHistory = await runScenario('stale-history', { staleHistory: true });
assert.match(staleHistory.error?.message || '', /history\.recorded_at is stale/);

const exposedPrivateSchema = await runScenario('private-schema-exposed', { privateSchemaExposed: true });
assert.match(exposedPrivateSchema.error?.message || '', /Supabase private schema boundary failed/);
assert.match(exposedPrivateSchema.error?.message || '', /returned HTTP 200/);

const wrongPrivateSchemaError = await runScenario('private-schema-wrong-error', {
  privateSchemaErrorCode: 'PGRST999'
});
assert.match(wrongPrivateSchemaError.error?.message || '', /must reject an unexposed schema/);

const strictPassing = await runScenario('strict-pass', {
  latestVersion: strictAppVersion,
  historyVersion: strictAppVersion
}, {
  expectedCloudVersion: strictAppVersion,
  requireHistoryCadence: true
});
assert.equal(strictPassing.error, null);
assert.ok(strictPassing.logs.some((line) => line.startsWith('Cloud history cadence: OK (3 samples')));
assert.ok(strictPassing.logs.every((line) => !line.includes('test-publishable-key')));
assert.ok(strictPassing.logs.every((line) => !/2026-\d{2}-\d{2}T/.test(line)));

const strictCadenceCall = strictPassing.calls.find((call) =>
  call.url.pathname === '/rest/v1/room_readings' && call.url.searchParams.get('limit') === '100'
);
assert.ok(strictCadenceCall, 'strict smoke must query a bounded history cadence window');
assert.equal(strictCadenceCall.url.searchParams.get('room_id'), `eq.${roomId}`);
assert.equal(strictCadenceCall.url.searchParams.get('app_version'), `eq.${strictAppVersion}`);
assert.match(strictCadenceCall.url.searchParams.get('recorded_at') || '', /^gte\./);
assert.equal(
  strictCadenceCall.url.searchParams.get('select'),
  'room_id,recorded_at,app_version,sensor_online,uptime_ms'
);
assert.equal(strictCadenceCall.url.searchParams.get('order'), 'recorded_at.desc');
assert.equal([...strictCadenceCall.url.searchParams.values()].some((value) => /temperature|humidity/i.test(value)), false);

const wrongStrictLatest = await runScenario('strict-wrong-latest', {
  latestVersion: appVersion,
  historyVersion: strictAppVersion
}, { expectedCloudVersion: strictAppVersion });
assert.match(wrongStrictLatest.error?.message || '', /latest\.app_version does not match expectedAppVersion/);

const wrongStrictHistory = await runScenario('strict-wrong-history', {
  latestVersion: strictAppVersion,
  historyVersion: appVersion
}, { expectedCloudVersion: strictAppVersion });
assert.match(wrongStrictHistory.error?.message || '', /history\.app_version does not match expectedAppVersion/);

const insufficientCadence = await runScenario('strict-insufficient-cadence', {
  latestVersion: strictAppVersion,
  historyVersion: strictAppVersion,
  cadenceAgesMs: [60 * 1000, 11 * 60 * 1000]
}, {
  expectedCloudVersion: strictAppVersion,
  requireHistoryCadence: true
});
assert.match(insufficientCadence.error?.message || '', /requires at least 3 same-boot samples/);

const shortCadence = await runScenario('strict-short-cadence', {
  latestVersion: strictAppVersion,
  historyVersion: strictAppVersion,
  cadenceAgesMs: [60 * 1000, 90 * 1000, 11 * 60 * 1000]
}, {
  expectedCloudVersion: strictAppVersion,
  requireHistoryCadence: true
});
assert.match(shortCadence.error?.message || '', /history cadence gap is below/);

const previousBootCadence = await runScenario('strict-previous-boot-cadence', {
  latestVersion: strictAppVersion,
  historyVersion: strictAppVersion,
  cadenceBootEpochOffsetsMs: [0, 0, 60 * 1000]
}, {
  expectedCloudVersion: strictAppVersion,
  requireHistoryCadence: true
});
assert.match(previousBootCadence.error?.message || '', /different device boot after the current boot started/);

const ignoredPreviousBoot = await runScenario('strict-ignore-previous-boot-before-current', {
  latestVersion: strictAppVersion,
  historyVersion: strictAppVersion,
  fixtureBootAgeMs: 30 * 60 * 1000,
  cadenceAgesMs: [60 * 1000, 11 * 60 * 1000, 21 * 60 * 1000, 30 * 60 * 1000 + 10 * 1000],
  cadenceBootEpochOffsetsMs: [0, 0, 0, -60 * 60 * 1000]
}, {
  expectedCloudVersion: strictAppVersion,
  requireHistoryCadence: true
});
assert.equal(ignoredPreviousBoot.error, null);
assert.ok(ignoredPreviousBoot.logs.some((line) => line.startsWith('Cloud history cadence: OK (3 samples')));

const insufficientCurrentBoot = await runScenario('strict-ignore-old-but-insufficient-current', {
  latestVersion: strictAppVersion,
  historyVersion: strictAppVersion,
  fixtureBootAgeMs: 30 * 60 * 1000,
  cadenceAgesMs: [60 * 1000, 11 * 60 * 1000, 30 * 60 * 1000 + 10 * 1000],
  cadenceBootEpochOffsetsMs: [0, 0, -60 * 60 * 1000]
}, {
  expectedCloudVersion: strictAppVersion,
  requireHistoryCadence: true
});
assert.match(insufficientCurrentBoot.error?.message || '', /requires at least 3 same-boot samples/);

const truncatedCadence = await runScenario('strict-truncated-cadence', {
  latestVersion: strictAppVersion,
  historyVersion: strictAppVersion,
  cadenceAgesMs: Array.from({ length: 100 }, (_, index) => index * 10 * 1000)
}, {
  expectedCloudVersion: strictAppVersion,
  requireHistoryCadence: true
});
assert.match(truncatedCadence.error?.message || '', /reached maxRows and may be truncated/);

console.log('LongOS Pages smoke integration tests: OK');
