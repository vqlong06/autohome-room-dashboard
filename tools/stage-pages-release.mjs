import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { stagePagesRelease } from './lib/pages-release.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function usage() {
  console.log(`Usage: node tools/stage-pages-release.mjs --output <dir> --revision <sha> [options]

Options:
  --source <dir>    Public source directory (default: public)
  --output <dir>    Empty staging directory (required)
  --revision <sha>  Lowercase 40-character commit SHA
  -h, --help        Show this help

Environment override: LONGOS_RELEASE_SHA`);
}

function parseArgs(args) {
  const options = {
    sourceDir: resolve(root, 'public'),
    outputDir: '',
    revision: process.env.LONGOS_RELEASE_SHA || ''
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const nextValue = () => {
      index += 1;
      if (index >= args.length) throw new Error(`${argument} requires a value`);
      return args[index];
    };

    if (argument === '--source') options.sourceDir = resolve(nextValue());
    else if (argument === '--output') options.outputDir = resolve(nextValue());
    else if (argument === '--revision') options.revision = nextValue();
    else if (argument === '--help' || argument === '-h') {
      usage();
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }

  assert.ok(options.outputDir, '--output is required');
  return options;
}

const result = await stagePagesRelease(parseArgs(process.argv.slice(2)));
console.log(`LongOS Pages release staged: ${result.revision} (${result.files.length} files)`);
