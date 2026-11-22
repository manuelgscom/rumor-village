import assert from 'node:assert/strict';
import { test } from 'node:test';

import { hourStep, markKey, MARK_COLORS, skyColor } from './track.js';

test('sky of the band: night, twilight and day', () => {
  assert.equal(skyColor(0), '#27325e');
  assert.equal(skyColor(0.5), '#f59a62');
  assert.equal(skyColor(1), '#ffe7a1');
});

test('hour labels stay apart as the track narrows', () => {
  const day = { start: 0, end: 1440 };
  assert.equal(hourStep(day, 2000), 1);
  assert.equal(hourStep(day, 1000), 2);
  assert.equal(hourStep(day, 400), 6);
  assert.ok(hourStep({ start: 0, end: 7 * 1440 }, 300) >= 24);
});

test('every mark has a legend key with a color', () => {
  const marks = [
    { tick: 1, kind: 'inject' },
    { tick: 2, kind: 'change' },
    { tick: 2, kind: 'forget' },
    { tick: 3, kind: 'arrive', ok: true, who: [] },
    { tick: 3, kind: 'arrive', ok: false, who: [] },
  ];
  assert.deepEqual(marks.map(markKey), ['inject', 'change', 'forget', 'arriveOk', 'arriveOther']);
  for (const m of marks) assert.ok(MARK_COLORS[markKey(m)]);
});
