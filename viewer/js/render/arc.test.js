import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ARC, arcPoint, arcPoints, GROUND_ARC, hopPhase, liftOf, ribbon, trailAlpha } from './arc.js';

const a = { x: 0, y: 0 };
const b = { x: 100, y: 0 };

test('an arc starts and ends at head height and rises in the middle', () => {
  assert.deepEqual(arcPoint(a, b, 0), [0, ARC.end, 0]);
  assert.deepEqual(arcPoint(a, b, 1), [100, ARC.end, 0]);
  const top = arcPoint(a, b, 0.5);
  assert.equal(top[1], ARC.end + liftOf(100));
  assert.ok(liftOf(0) >= ARC.minLift && liftOf(1e6) === ARC.maxLift);
  const pts = arcPoints(a, b, { n: 10, u0: 0.1, u1: 0.9 });
  assert.equal(pts.length, 11);
  assert.deepEqual(pts[0], arcPoint(a, b, 0.1));
  assert.ok(arcPoint(a, b, 0.5, 80)[1] >= ARC.end + 80, 'a smallest lift');
  // Sideways bulge: A → B and B → A curve to opposite sides.
  assert.ok(Math.abs(top[2]) > 0);
  assert.equal(Math.sign(arcPoint(b, a, 0.5)[2]), -Math.sign(top[2]));
});

test('a ribbon has the asked width, across the line', () => {
  const pts = arcPoints(a, b, { n: 8 });
  const eye = { x: 50, y: 300, z: 300 };
  const out = ribbon(pts, eye, pts.map(() => 4));
  assert.equal(out.length, pts.length * 6);
  for (let i = 0; i < pts.length; i++) {
    const l = out.slice(i * 6, i * 6 + 3);
    const r = out.slice(i * 6 + 3, i * 6 + 6);
    assert.ok(Math.abs(Math.hypot(r[0] - l[0], r[1] - l[1], r[2] - l[2]) - 4) < 1e-4);
    // Across the line: perpendicular to the direction of the arc there.
    const q0 = pts[Math.max(0, i - 1)];
    const q1 = pts[Math.min(pts.length - 1, i + 1)];
    const t = [q1[0] - q0[0], q1[1] - q0[1], q1[2] - q0[2]];
    assert.ok(Math.abs((r[0] - l[0]) * t[0] + (r[1] - l[1]) * t[1] + (r[2] - l[2]) * t[2]) < 1e-3);
  }
});

test('a hop: the spark travels, then the ring grows and it all fades', () => {
  const s0 = hopPhase(0);
  const s1 = hopPhase(0.3);
  const s2 = hopPhase(0.7);
  const s3 = hopPhase(1);
  assert.equal(s0.head, 0);
  assert.ok(s1.head > 0 && s1.head < 1);
  assert.equal(s2.head, 1);
  assert.equal(s0.ring, 0);
  assert.ok(s2.ring > 0 && s2.ring < 1);
  assert.equal(s0.fade, 1);
  assert.equal(s3.fade, 0);
  assert.equal(trailAlpha(0.8, 0.5), 0, 'nothing ahead of the spark');
  assert.ok(trailAlpha(0.5, 0.5) > trailAlpha(0.1, 0.5));
});

test('a ground arc (the trail) starts and ends on the ground and stays low', () => {
  const pts = arcPoints(a, b, { n: 8, shape: GROUND_ARC });
  assert.equal(pts[0][1], GROUND_ARC.end);
  assert.equal(pts[8][1], GROUND_ARC.end);
  const top = arcPoint(a, b, 0.5, GROUND_ARC.minLift, GROUND_ARC);
  assert.equal(top[1], GROUND_ARC.end + liftOf(100, GROUND_ARC.minLift, GROUND_ARC));
  assert.ok(liftOf(1e6, 0, GROUND_ARC) === GROUND_ARC.maxLift && GROUND_ARC.maxLift < ARC.maxLift);
  // The default shape is still the hop arc.
  assert.deepEqual(arcPoint(a, b, 0.5), arcPoint(a, b, 0.5, ARC.minLift, ARC));
});
