import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createGovernor, percentile } from './quality.js';

/** Pushes n frames of ms; returns the tiers it stepped to. */
function feed(g, n, ms) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = g.push(typeof ms === 'function' ? ms(i) : ms);
    if (t) out.push(t);
  }
  return out;
}

test('percentile', () => {
  assert.ok(Number.isNaN(percentile([], 0.5)));
  assert.equal(percentile([3, 1, 2], 0.5), 2);
  assert.equal(percentile([4, 1, 3, 2], 0.5), 3);
  assert.equal(percentile([5, 1, 4, 2, 3, 6, 7, 8, 9, 10], 0.9), 10);
  assert.equal(percentile([1, 2], 1), 2);
});

test('steps down with slow frames, after the warm-up', () => {
  const g = createGovernor({ budgetMs: 24, window: 10, cooldown: 5 });
  assert.deepEqual(feed(g, 14, 40), []); // 5 ignored + 9 in the window: not full yet
  assert.equal(g.push(40), 'mid');
  assert.equal(g.tier, 'mid');
});

test('does not step down with fast frames, nor for a few spikes', () => {
  const g = createGovernor({ budgetMs: 24, window: 10, cooldown: 5 });
  assert.deepEqual(feed(g, 500, 16.7), []);
  // One frame in three is slow: the median stays under the budget.
  assert.deepEqual(feed(g, 500, (i) => (i % 3 ? 16 : 200)), []);
  assert.equal(g.tier, 'high');
});

test('waits after each change and stops at low', () => {
  const g = createGovernor({ budgetMs: 24, window: 10, cooldown: 5 });
  const steps = [];
  for (let i = 0; i < 1000; i++) {
    const t = g.push(50);
    if (t) steps.push([i, t]);
  }
  // Frames 0-4 ignored, 5-14 fill the window → mid at frame 14; then 5 + 10 more.
  assert.deepEqual(steps, [
    [14, 'mid'],
    [29, 'low'],
  ]);
  assert.equal(g.tier, 'low');
});

test('does not oscillate: never steps up, whatever comes after', () => {
  const g = createGovernor({ budgetMs: 24, window: 10, cooldown: 5 });
  const steps = feed(g, 15, 50);
  steps.push(...feed(g, 1000, 5), ...feed(g, 1000, (i) => (i % 3 ? 5 : 60)));
  assert.deepEqual(steps, ['mid']);
  assert.equal(g.tier, 'mid');
});

test('ignores bad samples and can start lower', () => {
  const g = createGovernor({ window: 3, cooldown: 0, tier: 'mid' });
  assert.deepEqual(feed(g, 10, NaN), []);
  assert.deepEqual(feed(g, 10, 0), []);
  assert.deepEqual(feed(g, 3, 100), ['low']);
  assert.equal(createGovernor({ tier: 'low', cooldown: 0, window: 1 }).push(1000), null);
});
