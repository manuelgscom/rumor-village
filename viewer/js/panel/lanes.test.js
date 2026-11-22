import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { FIXTURE, loadLog, repoPath, SAMPLES } from '../core/testing.js';
import { pick } from '../core/lang.js';
import { addEvents, batchView, createBatchIndex, itemText, revealed } from './lanes.js';
import { STRINGS } from './strings.js';

const REAL = 'runs/phase2/gemma4-e4b/party-100-es/seed-1.jsonl';

/** Maximum number of [t0, t1) intervals at the same time (sweep). */
function maxOverlap(items) {
  const points = [];
  for (const it of items) {
    if (it.t1 > it.t0) points.push([it.t0, 1], [it.t1, -1]);
  }
  points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let cur = 0;
  let max = 0;
  for (const [, d] of points) {
    cur += d;
    max = Math.max(max, cur);
  }
  return max;
}

function assertNoOverlap(ix) {
  const lanes = new Map();
  for (const it of ix.items) {
    assert.ok(it.lane >= 0 && it.lane < ix.laneCount, 'every item has a lane');
    if (!lanes.has(it.lane)) lanes.set(it.lane, []);
    lanes.get(it.lane).push(it);
  }
  for (const list of lanes.values()) {
    list.sort((a, b) => a.t0 - b.t0);
    for (let i = 1; i < list.length; i++) assert.ok(list[i].t0 >= list[i - 1].t1, 'no overlap inside a lane');
  }
}

// Deterministic pseudo-random numbers.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function syntheticEvents(seed, count) {
  const r = rng(seed);
  const events = [];
  let tick = 100;
  let base = 0;
  for (let id = 1; id <= count; id++) {
    if (r() < 0.2) {
      tick++;
      base += 500;
    }
    const t0 = base + Math.floor(r() * 400);
    const t1 = t0 + Math.floor(r() * 600);
    events.push({ type: r() < 0.2 ? 'plan' : 'turn', tick, id, who: 'n001', gen: { t0, t1, in: 1, out: 1 } });
  }
  return events;
}

test('synthetic: no overlap in a lane and the minimum number of lanes', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const events = syntheticEvents(seed, 300);
    const ix = createBatchIndex();
    addEvents(ix, events);
    assertNoOverlap(ix);
    assert.equal(ix.laneCount, Math.max(1, maxOverlap(ix.items)), `seed ${seed}`);
  }
});

test('synthetic: touching intervals share a lane; zero-length ones too', () => {
  const ix = createBatchIndex();
  addEvents(ix, [
    { type: 'turn', tick: 1, id: 1, gen: { t0: 0, t1: 10 } },
    { type: 'turn', tick: 1, id: 2, gen: { t0: 10, t1: 20 } },
    { type: 'turn', tick: 1, id: 3, gen: { t0: 20, t1: 20 } },
    { type: 'turn', tick: 1, id: 4, gen: { t0: 5, t1: 15 } },
    { type: 'turn', tick: 1, id: 5, gen: null },
  ]);
  assert.equal(ix.laneCount, 2);
  assert.deepEqual(
    ix.items.map((it) => [it.event.id, it.lane]),
    [
      [1, 0],
      [4, 1],
      [2, 0],
      [3, 0],
    ],
  );
});

test('incremental: any split of the log gives the same lanes as all at once', () => {
  for (let seed = 1; seed <= 10; seed++) {
    const events = syntheticEvents(seed, 200);
    const whole = createBatchIndex();
    addEvents(whole, events);
    const r = rng(seed + 100);
    const parts = createBatchIndex();
    for (let i = 0; i < events.length; ) {
      const j = Math.min(events.length, i + 1 + Math.floor(r() * 7));
      addEvents(parts, events, i, j);
      i = j;
    }
    const lanes = (ix) => ix.items.map((it) => `${it.event.id}:${it.lane}`).join(',');
    assert.equal(lanes(parts), lanes(whole), `seed ${seed}`);
    assert.equal(parts.laneCount, whole.laneCount);
  }
});

test('hand log: three at once, three lanes', () => {
  const { events } = loadLog(FIXTURE);
  const ix = createBatchIndex();
  addEvents(ix, events);
  assertNoOverlap(ix);
  assert.equal(maxOverlap(ix.items), 3);
  assert.equal(ix.laneCount, 3);
  assert.equal(ix.items.length, 27);
  assert.deepEqual(ix.what.get('f1'), 'party');
});

test('hand log: progress of the text by the fraction of the tick', () => {
  const { header, events } = loadLog(FIXTURE);
  const ix = createBatchIndex();
  addEvents(ix, events);
  const s = pick(STRINGS, 'es');

  // Tick 1211: window 2000..2640; pos .5 → ms 2320.
  const v = batchView(ix, 1211.5);
  assert.equal(v.mode, 'active');
  assert.equal(v.tick, 1211);
  assert.equal(v.ms, 2320);
  assert.equal(v.running, 3);
  assert.deepEqual(
    v.rows.map((r) => [r.lane, r.item.event.id, r.phase]),
    [
      [0, 4, 'run'],
      [1, 5, 'run'],
      [2, 6, 'run'],
    ],
  );
  const t4 = v.rows[0];
  assert.ok(Math.abs(t4.progress - 320 / 420) < 1e-9);
  const text4 = itemText(t4.item.event, header, ix.what, s);
  assert.equal(text4, '¡Luis! Ven, que traigo noticias.');
  assert.equal(revealed(text4, t4.progress), Array.from(text4).slice(0, Math.floor(32 * (320 / 420))).join(''));

  // Start and end of the tick.
  const start = batchView(ix, 1211);
  assert.equal(start.ms, 2000);
  assert.deepEqual(
    start.rows.map((r) => [r.item.event.id, r.progress]),
    [
      [4, 0],
      [5, 0],
    ],
    'turn 6 starts at 2010: not yet',
  );
  const end = batchView(ix, 1211.999999);
  assert.ok(end.rows.every((r) => r.item.tick === 1211));

  // Tick 1210 at .9: ms 1000 + 530*.9 = 1477; plan 1 (…1460) and turn 2 (…1390) done.
  const late = batchView(ix, 1210.9);
  assert.deepEqual(
    late.rows.map((r) => [r.item.event.id, r.phase]),
    [
      [1, 'done'],
      [2, 'done'],
      [3, 'run'],
    ],
  );
  assert.equal(late.running, 1);
});

test('hand log: rest, before and texts of plans', () => {
  const { header, events } = loadLog(FIXTURE);
  const ix = createBatchIndex();
  addEvents(ix, events);
  const s = pick(STRINGS, 'es');

  assert.equal(batchView(ix, 1205.5).mode, 'before');
  const rest = batchView(ix, 1222.3);
  assert.equal(rest.mode, 'rest');
  assert.equal(rest.tick, 1218);
  assert.equal(rest.ms, null);
  assert.deepEqual(
    rest.rows.map((r) => [r.item.event.id, r.phase, r.progress]),
    [
      [16, 'idle', 1],
      [17, 'idle', 1],
    ],
  );
  assert.equal(batchView(ix, 1440).tick, 1237);

  const plan1 = events.find((e) => e.type === 'plan' && e.id === 1);
  assert.equal(itemText(plan1, header, ix.what, s), 'irá: fiesta · Manuel · plaza · 22:00 · 50');
  const plan11 = events.find((e) => e.type === 'plan' && e.id === 11);
  assert.equal(itemText(plan11, header, ix.what, s), 'decide no ir');
  const noText = { ...events.find((e) => e.type === 'turn' && e.id === 20), text: null };
  assert.equal(itemText(noText, header, ix.what, s), 'cuenta: fiesta · Manuel · plaza · 23:00? · 50');
  const rejected = { type: 'turn', action: 'none', act: null, reject: 'malformed', claim: null, text: null };
  assert.equal(itemText(rejected, header, ix.what, s), 'rechazada: mal formada');
});

test('samples (baseline): no generation, the view says so', () => {
  for (const rel of SAMPLES) {
    const { events } = loadLog(rel);
    const ix = createBatchIndex();
    assert.equal(addEvents(ix, events), false, rel);
    const v = batchView(ix, events[events.length - 1].tick);
    assert.equal(v.mode, 'empty', rel);
    assert.equal(v.laneCount, 0);
    assert.deepEqual(v.rows, []);
  }
});

test('real run (if present locally): minimum lanes and fast views', { skip: !existsSync(repoPath(REAL)) }, () => {
  const { events } = loadLog(REAL);
  const ix = createBatchIndex();
  // Appended in chunks, as the live source would.
  for (let i = 0; i < events.length; i += 997) addEvents(ix, events, i, Math.min(events.length, i + 997));
  assertNoOverlap(ix);
  assert.equal(ix.laneCount, maxOverlap(ix.items));
  const t = performance.now();
  let rows = 0;
  for (let pos = 420; pos < 1440; pos += 0.25) rows += batchView(ix, pos).rows.length;
  const ms = performance.now() - t;
  assert.ok(rows > 0);
  assert.ok(ms < 1000, `4080 views took ${ms.toFixed(0)} ms`);
});

test('row layout: few lanes are tall, many are dense, too many are summed up', async () => {
  const { layoutFor } = await import('./batch-dom.js');
  assert.deepEqual(layoutFor(3), { shown: 3, summary: false, rowH: 44, lines: 2, dense: false });
  assert.deepEqual(layoutFor(16), { shown: 16, summary: false, rowH: 12, lines: 1, dense: true });
  const many = layoutFor(40);
  assert.equal(many.summary, true);
  assert.equal(many.shown, 15);
  assert.equal(layoutFor(0).shown, 0);
});
