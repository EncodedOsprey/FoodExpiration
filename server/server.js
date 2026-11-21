// Pantry Pal push server: delivers expiry alerts to devices even when the app is closed.
// Configuration is through environment variables; see README.md.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sendNotification } from 'web-push';
import { createApp } from './lib/app.js';
import { staticFiles } from './lib/static.js';
import { Store } from './lib/store.js';
import { DEFAULT_PUSH_HOSTS } from './lib/validate.js';
import { loadVapid } from './lib/vapid.js';

const env = process.env;
const here = fileURLToPath(new URL('.', import.meta.url));
const list = (value) => String(value ?? '').split(',').map((s) => s.trim()).filter(Boolean);

const dataDir = resolve(env.DATA_DIR || resolve(here, 'data'));
const port = Number(env.PORT) || 8787;
const origins = list(env.ALLOWED_ORIGINS);
const token = env.PUSH_TOKEN || '';

const vapid = await loadVapid({ dataDir, env });
const store = new Store(resolve(dataDir, 'subscriptions.json'));
await store.load();

const app = createApp({
  store,
  publicKey: vapid.publicKey,
  sender: (subscription, payload, options) =>
    sendNotification(subscription, payload, { ...options, vapidDetails: vapid, timeout: 15_000 }),
  token,
  allowedOrigins: origins.length ? origins : ['*'],
  pushHosts: list(env.PUSH_HOSTS).length ? list(env.PUSH_HOSTS) : DEFAULT_PUSH_HOSTS,
  maxSubscriptions: Number(env.MAX_SUBSCRIPTIONS) || 1000,
  staticHandler: env.SERVE_APP === '0' ? null : staticFiles(resolve(here, '../app')),
});

const server = app.createServer();
server.listen(port, env.HOST, () => {
  console.log(`Pantry Pal push server listening on port ${port} (${store.size} devices).`);
  if (!token) console.warn('PUSH_TOKEN is not set: anyone who knows this address can use it.');
  if (!origins.length) console.warn('ALLOWED_ORIGINS is not set: any website can call the API.');
});

const timer = setInterval(() => app.tick().catch((err) => console.error('Delivery failed:', err)), 60_000);
app.tick().catch((err) => console.error('Delivery failed:', err));

async function shutdown() {
  clearInterval(timer);
  server.close();
  await store.flush();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
