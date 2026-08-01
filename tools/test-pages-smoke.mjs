import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultSiteUrl = 'https://vqlong06.github.io/autohome-room-dashboard/';

function usage() {
  console.log(`Usage: node tools/test-pages-smoke.mjs [options]

Options:
  --url <url>               Pages base URL (default: ${defaultSiteUrl})
  --expected-build <value>  Expected longos-build value, or "live" (default: public/index.html)
  --timeout-ms <ms>         Timeout for each request (default: 10000)
  --attempts <count>        Attempts while deployment propagates (default: 6)
  --retry-ms <ms>           Delay between attempts (default: 5000)
  --require-cloud           Verify anonymous Supabase reads without exposing telemetry
  -h, --help                Show this help

Environment overrides: LONGOS_PAGES_URL, LONGOS_PAGES_EXPECTED_BUILD,
LONGOS_PAGES_TIMEOUT_MS, LONGOS_PAGES_ATTEMPTS, LONGOS_PAGES_RETRY_MS`);
}

function positiveInteger(value, label) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

function parseArgs(argv) {
  const options = {
    url: process.env.LONGOS_PAGES_URL || defaultSiteUrl,
    expectedBuild: process.env.LONGOS_PAGES_EXPECTED_BUILD || '',
    timeoutMs: positiveInteger(process.env.LONGOS_PAGES_TIMEOUT_MS || '10000', 'timeout'),
    attempts: positiveInteger(process.env.LONGOS_PAGES_ATTEMPTS || '6', 'attempts'),
    retryMs: positiveInteger(process.env.LONGOS_PAGES_RETRY_MS || '5000', 'retry delay'),
    requireCloud: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const nextValue = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`${argument} requires a value`);
      return argv[index];
    };

    if (argument === '--url') options.url = nextValue();
    else if (argument === '--expected-build') options.expectedBuild = nextValue();
    else if (argument === '--timeout-ms') options.timeoutMs = positiveInteger(nextValue(), 'timeout');
    else if (argument === '--attempts') options.attempts = positiveInteger(nextValue(), 'attempts');
    else if (argument === '--retry-ms') options.retryMs = positiveInteger(nextValue(), 'retry delay');
    else if (argument === '--require-cloud') options.requireCloud = true;
    else if (argument === '--help' || argument === '-h') {
      usage();
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }

  return options;
}

function matchValue(source, pattern, label) {
  const match = source.match(pattern);
  assert.ok(match, `${label} is missing`);
  return match[1];
}

function metaContent(source, name) {
  return matchValue(
    source,
    new RegExp(`<meta\\s+name=["']${name}["']\\s+content=["']([^"']+)["']`, 'i'),
    `${name} meta tag`
  );
}

function javascriptConstant(source, name) {
  return matchValue(
    source,
    new RegExp(`const\\s+${name}\\s*=\\s*['"]([^'"]+)['"]\\s*;`),
    name
  );
}

const options = parseArgs(process.argv.slice(2));
const localPublicHtml = await readFile(resolve(root, 'public/index.html'), 'utf8');
let expectedBuild = options.expectedBuild || metaContent(localPublicHtml, 'longos-build');
const baseUrl = new URL(options.url);
assert.match(baseUrl.protocol, /^https?:$/, 'Pages URL must use HTTP or HTTPS');
baseUrl.search = '';
baseUrl.hash = '';
if (!baseUrl.pathname.endsWith('/')) baseUrl.pathname += '/';

const sleep = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));

async function retry(label, operation) {
  let lastError;
  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < options.attempts) await sleep(options.retryMs);
    }
  }
  throw new Error(`${label} failed after ${options.attempts} attempts: ${lastError?.message || lastError}`);
}

async function fetchResource(target, { expectedStatus = 200, headers = {}, binary = false } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await fetch(target, {
      cache: 'no-store',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'LongOS-production-smoke/1',
        ...headers
      }
    });
    assert.equal(response.status, expectedStatus, `${new URL(target).pathname} returned HTTP ${response.status}`);
    const body = binary ? Buffer.from(await response.arrayBuffer()) : await response.text();
    return { response, body };
  } finally {
    clearTimeout(timer);
  }
}

function siteUrl(path) {
  const target = new URL(path, baseUrl);
  target.searchParams.set('_longos_smoke', expectedBuild);
  return target;
}

async function verifyPng(path, expectedSize, label) {
  await retry(label, async () => {
    const { response, body } = await fetchResource(siteUrl(path), { binary: true });
    assert.match(response.headers.get('content-type') || '', /^image\/png/i);
    assert.ok(body.length >= 24, `${label} is truncated`);
    assert.deepEqual([...body.subarray(0, 8)], [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    assert.equal(body.readUInt32BE(16), expectedSize, `${label} width is incorrect`);
    assert.equal(body.readUInt32BE(20), expectedSize, `${label} height is incorrect`);
  });
}

const html = await retry('deployed HTML', async () => {
  const result = await fetchResource(siteUrl('./'));
  const deployedBuild = metaContent(result.body, 'longos-build');
  assert.match(deployedBuild, /^\d{8}\.\d+$/, 'Pages build marker has an invalid format');
  if (expectedBuild === 'live') expectedBuild = deployedBuild;
  else assert.equal(deployedBuild, expectedBuild, 'Pages is serving a stale LongOS build');
  assert.match(result.body, /<title>LongOS — Không gian của Long<\/title>/);
  assert.match(result.body, /function cloudHeaders\(\)\s*{[\s\S]*?apikey:[\s\S]*?Authorization:/);
  assert.doesNotMatch(result.body, /x-dashboard-token|CLOUD_ACCESS_STORAGE_KEY|Nhập mã truy cập cloud/);
  return result.body;
});

await retry('index.html', async () => {
  const { body } = await fetchResource(siteUrl('./index.html'));
  assert.equal(metaContent(body, 'longos-build'), expectedBuild);
});

await retry('manifest', async () => {
  const { response, body } = await fetchResource(siteUrl('./manifest.webmanifest'));
  assert.match(response.headers.get('content-type') || '', /application\/(manifest\+json|json)/i);
  const manifest = JSON.parse(body);
  assert.equal(manifest.name, 'LongOS');
  assert.equal(manifest.short_name, 'LongOS');
  assert.equal(manifest.start_url, `./?pwa=${expectedBuild}`);
});

await retry('favicon', async () => {
  const { response, body } = await fetchResource(siteUrl('./favicon.svg'));
  assert.match(response.headers.get('content-type') || '', /^image\/svg\+xml/i);
  assert.match(body, /<svg\b/);
});

await verifyPng('./apple-touch-icon.png', 180, 'Apple touch icon');
await verifyPng('./icon-192.png', 192, '192px PWA icon');
await verifyPng('./icon-512.png', 512, '512px PWA icon');

await retry('.nojekyll', () => fetchResource(siteUrl('./.nojekyll')));

const forbiddenPaths = [
  'README.md',
  'src/main.cpp',
  'include/secrets.h',
  'include/secrets.example.h',
  'supabase/room_latest.sql',
  'web/index.html',
  '.github/workflows/pages.yml'
];
for (const path of forbiddenPaths) {
  await retry(`private boundary ${path}`, () => fetchResource(siteUrl(path), { expectedStatus: 404 }));
}

if (options.requireCloud) {
  const supabaseUrl = new URL(javascriptConstant(html, 'SUPABASE_URL'));
  assert.equal(supabaseUrl.protocol, 'https:', 'Supabase URL must use HTTPS');
  const publishableKey = javascriptConstant(html, 'SUPABASE_PUBLISHABLE_KEY');
  const roomId = javascriptConstant(html, 'SUPABASE_ROOM_ID');
  const cloudHeaders = {
    apikey: publishableKey,
    Authorization: `Bearer ${publishableKey}`,
    Origin: baseUrl.origin
  };

  for (const table of ['room_latest', 'room_readings']) {
    await retry(`Supabase ${table} read contract`, async () => {
      const endpoint = new URL(`/rest/v1/${table}`, supabaseUrl);
      endpoint.searchParams.set('room_id', `eq.${roomId}`);
      endpoint.searchParams.set('select', 'room_id');
      endpoint.searchParams.set('limit', '1');
      const { response, body } = await fetchResource(endpoint, { headers: cloudHeaders });
      const allowOrigin = response.headers.get('access-control-allow-origin');
      assert.ok(allowOrigin === '*' || allowOrigin === baseUrl.origin, `${table} CORS does not allow the Pages origin`);
      const rows = JSON.parse(body);
      assert.ok(Array.isArray(rows), `${table} response must be an array`);
      if (table === 'room_latest') {
        assert.ok(rows.length > 0, `${table} must expose the configured room to the public dashboard`);
      }
      assert.ok(rows.every((row) => row.room_id === roomId), `${table} returned an unexpected room`);
    });
  }
}

console.log('LongOS Pages smoke test: OK');
console.log(`Site: ${baseUrl.href}`);
console.log(`Build: ${expectedBuild}`);
console.log(`Public boundary: ${forbiddenPaths.length} private paths return 404`);
console.log(`Cloud read contract: ${options.requireCloud ? 'OK' : 'skipped'}`);
