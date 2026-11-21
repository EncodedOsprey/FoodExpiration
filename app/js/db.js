// IndexedDB storage: pantry items, remembered products (by barcode) and a small API cache.
const DB_NAME = 'pantry-pal';
const VERSION = 1;
let dbPromise = null;

function open() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('items', { keyPath: 'id' });
      db.createObjectStore('products', { keyPath: 'code' });
      db.createObjectStore('cache', { keyPath: 'key' });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

async function run(storeName, mode, action) {
  const db = await open();
  const tx = db.transaction(storeName, mode);
  const result = action(tx.objectStore(storeName));
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new DOMException('Transaction aborted', 'AbortError'));
  });
  return result instanceof IDBRequest ? result.result : result;
}

export const getAll = (store) => run(store, 'readonly', (s) => s.getAll());
export const get = (store, key) => run(store, 'readonly', (s) => s.get(key));
export const put = (store, value) => run(store, 'readwrite', (s) => void s.put(value));
export const remove = (store, key) => run(store, 'readwrite', (s) => void s.delete(key));
export const clear = (store) => run(store, 'readwrite', (s) => void s.clear());
export const putMany = (store, values) =>
  run(store, 'readwrite', (s) => {
    for (const value of values) s.put(value);
  });

/** Cached API response: { value, fresh } or null. Stale values are kept for offline use. */
export async function cacheGet(key) {
  const hit = await get('cache', key).catch(() => undefined);
  return hit ? { value: hit.value, fresh: hit.expires > Date.now() } : null;
}

export const cacheSet = (key, value, ttlMs) => put('cache', { key, value, expires: Date.now() + ttlMs });

/** Drop cache entries that expired more than `graceMs` ago. */
export function cachePrune(graceMs = 60 * 86_400_000) {
  const cutoff = Date.now() - graceMs;
  return run('cache', 'readwrite', (s) => {
    s.openCursor().onsuccess = (event) => {
      const cursor = event.target.result;
      if (!cursor) return;
      if (cursor.value.expires < cutoff) cursor.delete();
      cursor.continue();
    };
  });
}
