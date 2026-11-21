// Pieces shared by several screens: item rows, recipe cards and item actions.
import { phraseFor, snoozeTarget } from '../alerts.js';
import { parseTime } from '../dates.js';
import { getSettings } from '../settings.js';
import { saveItem, setStatus } from '../store.js';
import { choose, daysLeftOf, expiryPill, html, locationName, safeUrl, thumb, toast } from '../ui.js';

export const INTERVAL_LABELS = { 30: '1 month', 14: '2 weeks', 7: '1 week', 5: '5 days', 3: '3 days', 2: '2 days', 1: '1 day', 0: 'On the day' };

export function formatTime(hhmm) {
  const [h, m] = parseTime(hhmm);
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(2000, 0, 1, h, m));
}

/** "You’ll be alerted 1 week before, …, at 9:00 AM.", or '' when every alert is off. */
export function alertSummary(s) {
  const parts = s.intervals.map((d) => (d === 0 ? 'on the day' : `${INTERVAL_LABELS[d] ?? `${d} days`} before`));
  if (s.expiredAlert) parts.push('the day after');
  if (!parts.length) return '';
  return `You’ll be alerted ${new Intl.ListFormat(undefined).format(parts)}, at ${formatTime(s.notifyTime)}.`;
}

export const itemHref = (item) => `#/item/${encodeURIComponent(item.id)}`;

export function itemSubtitle(item) {
  return [item.brand, locationName(item.location), item.quantity, item.expirySource === 'estimate' && 'estimated date']
    .filter(Boolean)
    .join(' · ');
}

/** A pantry row. `compact` drops the pill (the expiry moves into the subtitle) to make room for an action. */
export function itemRow(item, { action = '', compact = false } = {}) {
  const active = item.status === 'active';
  const days = daysLeftOf(item);
  const status = active ? expiryPill(item) : html`<span class="pill">${item.status === 'used' ? 'Used' : 'Tossed'}</span>`;
  const sub =
    compact && active && days !== null
      ? [phraseFor(days), locationName(item.location)].filter(Boolean).join(' · ')
      : itemSubtitle(item);
  return html`<li>
    <a class="row ${active ? '' : 'finished'}" href="${itemHref(item)}">
      ${thumb(item)}
      <span class="main"><span class="title">${item.name}</span><span class="sub">${sub}</span></span>
      ${compact ? '' : status}
    </a>
    ${action}
  </li>`;
}

export function recipeHref(recipe, itemId = '') {
  return `#/recipe/${encodeURIComponent(recipe.key)}${itemId ? `?item=${encodeURIComponent(itemId)}` : ''}`;
}

const names = (items) => items.map((i) => i.name).join(', ');

export function recipeMeta(recipe) {
  const time = recipe.minutes ? `${recipe.minutes} min · ` : '';
  if (recipe.items?.length) return html`${time}Uses <strong>${names(recipe.items)}</strong>`;
  if (recipe.also?.length) return html`${time}Also uses <strong>${names(recipe.also)}</strong>`;
  if (recipe.minutes) return `${recipe.minutes} min`;
  return recipe.source === 'mealdb' ? 'TheMealDB' : '';
}

export function recipeCard(recipe, { itemId = '' } = {}) {
  const img = safeUrl(recipe.thumb);
  const fallback = recipe.emoji || '🍽️';
  return html`<a class="recipe-card" href="${recipeHref(recipe, itemId)}">
    <span class="pic" aria-hidden="true">${
      img ? html`<img src="${img}" alt="" loading="lazy" referrerpolicy="no-referrer" data-fallback="${fallback}">` : fallback
    }</span>
    <span class="name">${recipe.name}</span>
    <span class="meta">${recipeMeta(recipe)}</span>
  </a>`;
}

export const skeletons = (n = 3) => html`${Array.from({ length: n }, () => html`<div class="skeleton"></div>`)}`;

export async function finishItem(item, status) {
  await setStatus(item.id, status);
  toast(status === 'used' ? `Nice, ${item.name} didn’t go to waste.` : `${item.name} marked as tossed.`, {
    action: 'Undo',
    onAction: () => setStatus(item.id, 'active'),
  });
}

export async function snoozeItem(item) {
  const days = await choose(`Remind me about ${item.name}`, [
    { label: 'Tomorrow', value: 1 },
    { label: 'In 2 days', value: 2 },
    { label: 'In 3 days', value: 3 },
    { label: 'In a week', value: 7 },
  ]);
  if (days === null) return;
  await saveItem({ id: item.id, snoozedUntil: snoozeTarget(days, getSettings()) });
  toast(days === 1 ? 'OK, I’ll remind you tomorrow.' : `OK, I’ll remind you in ${days} days.`);
}

export async function dismissAlert(alert) {
  await saveItem({ id: alert.item.id, ack: alert.ackKey });
  toast('Dismissed until the next reminder.', {
    action: 'Undo',
    onAction: () => saveItem({ id: alert.item.id, ack: null }),
  });
}
