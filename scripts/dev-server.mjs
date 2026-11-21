// Static server for local development and the end-to-end tests.
//   npm start                                    -> http://localhost:8080/
//   PORT=9000 BASE=/FoodExpiration/ npm start    (mimics a GitHub Pages project site)
// Browsers only allow the camera on https:// or localhost, so test on a phone through the
// deployed site or an https tunnel.
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { staticFiles } from '../server/lib/static.js';

const APP_DIR = fileURLToPath(new URL('../app/', import.meta.url));

export const createStaticServer = ({ base = '/' } = {}) => createServer(staticFiles(APP_DIR, { base }));

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 8080;
  const base = `/${(process.env.BASE || '/').replace(/^\/+|\/+$/g, '')}/`.replace('//', '/');
  createStaticServer({ base }).listen(port, process.env.HOST, () => {
    console.log(`Pantry Pal running at http://localhost:${port}${base}`);
  });
}
