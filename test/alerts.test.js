import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_ALERT_SETTINGS,
  attentionList,
  buildSchedule,
  dueNotifications,
  pruneNotified,
  renderNotification,
} from '../app/js/alerts.js';

const settings = { ...DEFAULT_ALERT_SETTINGS }; // 7, 3, 1, 0 days before + day after, at 09:00
const at = (y, m, d, h = 9, min = 0) => new Date(y, m - 1, d, h, min).getTime();

function item(id, expiryDate, extra = {}) {
  return {
    id,
    name: `Item ${id}`,
    emoji: '🥛',
    location: 'fridge',
    status: 'active',
    expiryDate,
    createdAt: at(2026, 3, 1, 8),
    ...extra,
  };
}

test('schedule skips stages that had passed when the item was added', () => {
  const entries = buildSchedule([item('a', '2026-03-05')], settings);
  assert.deepEqual(
    entries.map((e) => [e.stage, new Date(e.fireAt).getDate()]),
    [[3, 2], [1, 4], [0, 5], [-1, 6]],
  );
  assert.equal(buildSchedule([item('b', '2026-03-05', { status: 'used' })], settings).length, 0);
});

test('snoozing postpones alerts and adds a reminder at the snooze time', () => {
  const snoozedUntil = at(2026, 3, 14, 12);
  const entries = buildSchedule([item('a', '2026-03-20', { snoozedUntil })], settings);
  // The 7-day alert (Mar 13) falls inside the snooze and is dropped.
  assert.deepEqual(entries.map((e) => e.stage), [`snooze-${snoozedUntil}`, 3, 1, 0, -1]);
  // No extra reminder when a regular alert already fires when the snooze ends.
  const same = buildSchedule([item('b', '2026-03-06', { snoozedUntil: at(2026, 3, 3) })], settings);
  assert.deepEqual(same.map((e) => e.stage), [3, 1, 0, -1]);
});

test('only the latest due stage per item is shown and every due key is recorded', () => {
  const entries = buildSchedule([item('a', '2026-03-05')], settings);
  const { notifications, keys } = dueNotifications(entries, [], at(2026, 3, 4, 10));
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].title, '🥛 Item a expires tomorrow');
  assert.equal(keys.length, 2);
  assert.equal(dueNotifications(entries, keys, at(2026, 3, 4, 11)).notifications.length, 0);
});

test('several items due together are merged into one summary', () => {
  const entries = buildSchedule(
    [item('a', '2026-03-05'), item('b', '2026-03-05'), item('c', '2026-03-04')],
    settings,
  );
  const { notifications } = dueNotifications(entries, [], at(2026, 3, 4, 9, 5));
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].tag, 'pantry-summary');
  assert.match(notifications[0].body, /Item c \(today\), Item a \(tomorrow\), Item b \(tomorrow\)/);
});

test('notification text is computed when shown and mentions recipe ideas', () => {
  const [entry] = buildSchedule([item('a', '2026-03-10')], settings, { hints: { a: ['Pancakes', 'Rice Pudding'] } });
  const shownLate = renderNotification(entry, at(2026, 3, 8, 9));
  assert.equal(shownLate.title, '🥛 Item a expires in 2 days');
  assert.equal(shownLate.body, 'Fridge · Recipe ideas: Pancakes · Rice Pudding');
  assert.equal(shownLate.url, '#/item/a');
});

test('dismissing an alert lasts until the item reaches its next stage', () => {
  const milk = item('a', '2026-03-05', { ack: '3|2026-03-05' });
  const [threeDays] = attentionList([milk], settings, new Date(at(2026, 3, 2)));
  assert.equal(threeDays.acknowledged, true);
  const [oneDay] = attentionList([milk], settings, new Date(at(2026, 3, 4)));
  assert.equal(oneDay.acknowledged, false);
  assert.equal(attentionList([milk], settings, new Date(at(2026, 2, 20))).length, 0);
});

test('pruneNotified forgets keys for items that left the schedule', () => {
  const entries = buildSchedule([item('a', '2026-03-05')], settings);
  assert.deepEqual(pruneNotified([entries[0].key, 'gone|3|2026-03-05'], entries), [entries[0].key]);
});
