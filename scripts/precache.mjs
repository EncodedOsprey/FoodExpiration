// Writes the service worker's offline file list and version into app/sw.js.
//   npm run precache            update app/sw.js
//   npm run precache -- --check exit 1 if app/sw.js is out of date
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_DIR = fileURLToPath(new URL('../app/', import.meta.url));
const SW_FILE = resolve(APP_DIR, 'sw.js');
const BLOCK = /(\/\/ <precache>[^\n]*\n)[\s\S]*?(\/\/ <\/precache>)/;
const SKIP = new Set(['sw.js', '.DS_Store', 'Thumbs.db']);

async function listFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name) || entry.name.startsWith('.')) continue;
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(path)));
    else out.push(path);
  }
  return out;
}

/** The sw.js source with an up-to-date precache block. */
export async function stampedServiceWorker() {
  const source = await readFile(SW_FILE, 'utf8');
  if (!BLOCK.test(source)) throw new Error('app/sw.js is missing its // <precache> block');
  const files = (await listFiles(APP_DIR)).map((path) => relative(APP_DIR, path).split(sep).join('/')).sort();
  const hash = createHash('sha256');
  hash.update(source.replace(BLOCK, ''));
  for (const file of files) {
    hash.update(`\0${file}\0`);
    hash.update(await readFile(resolve(APP_DIR, file)));
  }
  const version = hash.digest('hex').slice(0, 12);
  const list = files.map((file) => `  '${file}',`).join('\n');
  return source.replace(BLOCK, (_, open, close) => `${open}const VERSION = '${version}';\nconst ASSETS = [\n${list}\n];\n${close}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [current, next] = await Promise.all([readFile(SW_FILE, 'utf8'), stampedServiceWorker()]);
  if (process.argv.includes('--check')) {
    if (current !== next) {
      console.error('app/sw.js is out of date. Run: npm run precache');
      process.exit(1);
    }
    console.log('app/sw.js is up to date.');
  } else if (current !== next) {
    await writeFile(SW_FILE, next);
    console.log(`Updated app/sw.js (${next.match(/VERSION = '(\w+)'/)[1]}).`);
  } else {
    console.log('app/sw.js already up to date.');
  }
}
