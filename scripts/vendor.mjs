// Bundles the barcode-detector ponyfill (ZXing-C++ WebAssembly) into app/vendor so the
// PWA works offline and without a build step. Run after upgrading barcode-detector.
import { build } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(root, 'app', 'vendor');

await mkdir(outDir, { recursive: true });

await build({
  stdin: {
    contents: "export * from 'barcode-detector/ponyfill';",
    resolveDir: root,
    loader: 'js',
  },
  bundle: true,
  format: 'esm',
  minify: true,
  target: 'es2020',
  outfile: path.join(outDir, 'barcode-detector.js'),
  legalComments: 'inline',
});

// zxing-wasm is a dependency of barcode-detector and neither exports package.json, so
// resolve the reader entry from barcode-detector's location and find dist/ from there.
const ponyfillPath = fileURLToPath(import.meta.resolve('barcode-detector/ponyfill'));
const readerEntry = createRequire(ponyfillPath).resolve('zxing-wasm/reader');
const distMarker = `${path.sep}dist${path.sep}`;
const zxingDist = readerEntry.slice(0, readerEntry.lastIndexOf(distMarker) + distMarker.length);
await copyFile(
  path.join(zxingDist, 'reader', 'zxing_reader.wasm'),
  path.join(outDir, 'zxing_reader.wasm'),
);

console.log('Vendored barcode-detector + zxing_reader.wasm into app/vendor');
