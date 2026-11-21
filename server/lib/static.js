// Serves the web app's static files (used by the push server and the dev server).
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
};

/** Request handler serving `root` under the URL path `base` (e.g. "/" or "/FoodExpiration/"). */
export function staticFiles(root, { base = '/' } = {}) {
  const rootDir = resolve(root);
  const prefix = `/${base.replace(/^\/+|\/+$/g, '')}/`.replace('//', '/');
  const plain = (res, status, text) => res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' }).end(text);

  return async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return plain(res, 405, 'Method not allowed');
    let path;
    try {
      const url = new URL(req.url, 'http://localhost');
      if (`${url.pathname}/` === prefix) return res.writeHead(301, { Location: prefix }).end();
      if (!url.pathname.startsWith(prefix)) return plain(res, 404, 'Not found');
      path = decodeURIComponent(url.pathname.slice(prefix.length));
    } catch {
      return plain(res, 400, 'Bad request');
    }
    if (path === '' || path.endsWith('/')) path += 'index.html';
    const file = resolve(rootDir, path);
    if (!file.startsWith(rootDir + sep)) return plain(res, 403, 'Forbidden');
    try {
      const body = await readFile(file);
      res.writeHead(200, {
        'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch (err) {
      if (err.code === 'ENOENT' || err.code === 'EISDIR') plain(res, 404, 'Not found');
      else plain(res, 500, 'Server error');
    }
  };
}
