// Pantry items: an in-memory copy of the IndexedDB "items" store plus change events.
import * as db from './db.js';
import { emit } from './events.js';

let items = [];

export async function loadItems() {
  items = await db.getAll('items');
  return items;
}

export const allItems = () => items;
export const activeItems = () => items.filter((i) => i.status === 'active');
export const findItem = (id) => items.find((i) => i.id === id) ?? null;

export function newId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Create or update an item. Changing the expiry date resets its alert state. */
export async function saveItem(changes) {
  const now = Date.now();
  const prev = changes.id ? findItem(changes.id) : null;
  const item = { ...prev, ...changes, updatedAt: now };
  if (!prev) {
    item.id ??= newId();
    item.createdAt ??= now;
    item.status ??= 'active';
  }
  if (!prev || prev.expiryDate !== item.expiryDate) {
    item.expirySetAt = now;
    item.ack = null;
    item.snoozedUntil = null;
  }
  await db.put('items', item);
  items = [...items.filter((i) => i.id !== item.id), item];
  emit('items-change', { item, prev });
  return item;
}

export function setStatus(id, status) {
  return saveItem({ id, status, finishedAt: status === 'active' ? null : Date.now() });
}

export async function deleteItem(id) {
  await db.remove('items', id);
  items = items.filter((i) => i.id !== id);
  emit('items-change', { removed: id });
}

const STATUSES = new Set(['active', 'used', 'tossed']);

/** Restore items from a backup. Existing items with the same id are overwritten. */
export async function importItems(list) {
  const valid = list
    .filter((i) => i && typeof i.id === 'string' && i.id && typeof i.name === 'string' && i.name.trim())
    .map((i) => ({ ...i, status: STATUSES.has(i.status) ? i.status : 'active' }));
  await db.putMany('items', valid);
  await loadItems();
  emit('items-change', { imported: valid.length });
  return valid.length;
}

/** Forget used/tossed items older than `days`. */
export async function clearHistory(days = 0) {
  const cutoff = Date.now() - days * 86_400_000;
  const old = items.filter((i) => i.status !== 'active' && (i.finishedAt ?? i.updatedAt) <= cutoff);
  for (const item of old) await db.remove('items', item.id);
  await loadItems();
  emit('items-change', { removed: old.length });
  return old.length;
}
