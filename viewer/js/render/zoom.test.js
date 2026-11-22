import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampCentre, clampZoom, homeScale, levelWeights, LEVELS, MID_FADE, NEAR_FADE, zoomAbout, zoomFactor, ZOOM_MAX, ZOOM_MIN } from './zoom.js';

test('levels at the presets', () => {
  assert.deepEqual(levelWeights(LEVELS.far), { far: 1, mid: 0, near: 0 });
  const mid = levelWeights(LEVELS.mid);
  assert.equal(mid.mid, 1);
  assert.equal(mid.near, 0);
  const near = levelWeights(LEVELS.near);
  assert.equal(near.mid, 1);
  assert.equal(near.near, 1);
});

test('the fades are continuous and monotonic (no jumps)', () => {
  let prev = levelWeights(ZOOM_MIN);
  for (let z = ZOOM_MIN; z <= ZOOM_MAX; z += 0.01) {
    const w = levelWeights(z);
    assert.ok(w.mid >= prev.mid && w.near >= prev.near, `monotonic at ${z}`);
    assert.ok(Math.abs(w.mid - prev.mid) < 0.05 && Math.abs(w.near - prev.near) < 0.05, `continuous at ${z}`);
    assert.ok(Math.abs(w.far + w.mid - 1) < 1e-12);
    prev = w;
  }
  const inside = levelWeights((MID_FADE[0] + MID_FADE[1]) / 2);
  assert.ok(inside.mid > 0.4 && inside.mid < 0.6);
  const inNear = levelWeights((NEAR_FADE[0] + NEAR_FADE[1]) / 2);
  assert.ok(inNear.near > 0.4 && inNear.near < 0.6);
});

test('zoom parameter', () => {
  assert.equal(zoomFactor('far'), LEVELS.far);
  assert.equal(zoomFactor('NEAR'), LEVELS.near);
  assert.equal(zoomFactor(3), 3);
  assert.equal(zoomFactor(100), ZOOM_MAX);
  assert.equal(zoomFactor('closer'), null);
  assert.equal(zoomFactor(null), null);
  assert.equal(zoomFactor(-1), null);
  assert.equal(clampZoom(0.1), ZOOM_MIN);
});

test('home scale fits the box like camera.fit', () => {
  const s = homeScale({ minX: 0, minY: 0, maxX: 100, maxY: 50 }, 320, 220, 10);
  assert.equal(s, Math.min(300 / 100, 200 / 50));
});

test('zooming keeps the point under the pointer still', () => {
  const cam = { x: 500, y: 350, scale: 1.2, w: 1200, h: 800 };
  const toWorld = (c, sx, sy) => ({ x: (sx - c.w / 2) / c.scale + c.x, y: (sy - c.h / 2) / c.scale + c.y });
  const before = toWorld(cam, 300, 200);
  const next = { ...cam, ...zoomAbout(cam, 2, 300, 200, 0.1, 100) };
  const after = toWorld(next, 300, 200);
  assert.ok(Math.abs(before.x - after.x) < 1e-9 && Math.abs(before.y - after.y) < 1e-9);
  assert.equal(next.scale, 2.4);
  assert.equal(zoomAbout(cam, 1000, 0, 0, 0.1, 5).scale, 5);
});

test('the camera centre stays inside the home bounds', () => {
  const b = { minX: 0, minY: 10, maxX: 100, maxY: 50 };
  assert.deepEqual(clampCentre({ x: 40, y: 20 }, b), { x: 40, y: 20 });
  assert.deepEqual(clampCentre({ x: -500, y: 900 }, b), { x: 0, y: 50 });
  assert.deepEqual(clampCentre({ x: 1e9, y: -1e9 }, b), { x: 100, y: 10 });
});
