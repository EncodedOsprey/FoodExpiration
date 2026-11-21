// Page-side alert handling: keeps the shared alert schedule current, shows alerts that fall
// due while the app is open, updates badges and sets up background checks.
import { buildSchedule, pendingAlertCount, pruneNotified } from './alerts.js';
import { todayISO } from './dates.js';
import { emit, on } from './events.js';
import { kvUpdate } from './kv.js';
import { claimDue, showNotifications } from './notify-core.js';
import { syncPush } from './push.js';
import { recipeHints } from './recipes.js';
import { getSettings } from './settings.js';
import { activeItems } from './store.js';

export const notificationsSupported = () => 'Notification' in globalThis && 'serviceWorker' in navigator;
export const notificationPermission = () => (notificationsSupported() ? Notification.permission : 'unsupported');

let chain = Promise.resolve();
let timer = null;

async function rebuildSchedule() {
  const settings = getSettings();
  const items = activeItems();
  const hints = await recipeHints(items, { online: settings.recipesOnline }).catch(() => ({}));
  const schedule = buildSchedule(items, settings, { hints });
  await kvUpdate(['notified'], ({ notified = [] }) => ({
    set: { schedule, notified: pruneNotified(notified, schedule) },
  }));
  updateBadge();
  if (settings.push.connected) await syncPush().catch((err) => console.warn('Push sync failed:', err));
  emit('schedule-change', schedule);
  return schedule;
}

/** Rebuild the alert schedule now (runs one at a time so the newest data always wins). */
export function syncSchedule() {
  clearTimeout(timer);
  chain = chain.then(rebuildSchedule, rebuildSchedule);
  return chain;
}

/** Rebuild soon, coalescing bursts of changes. */
export function scheduleSync(delay = 400) {
  clearTimeout(timer);
  timer = setTimeout(syncSchedule, delay);
}

export function updateBadge() {
  const count = pendingAlertCount(activeItems(), getSettings());
  emit('badge', count);
  if ('setAppBadge' in navigator) {
    (count ? navigator.setAppBadge(count) : navigator.clearAppBadge()).catch(() => {});
  }
}

async function showSystem(notifications) {
  if (notificationPermission() !== 'granted') return false;
  const reg = await navigator.serviceWorker.getRegistration().catch(() => null);
  if (reg) {
    await showNotifications(reg, notifications);
    return true;
  }
  for (const n of notifications) new Notification(n.title, { body: n.body, tag: n.tag });
  return true;
}

let checking = false;
/** Show alerts that are due. In the foreground they appear in the app; otherwise as notifications. */
export async function checkDue() {
  if (checking) return;
  checking = true;
  try {
    await chain;
    const due = await claimDue(Date.now());
    if (due.notifications.length === 0) return;
    const looking = document.visibilityState === 'visible' && document.hasFocus();
    if (looking || !(await showSystem(due.notifications))) emit('alerts-due', due.notifications);
    if (getSettings().push.connected) scheduleSync(); // stop the server sending these again
  } catch (err) {
    console.warn('Checking alerts failed:', err);
  } finally {
    checking = false;
  }
}

export async function requestPermission() {
  if (!notificationsSupported()) return 'unsupported';
  const result = await Notification.requestPermission();
  if (result === 'granted') registerPeriodicSync();
  emit('permission-change', result);
  return result;
}

/**
 * Chrome on Android/desktop can wake an installed app a few times a day to check for alerts
 * even while it's closed. Other browsers need the push server for that.
 */
export async function registerPeriodicSync() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (!reg?.periodicSync) return 'unsupported';
    const status = await navigator.permissions.query({ name: 'periodic-background-sync' });
    if (status.state !== 'granted') return 'not-installed';
    await reg.periodicSync.register('expiry-check', { minInterval: 4 * 60 * 60 * 1000 });
    return 'registered';
  } catch {
    return 'unsupported';
  }
}

export async function testNotification() {
  const shown = await showSystem([
    {
      title: '🥛 Milk expires tomorrow',
      body: 'This is a test alert. Recipe ideas: Pancakes · Rice pudding',
      tag: 'test-alert',
      url: '#/alerts',
    },
  ]);
  if (!shown) throw new Error('Notifications are not allowed.');
}

let lastDay = '';
function tick() {
  const today = todayISO();
  if (today !== lastDay) {
    const changed = lastDay !== '';
    lastDay = today;
    if (changed) {
      emit('day-change', today);
      syncSchedule();
    }
  }
  checkDue();
}

export function startAlerts() {
  lastDay = todayISO();
  on('items-change', () => scheduleSync());
  on('settings-change', () => scheduleSync());
  syncSchedule().then(checkDue);
  setInterval(tick, 60_000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') tick();
  });
  if (notificationPermission() === 'granted') registerPeriodicSync();
}
