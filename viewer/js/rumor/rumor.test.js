// Tests of package C: chain, culprit, groups, tree and versions, against the
// hand-written log (viewer/fixtures/README.md) and the samples.
//
// The expected figures of the samples come from the engine:
//   scripts/rumor.sh metrics <log>  →  reach {informed, correct, incomplete, wrong}
//                                      attendance {right, other_time, other_place}

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FIXTURE, loadStore, SAMPLES } from '../core/testing.js';
import { chainOf, chainPaths, leadSlot } from './chain.js';
import { culpritsOf, GROUP_KEYS, groupsAt } from './groups.js';
import { graphLayout, pickNode } from './graph.js';
import { createHistory } from './history.js';
import { buildModel } from './model.js';
import { profileLines } from './person.js';
import { STRINGS } from './strings.js';
import { neighborProfile } from '../core/neighbors.js';
import { overlaySpec, spreadLabels } from './overlay.js';
import { treeAt, versionsAt } from './tree.js';

/** A store at `pos` (default the end) and its history. */
function load(rel, pos) {
  const store = loadStore(rel, pos);
  const h = createHistory();
  h.ingest(store.events);
  const ids = store.header.neighbors.map((n) => n.id);
  return { store, h, ids, fact: store.firstFact, idx: store.index };
}

function nameId(store, name) {
  return store.header.neighbors.find((n) => n.name === name).id;
}

/** From `scripts/rumor.sh metrics <log>` (engine/src/metrics). */
const ENGINE = {
  [FIXTURE]: { reach: [5, 1, 2, 2], attendance: [2, 2, 0] },
  'runs/samples/party-100-es-s2.jsonl': { reach: [50, 30, 12, 8], attendance: [33, 2, 4] },
  'runs/samples/party-25-en-s4.jsonl': { reach: [21, 6, 6, 9], attendance: [8, 3, 2] },
  'runs/samples/telephone-20-en-s5.jsonl': { reach: [20, 0, 10, 10], attendance: [0, 0, 0] },
  'runs/samples/telephone-20-es-s5.jsonl': { reach: [20, 0, 10, 10], attendance: [0, 0, 0] },
};

test('fixture: chain of Elena, inject → Carmen (10) → Luis (20) → Ana (25) → Elena', () => {
  const { h, fact, idx } = load(FIXTURE);
  const original = h.inject(fact, idx).e.slots;
  assert.equal(leadSlot(h, 'n005', fact, original, idx), 'when');
  const c = chainOf(h, 'n005', fact, idx, 'when');
  assert.equal(c.origin.who, 'n001');
  assert.equal(c.origin.tick, 1210);
  assert.deepEqual(
    c.steps.map((s) => [s.turn.id, s.from, s.to]),
    [
      [10, 'n001', 'n002'],
      [20, 'n002', 'n003'],
      [25, 'n003', 'n005'],
    ],
  );
  const when = (k) => c.steps[k].slots.find((s) => s.slot === 'when');
  // Carmen → Luis: faithful, nothing changes.
  assert.equal(c.steps[0].slots.some((s) => s.changed), false);
  // Luis → Ana: `when` 44 → 46 by declared guess, after forgetting it at 1225.
  assert.equal(when(1).changed, true);
  assert.equal(when(1).cause, 'guess');
  assert.deepEqual(when(1).old, { value: 44, state: 'sure' });
  assert.deepEqual(when(1).got, { value: 46, state: 'doubt' });
  assert.deepEqual(
    when(1).notes.map((m) => [m.cause, m.tick]),
    [['forgot', 1225]],
  );
  assert.deepEqual(
    c.steps[1].slots.filter((s) => s.changed).map((s) => s.slot),
    ['when'],
  );
  // Ana → Elena: the doubt was dropped at 1232, so 46 goes on as sure.
  assert.equal(when(2).cause, 'doubt_dropped');
  assert.deepEqual(when(2).got, { value: 46, state: 'sure' });
  assert.deepEqual(chainPaths(h, 'n005', fact, idx).length, 1);
});

test('fixture: Inma lacks `amount` by omission', () => {
  const { h, fact, idx } = load(FIXTURE);
  const c = chainOf(h, 'n007', fact, idx, 'when');
  assert.deepEqual(
    c.steps.map((s) => s.turn.id),
    [15],
  );
  const amount = c.steps[0].slots.find((s) => s.slot === 'amount');
  assert.equal(amount.changed, true);
  assert.equal(amount.cause, 'omission');
  assert.equal(amount.got, null);
});

test('fixture: groups and the culprit of other_time is Luis, turn 20', () => {
  const { store, h, ids, fact, idx } = load(FIXTURE);
  const g = groupsAt(h, fact, idx, store.state.tick, ids);
  assert.deepEqual(
    g.right.map((m) => m.who),
    ['n001', 'n007'],
  );
  assert.deepEqual(
    g.other_time.map((m) => m.who),
    ['n003', 'n005'],
  );
  assert.deepEqual(g.other_place, []);
  const { culprits, unexplained } = culpritsOf(h, fact, g.other_time, 'other_time', idx);
  assert.deepEqual(unexplained, []);
  assert.equal(culprits.length, 1);
  const c = culprits[0].culprit;
  assert.equal(c.who, 'n002');
  assert.equal(c.id, 20);
  assert.equal(c.tick, 1228);
  assert.equal(c.cause, 'guess');
  assert.deepEqual(culprits[0].members, ['n003', 'n005']);
});

test('fixture: before arriving, the plans already make pending groups', () => {
  const { store, h, ids, fact, idx } = load(FIXTURE, 1300);
  const g = groupsAt(h, fact, idx, store.state.tick, ids);
  assert.deepEqual(
    g.other_time.map((m) => [m.who, m.arrived]),
    [
      ['n003', false],
      ['n005', false],
    ],
  );
  assert.equal(g.right.length, 2);
});

test('fixture: rewinding gives the chain of that moment', () => {
  // Tick 1230: Luis has told Ana (turn 20) but Ana has not told Elena yet.
  const { store, h, ids, fact, idx } = load(FIXTURE, 1230);
  assert.equal(chainOf(h, 'n005', fact, idx, 'when'), null);
  const ana = chainOf(h, 'n003', fact, idx, 'when');
  assert.deepEqual(
    ana.steps.map((s) => s.turn.id),
    [10, 20],
  );
  assert.equal(versionsAt(store.state, fact, ids).of.get('n003'), 'wrong');
  assert.equal(treeAt(h, fact, idx, ids).nodes.length, 4);
  // Before the inject: nothing.
  const early = load(FIXTURE, 1205);
  assert.equal(treeAt(early.h, early.fact, early.idx, early.ids), null);
  assert.equal(groupsAt(early.h, early.fact, early.idx, 1205, early.ids), null);
});

test('party-100: Silvia arrives at 18:30; the culprit is Jaime (turn 1748, tick 911)', () => {
  const { store, h, ids, fact, idx } = load('runs/samples/party-100-es-s2.jsonl');
  const silvia = nameId(store, 'Silvia');
  const jaime = nameId(store, 'Jaime');
  const g = groupsAt(h, fact, idx, store.state.tick, ids);
  const m = g.other_time.find((x) => x.who === silvia);
  assert.ok(m, 'Silvia is in other_time');
  assert.equal(m.place, 'p01');
  assert.equal(m.slot, 37); // 18:30
  const { culprits } = culpritsOf(h, fact, [m], 'other_time', idx);
  const c = culprits[0].culprit;
  assert.equal(c.who, jaime);
  assert.equal(c.id, 1748);
  assert.equal(c.tick, 911);
  assert.equal(c.cause, 'guess');
  assert.deepEqual(c.old, { value: 42, state: 'sure' });
  assert.deepEqual(
    c.notes.map((n) => [n.cause, n.tick]),
    [['forgot', 863]],
  );
  // Selecting Silvia shows the same hop, with the hour changed.
  const chain = chainOf(h, silvia, fact, idx, leadSlot(h, silvia, fact, h.inject(fact, idx).e.slots, idx));
  assert.equal(chain.lead, 'when');
  const last = chain.steps[chain.steps.length - 1];
  assert.equal(last.turn.id, 1748);
  assert.equal(last.slots.find((s) => s.slot === 'when').cause, 'guess');
});

for (const rel of [FIXTURE, ...SAMPLES]) {
  test(`${rel}: chains start at the inject, colors match memory, counts match the engine`, () => {
    const { store, h, ids, fact, idx } = load(rel);
    const { of, counts } = versionsAt(store.state, fact, ids);
    const [informed, correct, incomplete, wrong] = ENGINE[rel].reach;
    assert.deepEqual(counts, { correct, incomplete, wrong, unknown: ids.length - informed });

    const tree = treeAt(h, fact, idx, ids);
    assert.equal(tree.nodes.length, informed);
    for (const id of ids) {
      const v = of.get(id);
      const known = store.state.neighbors.get(id).memory[fact] !== undefined;
      if (v !== null) assert.ok(known, `${id} is colored without memory of ${fact}`);
      assert.equal(!!h.informed(id, fact, idx), known, `${id}: history and state disagree`);
      if (!known) continue;
      const original = h.inject(fact, idx).e.slots;
      const lead = leadSlot(h, id, fact, original, idx);
      for (const slot of new Set([lead, 'when', 'where'])) {
        const c = chainOf(h, id, fact, idx, slot);
        assert.ok(c.origin, `${id}/${slot}: chain without inject`);
        assert.equal(c.origin.i, h.inject(fact, idx).i);
        let node = c.origin.who;
        for (const s of c.steps) {
          assert.equal(s.from, node, `${id}/${slot}: broken chain at turn ${s.turn.id}`);
          node = s.to;
        }
        assert.equal(node, id);
      }
    }

    const g = groupsAt(h, fact, idx, store.state.tick, ids);
    const arrived = GROUP_KEYS.map((k) => g[k].filter((m) => m.arrived).length);
    assert.deepEqual(arrived, ENGINE[rel].attendance);
    for (const key of ['other_time', 'other_place']) {
      const { unexplained } = culpritsOf(h, fact, g[key], key, idx);
      assert.deepEqual(unexplained, [], `${key}: members without culprit`);
    }
  });
}

test('party-100 mid-afternoon: chains and colors hold while rewinding', () => {
  const { store, h, ids, fact, idx } = load('runs/samples/party-100-es-s2.jsonl', 900);
  const { of } = versionsAt(store.state, fact, ids);
  for (const id of ids) {
    if (of.get(id) === null) continue;
    const c = chainOf(h, id, fact, idx, 'when');
    assert.ok(c?.origin, `${id}: chain without inject at 900`);
    for (const s of c.steps) assert.ok(s.i < idx);
  }
});

test('model: selection gives the chain, a group gives its culprits', () => {
  const { store, h, ids, fact, idx } = load(FIXTURE);
  const base = { h, state: store.state, idx, tick: store.state.tick, fact, ids };
  const sel = buildModel({ ...base, select: 'n005' });
  assert.equal(sel.chain.target, 'n005');
  assert.equal(sel.culprits, null);
  const grp = buildModel({ ...base, group: 'other_time' });
  assert.equal(grp.chain, null);
  assert.equal(grp.culprits.culprits[0].culprit.who, 'n002');
  assert.equal(buildModel({ ...base, group: 'nonsense' }).group, null);
  assert.equal(buildModel({ ...base, select: 'n004' }).chain, null); // Pedro never heard
  // The overlay of a chain: one segment per hop, the changed one with its label.
  const spec = overlaySpec(sel, store.header);
  assert.equal(spec.segments.length, 3);
  assert.deepEqual(
    spec.segments.filter((s) => s.label).map((s) => s.label),
    ['22:00 → 23:00?', '23:00? → 23:00'],
  );
  assert.deepEqual(spec.labels.map((l) => l.text), ['◆ Carmen', 'Elena']);
  // The origin selected: a single label, not «◆ Carmen» and «Carmen».
  const own = overlaySpec(buildModel({ ...base, select: 'n001' }), store.header);
  assert.deepEqual(own.labels.map((l) => l.text), ['◆ Carmen']);
});

test('graph: layout fits the box and picks nodes; labels do not overlap', () => {
  for (const rel of ['runs/samples/party-100-es-s2.jsonl', 'runs/samples/telephone-20-es-s5.jsonl']) {
    const { h, ids, fact, idx } = load(rel);
    const tree = treeAt(h, fact, idx, ids);
    const layout = graphLayout(tree, 334);
    assert.ok(layout.height <= 220);
    for (const [id, p] of layout.pos) {
      assert.ok(p.x >= 0 && p.x <= 334 && p.y >= 0 && p.y <= layout.height, `${rel}: ${id} out of the box`);
      assert.equal(pickNode(layout, p.x, p.y), id);
    }
  }
  const boxes = spreadLabels([
    { x: 0, y: 0, w: 50 },
    { x: 10, y: 5, w: 50 },
    { x: 200, y: 0, w: 50 },
  ]);
  assert.ok(boxes[1].y >= boxes[0].y + 18);
  assert.equal(boxes[2].y, 0);
});

test('profileLines: the card of a neighbor in the game, with and without the timetable', () => {
  const header = {
    lang: 'es',
    neighbors: [
      { id: 'a', name: 'Ana', gender: 'f', job: 'seamstress', trait: 'sociable', home: 'h1' },
      { id: 'b', name: 'Luis', gender: 'm', job: 'clerk', trait: 'discreet', home: 'h1' },
      { id: 'c', name: 'Pedro', gender: 'm', job: 'carpenter', trait: 'shy', home: 'h1' },
    ],
    places: [
      { id: 'h1', key: 'lower_quarter', name: 'barrio bajo', kind: 'home' },
      { id: 'p1', key: 'market', name: 'mercado', kind: 'public' },
    ],
    relations: [
      { a: 'a', b: 'b', type: 'friend' },
      { a: 'c', b: 'a', type: 'rival' },
    ],
  };
  const hours = Array.from({ length: 24 }, (_, h) => (h >= 9 && h < 20 ? 'market' : 'home'));
  const timetable = { jobs: { seamstress: hours } };
  const t = STRINGS.es;
  assert.deepEqual(profileLines(neighborProfile(header, timetable, 'a', 'es'), t, 'es'), [
    '😊 sociable: lo cuenta a menudo',
    'Familia y amigos: Luis',
    'Rivales: Pedro',
    'Vive en el barrio bajo · pasa el día en el mercado, de 09:00 a 20:00',
  ]);
  // Without the timetable the day is left out; nobody close, no rivals.
  const lone = { ...header, relations: [] };
  assert.deepEqual(profileLines(neighborProfile(lone, null, 'b', 'en'), STRINGS.en, 'en'), [
    '🤐 discreet: hardly ever tells it',
    'Family and friends: nobody',
    'Lives in the barrio bajo',
  ]);
  assert.deepEqual(profileLines(null, t), []);
});

test('game tiles: plans while it runs, arrivals once it ended; the hour after the end', async () => {
  const { gameTiles, afterTheEnd, hourPassed } = await import('./groups.js');
  assert.equal(hourPassed({ when: 24 }, 720), false);
  assert.equal(hourPassed({ when: 24 }, 721), true);
  assert.equal(hourPassed({ when: null }, 900), false);
  const groups = { right: [{ arrived: true }, { arrived: false }, { arrived: false }], other_time: [{ arrived: false }], other_place: [] };
  assert.deepEqual(gameTiles(groups, false), { right: { n: 3, there: 1 }, other_time: { n: 1, there: 0 }, other_place: { n: 0, there: 0 } });
  assert.deepEqual(gameTiles(groups, true), { right: { n: 1, there: 1 }, other_time: { n: 0, there: 0 }, other_place: { n: 0, there: 0 } });
  assert.deepEqual(gameTiles(null, false).right, { n: 0, there: 0 });
  // A party at 21:00 (slot 42) in a game that ends at 13:00 (tick 780).
  assert.equal(afterTheEnd({ when: 42 }, 780), 1260);
  assert.equal(afterTheEnd({ when: 24 }, 780), null);
  assert.equal(afterTheEnd({ when: null }, 780), null);
  assert.equal(afterTheEnd({ when: 42 }, undefined), null);
});
