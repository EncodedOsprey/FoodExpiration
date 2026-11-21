// Checks everything the app sends, so the server only ever stores and sends plain data.
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Push services used by Chrome/Edge/Samsung/Opera (FCM, WNS), Firefox (Mozilla) and Safari (Apple).
export const DEFAULT_PUSH_HOSTS = [
  'fcm.googleapis.com',
  'android.googleapis.com',
  'push.services.mozilla.com',
  'push.apple.com',
  'notify.windows.com',
];

const B64URL = /^[A-Za-z0-9_-]+=*$/;
const ITEM_URL = /^#\/[\w\-.~%/?=&]*$/;

export const hostAllowed = (hostname, hosts) => hosts.some((h) => hostname === h || hostname.endsWith(`.${h}`));

export function parseSubscription(input, pushHosts) {
  const endpoint = input?.endpoint;
  let url = null;
  try {
    url = typeof endpoint === 'string' && endpoint.length <= 1024 ? new URL(endpoint) : null;
  } catch {
    // invalid URL
  }
  if (!url) throw new HttpError(400, 'Invalid push subscription.');
  if (url.protocol !== 'https:' || !hostAllowed(url.hostname, pushHosts)) {
    throw new HttpError(400, `Push service ${url.hostname} is not allowed on this server (see PUSH_HOSTS).`);
  }
  const { p256dh, auth } = input.keys ?? {};
  const ok = (v, max) => typeof v === 'string' && v.length <= max && B64URL.test(v);
  if (!ok(p256dh, 200) || !ok(auth, 100)) throw new HttpError(400, 'Invalid push subscription keys.');
  return { endpoint, keys: { p256dh, auth } };
}

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Alert schedule entries (see buildSchedule in app/js/alerts.js); invalid ones are dropped. */
export function parseEntries(input, max = 1000) {
  if (!Array.isArray(input)) throw new HttpError(400, 'entries must be a list.');
  const out = [];
  for (const e of input.slice(0, max)) {
    if (!e || typeof e !== 'object') continue;
    const key = str(e.key, 200);
    const itemId = str(e.itemId, 100);
    const fireAt = finite(e.fireAt);
    const expiresAt = finite(e.expiresAt);
    if (!key || !itemId || fireAt === null || expiresAt === null) continue;
    out.push({
      key,
      itemId,
      stage: typeof e.stage === 'number' ? e.stage : str(e.stage, 40),
      fireAt,
      expiresAt,
      name: str(e.name, 120) || 'Food',
      emoji: str(e.emoji, 16) || '🛒',
      location: str(e.location, 20),
      ideas: Array.isArray(e.ideas) ? e.ideas.slice(0, 3).map((i) => str(i, 80)).filter(Boolean) : [],
      url: typeof e.url === 'string' && e.url.length <= 200 && ITEM_URL.test(e.url) ? e.url : '#/alerts',
    });
  }
  return out;
}
