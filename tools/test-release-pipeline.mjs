import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PUBLIC_RELEASE_FILES } from './lib/pages-release.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFile(resolve(root, path), 'utf8');

const [
  ciWorkflow,
  pagesWorkflow,
  productionWorkflow,
  pagesSmokeTest,
  pagesSmokeIntegrationTest,
  pagesReleaseLibrary,
  pagesReleaseCli,
  pagesReleaseTest,
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
  read('tools/test-pages-smoke-integration.mjs'),
  read('tools/lib/pages-release.mjs'),
  read('tools/stage-pages-release.mjs'),
  read('tools/test-pages-release.mjs'),
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

assert.match(ciWorkflow, /^name:\s+LongOS CI\s*$/m, 'Pages workflow trigger depends on the exact CI workflow name');

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
for (const command of [
  'node --check tools/lib/pages-release.mjs',
  'node --check tools/stage-pages-release.mjs',
  'node --check tools/test-pages-release.mjs',
  'node tools/test-pages-release.mjs',
  'node tools/stage-pages-release.mjs --help'
]) {
  const exactCommand = new RegExp(`^\\s+${command.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\s*$`, 'gm');
  assert.equal((ciWorkflow.match(exactCommand) || []).length, 1, `CI must run exactly one ${command}`);
}
const pagesStageCiCommands = [...ciWorkflow.matchAll(/^\s+node tools\/stage-pages-release\.mjs(?:\s+[^\n]*)?$/gm)]
  .map((match) => match[0].trim());
assert.deepEqual(
  pagesStageCiCommands,
  ['node tools/stage-pages-release.mjs --help'],
  'CI must test the Pages staging CLI without creating a release artifact'
);
assert.match(ciWorkflow, /npm ci --ignore-scripts --no-audit --no-fund/);
assert.match(ciWorkflow, /node --check tools\/test-supabase-migrations\.mjs/);
assert.match(ciWorkflow, /npm run test:supabase-semantic/);
assert.match(ciWorkflow, /node --check tools\/test-supabase-security\.mjs/);
assert.match(ciWorkflow, /node tools\/test-supabase-security\.mjs/);
assert.match(ciWorkflow, /python-3\.11-platformio-6\.1\.19-/);
assert.equal((ciWorkflow.match(/persist-credentials:\s+false/g) || []).length, 2, 'CI checkouts must not persist credentials');

const pagesTriggerBlock = pagesWorkflow.slice(
  pagesWorkflow.indexOf('on:'),
  pagesWorkflow.indexOf('\npermissions:')
).trim();
assert.equal(pagesTriggerBlock, `on:
  workflow_run:
    workflows:
      - LongOS CI
    types:
      - completed
    branches:
      - main`, 'Pages must be triggered only by the named main-branch LongOS CI workflow');
assert.match(pagesWorkflow, /on:\s*\n\s+workflow_run:/);
assert.match(pagesWorkflow, /workflows:\s*\n\s+- LongOS CI/);
assert.match(pagesWorkflow, /types:\s*\n\s+- completed/);
assert.match(pagesWorkflow, /branches:\s*\n\s+- main/);
assert.doesNotMatch(
  pagesWorkflow,
  /^\s{2}(?:push|workflow_dispatch|repository_dispatch):/m,
  'Pages must not expose a direct or manual deployment trigger'
);
assert.match(pagesWorkflow, /^permissions:\s*\{\}/m);

const jobsStart = pagesWorkflow.indexOf('\njobs:');
const buildStart = pagesWorkflow.indexOf('  build:', jobsStart);
const releaseGateStart = pagesWorkflow.indexOf('  release_gate:', buildStart);
const deployStart = pagesWorkflow.indexOf('  deploy:', releaseGateStart);
const verifyStart = pagesWorkflow.indexOf('  verify:', deployStart);
assert.ok(
  jobsStart > 0 && buildStart > jobsStart && releaseGateStart > buildStart && deployStart > releaseGateStart && verifyStart > deployStart,
  'Pages jobs must run in build, release gate, deploy, verify order'
);
const workflowHeader = pagesWorkflow.slice(0, jobsStart);
const buildJob = pagesWorkflow.slice(buildStart, releaseGateStart);
const releaseGateJob = pagesWorkflow.slice(releaseGateStart, deployStart);
const deployJob = pagesWorkflow.slice(deployStart, verifyStart);
const verifyJob = pagesWorkflow.slice(verifyStart);

assert.match(workflowHeader, /concurrency:\s*\n\s+group:\s+longos-pages\s*\n\s+queue:\s+max/);
assert.doesNotMatch(workflowHeader, /cancel-in-progress:/, 'Queued Pages releases must not cancel an active deploy/verify chain');
assert.doesNotMatch(deployJob, /concurrency:/, 'Pages concurrency must cover the entire workflow, not only deploy');

for (const guard of [
  /github\.event\.workflow_run\.conclusion == 'success'/,
  /github\.event\.workflow_run\.event == 'push'/,
  /github\.event\.workflow_run\.head_branch == 'main'/,
  /github\.event\.workflow_run\.head_repository\.full_name == github\.repository/,
  /github\.event\.workflow_run\.head_sha == github\.sha/
]) {
  assert.match(buildJob, guard, `Pages admission guard is missing: ${guard}`);
}
const admissionBlock = buildJob.slice(buildJob.indexOf('    if: >-'), buildJob.indexOf('    runs-on:'));
const normalizedAdmission = admissionBlock
  .split('\n')
  .slice(1)
  .map((line) => line.trim())
  .filter(Boolean)
  .join(' ');
assert.equal(
  normalizedAdmission,
  "github.event.workflow_run.conclusion == 'success' && github.event.workflow_run.event == 'push' && github.event.workflow_run.head_branch == 'main' && github.event.workflow_run.head_repository.full_name == github.repository && github.event.workflow_run.head_sha == github.sha",
  'Pages admission expression must require every exact CI provenance guard'
);
assert.match(buildJob, /contents:\s+read/);
assert.match(buildJob, /pages:\s+read/);
assert.doesNotMatch(buildJob, /pages:\s+write|id-token:/, 'Pages build job must not receive deployment permissions');
assert.match(buildJob, /ref:\s+\$\{\{ github\.event\.workflow_run\.head_sha \}\}/);
assert.match(buildJob, /node tools\/test-pages-release\.mjs/);
assert.match(buildJob, /node tools\/stage-pages-release\.mjs/);
assert.match(buildJob, /LONGOS_RELEASE_SHA:\s+\$\{\{ github\.event\.workflow_run\.head_sha \}\}/);
assert.match(buildJob, /--output "\$\{RUNNER_TEMP\}\/longos-pages"/);
assert.match(buildJob, /--revision "\$\{LONGOS_RELEASE_SHA\}"/);
assert.match(buildJob, /git diff --exit-code/);
assert.ok(
  buildJob.indexOf('node tools/stage-pages-release.mjs') < buildJob.indexOf('actions/upload-pages-artifact@'),
  'Pages release must be staged before the artifact is uploaded'
);

assert.match(releaseGateJob, /needs:\s+build/);
assert.match(releaseGateJob, /contents:\s+read/);
assert.doesNotMatch(releaseGateJob, /pages:\s+write|id-token:/, 'Pages release gate must remain read-only');
assert.match(releaseGateJob, /ref:\s+refs\/heads\/main/);
assert.match(releaseGateJob, /fetch-depth:\s+1/);
assert.match(releaseGateJob, /LONGOS_RELEASE_SHA:\s+\$\{\{ github\.event\.workflow_run\.head_sha \}\}/);
assert.match(releaseGateJob, /current_sha="\$\(git rev-parse HEAD\)"/);
assert.match(releaseGateJob, /"\$\{current_sha\}" == "\$\{LONGOS_RELEASE_SHA\}"/);
assert.match(releaseGateJob, /current:\s+\$\{\{ steps\.compare\.outputs\.current \}\}/);
assert.match(releaseGateJob, /current=true/);
assert.match(releaseGateJob, /current=false/);

assert.match(deployJob, /pages:\s+write/);
assert.match(deployJob, /id-token:\s+write/);
assert.doesNotMatch(deployJob, /contents:\s+write/, 'Pages deploy job must not receive content write access');
assert.match(deployJob, /needs:[\s\S]*?- build[\s\S]*?- release_gate/);
const deployConditionBlock = deployJob.slice(deployJob.indexOf('    if: >-'), deployJob.indexOf('    runs-on:'));
const normalizedDeployCondition = deployConditionBlock
  .split('\n')
  .slice(1)
  .map((line) => line.trim())
  .filter(Boolean)
  .join(' ');
assert.equal(
  normalizedDeployCondition,
  "needs.release_gate.outputs.current == 'true' && github.run_attempt == 1",
  'Pages deploy must require a fresh live-main gate and reject manual workflow re-runs'
);
assert.match(deployJob, /page_url:\s+\$\{\{ steps\.deployment\.outputs\.page_url \}\}/);
assert.match(verifyJob, /needs:\s+deploy/);
assert.match(verifyJob, /contents:\s+read/);
assert.doesNotMatch(verifyJob, /pages:\s+write|id-token:/, 'Pages verify job must not receive deployment permissions');
assert.match(verifyJob, /ref:\s+\$\{\{ github\.event\.workflow_run\.head_sha \}\}/);
assert.match(verifyJob, /node tools\/test-pages-smoke\.mjs/);
assert.match(verifyJob, /\$\{\{ needs\.deploy\.outputs\.page_url \}\}/);
assert.match(verifyJob, /--expected-revision "\$\{\{ github\.event\.workflow_run\.head_sha \}\}"/);
assert.match(verifyJob, /--require-cloud(?:\s|$)/m);
assert.doesNotMatch(
  verifyJob,
  /--require-cloud-health|--expected-cloud-version|--require-history-cadence/,
  'Pages post-deploy verification must check the cloud contract without depending on device health'
);
assert.match(pagesWorkflow, /path:\s+\$\{\{ runner\.temp \}\}\/longos-pages/);
assert.match(pagesWorkflow, /include-hidden-files:\s+true/);
assert.match(pagesWorkflow, /environment:\s*\n\s+name:\s+github-pages/);
assert.equal(
  (pagesWorkflow.match(/ref:\s+\$\{\{ github\.event\.workflow_run\.head_sha \}\}/g) || []).length,
  2,
  'Pages build and verify must check out the exact CI-approved SHA'
);
assert.equal((pagesWorkflow.match(/persist-credentials:\s+false/g) || []).length, 3, 'Pages checkouts must not persist credentials');
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
  /--expected-revision|--expected-cloud-version|--require-history-cadence/,
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
assert.match(pagesSmokeTest, /--expected-revision/);
assert.match(pagesSmokeTest, /--expected-cloud-version/);
assert.match(pagesSmokeTest, /--require-history-cadence/);
assert.match(pagesSmokeTest, /--latest-max-age-ms/);
assert.match(pagesSmokeTest, /--history-max-age-ms/);
assert.match(pagesSmokeTest, /LONGOS_CLOUD_LATEST_MAX_AGE_MS/);
assert.match(pagesSmokeTest, /LONGOS_PAGES_EXPECTED_REVISION/);
assert.match(pagesSmokeTest, /LONGOS_CLOUD_HISTORY_MAX_AGE_MS/);
assert.match(pagesSmokeTest, /LONGOS_CLOUD_EXPECTED_VERSION/);
assert.match(pagesSmokeTest, /LONGOS_HISTORY_CADENCE_WINDOW_MS/);
assert.match(pagesSmokeTest, /LONGOS_HISTORY_MIN_SAMPLES/);
assert.match(pagesSmokeTest, /LONGOS_HISTORY_MIN_GAP_MS/);
assert.match(pagesSmokeTest, /DEFAULT_LATEST_MAX_AGE_MS/);
assert.match(pagesSmokeTest, /DEFAULT_HISTORY_MAX_AGE_MS/);
assert.match(pagesSmokeTest, /validateCloudHealth/);
assert.match(pagesSmokeTest, /validateHistoryCadence/);
assert.match(pagesSmokeTest, /validatePagesRevision/);
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
assert.match(pagesSmokeTest, /_longos_revision/);
assert.match(pagesSmokeTest, /root and index\.html revisions do not match/);
assert.match(pagesSmokeTest, /HTML and manifest revisions do not match/);
assert.match(pagesSmokeTest, /manifest longos_revision must appear at most once/);
assert.match(pagesSmokeTest, /Revision: \$\{deployedRevision \|\| 'unstamped'\}/);

assert.match(pagesSmokeIntegrationTest, /exact-revision/);
assert.match(pagesSmokeIntegrationTest, /wrong-revision/);
assert.match(pagesSmokeIntegrationTest, /legacy-revision/);
assert.match(pagesSmokeIntegrationTest, /duplicate-revision/);
assert.match(pagesSmokeIntegrationTest, /mismatched-index-revision/);
assert.match(pagesSmokeIntegrationTest, /missing-manifest-revision/);
assert.match(pagesSmokeIntegrationTest, /malformed-manifest-revision/);
assert.match(pagesSmokeIntegrationTest, /duplicate-manifest-revision/);
assert.match(pagesSmokeIntegrationTest, /_longos_revision/);

assert.match(pagesReleaseLibrary, /PUBLIC_RELEASE_FILES/);
assert.match(pagesReleaseLibrary, /validatePagesRevision/);
assert.match(pagesReleaseLibrary, /injectPagesRevision/);
assert.match(pagesReleaseLibrary, /injectManifestRevision/);
assert.match(pagesReleaseLibrary, /pre-stamped longos-revision/);
assert.match(pagesReleaseLibrary, /pre-stamped longos_revision/);
assert.match(pagesReleaseLibrary, /canonicalProspectivePath/);
assert.match(pagesReleaseLibrary, /realpath/);
assert.match(pagesReleaseLibrary, /outputDir must be a real directory, not a symbolic link/);
assert.match(pagesReleaseLibrary, /sourceDir must be a real directory, not a symbolic link/);
assert.match(pagesReleaseLibrary, /outputDir must be empty before staging/);
assert.match(pagesReleaseLibrary, /release source must be a regular file/);
assert.doesNotMatch(
  pagesReleaseLibrary,
  /SUPABASE_PUBLISHABLE_KEY|SUPABASE_DEVICE_TOKEN|include\/secrets\.h|GITHUB_TOKEN/,
  'Pages release staging must not read secrets or credentials'
);
assert.match(pagesReleaseCli, /LONGOS_RELEASE_SHA/);
assert.match(pagesReleaseCli, /--output is required/);
assert.match(pagesReleaseTest, /staging must not mutate public source/);
assert.match(pagesReleaseTest, /pre-stamped longos_revision/);
assert.match(pagesReleaseTest, /name=longos-revision/);
assert.match(pagesReleaseTest, /longos_\\\\u0072evision/);
assert.match(pagesReleaseTest, /output-symlink/);
assert.match(pagesReleaseTest, /fixture-source-alias/);
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

const expectedPublicReleaseFiles = [
  '.nojekyll',
  'apple-touch-icon.png',
  'favicon.svg',
  'icon-192.png',
  'icon-512.png',
  'index.html',
  'manifest.webmanifest'
];
assert.deepEqual(
  PUBLIC_RELEASE_FILES,
  expectedPublicReleaseFiles,
  'Pages release helper must preserve the independently reviewed seven-file allowlist'
);
const publicReleaseFiles = PUBLIC_RELEASE_FILES.map((path) => `public/${path}`);
assert.deepEqual(
  trackedFiles.filter((path) => path.startsWith('public/')),
  publicReleaseFiles,
  'Tracked public files must match the Pages release allowlist'
);
assert.match(pagesWorkflow, /node tools\/stage-pages-release\.mjs/);
assert.doesNotMatch(pagesWorkflow, /install -m 0644/, 'Pages workflow must delegate staging to the fail-closed helper');

console.log('LongOS release pipeline tests: OK');
