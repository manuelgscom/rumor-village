import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advance, initState, reduce } from '../core/reduce.js';
import { createStore } from '../core/store.js';
import { FIXTURE, loadLog, SAMPLES } from '../core/testing.js';
import { SNAPSHOT_EVERY } from './constants.js';
import { createStateAt } from './snapshots.js';

/** State at pos, reducing from the beginning. */
function fromScratch(header, events, pos) {
  const tick = Math.floor(pos);
  const state = initState(header);
  for (const e of events) {
    if (e.tick > tick) break;
    reduce(state, e);
  }
  return advance(state, tick);
}

/** Deterministic pseudo-random generator in [0, 1). */
function rng(seed) {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return x / 2147483648;
  };
}

function positions(start, end, count, seed) {
  const r = rng(seed);
  return Array.from({ length: count }, () => start - 10 + r() * (end - start + 20));
}

for (const rel of [...SAMPLES, FIXTURE]) {
  const { header, events } = loadLog(rel);
  const start = header.start_tick;
  const end = events[events.length - 1].tick;

  test(`stateAt equals reducing from the beginning: ${rel}`, () => {
    for (const every of [1, 7, SNAPSHOT_EVERY]) {
      const store = createStore(header);
      store.append(events);
      const stateAt = createStateAt(store, { every });
      for (const pos of [start, ...positions(start, end, 40, every), end, end + 0.5, start - 3]) {
        assert.deepEqual(stateAt(pos), fromScratch(header, events, pos), `every ${every}, pos ${pos}`);
      }
    }
  });

  test(`rewinding and playing forward again gives the same state: ${rel}`, () => {
    const store = createStore(header);
    store.append(events);
    store.setStateAt(createStateAt(store, { every: 50 }));
    const r = rng(3);
    // Forward in small steps (normal playback), with jumps back on the way.
    let pos = start;
    while (pos < end) {
      pos += r() * 3;
      store.seek(pos);
      if (r() < 0.05) {
        const back = pos - r() * 200;
        store.seek(back);
        assert.deepEqual(store.state, fromScratch(header, events, back), `back to ${back}`);
        store.seek(pos);
      }
      assert.equal(store.index, store.countUntil(Math.floor(pos)));
    }
    assert.deepEqual(store.state, fromScratch(header, events, pos));
    store.seek(start);
    assert.deepEqual(store.state, fromScratch(header, events, start));
    store.seek(end);
    assert.deepEqual(store.state, fromScratch(header, events, end));
  });

  test(`events appended after installing stateAt (live): ${rel}`, () => {
    const r = rng(11);
    const store = createStore(header, { live: true, pos: start });
    store.setStateAt(createStateAt(store, { every: 30 }));
    let i = 0;
    while (i < events.length) {
      // Chunks that may cut a tick in two, as SSE batches do.
      const n = 1 + Math.floor(r() * 40);
      store.append(events.slice(i, i + n));
      i += n;
      // Follow the edge most of the time; sometimes look back.
      const pos = r() < 0.8 ? store.lastTick : start + r() * (store.lastTick - start);
      store.seek(pos);
      assert.deepEqual(store.state, fromScratch(header, events.slice(0, i), pos), `after ${i} events, pos ${pos}`);
    }
  });
}

test('a position held inside one tick never clones', () => {
  const { header, events } = loadLog(SAMPLES[0]);
  const store = createStore(header);
  store.append(events);
  const stateAt = createStateAt(store);
  stateAt(900);
  const before = stateAt.stats().clones;
  const s = stateAt(900.2);
  for (let p = 900.2; p < 1100; p += 0.13) assert.equal(stateAt(p), s);
  assert.equal(stateAt.stats().clones, before);
});

test('cost of the snapshots on party-100 (chooses SNAPSHOT_EVERY)', (t) => {
  const { header, events } = loadLog(SAMPLES[0]);
  const end = events[events.length - 1].tick;
  const jumps = positions(header.start_tick, end, 400, 5);
  const ms = (fn) => {
    const t0 = performance.now();
    fn();
    return performance.now() - t0;
  };
  // Warm up the JIT once.
  {
    const store = createStore(header);
    store.append(events);
    const f = createStateAt(store, { every: 100 });
    for (const p of jumps) f(p);
  }
  const clone = ms(() => {
    const s = fromScratch(header, events, end);
    for (let i = 0; i < 50; i++) structuredClone(s);
  });
  const all = ms(() => fromScratch(header, events, end));
  t.diagnostic(`reduce all ${events.length} events: ${all.toFixed(2)} ms; one clone at the end: ${(clone / 50).toFixed(3)} ms`);
  const store = createStore(header);
  store.append(events);
  for (const every of [25, 100, 250, 500, 1000, 1e9]) {
    let f;
    const build = ms(() => {
      f = createStateAt(store, { every });
      f(header.start_tick);
    });
    const jump = ms(() => {
      for (const p of jumps) f(p);
    });
    t.diagnostic(
      `every ${every}: build ${build.toFixed(1)} ms, ${f.stats().snapshots} snapshots, mean random jump ${(jump / jumps.length).toFixed(3)} ms`,
    );
  }
  // The chosen interval: any jump well under one frame.
  const f = createStateAt(store);
  f(header.start_tick);
  let worst = 0;
  for (const p of jumps) worst = Math.max(worst, ms(() => f(p)));
  t.diagnostic(`every ${SNAPSHOT_EVERY}: worst jump ${worst.toFixed(2)} ms`);
  assert.ok(worst < 16, `worst jump ${worst} ms`);
});
