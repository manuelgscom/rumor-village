import test from 'node:test';
import assert from 'node:assert/strict';
import { holdFor } from './hold.js';
import { READ_MAX_MS, READ_MS_PER_CHAR } from '../replay/constants.js';

const engine = { paused: false, speed: 2, ended: false };
const base = { pos: 600.4, edge: 601, chars: 40, held: null, engine };

test('hold: text new on screen at x1 asks for its reading pause', () => {
  assert.equal(holdFor(base), 40 * READ_MS_PER_CHAR);
  assert.equal(holdFor({ ...base, chars: 1000 }), READ_MAX_MS);
  assert.equal(holdFor({ ...base, engine: { ...engine, speed: 8 } }), 40 * READ_MS_PER_CHAR);
});

test('hold: once per tick, nothing without text, far from the edge, paused, fast or ended', () => {
  assert.equal(holdFor({ ...base, held: 600 }), 0);
  assert.equal(holdFor({ ...base, held: 599 }), 40 * READ_MS_PER_CHAR);
  assert.equal(holdFor({ ...base, chars: 0 }), 0);
  assert.equal(holdFor({ ...base, edge: 640 }), 0);
  assert.equal(holdFor({ ...base, engine: { ...engine, paused: true } }), 0);
  assert.equal(holdFor({ ...base, engine: { ...engine, speed: 60 } }), 0);
  assert.equal(holdFor({ ...base, engine: { ...engine, speed: 'max' } }), 0);
  assert.equal(holdFor({ ...base, engine: { ...engine, ended: true } }), 0);
  assert.equal(holdFor({ ...base, engine: null }), 0);
});
