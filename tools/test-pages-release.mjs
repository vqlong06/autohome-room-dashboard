import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  injectManifestRevision,
  injectPagesRevision,
  PUBLIC_RELEASE_FILES,
  stagePagesRelease,
  validatePagesRevision
} from './lib/pages-release.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = resolve(root, 'public');
const revision = '0123456789abcdef0123456789abcdef01234567';
const sourceHtml = await readFile(resolve(publicDir, 'index.html'), 'utf8');
const sourceManifest = await readFile(resolve(publicDir, 'manifest.webmanifest'), 'utf8');

assert.equal(validatePagesRevision(revision), revision);
for (const invalidRevision of [
  revision.slice(1),
  `${revision}0`,
  revision.toUpperCase(),
  `${revision.slice(0, -1)}g`
]) {
  assert.throws(() => validatePagesRevision(invalidRevision), /lowercase 40-character Git SHA/);
}

const stampedHtml = injectPagesRevision(sourceHtml, revision);
assert.match(stampedHtml, new RegExp(`<meta name="longos-revision" content="${revision}">`));
assert.equal((stampedHtml.match(/name="longos-revision"/g) || []).length, 1);
assert.equal(stampedHtml.replace(/\n  <meta name="longos-revision"[^>]+>/, ''), sourceHtml);
assert.throws(() => injectPagesRevision(sourceHtml, 'ABC'), /lowercase 40-character Git SHA/);
assert.throws(() => injectPagesRevision(stampedHtml, revision), /pre-stamped longos-revision/);
assert.throws(
  () => injectPagesRevision(`${sourceHtml}\n<meta content="${revision}" name="longos-revision">`, revision),
  /pre-stamped longos-revision/
);
assert.throws(
  () => injectPagesRevision(`${sourceHtml}\n<meta content="${revision}" name=longos-revision>`, revision),
  /pre-stamped longos-revision/
);
assert.throws(() => injectPagesRevision('<html></html>', revision), /exactly one longos-build/);
assert.throws(
  () => injectPagesRevision(`${sourceHtml}\n<meta name="longos-build" content="duplicate">`, revision),
  /exactly one longos-build/
);

const sourceManifestValue = JSON.parse(sourceManifest);
const stampedManifest = injectManifestRevision(sourceManifest, revision);
assert.deepEqual(JSON.parse(stampedManifest), {
  ...sourceManifestValue,
  longos_revision: revision
});
assert.throws(() => injectManifestRevision(stampedManifest, revision), /pre-stamped longos_revision/);
assert.throws(
  () => injectManifestRevision('{"longos_revision":"one","longos_revision":"two"}', revision),
  /pre-stamped longos_revision/
);
assert.throws(
  () => injectManifestRevision(`{"longos_\\u0072evision":"${revision}"}`, revision),
  /pre-stamped longos_revision/
);
assert.throws(() => injectManifestRevision('[]', revision), /JSON object/);
assert.throws(() => injectManifestRevision('{', revision), /valid JSON/);

const temporaryRoot = await mkdtemp(join(tmpdir(), 'longos-pages-release-'));
try {
  const outputDir = resolve(temporaryRoot, 'staged');
  const result = await stagePagesRelease({ sourceDir: publicDir, outputDir, revision });
  assert.deepEqual(result.files, PUBLIC_RELEASE_FILES);
  assert.deepEqual((await readdir(outputDir)).sort(), PUBLIC_RELEASE_FILES);
  assert.match(await readFile(resolve(outputDir, 'index.html'), 'utf8'), new RegExp(revision));
  assert.equal(
    JSON.parse(await readFile(resolve(outputDir, 'manifest.webmanifest'), 'utf8')).longos_revision,
    revision
  );
  assert.doesNotMatch(sourceHtml, /longos-revision/);
  assert.doesNotMatch(sourceManifest, /longos_revision/);

  for (const file of PUBLIC_RELEASE_FILES.filter((name) => !['index.html', 'manifest.webmanifest'].includes(name))) {
    assert.deepEqual(
      await readFile(resolve(outputDir, file)),
      await readFile(resolve(publicDir, file)),
      `${file} must be copied without mutation`
    );
  }
  for (const file of PUBLIC_RELEASE_FILES) {
    assert.equal((await stat(resolve(outputDir, file))).mode & 0o777, 0o644);
  }

  const nonEmptyOutput = resolve(temporaryRoot, 'non-empty');
  await stagePagesRelease({ sourceDir: publicDir, outputDir: nonEmptyOutput, revision });
  await assert.rejects(
    stagePagesRelease({ sourceDir: publicDir, outputDir: nonEmptyOutput, revision }),
    /must be empty/
  );
  assert.equal(await readFile(resolve(publicDir, 'index.html'), 'utf8'), sourceHtml, 'staging must not mutate public source');

  const fixtureSource = resolve(temporaryRoot, 'fixture-source');
  await mkdir(fixtureSource);
  for (const file of PUBLIC_RELEASE_FILES) {
    await copyFile(resolve(publicDir, file), resolve(fixtureSource, file));
  }
  await writeFile(resolve(fixtureSource, 'not-public.txt'), 'must not be staged');
  const explicitOutput = resolve(temporaryRoot, 'explicit-allowlist');
  await stagePagesRelease({ sourceDir: fixtureSource, outputDir: explicitOutput, revision });
  assert.deepEqual((await readdir(explicitOutput)).sort(), PUBLIC_RELEASE_FILES, 'extra source files must not enter the artifact');

  const cliOutput = resolve(temporaryRoot, 'cli-output');
  const cliLog = execFileSync(process.execPath, [
    resolve(root, 'tools/stage-pages-release.mjs'),
    '--source', publicDir,
    '--output', cliOutput,
    '--revision', revision
  ], { cwd: root, encoding: 'utf8' });
  assert.match(cliLog, new RegExp(`LongOS Pages release staged: ${revision} \\(7 files\\)`));
  assert.equal(JSON.parse(await readFile(resolve(cliOutput, 'manifest.webmanifest'), 'utf8')).longos_revision, revision);

  const outputSymlinkTarget = resolve(temporaryRoot, 'output-symlink-target');
  const outputSymlink = resolve(temporaryRoot, 'output-symlink');
  await mkdir(outputSymlinkTarget);
  await symlink(outputSymlinkTarget, outputSymlink);
  await assert.rejects(
    stagePagesRelease({ sourceDir: publicDir, outputDir: outputSymlink, revision }),
    /outputDir must be a real directory, not a symbolic link/
  );
  assert.deepEqual(await readdir(outputSymlinkTarget), [], 'rejected output symlink must remain untouched');

  const fixtureAlias = resolve(temporaryRoot, 'fixture-source-alias');
  await symlink(fixtureSource, fixtureAlias);
  await assert.rejects(
    stagePagesRelease({ sourceDir: fixtureAlias, outputDir: resolve(temporaryRoot, 'source-alias-output'), revision }),
    /sourceDir must be a real directory, not a symbolic link/
  );
  await assert.rejects(
    stagePagesRelease({ sourceDir: fixtureSource, outputDir: resolve(fixtureAlias, 'nested-release'), revision }),
    /must not be the source directory/
  );
  await assert.rejects(stat(resolve(fixtureSource, 'nested-release')), /ENOENT/);

  await unlink(resolve(fixtureSource, 'favicon.svg'));
  await assert.rejects(
    stagePagesRelease({ sourceDir: fixtureSource, outputDir: resolve(temporaryRoot, 'missing-file'), revision }),
    /ENOENT|release source/
  );
  await symlink(resolve(publicDir, 'favicon.svg'), resolve(fixtureSource, 'favicon.svg'));
  await assert.rejects(
    stagePagesRelease({ sourceDir: fixtureSource, outputDir: resolve(temporaryRoot, 'symlink-file'), revision }),
    /release source must be a regular file/
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

await assert.rejects(
  stagePagesRelease({
    sourceDir: publicDir,
    outputDir: resolve(publicDir, 'nested-release-output'),
    revision
  }),
  /must not be the source directory/
);

const trackedPublicFiles = execFileSync('git', ['ls-files', 'public'], {
  cwd: root,
  encoding: 'utf8'
}).trim().split('\n');
assert.deepEqual(trackedPublicFiles.map((path) => path.replace(/^public\//, '')), PUBLIC_RELEASE_FILES);

console.log('LongOS Pages release staging tests: OK');
