import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.TZ = 'America/New_York';
const { addDays, addMonths, atLocalTime, daysUntil, isValidISODate, todayISO } = await import('../app/js/dates.js');

test('calendar math stays on whole local days across DST', () => {
  // US clocks spring forward on 2026-03-08.
  assert.equal(daysUntil('2026-03-09', new Date(2026, 2, 7, 23, 30)), 2);
  assert.equal(addDays('2026-03-07', 2), '2026-03-09');
  assert.equal(atLocalTime('2026-03-08', '09:00').getHours(), 9);
  assert.equal(todayISO(new Date(2026, 2, 8, 0, 30)), '2026-03-08');
});

test('addMonths clamps to the end of shorter months', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2028-01-31', 1), '2028-02-29');
  assert.equal(addMonths('2026-11-15', 3), '2027-02-15');
});

test('rejects impossible dates', () => {
  assert.equal(isValidISODate('2026-02-30'), false);
  assert.equal(isValidISODate('2026-2-3'), false);
  assert.equal(isValidISODate('2026-12-31'), true);
});
