import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { buildPayload, createApp } from '../lib/app.js';
import { Store } from '../lib/store.js';

const HOUR = 3_600_000;
const T = Date.UTC(2026, 10, 24, 9);
const subscription = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/device-1',
  keys: { p256dh: 'BOr2mHQ3ZJ0r4D2XkV0cR3T1n1lY9e_3Y0Y0kY0aX0', auth: 'k3kS0d-Ag8b2Xn0' },
};
// Milk expires on 25 Nov: expiresAt is midnight at the start of that day.
const entry = (key, fireAt, { name = 'Milk', expiresAt = T + 15 * HOUR } = {}) => ({
  key,
  itemId: name.toLowerCase(),
  stage: Number(key.split('|')[1]),
  fireAt,
  expiresAt,
  name,
  emoji: '🥛',
  location: 'fridge',
  ideas: ['Pancakes'],
  url: `#/item/${name.toLowerCase()}`,
});

const store = new Store();
let sent;
let failWith;
let server;
let base;
let app;

before(async () => {
  app = createApp({
    store,
    publicKey: 'test-public-key',
    sender: async (sub, payload) => {
      if (failWith) throw Object.assign(new Error('push failed'), { statusCode: failWith });
      sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) });
    },
    token: 'secret',
    allowedOrigins: ['https://pantry.example'],
    log: { error() {}, warn() {} },
  });
  server = app.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

beforeEach(() => {
  for (const record of store.all()) store.delete(record.endpoint);
  sent = [];
  failWith = 0;
});

const call = (path, { method = 'GET', body, token = 'secret', origin } = {}) =>
  fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(origin ? { Origin: origin } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

test('sends each due alert once, at its time', async () => {
  const res = await call('/api/schedule', {
    method: 'PUT',
    body: { subscription, entries: [entry('milk|1', T), entry('milk|0', T + 24 * HOUR)] },
  });
  assert.equal(res.status, 200);

  await app.tick(T - 1000);
  assert.equal(sent.length, 0);

  await app.tick(T + 1000);
  await app.tick(T + 2000);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].endpoint, subscription.endpoint);
  assert.deepEqual(sent[0].payload.keys, ['milk|1']);
  assert.match(sent[0].payload.notifications[0].title, /Milk expires tomorrow/);
  assert.match(sent[0].payload.notifications[0].body, /Pancakes/);

  await app.tick(T + 24 * HOUR + 1000);
  assert.equal(sent.length, 2);
  assert.match(sent[1].payload.notifications[0].title, /Milk expires today/);
});

test('keeps what was already sent when the app re-syncs its schedule', async () => {
  const body = { subscription, entries: [entry('milk|1', T)] };
  await call('/api/schedule', { method: 'PUT', body });
  await app.tick(T + 1000);
  await call('/api/schedule', { method: 'PUT', body });
  await app.tick(T + 2000);
  assert.equal(sent.length, 1);
});

test('requires the access token', async () => {
  assert.equal((await call('/api/vapid-public-key', { token: '' })).status, 401);
  assert.equal((await call('/api/vapid-public-key', { token: 'wrong' })).status, 401);
  const res = await call('/api/vapid-public-key');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { publicKey: 'test-public-key' });
  assert.equal((await call('/api/health', { token: '' })).status, 200);
});

test('only accepts subscriptions from known push services', async () => {
  const res = await call('/api/schedule', {
    method: 'PUT',
    body: { subscription: { ...subscription, endpoint: 'https://internal.example/hook' }, entries: [] },
  });
  assert.equal(res.status, 400);
  assert.equal(store.size, 0);
});

test('forgets devices the push service says are gone', async () => {
  await call('/api/schedule', { method: 'PUT', body: { subscription, entries: [entry('milk|1', T)] } });
  failWith = 410;
  await app.tick(T + 1000);
  assert.equal(store.size, 0);
});

test('backs off after other push failures, then retries', async () => {
  await call('/api/schedule', { method: 'PUT', body: { subscription, entries: [entry('milk|1', T)] } });
  failWith = 500;
  await app.tick(T + 1000);
  failWith = 0;
  await app.tick(T + 2000);
  assert.equal(sent.length, 0);
  await app.tick(T + 10 * 60_000);
  assert.equal(sent.length, 1);
});

test('only answers websites in ALLOWED_ORIGINS', async () => {
  const preflight = await fetch(`${base}/api/schedule`, {
    method: 'OPTIONS',
    headers: { Origin: 'https://pantry.example', 'Access-Control-Request-Method': 'PUT' },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://pantry.example');
  assert.match(preflight.headers.get('access-control-allow-headers'), /Authorization/);
  assert.equal((await call('/api/vapid-public-key', { origin: 'https://evil.example' })).status, 403);
});

test('trims remembered keys so the push message stays small', () => {
  const keys = Array.from({ length: 200 }, (_, i) => `item-${i}|3|2026-11-24`);
  const payload = buildPayload([{ title: 'x', body: 'y', tag: 't', url: '#/alerts' }], keys);
  assert.ok(Buffer.byteLength(payload) <= 3000);
  assert.equal(JSON.parse(payload).keys[0], 'item-199|3|2026-11-24');
});
