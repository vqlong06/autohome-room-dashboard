import { chmod, copyFile, lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';

export const PUBLIC_RELEASE_FILES = Object.freeze([
  '.nojekyll',
  'apple-touch-icon.png',
  'favicon.svg',
  'icon-192.png',
  'icon-512.png',
  'index.html',
  'manifest.webmanifest'
]);

const RELEASE_REVISION_PATTERN = /^[0-9a-f]{40}$/;

export function validatePagesRevision(value) {
  if (typeof value !== 'string' || !RELEASE_REVISION_PATTERN.test(value)) {
    throw new Error('release revision must be a lowercase 40-character Git SHA');
  }
  return value;
}

function requirePath(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty path`);
  }
  return resolve(value);
}

function pathIsWithin(parent, candidate) {
  const child = relative(parent, candidate);
  return child === '' || (!child.startsWith('..') && !isAbsolute(child));
}

async function lstatIfExists(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function canonicalProspectivePath(path) {
  let cursor = path;
  const missingSegments = [];
  while (true) {
    try {
      return resolve(await realpath(cursor), ...missingSegments);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const parent = dirname(cursor);
      if (parent === cursor) throw error;
      missingSegments.unshift(basename(cursor));
      cursor = parent;
    }
  }
}

function htmlAttributeValues(tag, attribute) {
  const pattern = new RegExp(
    `\\b${attribute}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>]+))`,
    'gi'
  );
  return [...tag.matchAll(pattern)].map((match) => match[1] ?? match[2] ?? match[3]);
}

export function injectPagesRevision(html, revision) {
  if (typeof html !== 'string') throw new Error('HTML source must be a string');
  const validatedRevision = validatePagesRevision(revision);
  const metaTags = html.match(/<meta\b[^>]*>/gi) || [];
  const hasNamedTag = (tag, name) => htmlAttributeValues(tag, 'name')
    .some((value) => value.toLowerCase() === name);
  if (metaTags.some((tag) => hasNamedTag(tag, 'longos-revision'))) {
    throw new Error('HTML source must not contain a pre-stamped longos-revision');
  }

  const buildTags = metaTags.filter((tag) => hasNamedTag(tag, 'longos-build'));
  if (buildTags.length !== 1) {
    throw new Error('HTML source must contain exactly one longos-build meta tag');
  }

  return html.replace(
    buildTags[0],
    `${buildTags[0]}\n  <meta name="longos-revision" content="${validatedRevision}">`
  );
}

export function injectManifestRevision(source, revision) {
  if (typeof source !== 'string') throw new Error('manifest source must be a string');
  const validatedRevision = validatePagesRevision(revision);
  if ((source.match(/"longos_revision"\s*:/g) || []).length !== 0) {
    throw new Error('manifest source must not contain a pre-stamped longos_revision');
  }

  let manifest;
  try {
    manifest = JSON.parse(source);
  } catch (error) {
    throw new Error(`manifest source must be valid JSON: ${error.message}`);
  }
  if (manifest === null || Array.isArray(manifest) || typeof manifest !== 'object') {
    throw new Error('manifest source must contain a JSON object');
  }
  if (Object.hasOwn(manifest, 'longos_revision')) {
    throw new Error('manifest source must not contain a pre-stamped longos_revision');
  }

  manifest.longos_revision = validatedRevision;
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export async function stagePagesRelease({ sourceDir, outputDir, revision } = {}) {
  const sourceRoot = requirePath(sourceDir, 'sourceDir');
  const outputRoot = requirePath(outputDir, 'outputDir');
  const validatedRevision = validatePagesRevision(revision);
  if (pathIsWithin(sourceRoot, outputRoot)) {
    throw new Error('outputDir must not be the source directory or one of its descendants');
  }

  const sourceRootStats = await lstat(sourceRoot);
  if (!sourceRootStats.isDirectory() || sourceRootStats.isSymbolicLink()) {
    throw new Error('sourceDir must be a real directory, not a symbolic link');
  }
  const canonicalSourceRoot = await realpath(sourceRoot);

  const existingOutputStats = await lstatIfExists(outputRoot);
  if (existingOutputStats?.isSymbolicLink()) {
    throw new Error('outputDir must be a real directory, not a symbolic link');
  }
  if (existingOutputStats && !existingOutputStats.isDirectory()) {
    throw new Error('outputDir must be a directory');
  }
  const prospectiveOutputRoot = await canonicalProspectivePath(outputRoot);
  if (pathIsWithin(canonicalSourceRoot, prospectiveOutputRoot)) {
    throw new Error('outputDir must not be the source directory or one of its descendants');
  }

  await mkdir(outputRoot, { recursive: true, mode: 0o755 });
  const outputRootStats = await lstat(outputRoot);
  if (!outputRootStats.isDirectory() || outputRootStats.isSymbolicLink()) {
    throw new Error('outputDir must be a real directory, not a symbolic link');
  }
  const canonicalOutputRoot = await realpath(outputRoot);
  if (pathIsWithin(canonicalSourceRoot, canonicalOutputRoot)) {
    throw new Error('outputDir must not be the source directory or one of its descendants');
  }
  const existingOutput = await readdir(canonicalOutputRoot);
  if (existingOutput.length !== 0) {
    throw new Error('outputDir must be empty before staging');
  }

  for (const file of PUBLIC_RELEASE_FILES) {
    const sourcePath = resolve(canonicalSourceRoot, file);
    const sourceStats = await lstat(sourcePath);
    if (!sourceStats.isFile() || sourceStats.isSymbolicLink()) {
      throw new Error(`release source must be a regular file: ${file}`);
    }

    const outputPath = resolve(canonicalOutputRoot, file);
    if (file === 'index.html') {
      const html = await readFile(sourcePath, 'utf8');
      await writeFile(outputPath, injectPagesRevision(html, validatedRevision), { mode: 0o644 });
    } else if (file === 'manifest.webmanifest') {
      const manifest = await readFile(sourcePath, 'utf8');
      await writeFile(outputPath, injectManifestRevision(manifest, validatedRevision), { mode: 0o644 });
    } else {
      await copyFile(sourcePath, outputPath);
    }
    await chmod(outputPath, 0o644);
  }

  const stagedFiles = (await readdir(canonicalOutputRoot)).sort();
  if (JSON.stringify(stagedFiles) !== JSON.stringify(PUBLIC_RELEASE_FILES)) {
    throw new Error('staged Pages files do not match the public release allowlist');
  }

  return { outputDir: outputRoot, revision: validatedRevision, files: stagedFiles };
}
