// Showing due expiry alerts. Shared by the page and the service worker.
import { dueNotifications, pruneNotified } from './alerts.js';
import { kvUpdate } from './kv.js';

/** Atomically take the alerts that are due now and mark them as shown. */
export function claimDue(now = Date.now()) {
  return kvUpdate(['schedule', 'notified'], ({ schedule = [], notified = [] }) => {
    const due = dueNotifications(schedule, notified, now);
    if (due.keys.length === 0) return { result: due };
    return { set: { notified: pruneNotified([...notified, ...due.keys], schedule) }, result: due };
  });
}

/** Record alerts shown by another route (a push message). Resolves true if any were new. */
export function markNotified(keys) {
  return kvUpdate(['notified'], ({ notified = [] }) => {
    const known = new Set(notified);
    const fresh = keys.filter((k) => !known.has(k));
    return fresh.length ? { set: { notified: [...notified, ...fresh] }, result: true } : { result: false };
  });
}

export async function showNotifications(registration, notifications, { renotify = true } = {}) {
  const icon = new URL('icons/icon-192.png', registration.scope).href;
  const badge = new URL('icons/badge-96.png', registration.scope).href;
  for (const n of notifications) {
    await registration.showNotification(n.title, {
      body: n.body,
      tag: n.tag,
      renotify,
      icon,
      badge,
      data: { url: n.url },
    });
  }
}
