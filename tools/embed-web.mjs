import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const webPath = resolve(root, 'web/index.html');
const firmwarePath = resolve(root, 'src/main.cpp');

const html = await readFile(webPath, 'utf8');
const firmware = await readFile(firmwarePath, 'utf8');

if (html.includes(')HTML"')) {
  throw new Error('web/index.html contains the raw literal terminator )HTML"');
}

const indexHtmlBlock = /const char INDEX_HTML\[\] PROGMEM = R"HTML\([\s\S]*?\)HTML";/;

if (!indexHtmlBlock.test(firmware)) {
  throw new Error('INDEX_HTML block was not found');
}

const nextFirmware = firmware.replace(
  indexHtmlBlock,
  `const char INDEX_HTML[] PROGMEM = R"HTML(\n${html}\n)HTML";`
);

await writeFile(firmwarePath, nextFirmware);
console.log('Embedded web/index.html into firmware.');
