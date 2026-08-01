import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFile(resolve(root, path), 'utf8');

const [ciWorkflow, pagesWorkflow, platformio, gitignore] = await Promise.all([
  read('.github/workflows/ci.yml'),
  read('.github/workflows/pages.yml'),
  read('platformio.ini'),
  read('.gitignore')
]);

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

for (const workflow of [ciWorkflow, pagesWorkflow]) {
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
assert.match(ciWorkflow, /node tools\/test-release-pipeline\.mjs/);
assert.match(ciWorkflow, /python-3\.11-platformio-6\.1\.19-/);
assert.equal((ciWorkflow.match(/persist-credentials:\s+false/g) || []).length, 2, 'CI checkouts must not persist credentials');

assert.match(pagesWorkflow, /branches:\s*\n\s*- main/);
assert.match(pagesWorkflow, /^permissions:\s*\{\}/m);
const buildJob = pagesWorkflow.slice(
  pagesWorkflow.indexOf('  build:'),
  pagesWorkflow.indexOf('\n  deploy:')
);
const deployJob = pagesWorkflow.slice(pagesWorkflow.indexOf('  deploy:'));
assert.match(buildJob, /contents:\s+read/);
assert.match(buildJob, /pages:\s+read/);
assert.doesNotMatch(buildJob, /pages:\s+write|id-token:/, 'Pages build job must not receive deployment permissions');
assert.match(deployJob, /pages:\s+write/);
assert.match(deployJob, /id-token:\s+write/);
assert.doesNotMatch(deployJob, /contents:\s+write/, 'Pages deploy job must not receive content write access');
assert.match(pagesWorkflow, /path:\s+\$\{\{ runner\.temp \}\}\/longos-pages/);
assert.match(pagesWorkflow, /include-hidden-files:\s+true/);
assert.match(pagesWorkflow, /environment:\s*\n\s+name:\s+github-pages/);
assert.match(pagesWorkflow, /needs:\s+build/);
assert.match(pagesWorkflow, /persist-credentials:\s+false/);
assert.doesNotMatch(pagesWorkflow, /^\s*path:\s*(?:['"]?\.['"]?|public)\s*$/m, 'Pages must never upload the repository root or public directly');

assert.match(platformio, /^platform\s*=\s*espressif32@6\.10\.0$/m);
assert.match(gitignore, /^include\/secrets\.h$/m);
assert.match(gitignore, /^public\/index_v\*\.html$/m);

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
