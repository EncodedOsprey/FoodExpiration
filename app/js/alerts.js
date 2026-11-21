// Expiry alert logic shared by the page, the service worker and the optional push server.
// Everything here is pure (no DOM, no storage) so it can run in any of those contexts.
import { DAY_MS, addDays, atLocalTime, daysUntil, isValidISODate, todayISO } from './dates.js';

/** Stage value for "the day after expiry". Other stages are "N days before expiry". */
export const EXPIRED_STAGE = -1;
export const INTERVAL_CHOICES = [30, 14, 7, 5, 3, 2, 1, 0];
export const DEFAULT_ALERT_SETTINGS = Object.freeze({
  intervals: [7, 3, 1, 0],
  expiredAlert: true,
  notifyTime: '09:00',
});

export const isActive = (item) => item?.status === 'active' && isValidISODate(item.expiryDate);

/** Alert stages, most distant first, e.g. [7, 3, 1, 0, -1]. */
export function stagesFor(settings = DEFAULT_ALERT_SETTINGS) {
  const unique = new Set(
    (settings.intervals ?? [])
      .map(Number)
      .filter((n) => Number.isInteger(n) && n >= 0 && n <= 365),
  );
  const stages = [...unique].sort((a, b) => b - a);
  if (settings.expiredAlert) stages.push(EXPIRED_STAGE);
  return stages;
}

/** The most urgent stage an item with `daysLeft` has reached, or null if none yet. */
export function currentStage(daysLeft, stages) {
  let stage = null;
  for (const s of stages) {
    if (s >= 0 ? daysLeft <= s : daysLeft < 0) stage = s;
  }
  return stage;
}

export function urgencyOf(daysLeft) {
  if (daysLeft < 0) return 'expired';
  if (daysLeft === 0) return 'today';
  if (daysLeft <= 2) return 'soon';
  if (daysLeft <= 7) return 'week';
  return 'fresh';
}

export function phraseFor(daysLeft) {
  const d = daysLeft || 0;
  if (d < -1) return `expired ${-d} days ago`;
  if (d === -1) return 'expired yesterday';
  if (d === 0) return 'expires today';
  if (d === 1) return 'expires tomorrow';
  return `expires in ${d} days`;
}

function shortPhrase(daysLeft) {
  const d = daysLeft || 0;
  if (d < 0) return 'expired';
  if (d === 0) return 'today';
  if (d === 1) return 'tomorrow';
  return `${d} days`;
}

export function groupLabel(daysLeft) {
  if (daysLeft < 0) return 'Expired';
  if (daysLeft === 0) return 'Expires today';
  if (daysLeft === 1) return 'Expires tomorrow';
  if (daysLeft <= 3) return 'Within 3 days';
  if (daysLeft <= 7) return 'This week';
  return 'Coming up';
}

/**
 * Items that need attention in the app right now (inside an alert window or expired),
 * most urgent first. Acknowledgement is per stage, so a dismissed alert comes back when
 * the item reaches its next stage.
 */
export function attentionList(items, settings, now = new Date()) {
  const stages = stagesFor(settings);
  const nowMs = Number(now);
  const out = [];
  for (const item of items) {
    if (!isActive(item)) continue;
    const daysLeft = daysUntil(item.expiryDate, now);
    const stage = currentStage(daysLeft, stages) ?? (daysLeft < 0 ? EXPIRED_STAGE : null);
    if (stage === null) continue;
    const ackKey = `${stage}|${item.expiryDate}`;
    out.push({
      item,
      daysLeft,
      stage,
      ackKey,
      acknowledged: item.ack === ackKey,
      snoozed: Number(item.snoozedUntil ?? 0) > nowMs,
    });
  }
  return out.sort((a, b) => a.daysLeft - b.daysLeft || a.item.name.localeCompare(b.item.name));
}

export const pendingAlertCount = (items, settings, now = new Date()) =>
  attentionList(items, settings, now).filter((a) => !a.acknowledged && !a.snoozed).length;

/** Timestamp `days` days from today at the user's notification time. */
export function snoozeTarget(days, settings, now = new Date()) {
  return atLocalTime(addDays(todayISO(now), days), settings.notifyTime).getTime();
}

function makeEntry(item, stage, fireAt, ideas) {
  return {
    key: `${item.id}|${stage}|${item.expiryDate}`,
    itemId: item.id,
    stage,
    fireAt,
    // Local midnight at the start of the expiry day; lets any context (including a server in
    // another time zone) work out "days left" at the moment a notification is shown.
    expiresAt: atLocalTime(item.expiryDate, '00:00').getTime(),
    name: item.name,
    emoji: item.emoji || '🛒',
    location: item.location || '',
    ideas: ideas.slice(0, 3),
    url: `#/item/${encodeURIComponent(item.id)}`,
  };
}

/**
 * Every future/pending notification for the given items, one per alert stage.
 * Stages that had already passed when the item was added (or its date last changed) are
 * skipped so adding something that expires tomorrow doesn't trigger a "7 days" alert.
 * `hints` maps item id -> recipe names to mention in the notification.
 */
export function buildSchedule(items, settings, { hints = {} } = {}) {
  const stages = stagesFor(settings);
  const entries = [];
  for (const item of items) {
    if (!isActive(item)) continue;
    const floor = Number(item.expirySetAt ?? item.createdAt ?? 0);
    const snoozedUntil = Number(item.snoozedUntil ?? 0);
    const ideas = hints[item.id] ?? [];
    const own = [];
    for (const stage of stages) {
      const fireAt = atLocalTime(addDays(item.expiryDate, -stage), settings.notifyTime).getTime();
      if (fireAt < floor || fireAt < snoozedUntil) continue;
      own.push(makeEntry(item, stage, fireAt, ideas));
    }
    if (snoozedUntil > floor && !own.some((e) => e.fireAt === snoozedUntil)) {
      own.push(makeEntry(item, `snooze-${snoozedUntil}`, snoozedUntil, ideas));
    }
    entries.push(...own);
  }
  return entries.sort((a, b) => a.fireAt - b.fireAt);
}

export const daysLeftAt = (expiresAt, now) => Math.ceil((expiresAt - now) / DAY_MS) || 0;

export function renderNotification(entry, now = Date.now()) {
  const daysLeft = daysLeftAt(entry.expiresAt, now);
  const ideas = entry.ideas?.length
    ? `Recipe ideas: ${entry.ideas.join(' · ')}`
    : 'Tap for recipe ideas.';
  const where = entry.location ? `${entry.location[0].toUpperCase()}${entry.location.slice(1)} · ` : '';
  return {
    title: `${entry.emoji} ${entry.name} ${phraseFor(daysLeft)}`,
    body: `${where}${ideas}`,
    tag: `item-${entry.itemId}`,
    url: entry.url,
  };
}

/**
 * Notifications that are due and haven't been shown yet. Only the most recent stage per
 * item is shown (no backlog spam after the app was closed for a while), and several items
 * becoming due together are merged into one summary notification.
 */
export function dueNotifications(entries, notifiedKeys = [], now = Date.now(), { summaryAt = 3 } = {}) {
  const notified = new Set(notifiedKeys);
  const due = entries.filter((e) => e.fireAt <= now && !notified.has(e.key));
  if (due.length === 0) return { notifications: [], keys: [] };

  const latest = new Map();
  for (const e of due) {
    const prev = latest.get(e.itemId);
    if (!prev || e.fireAt > prev.fireAt) latest.set(e.itemId, e);
  }
  const picked = [...latest.values()].sort(
    (a, b) => a.expiresAt - b.expiresAt || a.name.localeCompare(b.name),
  );
  const keys = due.map((e) => e.key);
  if (picked.length < summaryAt) {
    return { notifications: picked.map((e) => renderNotification(e, now)), keys };
  }
  const shown = picked.slice(0, 6).map((e) => `${e.name} (${shortPhrase(daysLeftAt(e.expiresAt, now))})`);
  const more = picked.length > 6 ? ` and ${picked.length - 6} more` : '';
  return {
    notifications: [
      {
        title: `🍳 ${picked.length} items need using up`,
        body: `${shown.join(', ')}${more}. Tap for recipe ideas.`,
        tag: 'pantry-summary',
        url: '#/alerts',
      },
    ],
    keys,
  };
}

/** Drop remembered keys that no longer exist in the schedule so the set stays small. */
export function pruneNotified(notifiedKeys, entries) {
  const live = new Set(entries.map((e) => e.key));
  return notifiedKeys.filter((k) => live.has(k));
}
