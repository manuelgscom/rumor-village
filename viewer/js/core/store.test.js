import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advance, initState, reduce } from './reduce.js';
import { createStore } from './store.js';
import { FIXTURE, loadLog, loadStore, SAMPLES } from './testing.js';

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

// Deterministic pseudo-random positions.
function positions(start, end, count, seed) {
  let x = seed;
  const out = [];
  for (let i = 0; i < count; i++) {
    x = (x * 1103515245 + 12345) % 2147483648;
    out.push(start + (x / 2147483648) * (end - start + 20) - 10);
  }
  return out;
}

for (const rel of [...SAMPLES, FIXTURE]) {
  test(`seek equals reducing from the beginning: ${rel}`, () => {
    const { header, events } = loadLog(rel);
    const store = createStore(header);
    store.append(events);
    const end = events[events.length - 1].tick;
    // Forward and backward jumps, with decimals, plus both ends.
    for (const pos of [header.start_tick, ...positions(header.start_tick, end, 12, 7), end, end + 0.5]) {
      store.seek(pos);
      assert.equal(store.pos, pos);
      assert.equal(store.state.tick, Math.floor(pos));
      assert.equal(store.index, store.countUntil(Math.floor(pos)));
      assert.deepEqual(store.state, fromScratch(header, events, pos), `pos ${pos}`);
    }
  });

  test(`the log is coherent for the viewer: ${rel}`, () => {
    const store = loadStore(rel);
    const { events, state } = store;
    const ids = events.filter((e) => e.type === 'turn' || e.type === 'plan').map((e) => e.id);
    assert.deepEqual(
      ids,
      ids.map((_, i) => i + 1),
      'turn and plan ids count from 1 together',
    );
    for (const e of events) {
      if (e.type !== 'memory' || e.cause !== 'told') continue;
      const t = store.turn(e.turn);
      assert.equal(t?.type, 'turn', `memory at ${e.tick} cites turn ${e.turn}`);
      assert.equal(t.to, e.who);
      assert.equal(t.fact, e.fact);
    }
    assert.equal(state.convs.size, 0, 'every conversation ended');
    assert.ok(state.ended);
    const known = [...state.neighbors.values()].filter((n) => Object.keys(n.memory).length).length;
    assert.equal(known, state.ended.informed);
  });
}

test('trips end by timetable, without an event', () => {
  const header = { start_tick: 100, neighbors: [{ id: 'n001', home: 'p13' }], places: [] };
  const store = createStore(header);
  store.append([
    { type: 'move', tick: 101, who: 'n001', from: 'p13', to: 'p02', arrive: 105, fact: null },
    { type: 'end', tick: 200 },
  ]);
  assert.equal(store.firstPlace('n001'), 'p13');
  store.seek(104.9);
  assert.equal(store.state.neighbors.get('n001').place, null);
  assert.equal(store.state.neighbors.get('n001').trip.to, 'p02');
  store.seek(105);
  assert.equal(store.state.neighbors.get('n001').place, 'p02');
  assert.equal(store.state.neighbors.get('n001').trip, null);
  store.seek(100);
  assert.equal(store.state.neighbors.get('n001').trip, null);
  assert.equal(store.state.neighbors.get('n001').place, null);
});

test('append notifies and keeps the state at pos; setStateAt replaces seek', () => {
  const { header, events } = loadLog(FIXTURE);
  const store = createStore(header, { live: true });
  const changes = [];
  store.subscribe((c) => changes.push(c));
  store.append(events.slice(0, 10));
  store.append(events.slice(10));
  assert.deepEqual(changes, [
    { type: 'append', from: 0, to: 10 },
    { type: 'append', from: 10, to: events.length },
  ]);
  assert.equal(store.lastTick, 1440);
  assert.equal(store.firstFact, 'f1');
  assert.equal(store.turn(4).type, 'turn');
  assert.equal(store.turn(1).type, 'plan');

  store.seek(1236);
  const seen = [];
  store.setStateAt((pos) => {
    seen.push(pos);
    return fromScratch(header, events, pos);
  });
  assert.deepEqual(seen, [1236]);
  store.seek(1220.5);
  assert.deepEqual(seen, [1236, 1220.5]);
  assert.equal(store.index, store.countUntil(1220));
  assert.deepEqual(store.state, fromScratch(header, events, 1220.5));
  assert.ok(changes.some((c) => c.type === 'seek'));
  assert.throws(() => store.append([{ type: 'end', tick: 5 }]), /after tick/);
});

test('the state of the hand-written log tells its story', () => {
  const store = loadStore(FIXTURE, 1228.5);
  const { state } = store;
  const ana = state.neighbors.get('n003');
  assert.deepEqual(ana.memory.f1.when, { state: 'doubt', value: 46, cause: 'told', turn: 20, tick: 1228 });
  assert.equal(state.neighbors.get('n002').memory.f1.when.state, 'forgotten');
  assert.equal(state.convs.get('c5').turns.length, 3);
  assert.equal(ana.conv, 'c5');
  assert.equal(ana.place, 'p01');
  assert.equal(state.facts.get('f1').slots.when, 44);
  assert.equal(state.perf.tick, 1218);

  store.seek(1400);
  assert.deepEqual(
    store.state.arrivals.map((a) => [a.who, a.slot]),
    [
      ['n001', 44],
      ['n007', 44],
      ['n003', 46],
      ['n005', 46],
    ],
  );
  assert.equal(store.state.neighbors.get('n005').plan.f1.claim.when, 46);
  assert.equal(store.state.neighbors.get('n002').plan.f1.action, 'none');
  assert.equal(store.state.neighbors.get('n005').arrived.f1.slot, 46);
});
