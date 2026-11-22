import { test } from 'node:test';
import assert from 'node:assert/strict';

import { daylight } from '../core/clock.js';
import { lightAt, MIN_ELEVATION, sunAt, SUNRISE, SUNSET } from './sun.js';

const angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z))) / (Math.PI / 180);
const len = (v) => Math.hypot(v.x, v.y, v.z);

test('sun and moon are unit vectors on a continuous path, also across midnight', () => {
  let prev = sunAt(2 * 1440 - 30);
  for (let pos = 2 * 1440 - 30 + 0.25; pos <= 3 * 1440 + 30; pos += 0.25) {
    const s = sunAt(pos);
    assert.ok(Math.abs(len(s.sun) - 1) < 1e-9 && Math.abs(len(s.moon) - 1) < 1e-9);
    assert.ok(angle(prev.sun, s.sun) < 0.2, `sun jumps at ${pos}`);
    assert.ok(angle(prev.moon, s.moon) < 0.2, `moon jumps at ${pos}`);
    prev = s;
  }
});

test('the sun is up exactly while daylight is above one half', () => {
  for (let pos = 0; pos < 1440; pos += 0.5) assert.equal(sunAt(pos).sunUp, daylight(pos) > 0.5, `at ${pos}`);
  assert.ok(Math.abs(sunAt(SUNRISE).elevation) < 1e-9);
  assert.ok(Math.abs(sunAt(SUNSET).elevation) < 1e-9);
  assert.equal(daylight(SUNRISE), 0.5);
  assert.equal(daylight(SUNSET), 0.5);
});

test('east at sunrise, south at noon, west at sunset; the moon by night', () => {
  const rise = sunAt(SUNRISE + 1).sun;
  const noon = sunAt((SUNRISE + SUNSET) / 2).sun;
  const set = sunAt(SUNSET - 1).sun;
  assert.ok(rise.x > 0.99, 'rises in the east (+x)');
  assert.ok(noon.z > 0.4 && Math.abs(noon.x) < 1e-9, 'noon in the south (+z)');
  assert.ok(set.x < -0.99, 'sets in the west (-x)');
  const night = sunAt(23 * 60);
  assert.ok(!night.sunUp && night.moonUp);
  assert.ok(!sunAt(12 * 60).moonUp);
});

test('noon is higher than the afternoon, and the morning of the recordings is low', () => {
  const noon = sunAt(13 * 60 + 30).elevation;
  assert.ok(noon > 55);
  assert.ok(sunAt(17 * 60).elevation < noon);
  assert.ok(sunAt(20 * 60).elevation < sunAt(17 * 60).elevation);
  const morning = sunAt(7 * 60).elevation;
  assert.ok(morning > 5 && morning < 20, `07:00 at ${morning.toFixed(1)}°`);
});

test('the shadow light: quantized, never below the minimum, faded where sun and moon swap', () => {
  const keys = new Set();
  for (let pos = 7 * 60; pos < 24 * 60; pos += 1) {
    const l = lightAt(pos);
    keys.add(l.key);
    assert.ok(Math.asin(l.dir.y) / (Math.PI / 180) >= MIN_ELEVATION - 1e-9);
    assert.ok(Math.abs(len(l.dir) - 1) < 1e-9);
    assert.ok(l.k >= 0 && l.k <= 1);
  }
  // From 07:00 to 24:00 the shadow map is redrawn about a hundred times, not every minute.
  assert.ok(keys.size > 50 && keys.size < 200, `${keys.size} keys`);
  assert.equal(lightAt(SUNSET).k, 0);
  assert.equal(lightAt(SUNSET - 0.01).body, 'sun');
  assert.equal(lightAt(SUNSET + 0.01).body, 'moon');
  assert.ok(lightAt(SUNSET - 0.05).k < 0.05 && lightAt(SUNSET + 0.05).k < 0.05);
  assert.equal(lightAt(15 * 60).k, 1);
  assert.equal(lightAt(23 * 60).k, 1);
  // Same position, same light (captures repeat).
  assert.deepEqual(lightAt(1255.5), lightAt(1255.5));
});
