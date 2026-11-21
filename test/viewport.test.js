import assert from 'node:assert/strict';
import { test } from 'node:test';

const { looksStuck } = await import('../app/js/viewport.js');

const healthy = { scale: 1, offsetTop: 0, visualHeight: 580, innerHeight: 580, fullHeight: 580, typing: false };

test('spots the viewport iOS leaves shifted or shrunk', () => {
  assert.equal(looksStuck(healthy), false);
  assert.equal(looksStuck({ ...healthy, offsetTop: 92 }), true); // header off the top, tab bar floating
  assert.equal(looksStuck({ ...healthy, visualHeight: 300 }), true); // still sized for the keyboard
  assert.equal(looksStuck({ ...healthy, innerHeight: 488, visualHeight: 488 }), true); // shrunk
});

test('leaves an open keyboard, pinch zoom and Safari’s toolbars alone', () => {
  assert.equal(looksStuck({ ...healthy, offsetTop: 40, visualHeight: 300, typing: true }), false);
  assert.equal(looksStuck({ ...healthy, scale: 2, offsetTop: 120, visualHeight: 290 }), false);
  assert.equal(looksStuck({ ...healthy, innerHeight: 618, visualHeight: 618 }), false); // toolbar collapsed
});
