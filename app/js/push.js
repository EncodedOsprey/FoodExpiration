// Optional link to a self-hosted push server (see /server). With it, alerts arrive even when
// the app is closed, which is the only way to get them on iPhone / iPad.
import { kvGet } from './kv.js';
import { getSettings, updateSettings } from './settings.js';

const MAX_ENTRIES = 500;

export function normalizeServerUrl(input) {
  const url = new URL(String(input).trim());
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new Error('The push server address must start with https://');
  }
  return url.href.replace(/\/+$/, '');
}

async function api(path, { method = 'GET', body, push = getSettings().push } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (push.token) headers.Authorization = `Bearer ${push.token}`;
  let res;
  try {
    res = await fetch(`${push.url}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error(`Couldn't reach ${push.url}. Check the address and that the server allows this site (ALLOWED_ORIGINS).`);
  }
  if (res.status === 401) throw new Error('The push server rejected the access token.');
  if (!res.ok) throw new Error(`Push server error (HTTP ${res.status}).`);
  return res.status === 204 ? null : res.json();
}

function base64UrlToBytes(text) {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(text.length / 4) * 4, '=');
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

const sameKey = (a, b) => a && b && a.byteLength === b.byteLength && new Uint8Array(a).every((v, i) => v === b[i]);

async function registration() {
  const reg = await navigator.serviceWorker?.getRegistration();
  if (!reg?.pushManager) throw new Error('Push messages are not supported in this browser.');
  return reg;
}

/** Entries the server should deliver: everything scheduled that hasn't been shown yet. */
async function pendingEntries() {
  const [schedule, notified] = await Promise.all([kvGet('schedule', []), kvGet('notified', [])]);
  const shown = new Set(notified);
  return schedule.filter((entry) => !shown.has(entry.key)).slice(0, MAX_ENTRIES);
}

/** Subscribe this device and send it the alert schedule. Call from a click handler. */
export async function connect(urlInput, token = '') {
  if (!('Notification' in globalThis)) throw new Error('Notifications are not available here.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Allow notifications first.');
  const push = { url: normalizeServerUrl(urlInput), token: token.trim(), connected: false };
  const { publicKey } = await api('/api/vapid-public-key', { push });
  const key = base64UrlToBytes(publicKey);
  const reg = await registration();
  let subscription = await reg.pushManager.getSubscription();
  if (subscription && !sameKey(subscription.options?.applicationServerKey, key)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await api('/api/schedule', {
    method: 'PUT',
    push,
    body: { subscription: subscription.toJSON(), entries: await pendingEntries() },
  });
  await updateSettings({ push: { ...push, connected: true } });
}

/** Send the latest schedule to the server (called whenever it changes). */
export async function syncPush() {
  const push = getSettings().push;
  if (!push.connected) return;
  const subscription = await (await registration()).pushManager.getSubscription();
  if (!subscription) {
    await updateSettings({ push: { ...push, connected: false } });
    return;
  }
  await api('/api/schedule', {
    method: 'PUT',
    body: { subscription: subscription.toJSON(), entries: await pendingEntries() },
  });
}

export async function disconnect() {
  const push = getSettings().push;
  const reg = await navigator.serviceWorker?.getRegistration();
  const subscription = await reg?.pushManager?.getSubscription();
  if (subscription) {
    await api('/api/schedule', { method: 'DELETE', body: { endpoint: subscription.endpoint } }).catch(() => {});
    await subscription.unsubscribe().catch(() => {});
  }
  await updateSettings({ push: { ...push, connected: false } });
}

/** Ask the server to send a test push right away. */
export async function testPush() {
  const subscription = await (await registration()).pushManager.getSubscription();
  if (!subscription) throw new Error('This device is not subscribed. Connect again.');
  await api('/api/test', { method: 'POST', body: { endpoint: subscription.endpoint } });
}
