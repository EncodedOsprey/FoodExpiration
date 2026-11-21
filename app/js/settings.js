// User settings, persisted in the shared key-value store.
import { DEFAULT_ALERT_SETTINGS } from './alerts.js';
import { emit } from './events.js';
import { kvGet, kvSet } from './kv.js';

export const DEFAULT_SETTINGS = Object.freeze({
  ...DEFAULT_ALERT_SETTINGS,
  lookupOnline: true, // product names from Open Food Facts
  recipesOnline: true, // recipe ideas from TheMealDB
  beep: true,
  vibrate: true,
  push: Object.freeze({ url: '', token: '', connected: false }),
});

let current = sanitize({});

function sanitize(input) {
  const s = { ...DEFAULT_SETTINGS, ...input };
  const intervals = Array.isArray(s.intervals) ? s.intervals : DEFAULT_SETTINGS.intervals;
  s.intervals = [...new Set(intervals.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 365))].sort(
    (a, b) => b - a,
  );
  s.notifyTime = /^([01]\d|2[0-3]):[0-5]\d$/.test(s.notifyTime) ? s.notifyTime : DEFAULT_SETTINGS.notifyTime;
  for (const key of ['expiredAlert', 'lookupOnline', 'recipesOnline', 'beep', 'vibrate']) {
    s[key] = Boolean(s[key]);
  }
  s.push = { ...DEFAULT_SETTINGS.push, ...(s.push ?? {}) };
  return s;
}

export async function loadSettings() {
  current = sanitize(await kvGet('settings', {}));
  return current;
}

export const getSettings = () => current;

export async function updateSettings(patch) {
  current = sanitize({ ...current, ...patch });
  await kvSet('settings', current);
  emit('settings-change', current);
  return current;
}
