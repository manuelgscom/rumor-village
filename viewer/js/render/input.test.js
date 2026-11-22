import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coastStep, INERTIA, releaseVelocity } from './input.js';

test('release speed: from the last moves, none when the pointer was still', () => {
  const moves = [0, 16, 32, 48, 64].map((t) => ({ t, x: 100 + t, y: 50 - t / 2 }));
  const v = releaseVelocity(moves, 70);
  assert.ok(Math.abs(v.vx - 1) < 1e-9 && Math.abs(v.vy + 0.5) < 1e-9);
  assert.equal(releaseVelocity(moves, 64 + INERTIA.staleMs + 1), null, 'held still before letting go');
  assert.equal(releaseVelocity(moves.slice(0, 1), 10), null);
  const fast = releaseVelocity([{ t: 0, x: 0, y: 0 }, { t: 10, x: 400, y: 0 }], 12);
  assert.ok(Math.abs(fast.vx - INERTIA.maxSpeed) < 1e-9, 'capped');
});

test('coasting slows down and stops, the same in big or small frames', () => {
  let v = { vx: 2, vy: 0 };
  let x = 0;
  let frames = 0;
  while (v && frames < 1000) {
    const s = coastStep(v, 16);
    x += s.dx;
    v = s.v;
    frames++;
  }
  assert.equal(v, null);
  assert.ok(frames < 200, `${frames} frames`);
  // Total slide ≈ v0 · tau, whatever the frame length.
  let y = 0;
  let w = { vx: 2, vy: 0 };
  while (w) {
    const s = coastStep(w, 8);
    y += s.dx;
    w = s.v;
  }
  assert.ok(Math.abs(x - y) < 2 && Math.abs(x - 2 * INERTIA.tauMs) < 10, `${x} ${y}`);
});
