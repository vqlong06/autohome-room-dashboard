import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFile(resolve(root, path), 'utf8');
const readBytes = (path) => readFile(resolve(root, path));

const [
  rootHtml,
  publicHtml,
  retiredHtml,
  rootManifestSource,
  publicManifestSource,
  webHtml,
  firmware,
  configHeader,
  secretsExample,
  snapshotSql,
  webAssetsHeader,
  webFavicon,
  webAppleTouchIcon
] = await Promise.all([
  read('index.html'),
  read('public/index.html'),
  read('index_v1.html'),
  read('manifest.webmanifest'),
  read('public/manifest.webmanifest'),
  read('web/index.html'),
  read('src/main.cpp'),
  read('include/longos_config.h'),
  read('include/secrets.example.h'),
  read('supabase/snapshot_room_readings.sql'),
  read('include/web_assets.h'),
  readBytes('web/favicon.svg'),
  readBytes('web/apple-touch-icon.png')
]);

function sliceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `Missing start marker: ${startMarker}`);
  assert.notEqual(end, -1, `Missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

function embeddedBytes(source, name) {
  const match = source.match(new RegExp(
    `static const uint8_t ${name}\\[\\] PROGMEM = \\{([\\s\\S]*?)\\};`
  ));
  assert.ok(match, `Embedded asset ${name} is missing`);
  const bytes = [...match[1].matchAll(/0x([0-9a-f]{2})/gi)]
    .map((entry) => Number.parseInt(entry[1], 16));
  assert.ok(bytes.length > 0, `Embedded asset ${name} is empty`);
  return Buffer.from(bytes);
}

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    api: {
      getItem(key) {
        return values.has(key) ? values.get(key) : null;
      },
      setItem(key, value) {
        values.set(key, String(value));
      },
      removeItem(key) {
        values.delete(key);
      }
    }
  };
}

assert.equal(rootHtml, publicHtml, 'Root HTML must match public HTML');
assert.equal(rootManifestSource, publicManifestSource, 'Root manifest must match public manifest');
assert.doesNotMatch(rootHtml, /longos-revision/i, 'Tracked HTML source must remain unstamped');
assert.doesNotMatch(publicHtml, /longos-revision/i, 'Public HTML source must remain unstamped');
assert.doesNotMatch(rootManifestSource, /"longos_revision"\s*:/, 'Tracked manifest source must remain unstamped');
assert.doesNotMatch(publicManifestSource, /"longos_revision"\s*:/, 'Public manifest source must remain unstamped');

const trackedPublicFiles = execFileSync('git', ['ls-files', 'public'], {
  cwd: root,
  encoding: 'utf8'
}).trim().split('\n');
assert.deepEqual(trackedPublicFiles, [
  'public/.nojekyll',
  'public/apple-touch-icon.png',
  'public/favicon.svg',
  'public/icon-192.png',
  'public/icon-512.png',
  'public/index.html',
  'public/manifest.webmanifest'
], 'Tracked public deploy files must match the release allowlist');

assert.doesNotMatch(retiredHtml, /AutoHome|Phòng của Long|autohome\./i, 'Retired entry page must not expose legacy branding or storage keys');
assert.match(retiredHtml, /<meta name="robots" content="noindex">/);
assert.match(retiredHtml, /<link rel="canonical" href="\.\/index\.html">/);
assert.match(retiredHtml, /window\.location\.replace\(target\.href\)/);
assert.ok(Buffer.byteLength(retiredHtml) < 5000, 'Retired entry page must stay a small redirect');

const redirectScriptMatch = retiredHtml.match(/<script>\s*([\s\S]*?)\s*<\/script>/);
assert.ok(redirectScriptMatch, 'Retired entry redirect script is missing');
let redirectedTo = '';
const redirectLocation = {
  href: 'https://example.com/LongOS/index_v1.html?source=cloud#history',
  search: '?source=cloud',
  hash: '#history',
  replace(value) {
    redirectedTo = value;
  }
};
vm.runInNewContext(redirectScriptMatch[1], { URL, window: { location: redirectLocation } });
assert.equal(redirectedTo, 'https://example.com/LongOS/index.html?source=cloud#history');

const rootManifest = JSON.parse(rootManifestSource);
assert.equal(Object.hasOwn(rootManifest, 'longos_revision'), false, 'Tracked manifest must not contain a release revision');
assert.equal(rootManifest.name, 'LongOS');
assert.equal(rootManifest.short_name, 'LongOS');
assert.equal(rootManifest.start_url, './?pwa=20260813.3');
assert.match(publicHtml, /name="longos-build" content="20260813\.3"/);
assert.match(publicHtml, /name="autohome-build" content="20260813\.3"/);
assert.match(publicHtml, /manifest\.webmanifest\?v=20260813\.3/);
assert.match(firmware, /longos-sensor-2026-08-02\.1/);

assert.match(publicHtml, /const CLOUD_POLL_INTERVAL_MS = 30 \* 1000;/);
assert.match(publicHtml, /const CLOUD_REQUEST_TIMEOUT_MS = 8 \* 1000;/);
assert.doesNotMatch(publicHtml, /x-dashboard-token|CLOUD_ACCESS_STORAGE_KEY|Nhập mã truy cập cloud/);

const cloudRequestBlock = sliceBetween(
  publicHtml,
  '    async function fetchJsonWithTimeout(url, options = {}) {',
  '\n\n    const state = {'
);
assert.match(cloudRequestBlock, /new AbortController\(\)/);
assert.match(cloudRequestBlock, /controller\.abort\(\)/);
assert.match(cloudRequestBlock, /signal: controller\.signal/);
assert.ok(
  cloudRequestBlock.indexOf('await response.json()') < cloudRequestBlock.indexOf('clearTimeout(timeout)'),
  'Cloud response body must be read before clearing the timeout'
);
assert.match(cloudRequestBlock, /clearTimeout\(timeout\)/);

const publicScriptMatch = publicHtml.match(/<script>\s*([\s\S]*?)\s*<\/script>/);
assert.ok(publicScriptMatch, 'Public dashboard script is missing');
new vm.Script(publicScriptMatch[1], { filename: 'public/index.html' });

const historyRefreshBlock = sliceBetween(
  publicHtml,
  '    function maybeFetchCloudHistory(force = false) {',
  '\n\n    async function fetchReading() {'
);
assert.match(historyRefreshBlock, /state\.historyFetchPromise/);
assert.match(historyRefreshBlock, /finally\(\(\) =>\s*{\s*state\.historyFetchPromise = null;/);
assert.match(historyRefreshBlock, /render\(state\.latestReading, false\)/);

const tickBlock = sliceBetween(
  publicHtml,
  '    async function tick() {',
  '\n\n    let dashboardResizeTimer'
);
assert.match(tickBlock, /state\.tickInFlight \|\| document\.hidden/);
assert.match(tickBlock, /finally\s*{\s*state\.tickInFlight = false;/);
assert.ok(
  tickBlock.indexOf('const reading = await fetchReading();') < tickBlock.indexOf('void maybeFetchCloudHistory();'),
  'Latest cloud reading must render before the heavier history request'
);
assert.match(tickBlock, /state\.latestReading = reading;\s*render\(reading\);\s*void maybeFetchCloudHistory\(\);/);
assert.doesNotMatch(tickBlock, /await maybeFetchCloudHistory/);

const localReadingBlock = sliceBetween(
  publicHtml,
  '    async function fetchReading() {',
  '\n\n    function clamp(value, min, max) {'
);
assert.match(localReadingBlock, /fetchJsonWithTimeout\(/);
assert.doesNotMatch(localReadingBlock, /await fetch\(/);

const pollingBlock = sliceBetween(
  publicHtml,
  '    let pollTimer = null;',
  "\n\n    document.getElementById('settingsBtn')"
);
assert.match(pollingBlock, /state\.cloudMode && !state\.demoMode/);
assert.match(pollingBlock, /Math\.max\(CLOUD_POLL_INTERVAL_MS, requestedMs\)/);
assert.match(pollingBlock, /setInterval\(\(\) => { void tick\(\); }, intervalMs\)/);

const firmwareVersionMatch = firmware.match(/const char \*APP_VERSION = "longos-sensor-(\d{4})-(\d{2})-(\d{2}\.\d+)";/);
assert.ok(firmwareVersionMatch, 'Firmware APP_VERSION format is invalid');
const webAssetVersion = `${firmwareVersionMatch[1]}${firmwareVersionMatch[2]}${firmwareVersionMatch[3]}`;
assert.ok(webHtml.includes(`favicon.svg?v=${webAssetVersion}`), 'Favicon cache version must match APP_VERSION');
assert.ok(webHtml.includes(`apple-touch-icon.png?v=${webAssetVersion}`), 'Apple icon cache version must match APP_VERSION');

const embeddedHtmlGzip = embeddedBytes(webAssetsHeader, 'INDEX_HTML_GZ');
const embeddedFaviconGzip = embeddedBytes(webAssetsHeader, 'FAVICON_SVG_GZ');
const embeddedAppleTouchIcon = embeddedBytes(webAssetsHeader, 'APPLE_TOUCH_ICON_PNG');
assert.deepEqual([...embeddedHtmlGzip.subarray(0, 3)], [0x1F, 0x8B, 0x08], 'Embedded HTML must have a gzip header');
assert.deepEqual([...embeddedFaviconGzip.subarray(0, 3)], [0x1F, 0x8B, 0x08], 'Embedded favicon must have a gzip header');
assert.equal(embeddedHtmlGzip[9], 0xFF, 'Embedded HTML gzip OS byte must be normalized');
assert.equal(embeddedFaviconGzip[9], 0xFF, 'Embedded favicon gzip OS byte must be normalized');
assert.equal(gunzipSync(embeddedHtmlGzip).toString('utf8'), webHtml, 'Embedded gzip HTML must match web/index.html');
assert.deepEqual(gunzipSync(embeddedFaviconGzip), webFavicon, 'Embedded gzip favicon must match web/favicon.svg');
assert.deepEqual(embeddedAppleTouchIcon, webAppleTouchIcon, 'Embedded Apple icon must match web/apple-touch-icon.png');
assert.ok(embeddedHtmlGzip.length < Buffer.byteLength(webHtml) / 2, 'Embedded HTML gzip must stay below 50% of the source size');
assert.ok(
  embeddedHtmlGzip.length + embeddedFaviconGzip.length + embeddedAppleTouchIcon.length < Buffer.byteLength(webHtml),
  'All embedded web assets together must stay smaller than the former raw HTML'
);
assert.match(firmware, /#include "web_assets\.h"/);
assert.doesNotMatch(firmware, /const char INDEX_HTML\[\]/);
assert.match(firmware, /server\.on\("\/favicon\.svg", HTTP_GET, handleFavicon\)/);
assert.match(firmware, /server\.on\("\/apple-touch-icon\.png", HTTP_GET, handleAppleTouchIcon\)/);
assert.match(firmware, /reinterpret_cast<PGM_P>\(INDEX_HTML_GZ\)/);
assert.match(firmware, /reinterpret_cast<PGM_P>\(FAVICON_SVG_GZ\)/);
assert.match(firmware, /reinterpret_cast<PGM_P>\(APPLE_TOUCH_ICON_PNG\)/);

const settingsBlock = sliceBetween(
  publicHtml,
  "    const SETTINGS_KEY = 'longos.settings.v1';",
  '\n\n    function isDarkTheme()'
);

function runSettings(initial, commands = '') {
  const storage = createStorage(initial);
  const context = { localStorage: storage.api };
  vm.runInNewContext(
    `${settingsBlock}\n${commands}\nglobalThis.__settings = settings;`,
    context
  );
  return { settings: context.__settings, values: storage.values };
}

const legacySettings = JSON.stringify({ theme: 'dark', lat: 10.5 });
const legacyOnly = runSettings({ 'autohome.settings.v1': legacySettings });
assert.equal(legacyOnly.settings.theme, 'dark');
assert.equal(legacyOnly.settings.lat, 10.5);
assert.equal(legacyOnly.values.get('longos.settings.v1'), legacySettings);

const newSettings = JSON.stringify({ theme: 'light', lat: 11.5 });
const newWins = runSettings({
  'longos.settings.v1': newSettings,
  'autohome.settings.v1': legacySettings
});
assert.equal(newWins.settings.theme, 'light');
assert.equal(newWins.settings.lat, 11.5);

const malformedFallback = runSettings({
  'longos.settings.v1': '{broken',
  'autohome.settings.v1': legacySettings
});
assert.equal(malformedFallback.settings.theme, 'dark');
assert.equal(malformedFallback.values.get('longos.settings.v1'), legacySettings);

const defaults = runSettings({});
assert.equal(defaults.settings.theme, 'auto');
assert.equal(defaults.settings.refreshSec, 1);

const saved = runSettings(
  { 'autohome.settings.v1': legacySettings },
  "settings.theme = 'light'; saveSettings();"
);
assert.equal(JSON.parse(saved.values.get('longos.settings.v1')).theme, 'light');
assert.equal(saved.values.get('autohome.settings.v1'), legacySettings);

const tokenKeys = sliceBetween(
  webHtml,
  "    const CLOUD_ACCESS_STORAGE_KEY = 'longos.cloudAccessToken.v1';",
  '\n    const HISTORY_PAGE_SIZE'
);
const tokenFunctions = sliceBetween(
  webHtml,
  "    if (params.get('reset_access') === '1') {",
  '\n\n    function cloudHeaders()'
);

function runToken(initial, search = '', commands = 'globalThis.__token = readCloudAccessToken();') {
  const storage = createStorage(initial);
  const context = {
    localStorage: storage.api,
    params: new URLSearchParams(search),
    state: { cloudAccessPrompted: false, cloudMode: true, demoMode: false },
    window: { prompt: () => null }
  };
  vm.runInNewContext(`${tokenKeys}\n${tokenFunctions}\n${commands}`, context);
  return { token: context.__token, values: storage.values };
}

const legacyToken = runToken({ 'autohome.cloudAccessToken.v1': ' legacy-token ' });
assert.equal(legacyToken.token, 'legacy-token');
assert.equal(legacyToken.values.get('longos.cloudAccessToken.v1'), 'legacy-token');

const primaryToken = runToken({
  'longos.cloudAccessToken.v1': 'new-token',
  'autohome.cloudAccessToken.v1': 'old-token'
});
assert.equal(primaryToken.token, 'new-token');

const resetToken = runToken(
  {
    'longos.cloudAccessToken.v1': 'new-token',
    'autohome.cloudAccessToken.v1': 'old-token'
  },
  '?reset_access=1'
);
assert.equal(resetToken.token, '');
assert.equal(resetToken.values.has('longos.cloudAccessToken.v1'), false);
assert.equal(resetToken.values.has('autohome.cloudAccessToken.v1'), false);

const savedToken = runToken(
  { 'autohome.cloudAccessToken.v1': 'old-token' },
  '',
  "saveCloudAccessToken('saved-token'); globalThis.__token = readCloudAccessToken();"
);
assert.equal(savedToken.token, 'saved-token');
assert.equal(savedToken.values.get('longos.cloudAccessToken.v1'), 'saved-token');
assert.equal(savedToken.values.get('autohome.cloudAccessToken.v1'), 'old-token');

const configNames = [
  'WIFI_SSID',
  'WIFI_PASSWORD',
  'AP_PASSWORD',
  'SUPABASE_URL',
  'SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_ROOM_ID',
  'SUPABASE_DEVICE_TOKEN'
];

for (const name of configNames) {
  assert.match(configHeader, new RegExp(`#ifndef LONGOS_${name}`));
  assert.match(configHeader, new RegExp(`#ifdef AUTOHOME_${name}`));
  assert.match(configHeader, new RegExp(`#define LONGOS_${name} AUTOHOME_${name}`));
  assert.match(secretsExample, new RegExp(`#define LONGOS_${name}`));
  assert.doesNotMatch(secretsExample, new RegExp(`#define AUTOHOME_${name}`));
}

assert.match(firmware, /LEGACY_HISTORY_NAMESPACE = "autohome"/);
assert.match(snapshotSql, /'autohome-snapshot'/);
assert.match(snapshotSql, /'autohome-cleanup'/);

console.log('LongOS brand migration tests: OK');
