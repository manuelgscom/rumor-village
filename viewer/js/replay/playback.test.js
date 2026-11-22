import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIVE_JUMP_TICKS, READ_MAX_MS, READ_MS_PER_CHAR, SPEEDS, TICK_EPSILON } from './constants.js';
import { chase, engineView, liveLabel, liveStep, parseSpeed, playTitle, readingPause, speedOf, step } from './playback.js';

const fresh = (pos) => ({ pos, waitMs: 0, waitedTick: null });

/** Plays from `from` until `to` in frames of `dt`, returns the elapsed ms. */
function playTime(from, to, speed, chars, dt = 16) {
  let p = fresh(from);
  let ms = 0;
  while (p.pos < to) {
    p = step(p, dt, { ...speed, chars, end: 1e9 });
    ms += dt;
    if (ms > 1e7) throw new Error('never got there');
  }
  return ms;
}

test('speed from the URL', () => {
  assert.deepEqual(parseSpeed(null), speedOf('x1'));
  assert.deepEqual(parseSpeed(1), speedOf('x1'));
  assert.deepEqual(parseSpeed(4), speedOf('x4'));
  assert.deepEqual(parseSpeed('fast'), speedOf('fast'));
  assert.deepEqual(parseSpeed('FAST'), speedOf('fast'));
  assert.deepEqual(parseSpeed(12), { key: null, tps: 12, fast: false });
  assert.deepEqual(parseSpeed(120), { key: null, tps: 120, fast: true });
  assert.deepEqual(parseSpeed('slow'), speedOf('x1'));
  assert.deepEqual(parseSpeed(-3), speedOf('x1'));
  assert.equal(speedOf('x1').tps, SPEEDS.x1);
});

test('without text, playback goes at the speed', () => {
  const p = step(fresh(1000), 100, { ...speedOf('x4'), chars: 0, end: 2000 });
  assert.equal(p.pos, 1000 + (100 * SPEEDS.x4) / 1000);
  assert.equal(p.waitMs, 0);
  const ms = playTime(1000, 1010, speedOf('x1'), 0);
  assert.ok(Math.abs(ms - (10 / SPEEDS.x1) * 1000) < 40, `${ms} ms`);
});

test('with text, it holds at the end of the tick, then goes on', () => {
  const opts = { ...speedOf('x1'), chars: 4, end: 2000 };
  let p = step(fresh(1000.9), 200, opts); // would cross 1001
  assert.equal(p.pos, 1001 - TICK_EPSILON);
  assert.equal(Math.floor(p.pos), 1000, 'the state shown is still the one of tick 1000');
  assert.equal(p.waitMs, 4 * READ_MS_PER_CHAR);
  p = step(p, 100, opts);
  assert.equal(p.pos, 1001 - TICK_EPSILON);
  assert.equal(p.waitMs, 4 * READ_MS_PER_CHAR - 100);
  p = step(p, p.waitMs + 100, opts); // the pause ends inside this frame
  assert.equal(p.waitMs, 0);
  assert.ok(p.pos > 1001 && p.pos < 1002, `${p.pos}`);
});

test('reading pauses are proportional to the characters, with a cap', () => {
  assert.equal(readingPause(0), 0);
  assert.equal(readingPause(10), 10 * READ_MS_PER_CHAR);
  assert.equal(readingPause(20), 2 * readingPause(10));
  assert.equal(readingPause(1e6), READ_MAX_MS);
  const base = playTime(1000, 1010, speedOf('x1'), 0);
  const short = playTime(1000, 1010, speedOf('x1'), 20);
  const long = playTime(1000, 1010, speedOf('x1'), 40);
  // Ten tick ends crossed, each with one pause (frames of 16 ms blur it a bit).
  assert.ok(Math.abs(short - base - 10 * readingPause(20)) < 10 * 16 + 20, `${short - base}`);
  assert.ok(Math.abs(long - base - 10 * readingPause(40)) < 10 * 16 + 20, `${long - base}`);
});

test('x4 pauses too; fast speed never pauses', () => {
  const x4 = step(fresh(1000.95), 50, { ...speedOf('x4'), chars: 100, end: 2000 });
  assert.ok(x4.waitMs > 0);
  const fast = step(fresh(1000.95), 50, { ...speedOf('fast'), chars: 100, end: 2000 });
  assert.equal(fast.waitMs, 0);
  assert.equal(fast.pos, 1000.95 + (50 * SPEEDS.fast) / 1000);
  // A pause pending when switching to fast is dropped.
  const after = step({ ...x4 }, 16, { ...speedOf('fast'), chars: 100, end: 2000 });
  assert.equal(after.waitMs, 0);
  assert.ok(after.pos > x4.pos);
  assert.equal(playTime(1000, 1100, speedOf('fast'), 500), playTime(1000, 1100, speedOf('fast'), 0));
});

test('reading pauses do not change what is shown, only the pace', () => {
  // Every whole tick visited without text is also visited with text.
  const ticks = (chars) => {
    const seen = new Set();
    let p = fresh(1000);
    while (p.pos < 1030) {
      p = step(p, 16, { ...speedOf('x4'), chars, end: 1e9 });
      seen.add(Math.floor(p.pos));
    }
    return [...seen];
  };
  assert.deepEqual(ticks(60), ticks(0));
});

test('playback stops at the end', () => {
  const p = step(fresh(1439.9), 200, { ...speedOf('x4'), chars: 0, end: 1440 });
  assert.equal(p.pos, 1440);
  assert.equal(p.atEnd, true);
  // No reading pause after the last tick.
  const q = step(fresh(1439.9), 200, { ...speedOf('x1'), chars: 50, end: 1440 });
  assert.equal(q.waitMs, 0);
});

test('a long frame (hidden tab) does not jump far', () => {
  const p = step(fresh(1000), 60000, { ...speedOf('x1'), chars: 0, end: 2000 });
  assert.ok(p.pos - 1000 < 1);
});

test('live: the chase never passes the edge and closes in smoothly', () => {
  let pos = 1000;
  const seen = [];
  for (let i = 0; i < 200; i++) {
    pos = chase(pos, 1010, 16);
    seen.push(pos);
    assert.ok(pos <= 1010);
  }
  assert.equal(pos, 1010);
  for (let i = 1; i < seen.length; i++) assert.ok(seen[i] - seen[i - 1] < 1, 'no jumps');
  assert.equal(chase(1000, 1000 + LIVE_JUMP_TICKS + 1, 16), 1000 + LIVE_JUMP_TICKS + 1, 'far behind: jump');
  assert.equal(chase(1012, 1010, 16), 1012, 'never backwards');
});

test('engine state shown on the transport', () => {
  assert.deepEqual(engineView({ paused: false, speed: SPEEDS.x1, ended: false }), { paused: false, key: 'x1' });
  assert.deepEqual(engineView({ paused: true, speed: SPEEDS.x4, ended: false }), { paused: true, key: 'x4' });
  assert.deepEqual(engineView({ paused: false, speed: SPEEDS.fast, ended: false }), { paused: false, key: 'fast' });
  // Not one of ours: no button marked.
  assert.deepEqual(engineView({ paused: false, speed: 5, ended: false }), { paused: false, key: null });
  assert.deepEqual(engineView({ paused: false, speed: 'max', ended: false }), { paused: false, key: 'fast' });
  assert.deepEqual(engineView({ paused: false, speed: null, ended: false }), { paused: false, key: null });
  // An ended run shows as paused.
  assert.deepEqual(engineView({ paused: false, speed: SPEEDS.x1, ended: true }), { paused: true, key: 'x1' });
});

test('live pill: preparing only before the game runs', () => {
  assert.equal(liveLabel({ following: true, over: false, phase: 'prepare' }), 'preparing');
  assert.equal(liveLabel({ following: true, over: false, phase: 'menu' }), 'preparing');
  assert.equal(liveLabel({ following: true, over: false, phase: 'boot' }), 'preparing');
  assert.equal(liveLabel({ following: true, over: false, phase: 'playing' }), 'live');
  assert.equal(liveLabel({ following: true, over: true, phase: 'ended' }), 'ended');
  assert.equal(liveLabel({ following: true, over: false, phase: 'ended' }), 'ended');
  // Outside the game mode nothing changes.
  assert.equal(liveLabel({ following: true, over: false }), 'live');
  assert.equal(liveLabel({ following: true, over: true, phase: undefined }), 'ended');
  // Looking at the past: always the way back.
  assert.equal(liveLabel({ following: false, over: false, phase: 'prepare' }), 'back');
  assert.equal(liveLabel({ following: false, over: true }), 'back');
});

test('play title names what it pauses', () => {
  assert.equal(playTitle({ live: false, following: false, paused: true }), 'play');
  assert.equal(playTitle({ live: false, following: false, paused: false }), 'pause');
  assert.equal(playTitle({ live: true, following: true, paused: false }), 'pauseVillage');
  assert.equal(playTitle({ live: true, following: true, paused: true }), 'resumeVillage');
  assert.equal(playTitle({ live: true, following: false, paused: false }), 'pauseView');
  assert.equal(playTitle({ live: true, following: false, paused: true }), 'resumeView');
});

test('liveStep: a pause of the game stops what is seen at once; resumed, it catches up', () => {
  // Paused: the position stays though the engine sent ten more minutes.
  assert.equal(liveStep(436.2, 16, { edge: 447, frozen: true }), 436.2);
  // Resumed: it chases the edge from there, smoothly.
  let p = 436.2;
  for (let i = 0; i < 10; i++) p = liveStep(p, 16, { edge: 447, frozen: false });
  assert.ok(p > 436.2 && p < 447, `${p}`);
  for (let i = 0; i < 300; i++) p = liveStep(p, 16, { edge: 447, frozen: false });
  assert.equal(p, 447);
});
