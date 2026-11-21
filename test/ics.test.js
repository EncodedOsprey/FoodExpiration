import assert from 'node:assert/strict';
import { test } from 'node:test';
import { alarmTrigger, buildICS, foldLine } from '../app/js/ics.js';

const settings = { intervals: [7, 3, 0], expiredAlert: true, notifyTime: '09:00' };

test('alarms fire at the notification time on each interval', () => {
  assert.equal(alarmTrigger(3, '09:00'), '-P2DT15H');
  assert.equal(alarmTrigger(0, '09:00'), 'PT9H');
  assert.equal(alarmTrigger(-1, '18:30'), 'P1DT18H30M');
  assert.equal(alarmTrigger(1, '00:00'), '-P1D');
});

test('folds long lines at 75 octets without splitting characters', () => {
  const line = `SUMMARY:${'🥛 Milk, '.repeat(20)}`;
  const folded = foldLine(line);
  const parts = folded.split('\r\n');
  assert.ok(parts.length > 1);
  for (const part of parts) assert.ok(new TextEncoder().encode(part).length <= 75);
  assert.equal(folded.replaceAll('\r\n ', ''), line);
});

test('exports active items as all-day events with escaped text', () => {
  const items = [
    { id: 'a1', name: 'Milk, whole', emoji: '🥛', status: 'active', expiryDate: '2026-03-05', location: 'fridge' },
    { id: 'b2', name: 'Eaten', status: 'used', expiryDate: '2026-03-05' },
  ];
  const ics = buildICS(items, settings, { now: new Date('2026-03-01T12:00:00Z'), hints: { a1: ['Pancakes'] } });
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.equal(ics.match(/BEGIN:VEVENT/g).length, 1);
  assert.equal(ics.match(/BEGIN:VALARM/g).length, 4);
  assert.match(ics, /\r\nDTSTART;VALUE=DATE:20260305\r\nDTEND;VALUE=DATE:20260306\r\n/);
  assert.match(ics, /SUMMARY:🥛 Milk\\, whole expires\r\n/);
  assert.match(ics, /DESCRIPTION:Stored in: fridge\\nRecipe ideas: Pancakes\r\n/);
  assert.match(ics, /DTSTAMP:20260301T120000Z/);
  assert.doesNotMatch(ics, /[^\r]\n/);
});
