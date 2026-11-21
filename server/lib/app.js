// HTTP API and delivery loop. The alert logic itself is shared with the app
// (app/js/alerts.js), so the server sends exactly what the app would have shown.
import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { dueNotifications, pruneNotified } from '../../app/js/alerts.js';
import { DEFAULT_PUSH_HOSTS, HttpError, parseEntries, parseSubscription } from './validate.js';

const MAX_BODY = 1_000_000;
const MAX_PAYLOAD = 3000; // push messages are limited to ~4 KB after encryption
const DAY = 86_400_000;
const STALE_AFTER = 120 * DAY; // forget devices that haven't synced for this long

/** Push payload for the service worker; keeps the newest keys if it has to trim. */
export function buildPayload(notifications, keys) {
  const payload = { notifications: notifications.slice(0, 2), keys: [...keys].reverse() };
  while (payload.keys.length && Buffer.byteLength(JSON.stringify(payload)) > MAX_PAYLOAD) payload.keys.pop();
  return JSON.stringify(payload);
}

const digest = (value) => createHash('sha256').update(String(value)).digest();

async function readJson(req) {
  if (!String(req.headers['content-type'] ?? '').includes('application/json')) throw new HttpError(415, 'Send JSON.');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, 'Request too large.');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Invalid JSON.');
  }
}

function sendJson(res, status, body) {
  if (status === 204) return res.writeHead(204).end();
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

export function createApp({
  store,
  publicKey,
  sender, // (subscription, payload, options) => Promise; web-push's sendNotification in production
  token = '',
  allowedOrigins = ['*'],
  pushHosts = DEFAULT_PUSH_HOSTS,
  maxSubscriptions = 1000,
  staticHandler = null,
  log = console,
}) {
  const tokenDigest = token ? digest(token) : null;
  const anyOrigin = allowedOrigins.includes('*');
  const origins = new Set(allowedOrigins.map((o) => o.replace(/\/+$/, '')));

  const authorized = (header = '') =>
    !tokenDigest || timingSafeEqual(digest(String(header).replace(/^Bearer\s+/i, '')), tokenDigest);

  function cors(req, res) {
    const origin = req.headers.origin;
    if (!origin) return true;
    if (!anyOrigin && !origins.has(origin)) return false;
    res.setHeader('Access-Control-Allow-Origin', anyOrigin ? '*' : origin);
    res.setHeader('Vary', 'Origin');
    return true;
  }

  async function api(req, res, path) {
    if (path === '/api/health' && req.method === 'GET') return sendJson(res, 200, { ok: true });
    if (!authorized(req.headers.authorization)) throw new HttpError(401, 'Missing or wrong access token.');
    const route = `${req.method} ${path}`;

    if (route === 'GET /api/vapid-public-key') return sendJson(res, 200, { publicKey });

    if (route === 'PUT /api/schedule') {
      const body = await readJson(req);
      const subscription = parseSubscription(body?.subscription, pushHosts);
      const entries = parseEntries(body.entries);
      if (typeof body.oldEndpoint === 'string' && body.oldEndpoint !== subscription.endpoint) store.delete(body.oldEndpoint);
      const existing = store.get(subscription.endpoint);
      if (!existing && store.size >= maxSubscriptions) throw new HttpError(503, 'This push server has no room for more devices.');
      store.set({
        endpoint: subscription.endpoint,
        subscription,
        entries,
        sent: pruneNotified(existing?.sent ?? [], entries),
        updatedAt: Date.now(),
        failures: 0,
        retryAt: 0,
      });
      return sendJson(res, 200, { ok: true, entries: entries.length });
    }

    if (route === 'DELETE /api/schedule') {
      const body = await readJson(req);
      if (typeof body?.endpoint === 'string') store.delete(body.endpoint);
      return sendJson(res, 204);
    }

    if (route === 'POST /api/test') {
      const body = await readJson(req);
      const record = typeof body?.endpoint === 'string' ? store.get(body.endpoint) : null;
      if (!record) throw new HttpError(404, 'This device is not connected. Connect it again.');
      const payload = buildPayload(
        [
          {
            title: '✅ Pantry Pal push works',
            body: 'Expiry alerts will reach this device even when the app is closed.',
            tag: 'test-push',
            url: '#/settings',
          },
        ],
        [],
      );
      try {
        await sender(record.subscription, payload, { TTL: 600, urgency: 'high' });
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) store.delete(record.endpoint);
        throw new HttpError(502, `The push service refused the message (${err.statusCode ?? err.message}).`);
      }
      return sendJson(res, 204);
    }

    throw new HttpError(404, 'Not found.');
  }

  async function handle(req, res) {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (!path.startsWith('/api/')) {
      if (staticHandler) return staticHandler(req, res);
      return sendJson(res, 404, { error: 'Not found.' });
    }
    if (!cors(req, res)) return sendJson(res, 403, { error: 'This website is not allowed to use this push server (ALLOWED_ORIGINS).' });
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, POST, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.setHeader('Access-Control-Max-Age', '86400');
      if (req.headers['access-control-request-private-network'] === 'true') {
        res.setHeader('Access-Control-Allow-Private-Network', 'true');
      }
      return sendJson(res, 204);
    }
    try {
      await api(req, res, path);
    } catch (err) {
      if (!(err instanceof HttpError)) log.error(err);
      if (err.status === 413) res.setHeader('Connection', 'close');
      sendJson(res, err.status ?? 500, { error: err instanceof HttpError ? err.message : 'Server error.' });
    }
  }

  /** Send what's due for one device. */
  async function deliver(record, now) {
    if (record.retryAt > now) return;
    const due = dueNotifications(record.entries, record.sent, now);
    if (due.keys.length === 0) return;
    try {
      await sender(record.subscription, buildPayload(due.notifications, due.keys), { TTL: 12 * 3600, urgency: 'normal' });
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        store.delete(record.endpoint); // the browser unsubscribed
        return;
      }
      const failures = (record.failures ?? 0) + 1;
      const wait = Math.min(2 ** failures * 60_000, DAY / 4);
      log.warn(`Push to ${new URL(record.endpoint).host} failed (${err.statusCode ?? err.message}); retrying in ${Math.round(wait / 60_000)} min.`);
      store.set({ ...record, failures, retryAt: now + wait });
      return;
    }
    store.set({ ...record, sent: pruneNotified([...record.sent, ...due.keys], record.entries), failures: 0, retryAt: 0 });
  }

  let ticking = false;
  /** Deliver everything that's due (runs every minute). */
  async function tick(now = Date.now()) {
    if (ticking) return;
    ticking = true;
    try {
      for (const record of store.all()) {
        if (now - record.updatedAt > STALE_AFTER) store.delete(record.endpoint);
        else await deliver(record, now);
      }
    } finally {
      ticking = false;
    }
  }

  return { handle, tick, createServer: () => createServer(handle) };
}
