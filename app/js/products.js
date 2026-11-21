// Product lookup by barcode: first what you entered last time you bought it, then the
// Open Food Facts database (free, open data: https://openfoodfacts.org).
import { lookupCandidates } from './barcode.js';
import { daysBetween } from './dates.js';
import * as db from './db.js';
import { englishCategories } from './foods.js';

const OFF_API = 'https://world.openfoodfacts.org/api/v2/product/';
const FIELDS = [
  'code',
  'product_name',
  'product_name_en',
  'generic_name',
  'generic_name_en',
  'brands',
  'quantity',
  'categories_tags',
  'image_front_small_url',
  'image_small_url',
].join(',');

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

export function parseOFFProduct(code, p) {
  return {
    code,
    name: clean(p.product_name_en) || clean(p.product_name) || clean(p.generic_name_en) || clean(p.generic_name),
    brand: clean(String(p.brands ?? '').split(',')[0]),
    quantity: clean(p.quantity),
    image: p.image_front_small_url || p.image_small_url || '',
    categories: englishCategories(p.categories_tags ?? []),
    source: 'off',
    fetchedAt: Date.now(),
  };
}

async function fetchJSON(url, { timeout = 8000, signal } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  const abort = () => ctrl.abort();
  signal?.addEventListener('abort', abort);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    const body = res.status === 404 ? null : res.ok ? await res.json() : undefined;
    if (body === undefined) throw new Error(`HTTP ${res.status}`);
    return body;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

/**
 * Find a product. Resolves to { status: 'found', product, remembered } or
 * { status: 'not-found' | 'offline' | 'error' }.
 */
export async function lookupProduct(code, { online = true, signal } = {}) {
  const candidates = lookupCandidates(code);
  for (const candidate of candidates) {
    const known = await db.get('products', candidate).catch(() => null);
    if (known?.name || known?.savedAt) return { status: 'found', product: known, remembered: Boolean(known.savedAt) };
  }
  if (!online) return { status: 'not-found' };
  if (globalThis.navigator?.onLine === false) return { status: 'offline' };
  try {
    for (const candidate of candidates) {
      const data = await fetchJSON(`${OFF_API}${encodeURIComponent(candidate)}.json?fields=${FIELDS}`, { signal });
      if (data?.status === 1 && data.product) {
        const product = parseOFFProduct(candidate, data.product);
        await db.put('products', product).catch(() => {});
        return { status: 'found', product, remembered: false };
      }
    }
    return { status: 'not-found' };
  } catch (err) {
    if (signal?.aborted) throw err;
    return { status: globalThis.navigator?.onLine === false ? 'offline' : 'error', error: err };
  }
}

/** Remember what was entered for a barcode so the next scan of it is instant. */
export async function rememberProduct(item) {
  if (!item.barcode) return;
  const existing = (await db.get('products', item.barcode).catch(() => null)) ?? { code: item.barcode };
  const learned =
    ['manual', 'barcode'].includes(item.expirySource) && item.purchaseDate && item.expiryDate
      ? daysBetween(item.purchaseDate, item.expiryDate)
      : null;
  await db.put('products', {
    ...existing,
    code: item.barcode,
    name: item.name,
    brand: item.brand ?? '',
    quantity: item.quantity ?? '',
    image: item.image || existing.image || '',
    location: item.location,
    typeId: item.typeId ?? null,
    emoji: item.emoji,
    ingredient: item.ingredient ?? '',
    shelfDays: learned > 0 ? learned : (existing.shelfDays ?? null),
    savedAt: Date.now(),
  });
}
