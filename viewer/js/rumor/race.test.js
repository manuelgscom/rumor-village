// The race in two colours (phase 9, package E): the side of each neighbor,
// its colour, and the tint and trail by rumor, the same whether the position
// is reached by playing or by jumping (with the snapshots of replay/).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadLog } from '../core/testing.js';
import { createStore } from '../core/store.js';
import { VERSION_COLORS } from '../core/theme.js';
import { createStateAt } from '../replay/snapshots.js';
import { RACE_TINT, raceTintAt, raceTrailsAt, tintBar, trailsAt } from '../render/heat.js';
import { createHistory } from './history.js';
import { RACE_COLORS, raceColor, raceSides, sidesOf } from './race.js';

const SLOTS = { who: null, where: 'p01', when: 42, amount: null };
const VERDICT = { who: 'omitted', where: 'faithful', when: 'faithful', amount: 'omitted' };
const CLAIM = { who: null, where: 'p01', when: 42, amount: null, guess: [] };

/** A small race by hand: f1 enters with n001, f2 with n002; n003 hears f1 first, n004 f2 first. */
function raceLog() {
  const header = {
    type: 'header',
    format: 1,
    seed: 1,
    scenario: 'race-hand',
    lang: 'es',
    policy: 'baseline',
    model: null,
    params: {},
    tick_seconds: 60,
    start_tick: 600,
    start_weekday: 1,
    places: [
      { id: 'p01', key: 'square', name: 'plaza', kind: 'public', x: 0, y: 0 },
      { id: 'p02', key: 'bar', name: 'bar', kind: 'public', x: 100, y: 0 },
    ],
    routes: [{ from: 'p01', to: 'p02', ticks: 3, path: [[0, 0], [100, 0]] }],
    neighbors: ['Ana', 'Luis', 'Eva', 'Pablo', 'Rosa'].map((name, k) => ({ id: `n00${k + 1}`, name, gender: 'f', job: 'baker', trait: 'gossip', home: 'p01' })),
    relations: [],
  };
  let id = 0;
  const tell = (tick, conv, who, to, fact) => [
    { type: 'turn', tick, id: ++id, conv, n: 1, who, to, card: 'x', action: 'say', act: 'tell', fact, claim: CLAIM, reject: null, verdict: VERDICT, conflicts: [], text: null, gen: null },
    { type: 'memory', tick, who: to, fact, slot: 'where', state: 'sure', value: 'p01', cause: 'told', turn: id },
  ];
  const events = [
    { type: 'move', tick: 600, who: 'n003', from: 'p01', to: 'p02', arrive: 603, fact: null },
    { type: 'inject', tick: 600, fact: 'f1', text: null, what: 'party', slots: SLOTS, to: ['n001'] },
    { type: 'memory', tick: 600, who: 'n001', fact: 'f1', slot: 'where', state: 'sure', value: 'p01', cause: 'inject', turn: null },
    { type: 'inject', tick: 605, fact: 'f2', text: null, what: 'wedding', slots: SLOTS, to: ['n002'] },
    { type: 'memory', tick: 605, who: 'n002', fact: 'f2', slot: 'where', state: 'sure', value: 'p01', cause: 'inject', turn: null },
    { type: 'conv_start', tick: 610, conv: 'c1', a: 'n001', b: 'n003', place: 'p01' },
    ...tell(611, 'c1', 'n001', 'n003', 'f1'),
    { type: 'conv_end', tick: 612, conv: 'c1', reason: 'bye' },
    { type: 'conv_start', tick: 620, conv: 'c2', a: 'n002', b: 'n004', place: 'p02' },
    ...tell(621, 'c2', 'n002', 'n004', 'f2'),
    { type: 'conv_end', tick: 622, conv: 'c2', reason: 'bye' },
    { type: 'conv_start', tick: 630, conv: 'c3', a: 'n002', b: 'n003', place: 'p02' },
    ...tell(631, 'c3', 'n002', 'n003', 'f2'),
    { type: 'conv_end', tick: 632, conv: 'c3', reason: 'bye' },
    { type: 'conv_start', tick: 640, conv: 'c4', a: 'n003', b: 'n004', place: 'p02' },
    ...tell(641, 'c4', 'n003', 'n004', 'f1'),
    { type: 'conv_end', tick: 642, conv: 'c4', reason: 'bye' },
  ];
  return { header, events };
}

const RACE = ['f1', 'f2'];
const IDS = ['n001', 'n002', 'n003', 'n004', 'n005'];

/** Everything coloured by the race at the store's position. */
function picture(store) {
  const sides = raceSides(store.events, store.index, RACE, IDS);
  const placeOf = new Map();
  for (const [id, n] of store.state.neighbors) if (n.place) placeOf.set(id, n.place);
  const tint = raceTintAt(sides, placeOf);
  return {
    colors: IDS.map((id) => raceColor(sides.get(id))),
    tint: [...tint.entries()].sort(),
    bars: [...tint.entries()].sort().map(([p, t]) => `${p}:${tintBar(t, RACE_TINT)}`),
    trail: raceTrailsAt(store.events, store.index, store.pos, RACE),
  };
}

test('race: each neighbor takes the colour of the rumor it heard first', () => {
  const { header, events } = raceLog();
  const h = createHistory();
  h.ingest(events);
  const sides = sidesOf(h, events.length, RACE, IDS);
  assert.deepEqual(Object.fromEntries(sides), { n001: 0, n002: 1, n003: 0, n004: 1 });
  assert.equal(raceColor(sides.get('n003')), RACE_COLORS[0]);
  assert.equal(raceColor(sides.get('n004')), RACE_COLORS[1]);
  assert.equal(raceColor(sides.get('n005')), VERSION_COLORS.unknown);
  // Before n003 hears f2 and before n004 hears f1, the same sides.
  const store = createStore(header, { pos: 625 });
  store.append(events);
  assert.deepEqual(Object.fromEntries(raceSides(store.events, store.index, RACE, IDS)), { n001: 0, n002: 1, n003: 0, n004: 1 });
  // Who has a side is exactly who knows a rumor in the state.
  for (const id of IDS) {
    const mem = store.state.neighbors.get(id).memory;
    assert.equal(raceSides(store.events, store.index, RACE, IDS).has(id), !!(mem.f1 || mem.f2), id);
  }
});

test('race: the colours are not the versions and differ from each other', () => {
  const versions = Object.values(VERSION_COLORS).map((c) => c.toLowerCase());
  assert.notEqual(RACE_COLORS[0], RACE_COLORS[1]);
  for (const c of RACE_COLORS) assert.ok(!versions.includes(c.toLowerCase()), c);
});

test('race: playing up to a position or jumping to it gives the same picture', () => {
  const { header, events } = raceLog();
  const played = createStore(header, { pos: 600 });
  played.append(events);
  const jumped = createStore(header, { pos: 600 });
  jumped.append(events);
  jumped.setStateAt(createStateAt(jumped, { every: 3 }));
  const positions = [];
  for (let p = 600; p <= 700; p += 0.5) positions.push(p);
  const shots = new Map();
  for (const p of positions) {
    played.seek(p);
    shots.set(p, picture(played));
  }
  // Jumps in a scrambled order, backwards too, with snapshots.
  const order = [...positions].sort((a, b) => ((a * 7919) % 101) - ((b * 7919) % 101));
  for (const p of order) {
    jumped.seek(p);
    assert.deepEqual(picture(jumped), shots.get(p), `pos ${p}`);
  }
  // At the end: two of each colour on the map, and n005 grey.
  played.seek(700);
  const end = picture(played);
  assert.deepEqual(end.colors, [RACE_COLORS[0], RACE_COLORS[1], RACE_COLORS[0], RACE_COLORS[1], VERSION_COLORS.unknown]);
});

test('race: the trail goes by rumor, one side per fact', () => {
  const { header, events } = raceLog();
  const store = createStore(header, { pos: 645 });
  store.append(events);
  const { ways, pulses } = raceTrailsAt(store.events, store.index, store.pos, RACE);
  const all = [...ways, ...pulses];
  const n = (side) => all.filter((w) => w.side === side).reduce((s, w) => s + w.n, 0);
  assert.equal(n(0), trailsAt(store.events, store.index, store.pos, 'f1').length);
  assert.equal(n(1), trailsAt(store.events, store.index, store.pos, 'f2').length);
  assert.ok(n(0) === 2 && n(1) === 2, 'two tells of each');
  for (const w of all) assert.ok(!('changed' in w), 'no change colour in a race');
  for (let k = 1; k < ways.length; k++) assert.ok(ways[k - 1].alpha <= ways[k].alpha, 'faintest first');
});

test('race: the tint of a place counts each side and the bar has both colours', () => {
  const sides = new Map([
    ['n001', 0],
    ['n002', 1],
    ['n003', 1],
  ]);
  const placeOf = new Map([
    ['n001', 'p01'],
    ['n002', 'p01'],
    ['n003', 'p01'],
    ['n004', 'p01'],
    ['n005', 'p02'],
  ]);
  const t = raceTintAt(sides, placeOf);
  assert.deepEqual(t.get('p01'), { n: 4, first: 1, second: 2, unknown: 1 });
  assert.deepEqual(t.get('p02'), { n: 1, first: 0, second: 0, unknown: 1 });
  const bar = tintBar(t.get('p01'), RACE_TINT);
  assert.ok(bar.includes(RACE_COLORS[0]) && bar.includes(RACE_COLORS[1]) && bar.includes(VERSION_COLORS.unknown));
  assert.equal(tintBar(t.get('p02'), RACE_TINT), '');
});

test('race: on a sample with one rumor, the second side stays empty', () => {
  const { events, header } = loadLog('runs/samples/party-25-en-s4.jsonl');
  const ids = header.neighbors.map((n) => n.id);
  const h = createHistory();
  h.ingest(events);
  const sides = raceSides(events, events.length, ['f1', 'f9'], ids);
  assert.ok(sides.size > 0);
  assert.ok([...sides.values()].every((s) => s === 0));
  assert.equal(sides.size, ids.filter((id) => h.informed(id, 'f1', events.length)).length);
  assert.equal(raceSides(events, events.length, null, ids).size, 0);
});
