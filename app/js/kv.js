// Tiny key-value store shared by the page and the service worker (settings, the alert
// schedule and which alerts were already shown). Kept separate from the main database so
// the service worker never has to know about item storage.
const DB_NAME = 'pantry-pal-kv';
const STORE = 'kv';
let dbPromise = null;

function open() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
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

/**
 * Atomically read `keys`, then let `update(values)` return { set: {key: value}, result }.
 * `update` must be synchronous: everything happens inside one IndexedDB transaction, so the
 * page and the service worker can't both claim the same alert.
 */
export async function kvUpdate(keys, update) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const values = {};
    let result;
    let remaining = keys.length;
    const apply = () => {
      try {
        const out = update(values) ?? {};
        result = out.result;
        for (const [key, value] of Object.entries(out.set ?? {})) store.put(value, key);
      } catch (err) {
        tx.abort();
        reject(err);
      }
    };
    for (const key of keys) {
      const req = store.get(key);
      req.onsuccess = () => {
        values[key] = req.result;
        if (--remaining === 0) apply();
      };
    }
    if (keys.length === 0) apply();
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new DOMException('Transaction aborted', 'AbortError'));
  });
}

export async function kvGet(key, fallback) {
  const value = await kvUpdate([key], (values) => ({ result: values[key] }));
  return value === undefined ? fallback : value;
}

export const kvSet = (key, value) => kvUpdate([], () => ({ set: { [key]: value } }));
