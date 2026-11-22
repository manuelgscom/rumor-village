import assert from 'node:assert/strict';
import test from 'node:test';

import { createCamera, PITCH, pitchAt } from './camera.js';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

function camera() {
  const cam = createCamera();
  cam.resize(1600, 900);
  cam.base = 2;
  cam.set({ x: 500, y: 350, scale: 2 });
  return cam;
}

test('scale is CSS px per world unit at the centre, sideways', () => {
  const cam = camera();
  const a = cam.toScreen(500, 350);
  const b = cam.toScreen(501, 350);
  assert.ok(near(a.x, 800) && near(a.y, 450));
  assert.ok(near(b.x - a.x, 2, 1e-3));
});

test('toWorld inverts toScreen on the ground', () => {
  const cam = camera();
  for (const [sx, sy] of [
    [0, 0],
    [1600, 900],
    [123, 456],
    [800, 450],
  ]) {
    const w = cam.toWorld(sx, sy);
    const s = cam.toScreen(w.x, w.y);
    assert.ok(near(s.x, sx, 1e-6) && near(s.y, sy, 1e-6), `${sx},${sy}`);
  }
});

test('north is up and far things look smaller', () => {
  const cam = camera();
  const north = cam.toScreen(500, 300);
  const south = cam.toScreen(500, 400);
  assert.ok(north.y < 450 && south.y > 450);
  const wideNorth = cam.toScreen(510, 300).x - north.x;
  const wideSouth = cam.toScreen(510, 400).x - south.x;
  assert.ok(wideNorth < wideSouth);
});

test('height goes up on screen; points behind the camera are off screen', () => {
  const cam = camera();
  assert.ok(cam.toScreen(500, 350, 10).y < cam.toScreen(500, 350).y);
  // A point 10 units behind the eye along the view direction.
  const v = cam.view();
  const back = { x: v.eye.x - (v.target.x - v.eye.x) * 0.01, y: v.eye.y - (v.target.y - v.eye.y) * 0.01, z: v.eye.z - (v.target.z - v.eye.z) * 0.01 };
  const behind = cam.toScreen(back.x, back.z, back.y);
  assert.ok(behind.x < -1e6);
});

test('pitch is steeper far away than close up', () => {
  assert.ok(near(pitchAt(1), (PITCH.far * Math.PI) / 180));
  assert.ok(near(pitchAt(20), (PITCH.near * Math.PI) / 180));
  assert.ok(pitchAt(2) > pitchAt(3));
  const cam = camera();
  const far = cam.view().pitch;
  cam.set({ scale: 10 });
  assert.ok(cam.view().pitch < far);
});
