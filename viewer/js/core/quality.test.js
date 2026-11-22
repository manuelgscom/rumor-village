import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createQuality, lowerTier, TIERS, TIER_ORDER } from './quality.js';

test('quality levels', () => {
  assert.deepEqual(Object.keys(TIERS), TIER_ORDER);
  assert.equal(lowerTier('high'), 'mid');
  assert.equal(lowerTier('low'), null);
  const q = createQuality('auto');
  assert.equal(q.tier, 'high');
  assert.equal(q.auto, true);
  const seen = [];
  q.on((t) => seen.push(t));
  q.set('mid');
  q.set('mid');
  q.set('bogus');
  assert.deepEqual(seen, ['mid']);
  assert.equal(q.spec.ao, false);
  assert.equal(createQuality('auto', true).auto, false);
  assert.equal(createQuality('low').tier, 'low');
  assert.equal(createQuality('low').auto, false);
});
