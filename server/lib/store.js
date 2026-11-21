// Push subscriptions and their alert schedules, kept in memory and saved to a JSON file.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export class Store {
  #file;
  #records = new Map();
  #timer = null;
  #writing = Promise.resolve();

  /** `file` is optional: without one nothing is saved (tests). */
  constructor(file = null) {
    this.#file = file;
  }

  async load() {
    if (!this.#file) return;
    try {
      const data = JSON.parse(await readFile(this.#file, 'utf8'));
      for (const record of data.subscriptions ?? []) this.#records.set(record.endpoint, record);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }

  get size() {
    return this.#records.size;
  }

  get(endpoint) {
    return this.#records.get(endpoint) ?? null;
  }

  all() {
    return [...this.#records.values()];
  }

  set(record) {
    this.#records.set(record.endpoint, record);
    this.#saveSoon();
  }

  delete(endpoint) {
    if (this.#records.delete(endpoint)) this.#saveSoon();
  }

  #saveSoon() {
    if (!this.#file) return;
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => this.flush(), 250);
  }

  /** Write to disk now (atomically: temp file + rename). */
  flush() {
    clearTimeout(this.#timer);
    if (!this.#file) return Promise.resolve();
    const file = this.#file;
    const data = JSON.stringify({ version: 1, subscriptions: this.all() });
    this.#writing = this.#writing
      .then(async () => {
        await mkdir(dirname(file), { recursive: true });
        await writeFile(`${file}.tmp`, data, { mode: 0o600 });
        await rename(`${file}.tmp`, file);
      })
      .catch((err) => console.error('Saving subscriptions failed:', err));
    return this.#writing;
  }
}
