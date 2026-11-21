import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { stampedServiceWorker } from '../scripts/precache.mjs';

test('app/sw.js offline file list is current (fix: npm run precache)', async () => {
  const current = await readFile(new URL('../app/sw.js', import.meta.url), 'utf8');
  assert.equal(current, await stampedServiceWorker());
});
