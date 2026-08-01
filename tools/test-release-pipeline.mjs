import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFile(resolve(root, path), 'utf8');

const [
  ciWorkflow,
  pagesWorkflow,
  productionWorkflow,
  pagesSmokeTest,
  deviceSoak,
  deviceSoakValidator,
  deviceSoakTest,
  platformio,
  gitignore,
  packageJsonSource,
  packageLockSource
] = await Promise.all([
  read('.github/workflows/ci.yml'),
  read('.github/workflows/pages.yml'),
  read('.github/workflows/production-smoke.yml'),
  read('tools/test-pages-smoke.mjs'),
  read('tools/device-soak.mjs'),
  read('tools/lib/device-soak.mjs'),
  read('tools/test-device-soak.mjs'),
  read('platformio.ini'),
  read('.gitignore'),
  read('package.json'),
  read('package-lock.json')
]);

const packageJson = JSON.parse(packageJsonSource);
const packageLock = JSON.parse(packageLockSource);

function assertUses(source, action) {
  assert.ok(source.includes(`uses: ${action}`), `Workflow must use ${action}`);
}

const pinnedActions = {
  checkout: 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7',
  setupNode: 'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7',
  cache: 'actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6',
  setupPython: 'actions/setup-python@5fda3b95a4ea91299a34e894583c3862153e4b97 # v7',
  configurePages: 'actions/configure-pages@45bfe0192ca1faeb007ade9deae92b16b8254a0d # v6',
  uploadPagesArtifact: 'actions/upload-pages-artifact@fc324d3547104276b827a68afc52ff2a11cc49c9 # v5',
  deployPages: 'actions/deploy-pages@cd2ce8fcbc39b97be8ca5fce6e763baed58fa128 # v5'
};

for (const action of [pinnedActions.checkout, pinnedActions.setupNode]) {
  assertUses(ciWorkflow, action);
  assertUses(pagesWorkflow, action);
  assertUses(productionWorkflow, action);
}

for (const action of [pinnedActions.cache, pinnedActions.setupPython]) {
  assertUses(ciWorkflow, action);
}

for (const action of [
  pinnedActions.configurePages,
  pinnedActions.uploadPagesArtifact,
  pinnedActions.deployPages
]) {
  assertUses(pagesWorkflow, action);
}

for (const workflow of [ciWorkflow, pagesWorkflow, productionWorkflow]) {
  const actionReferences = [...workflow.matchAll(/uses:\s+([^\s#]+)/g)].map((match) => match[1]);
  assert.ok(actionReferences.length > 0, 'Workflow must contain actions');
  for (const action of actionReferences) {
    assert.match(action, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/, `Action must be pinned to a full commit SHA: ${action}`);
  }
}

assert.match(ciWorkflow, /node-version:\s+24/);
assert.match(ciWorkflow, /python-version:\s+'3\.11'/);
assert.match(ciWorkflow, /platformio==6\.1\.19/);
assert.match(ciWorkflow, /test ! -e include\/secrets\.h/);
assert.match(ciWorkflow, /install -m 600 include\/secrets\.example\.h include\/secrets\.h/);
assert.match(ciWorkflow, /pio run -e esp32dev/);
assert.match(ciWorkflow, /node tools\/test-brand-migration\.mjs/);
assert.match(ciWorkflow, /node --check tools\/lib\/cloud-health\.mjs/);
assert.match(ciWorkflow, /node --check tools\/lib\/device-soak\.mjs/);
assert.match(ciWorkflow, /node --check tools\/device-soak\.mjs/);
assert.match(ciWorkflow, /node --check tools\/test-cloud-health\.mjs/);
assert.match(ciWorkflow, /node tools\/test-cloud-health\.mjs/);
assert.match(ciWorkflow, /node --check tools\/test-device-soak\.mjs/);
assert.match(ciWorkflow, /node tools\/test-device-soak\.mjs/);
assert.match(ciWorkflow, /node tools\/device-soak\.mjs --help/);
for (const command of [
  'node --check tools/lib/device-soak.mjs',
  'node --check tools/device-soak.mjs',
  'node --check tools/test-device-soak.mjs',
  'node tools/test-device-soak.mjs',
  'node tools/device-soak.mjs --help'
]) {
  const exactCommand = new RegExp(`^\\s+${command.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\s*$`, 'gm');
  assert.equal((ciWorkflow.match(exactCommand) || []).length, 1, `CI must run exactly one ${command}`);
}
const deviceSoakCiCommands = [...ciWorkflow.matchAll(/^\s+node tools\/device-soak\.mjs(?:\s+[^\n]*)?$/gm)]
  .map((match) => match[0].trim());
assert.deepEqual(
  deviceSoakCiCommands,
  ['node tools/device-soak.mjs --help'],
  'CI must never contact physical hardware through the device soak CLI'
);
assert.match(ciWorkflow, /^\s+node --check tools\/test-firmware-reliability\.mjs\s*$/m);
assert.match(ciWorkflow, /^\s+node tools\/test-firmware-reliability\.mjs\s*$/m);
assert.match(
  ciWorkflow,
  /^\s+c\+\+ -std=c\+\+11 -Wall -Wextra -Werror -pedantic -Iinclude tools\/test-firmware-retry-policy\.cpp -o "\$\{RUNNER_TEMP\}\/longos-firmware-retry-policy-test"\s*$/m
);
assert.match(ciWorkflow, /^\s+"\$\{RUNNER_TEMP\}\/longos-firmware-retry-policy-test"\s*$/m);
assert.doesNotMatch(
  ciWorkflow,
  /test-firmware-(?:reliability|retry-policy)[^\n]*(?:\|\||&&|;)\s*true/,
  'Firmware reliability gates must not suppress failures'
);
assert.doesNotMatch(
  ciWorkflow,
  /^\s*continue-on-error:\s*(?:true|\$\{\{\s*true\s*\}\})\s*$/m,
  'CI steps must not suppress failures'
);
assert.doesNotMatch(ciWorkflow, /^\s*if:\s*(?:false|\$\{\{\s*false\s*\}\})\s*$/m, 'CI steps must not disable gates');
assert.match(ciWorkflow, /node tools\/test-release-pipeline\.mjs/);
assert.match(ciWorkflow, /node --check tools\/test-pages-smoke\.mjs/);
assert.match(ciWorkflow, /node tools\/test-pages-smoke\.mjs --help/);
assert.match(ciWorkflow, /node --check tools\/test-pages-smoke-integration\.mjs/);
assert.match(ciWorkflow, /node tools\/test-pages-smoke-integration\.mjs/);
assert.match(ciWorkflow, /npm ci --ignore-scripts --no-audit --no-fund/);
assert.match(ciWorkflow, /node --check tools\/test-supabase-migrations\.mjs/);
assert.match(ciWorkflow, /npm run test:supabase-semantic/);
assert.match(ciWorkflow, /node --check tools\/test-supabase-security\.mjs/);
assert.match(ciWorkflow, /node tools\/test-supabase-security\.mjs/);
assert.match(ciWorkflow, /python-3\.11-platformio-6\.1\.19-/);
assert.equal((ciWorkflow.match(/persist-credentials:\s+false/g) || []).length, 2, 'CI checkouts must not persist credentials');

assert.match(pagesWorkflow, /branches:\s*\n\s*- main/);
assert.match(pagesWorkflow, /^permissions:\s*\{\}/m);
const buildJob = pagesWorkflow.slice(
  pagesWorkflow.indexOf('  build:'),
  pagesWorkflow.indexOf('\n  deploy:')
);
const deployJob = pagesWorkflow.slice(
  pagesWorkflow.indexOf('  deploy:'),
  pagesWorkflow.indexOf('\n  verify:')
);
const verifyJob = pagesWorkflow.slice(pagesWorkflow.indexOf('  verify:'));
assert.match(buildJob, /contents:\s+read/);
assert.match(buildJob, /pages:\s+read/);
assert.doesNotMatch(buildJob, /pages:\s+write|id-token:/, 'Pages build job must not receive deployment permissions');
assert.match(deployJob, /pages:\s+write/);
assert.match(deployJob, /id-token:\s+write/);
assert.doesNotMatch(deployJob, /contents:\s+write/, 'Pages deploy job must not receive content write access');
assert.match(deployJob, /page_url:\s+\$\{\{ steps\.deployment\.outputs\.page_url \}\}/);
assert.match(verifyJob, /needs:\s+deploy/);
assert.match(verifyJob, /contents:\s+read/);
assert.doesNotMatch(verifyJob, /pages:\s+write|id-token:/, 'Pages verify job must not receive deployment permissions');
assert.match(verifyJob, /node tools\/test-pages-smoke\.mjs/);
assert.match(verifyJob, /\$\{\{ needs\.deploy\.outputs\.page_url \}\}/);
assert.match(verifyJob, /--require-cloud(?:\s|$)/m);
assert.doesNotMatch(
  verifyJob,
  /--require-cloud-health|--expected-cloud-version|--require-history-cadence/,
  'Pages post-deploy verification must check the cloud contract without depending on device health'
);
assert.match(pagesWorkflow, /path:\s+\$\{\{ runner\.temp \}\}\/longos-pages/);
assert.match(pagesWorkflow, /include-hidden-files:\s+true/);
assert.match(pagesWorkflow, /environment:\s*\n\s+name:\s+github-pages/);
assert.match(pagesWorkflow, /needs:\s+build/);
assert.equal((pagesWorkflow.match(/persist-credentials:\s+false/g) || []).length, 2, 'Pages checkouts must not persist credentials');
assert.doesNotMatch(pagesWorkflow, /^\s*path:\s*(?:['"]?\.['"]?|public)\s*$/m, 'Pages must never upload the repository root or public directly');

assert.match(productionWorkflow, /cron:\s+'7,22,37,52 \* \* \* \*'/);
assert.match(productionWorkflow, /workflow_dispatch:/);
assert.match(productionWorkflow, /group:\s+longos-production-smoke/);
assert.match(productionWorkflow, /cancel-in-progress:\s+true/);
assert.match(productionWorkflow, /contents:\s+read/);
assert.doesNotMatch(productionWorkflow, /contents:\s+write|pages:\s+write|id-token:/);
assert.match(productionWorkflow, /node tools\/test-pages-smoke\.mjs/);
assert.match(productionWorkflow, /https:\/\/vqlong06\.github\.io\/autohome-room-dashboard\//);
assert.match(productionWorkflow, /--expected-build live/);
assert.match(productionWorkflow, /--attempts 1/);
assert.match(productionWorkflow, /--require-cloud-health/);
assert.doesNotMatch(
  productionWorkflow,
  /--expected-cloud-version|--require-history-cadence/,
  'Scheduled production health must stay firmware-compatible until a board release is explicitly promoted'
);
assert.match(productionWorkflow, /shell:\s+bash/);
assert.match(productionWorkflow, /for attempt in 1 2 3/);
assert.match(productionWorkflow, /sleep 20/);
assert.match(productionWorkflow, /exit 1/);
assert.match(productionWorkflow, /ref:\s+main/);
assert.equal((productionWorkflow.match(/persist-credentials:\s+false/g) || []).length, 1, 'Production checkout must not persist credentials');

assert.match(pagesSmokeTest, /const forbiddenPaths = \[/);
assert.match(pagesSmokeTest, /'include\/secrets\.h'/);
assert.match(pagesSmokeTest, /'include\/secrets\.example\.h'/);
assert.match(pagesSmokeTest, /'\.github\/workflows\/pages\.yml'/);
assert.match(pagesSmokeTest, /verifyPng\('\.\/icon-192\.png', 192/);
assert.match(pagesSmokeTest, /verifyPng\('\.\/icon-512\.png', 512/);
assert.match(pagesSmokeTest, /--require-cloud-health/);
assert.match(pagesSmokeTest, /--expected-cloud-version/);
assert.match(pagesSmokeTest, /--require-history-cadence/);
assert.match(pagesSmokeTest, /--latest-max-age-ms/);
assert.match(pagesSmokeTest, /--history-max-age-ms/);
assert.match(pagesSmokeTest, /LONGOS_CLOUD_LATEST_MAX_AGE_MS/);
assert.match(pagesSmokeTest, /LONGOS_CLOUD_HISTORY_MAX_AGE_MS/);
assert.match(pagesSmokeTest, /LONGOS_CLOUD_EXPECTED_VERSION/);
assert.match(pagesSmokeTest, /LONGOS_HISTORY_CADENCE_WINDOW_MS/);
assert.match(pagesSmokeTest, /LONGOS_HISTORY_MIN_SAMPLES/);
assert.match(pagesSmokeTest, /LONGOS_HISTORY_MIN_GAP_MS/);
assert.match(pagesSmokeTest, /DEFAULT_LATEST_MAX_AGE_MS/);
assert.match(pagesSmokeTest, /DEFAULT_HISTORY_MAX_AGE_MS/);
assert.match(pagesSmokeTest, /validateCloudHealth/);
assert.match(pagesSmokeTest, /validateHistoryCadence/);
assert.match(pagesSmokeTest, /from '\.\/lib\/cloud-health\.mjs'/);
assert.match(pagesSmokeTest, /if \(options\.requireCloudHealth\) options\.requireCloud = true/);
assert.match(pagesSmokeTest, /if \(options\.requireCloudHealth\)/);
assert.match(pagesSmokeTest, /room_id,updated_at,app_version,device_online,wifi_connected,sensor_online/);
assert.match(pagesSmokeTest, /room_id,recorded_at,app_version,sensor_online/);
assert.match(pagesSmokeTest, /Accept-Profile/);
assert.match(pagesSmokeTest, /longos_private/);
assert.match(pagesSmokeTest, /expectedStatus:\s*406/);
assert.match(pagesSmokeTest, /PGRST106/);
assert.match(pagesSmokeTest, /validateCloudHealth\(\{/);
assert.match(pagesSmokeTest, /latestMaxAgeMs:\s*options\.latestMaxAgeMs/);
assert.match(pagesSmokeTest, /historyMaxAgeMs:\s*options\.historyMaxAgeMs/);
assert.match(pagesSmokeTest, /expectedAppVersion:\s*options\.expectedCloudVersion/);
assert.match(pagesSmokeTest, /endpoint\.searchParams\.set\('app_version', `eq\.\$\{options\.expectedCloudVersion\}`\)/);
assert.match(pagesSmokeTest, /endpoint\.searchParams\.set\('limit', String\(DEFAULT_HISTORY_MAX_ROWS\)\)/);
assert.match(pagesSmokeTest, /rows\.length > 0/);
assert.match(pagesSmokeTest, /access-control-allow-origin/);
const cadenceBlockStart = pagesSmokeTest.lastIndexOf('  if (options.requireHistoryCadence) {');
const cadenceBlock = pagesSmokeTest.slice(
  cadenceBlockStart,
  pagesSmokeTest.indexOf('\n  }\n}\n\nconsole.log', cadenceBlockStart)
);
assert.match(cadenceBlock, /room_id,recorded_at,app_version,sensor_online,uptime_ms/);
assert.match(cadenceBlock, /expectedBootEpochMs/);
assert.match(cadenceBlock, /DEFAULT_HISTORY_BOOT_TOLERANCE_MS/);
assert.doesNotMatch(cadenceBlock, /temperature|humidity|SUPABASE_PUBLISHABLE_KEY|x-device-token/i);

assert.match(deviceSoak, /from '\.\/lib\/device-soak\.mjs'/);
assert.match(deviceSoak, /--expected-version/);
assert.match(deviceSoak, /--require-wifi/);
assert.match(deviceSoak, /--require-ap/);
assert.match(deviceSoak, /--require-sensor/);
assert.match(deviceSoak, /--require-cloud/);
assert.match(deviceSoak, /--require-time-synced/);
assert.match(deviceSoak, /--write-checkpoint/);
assert.match(deviceSoak, /--resume-checkpoint/);
assert.match(deviceSoak, /Promise\.all\(\[/);
assert.match(deviceSoak, /fetchJson\(options\.baseUrl, '\/health'/);
assert.match(deviceSoak, /fetchJson\(options\.baseUrl, '\/api\/readings'/);
assert.match(deviceSoak, /const requireSampleGrowth = options\.requireSensor && options\.requireTimeSynced/);
assert.match(deviceSoak, /Transient soak request failure/);
assert.match(deviceSoak, /certifiedDeviceVersion\(sourceAppVersion, options\.expectedVersion\)/);
assert.match(deviceSoak, /monotonicNow:\s*\(\) => performance\.now\(\)/);
assert.match(deviceSoak, /runDeviceSoak\(\{/);
assert.match(deviceSoak, /validateCheckpointContinuity\(\{/);
assert.match(deviceSoak, /createDeviceSoakCheckpoint\(lastEvidence\)/);
assert.match(deviceSoak, /writeFile\(options\.writeCheckpoint/);
assert.match(deviceSoak, /chmod\(options\.writeCheckpoint, 0o600\)/);
assert.doesNotMatch(deviceSoak, /include\/secrets\.h|WIFI_PASSWORD|SUPABASE_DEVICE_TOKEN/);

assert.match(deviceSoakValidator, /health\.appVersion does not match expectedVersion/);
assert.match(deviceSoakValidator, /readings\.appVersion does not match expectedVersion/);
assert.match(deviceSoakValidator, /certified device soak version must match APP_VERSION/);
assert.match(deviceSoakValidator, /station-only Wi-Fi after reconnect/);
assert.match(deviceSoakValidator, /fallback AP at 192\.168\.4\.1/);
assert.match(deviceSoakValidator, /device uptime must increase without reboot or stall/);
assert.match(deviceSoakValidator, /local history sample count stalled during soak/);
assert.match(deviceSoakValidator, /minimumSampleCoverage/);
assert.match(deviceSoakValidator, /verified local day rollover/);
assert.match(deviceSoakValidator, /longos-device-soak-checkpoint-v1/);
assert.match(deviceSoakValidator, /device uptime diverged across the checkpoint and may have rebooted/);
assert.match(deviceSoakValidator, /today sample count decreased across the reconnect checkpoint/);
assert.match(deviceSoakValidator, /successful device observations did not cover the configured soak duration/);
assert.match(deviceSoakValidator, /history status codes must be 2xx|latest\/history status codes must be 2xx/);
assert.match(deviceSoakTest, /LongOS device soak validator tests: OK/);

assert.match(platformio, /^platform\s*=\s*espressif32@6\.10\.0$/m);
assert.match(gitignore, /^include\/secrets\.h$/m);
assert.match(gitignore, /^public\/index_v\*\.html$/m);
assert.match(gitignore, /^node_modules\/$/m);

const pglitePackage = packageLock.packages?.['node_modules/@electric-sql/pglite'];
assert.equal(
  packageJson.scripts?.['test:supabase-semantic'],
  'node tools/test-supabase-migrations.mjs',
  'Semantic Supabase test command must remain explicit'
);
assert.equal(
  packageJson.devDependencies?.['@electric-sql/pglite'],
  '0.5.4',
  'PGlite must use an exact version pin'
);
assert.equal(packageLock.lockfileVersion, 3, 'npm lockfile version must remain reproducible');
assert.equal(
  packageLock.packages?.['']?.devDependencies?.['@electric-sql/pglite'],
  '0.5.4',
  'Lockfile root must preserve the exact PGlite pin'
);
assert.equal(pglitePackage?.version, '0.5.4', 'Lockfile must resolve PGlite 0.5.4');
assert.equal(
  pglitePackage?.resolved,
  'https://registry.npmjs.org/@electric-sql/pglite/-/pglite-0.5.4.tgz',
  'Lockfile must resolve the expected PGlite artifact'
);
assert.equal(
  pglitePackage?.integrity,
  'sha512-yYZUyyXrHU7tPlCjwZQJ6hIG9DscdCCn7Uk0mYKwC1FeHX286AbcmFveMiRBEak8e9iPupjsoVImN3yJZVed2g==',
  'Lockfile must preserve the verified PGlite integrity hash'
);
assert.equal(pglitePackage?.dev, true, 'PGlite must remain a development-only dependency');

const trackedFiles = execFileSync('git', ['ls-files'], {
  cwd: root,
  encoding: 'utf8'
}).trim().split('\n');
assert.equal(trackedFiles.includes('include/secrets.h'), false, 'Private firmware secrets must not be tracked');
assert.equal(trackedFiles.some((path) => /(^|\/)index_v\d+\.html$/.test(path) && path.startsWith('public/')), false, 'Local public snapshots must not be tracked');

const publicReleaseFiles = [
  'public/.nojekyll',
  'public/apple-touch-icon.png',
  'public/favicon.svg',
  'public/icon-192.png',
  'public/icon-512.png',
  'public/index.html',
  'public/manifest.webmanifest'
];
const stagingCommand = pagesWorkflow.match(
  /install -m 0644 \\\n([\s\S]*?)\n\s+"\$\{release_dir\}\/"/
);
assert.ok(stagingCommand, 'Pages workflow must stage an explicit release allowlist');
const stagedFiles = [...stagingCommand[1].matchAll(/^\s+(\S+)\s+\\$/gm)]
  .map((match) => match[1]);
assert.deepEqual(stagedFiles, publicReleaseFiles, 'Pages staging command must copy only the release allowlist');
assert.deepEqual(
  trackedFiles.filter((path) => path.startsWith('public/')),
  publicReleaseFiles,
  'Tracked public files must match the Pages release allowlist'
);
for (const path of publicReleaseFiles) {
  assert.ok(pagesWorkflow.includes(path), `Pages staging must include ${path}`);
}

console.log('LongOS release pipeline tests: OK');
