import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadLog, loadStore } from '../core/testing.js';
import { VERSION_COLORS, versionColor } from '../core/theme.js';
import { SLOTS, versionOf } from '../core/version.js';
import { hopSlot } from '../rumor/chain.js';
import { createHistory } from '../rumor/history.js';
import { beaconsAt, mergeTrails, tintAt, tintBar, trailFade, trailsAt, TRAIL_TICKS } from './heat.js';
import { placeLayout } from './layout.js';
import { crowdCounts } from './tags.js';

const P100 = 'runs/samples/party-100-es-s2.jsonl';
const FACT = 'f1';

/** Events applied at a position (store.index): ticks <= floor(pos). */
const indexAt = (events, pos) => {
  let n = 0;
  while (n < events.length && events[n].tick <= Math.floor(pos)) n++;
  return n;
};

test('a stretch fades with its age and is gone after TRAIL_TICKS', () => {
  assert.equal(trailFade(0), 1);
  assert.equal(trailFade(1), 0);
  let last = 1;
  for (let a = 0; a <= 1; a += 0.05) {
    assert.ok(trailFade(a) <= last + 1e-12, `fade at ${a}`);
    last = trailFade(a);
  }
  const { events } = loadLog(P100);
  const pos = 1000.5;
  const trails = trailsAt(events, indexAt(events, pos), pos, FACT);
  assert.ok(trails.length > 5, 'some tells in the last three hours');
  for (const t of trails) {
    assert.ok(t.tick <= pos && t.tick > pos - TRAIL_TICKS);
    assert.equal(t.age, (pos - t.tick) / TRAIL_TICKS);
    assert.equal(t.alpha, trailFade(t.age));
    assert.ok(t.from && t.to);
  }
  for (let k = 1; k < trails.length; k++) assert.ok(trails[k - 1].i < trails[k].i, 'oldest first');
  // A tell is not in the trail before its tick, and leaves it TRAIL_TICKS later.
  const t0 = trails[trails.length - 1];
  const before = trailsAt(events, indexAt(events, t0.tick - 0.5), t0.tick - 0.5, FACT);
  assert.ok(!before.some((x) => x.i === t0.i));
  const after = trailsAt(events, indexAt(events, t0.tick + TRAIL_TICKS), t0.tick + TRAIL_TICKS, FACT);
  assert.ok(!after.some((x) => x.i === t0.i));
  assert.deepEqual(trailsAt(events, events.length, pos, null), []);
});

test('the trail is the same reached by playing or by jumping', () => {
  const { events } = loadLog(P100);
  const grow = [];
  let k = 0;
  const seen = new Map();
  for (let pos = 430; pos <= 1440; pos += 37.25) {
    while (k < events.length && events[k].tick <= Math.floor(pos)) grow.push(events[k++]);
    seen.set(pos, JSON.stringify(trailsAt(grow, grow.length, pos, FACT)));
  }
  while (k < events.length) grow.push(events[k++]);
  for (const [pos, played] of seen) {
    const fresh = events.slice();
    assert.equal(JSON.stringify(trailsAt(fresh, indexAt(fresh, pos), pos, FACT)), played, `pos ${pos}`);
    // Rewound on the grown index too.
    assert.equal(JSON.stringify(trailsAt(grow, indexAt(grow, pos), pos, FACT)), played, `rewound to ${pos}`);
  }
});

test('changed is the hop of rumor/chain.js, and the trail goes from where the teller heard it', () => {
  const { events } = loadLog(P100);
  const h = createHistory();
  h.ingest(events);
  const trails = trailsAt(events, events.length, 1440, FACT, 2000);
  assert.ok(trails.length > 20);
  const convPlace = new Map(events.filter((e) => e.type === 'conv_start').map((e) => [e.conv, e.place]));
  for (const t of trails) {
    const turn = events[t.i];
    assert.equal(t.changed, SLOTS.some((s) => hopSlot(h, turn, t.i, FACT, s).changed));
    assert.equal(t.to, convPlace.get(turn.conv));
    // The teller heard it in the conversation of the tell that first reached it.
    const inf = h.informed(turn.who, FACT, t.i);
    if (inf?.turn !== null && inf) assert.equal(t.from, convPlace.get(events[inf.i].conv));
  }
  const { ways, pulses } = mergeTrails(trails);
  assert.equal(ways.reduce((a, w) => a + w.n, 0) + pulses.reduce((a, w) => a + w.n, 0), trails.length);
});

/** The bar of the place labels before phase 8-2 (scene/labels.js barOf). */
function oldBar(colors) {
  const BAR_ORDER = ['correct', 'incomplete', 'wrong', 'unknown'].map((v) => VERSION_COLORS[v]);
  const total = [...colors.values()].reduce((a, b) => a + b, 0);
  const known = [...colors.keys()].some((c) => c !== VERSION_COLORS.unknown);
  if (!total || !known) return '';
  const stops = [];
  let at = 0;
  const seen = new Set();
  const add = (color, n) => {
    const from = (at / total) * 100;
    at += n;
    stops.push(`${color} ${from.toFixed(1)}% ${((at / total) * 100).toFixed(1)}%`);
  };
  for (const c of BAR_ORDER) {
    if (colors.has(c)) {
      add(c, colors.get(c));
      seen.add(c);
    }
  }
  for (const [c, n] of colors) if (!seen.has(c)) add(c, n);
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

test('tintAt gives the bar the place labels had', () => {
  const store = loadStore(P100, 420);
  let some = 0;
  for (const pos of [430, 600, 800, 1000, 1200, 1300, 1440]) {
    store.seek(pos);
    const state = store.state;
    const { placeOf } = placeLayout(store.header, state, store.firstPlace);
    const original = state.facts.get(FACT)?.slots;
    const color = (id) => (original ? versionColor(versionOf(state.neighbors.get(id)?.memory[FACT], original)) : versionColor(null));
    const crowds = crowdCounts(placeOf, color);
    const tint = tintAt(state, FACT, placeOf);
    assert.deepEqual([...tint.keys()].sort(), [...crowds.keys()].sort());
    for (const [place, c] of crowds) {
      assert.equal(tint.get(place).n, c.n);
      assert.equal(tintBar(tint.get(place)), oldBar(c.colors), `${place} at ${pos}`);
      if (tintBar(tint.get(place))) some++;
    }
  }
  assert.ok(some > 10, 'some places with a bar');
});

test('beacons: the original place at its hour, and where people arrive', () => {
  const { header, events } = loadLog(P100);
  const ids = header.neighbors.map((n) => n.id);
  const inj = events.find((e) => e.type === 'inject');
  assert.deepEqual(beaconsAt(events, indexAt(events, 900), 900, FACT, ids), []);
  const at = beaconsAt(events, indexAt(events, 1275), 1275, FACT, ids);
  const right = at.find((b) => b.kind === 'right');
  assert.equal(right.place, inj.slots.where);
  assert.equal(right.slot, inj.slots.when);
  assert.ok(right.n > 10 && right.strength > 0.9);
  for (const b of at) {
    assert.ok(b.strength > 0 && b.strength <= 1);
    if (b.kind === 'other_place') assert.notEqual(b.place, inj.slots.where);
    if (b.kind === 'other_time') assert.equal(b.place, inj.slots.where);
  }
  // Same answer jumping on a fresh array.
  assert.deepEqual(beaconsAt(events.slice(), indexAt(events, 1275), 1275, FACT, ids), at);
  assert.deepEqual(beaconsAt(events, events.length, 1440 + 200, FACT, ids), []);
});
