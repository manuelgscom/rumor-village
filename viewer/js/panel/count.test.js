// Tests of the counting figures (phase 8-2, 2.14): the pure curve and the
// counters with a fake element and an injected clock.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { COUNT_MS, countAt, createCounters } from './count.js';

test('countAt: starts at from, ends at to, never overshoots, integers', () => {
  assert.equal(countAt(0, 50, 0), 0);
  assert.equal(countAt(0, 50, COUNT_MS), 50);
  assert.equal(countAt(0, 50, COUNT_MS * 3), 50);
  assert.equal(countAt(10, 10, 5), 10);
  let prev = 0;
  for (let ms = 0; ms <= COUNT_MS; ms += 10) {
    const v = countAt(0, 50, ms);
    assert.ok(Number.isInteger(v) && v >= prev && v <= 50, `${ms}: ${v}`);
    prev = v;
  }
  // Down as well.
  assert.equal(countAt(50, 20, 0), 50);
  assert.equal(countAt(50, 20, COUNT_MS), 20);
  assert.ok(countAt(50, 20, COUNT_MS / 2) < 50 && countAt(50, 20, COUNT_MS / 2) > 20);
  // No length: the end at once.
  assert.equal(countAt(0, 9, 0, 0), 9);
});

function fakeApp(params = {}, reduced = false) {
  let now = 1000;
  return {
    app: { params: { t: null, paused: null, embed: false, summary: false, draft: null, clock: null, ...params }, now: () => now, reducedMotion: () => reduced },
    advance(ms) {
      now += ms;
    },
  };
}

test('counters: a new element shows its figure at once, a change counts', () => {
  const { app, advance } = fakeApp();
  const c = createCounters(app);
  const el = { textContent: '' };
  c.set(el, 10);
  assert.equal(el.textContent, '10');
  assert.equal(c.busy, false);
  c.set(el, 30);
  assert.equal(el.textContent, '10');
  assert.equal(c.busy, true);
  advance(COUNT_MS / 2);
  c.frame();
  const mid = Number(el.textContent);
  assert.ok(mid > 10 && mid < 30, `mid ${mid}`);
  advance(COUNT_MS);
  c.frame();
  assert.equal(el.textContent, '30');
  assert.equal(c.busy, false);
});

test('counters: from 0 when asked, and a text rewritten by a rebuild comes back', () => {
  const { app, advance } = fakeApp();
  const c = createCounters(app);
  const el = { textContent: '' };
  c.set(el, 50, 0);
  assert.equal(el.textContent, '0');
  advance(COUNT_MS / 3);
  c.frame();
  const shown = el.textContent;
  // morph writes the final figure; the same target keeps the count where it was.
  el.textContent = '50';
  c.set(el, 50);
  assert.equal(el.textContent, shown);
});

test('counters: still in captures and with reduced motion', () => {
  for (const { app } of [fakeApp({ clock: 0 }), fakeApp({ t: 1440 }), fakeApp({}, true)]) {
    const c = createCounters(app);
    const el = { textContent: '' };
    c.set(el, 5);
    c.set(el, 40);
    assert.equal(el.textContent, '40');
    c.set({ textContent: '' }, 7, 0);
    assert.equal(c.busy, false);
  }
});
