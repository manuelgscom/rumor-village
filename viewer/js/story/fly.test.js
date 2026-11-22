import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseParams } from '../core/params.js';
import { OPENING, openingAt, openingStart } from './fly.js';
import { opensWithShot } from './index.js';

test('opening shot: from high above down to the home view, smoothly', () => {
  const home = { x: 500, y: 300, scale: 1.2 };
  const from = openingStart(home, 1600);
  assert.ok(Math.abs(from.scale - home.scale * OPENING.zoom) < 1e-12);
  assert.deepEqual(openingAt(from, home, 0), from);
  const end = openingAt(from, home, 1);
  assert.ok(Math.abs(end.x - home.x) < 1e-9 && Math.abs(end.y - home.y) < 1e-9 && Math.abs(end.scale - home.scale) < 1e-12);
  // Monotonic zoom and no jumps between close fractions.
  let prev = openingAt(from, home, 0);
  for (let k = 0.01; k <= 1.0001; k += 0.01) {
    const v = openingAt(from, home, k);
    assert.ok(v.scale >= prev.scale - 1e-12);
    assert.ok(Math.abs(Math.log(v.scale / prev.scale)) < 0.05 && Math.abs(v.x - prev.x) * home.scale < 40);
    prev = v;
  }
});

test('opening shot plays by itself only on a plain visit', () => {
  const p = (q) => parseParams(q);
  assert.equal(opensWithShot(p('?log=a.jsonl')), true);
  assert.equal(opensWithShot(p('?log=a.jsonl&t=900&paused=1')), false);
  assert.equal(opensWithShot(p('?log=a.jsonl&clock=0')), false);
  assert.equal(opensWithShot(p('?log=a.jsonl&embed=1')), false);
  assert.equal(opensWithShot(p('?log=a.jsonl&zoom=near')), false);
  assert.equal(opensWithShot(p('?log=a.jsonl&cam=1,2,3')), false);
  assert.equal(opensWithShot(p('?log=a.jsonl&select=n003')), false);
  assert.equal(opensWithShot(p('?log=a.jsonl&director=1')), false);
  assert.equal(opensWithShot({ ...p('?log=a.jsonl'), bg: true }), false);
});
