import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIXTURE, loadStore, SAMPLES } from '../core/testing.js';
import { slotValueText } from '../core/names.js';
import { versionOf } from '../core/version.js';
import { boxAbove, crowdCounts, declutter, hoverCard, placeLook, PRIORITY, touches, VERSION_GLYPHS } from './tags.js';

const box = (x, y, prio, w = 60, h = 18) => ({ x, y, w, h, prio });

test('declutter: no two shown labels touch, higher priority wins', () => {
  const items = [box(100, 100, PRIORITY.name), box(130, 105, PRIORITY.selected), box(400, 100, PRIORITY.name), box(150, 110, PRIORITY.talking)];
  const shown = declutter(items);
  assert.deepEqual(shown, [false, true, true, false]);
  const kept = items.filter((_, i) => shown[i]);
  for (let i = 0; i < kept.length; i++) for (let j = i + 1; j < kept.length; j++) assert.ok(!touches(kept[i], kept[j]));
});

test('declutter: ties keep the input order, reserved boxes always win', () => {
  assert.deepEqual(declutter([box(0, 0, 1), box(10, 0, 1)]), [true, false]);
  assert.deepEqual(declutter([box(0, 0, 1), box(10, 0, 1)].reverse()), [true, false]);
  const reserved = [{ x: 90, y: 90, w: 50, h: 50 }];
  assert.deepEqual(declutter([box(100, 100, PRIORITY.selected), box(300, 100, 1)], reserved), [false, true]);
});

test('declutter: a crowd of names keeps a readable subset, deterministically', () => {
  const items = [];
  for (let i = 0; i < 60; i++) items.push(box((i % 10) * 25, Math.floor(i / 10) * 9, PRIORITY.name));
  const a = declutter(items);
  assert.deepEqual(a, declutter(items));
  assert.ok(a.filter(Boolean).length > 3 && a.filter(Boolean).length < 30);
});

test('label box above an anchor, crowd counts and place looks', () => {
  assert.deepEqual(boxAbove({ x: 100, y: 50 }, 40, 20), { x: 80, y: 30, w: 40, h: 20 });
  const placeOf = new Map([['a', 'p1'], ['b', 'p1'], ['c', 'p2']]);
  const c = crowdCounts(placeOf, (id) => (id === 'a' ? 'red' : 'grey'));
  assert.equal(c.get('p1').n, 2);
  assert.equal(c.get('p1').colors.get('red'), 1);
  assert.equal(c.get('p2').colors.get('grey'), 1);
  assert.equal(placeLook({ key: 'bar', kind: 'public' }).icon, 'cup');
  assert.equal(placeLook({ key: 'upper_quarter', kind: 'home' }).icon, 'house');
  assert.equal(placeLook({ key: 'zoo', kind: 'public' }).icon, 'pin');
});

test('hover card: who, and what they believe against the original', () => {
  const store = loadStore(FIXTURE, 1230);
  const { header, state } = store;
  const card = (id, lang = 'es') => hoverCard(header, state, 'f1', id, lang);
  const when = (v) => slotValueText('when', v, header);

  const carmen = card('n001');
  assert.equal(carmen.name, 'Carmen');
  assert.equal(carmen.role, 'panadera · cotilla');
  assert.equal(carmen.version, 'correct');
  assert.equal(carmen.glyph, '✓');
  assert.equal(carmen.status, 'correcta');
  assert.deepEqual(carmen.rows.map((r) => [r.label, r.original]), [['quién', null], ['dónde', null], ['cuándo', null], ['cuántos', null]]);
  assert.equal(carmen.rows[0].now, 'Manuel');
  assert.equal(carmen.rows[3].now, '50 personas');

  // Forgot the hour: incomplete, the original is told.
  const luis = card('n002');
  assert.equal(luis.role, 'funcionario · discreto');
  assert.equal(luis.version, 'incomplete');
  assert.equal(luis.glyph, '~');
  const lw = luis.rows.find((r) => r.slot === 'when');
  assert.deepEqual([lw.now, lw.original, lw.kind], ['—', when(44), 'missing']);

  // Another hour, in doubt: distorted.
  const ana = card('n003', 'en');
  assert.equal(ana.version, 'wrong');
  assert.equal(ana.glyph, '✗');
  assert.equal(ana.status, 'distorted');
  const aw = ana.rows.find((r) => r.slot === 'when');
  assert.deepEqual([aw.label, aw.now, aw.original, aw.kind], ['when', `${when(46)}?`, when(44), 'changed']);

  // Has not heard; no rumor yet; unknown neighbor.
  const pedro = card('n004');
  assert.deepEqual([pedro.version, pedro.glyph, pedro.status, pedro.rows], [null, '', 'no se ha enterado', []]);
  const before = loadStore(FIXTURE, 1205);
  assert.equal(hoverCard(header, before.state, before.firstFact, 'n001', 'es').status, 'todavía no corre el rumor');
  assert.equal(card('n999'), null);
});

test('hover card agrees with the version of every neighbor, and is the same twice', () => {
  for (const rel of SAMPLES) {
    const store = loadStore(rel);
    const fact = store.firstFact;
    const original = store.state.facts.get(fact).slots;
    for (const n of store.header.neighbors) {
      const c = hoverCard(store.header, store.state, fact, n.id, store.header.lang);
      assert.equal(c.version, versionOf(store.state.neighbors.get(n.id)?.memory[fact], original), `${rel} ${n.id}`);
      assert.equal(c.glyph, VERSION_GLYPHS[c.version] ?? '');
      assert.ok(c.role && !c.role.includes('undefined'), `${rel} ${n.id}: ${c.role}`);
      assert.deepEqual(hoverCard(store.header, store.state, fact, n.id, store.header.lang), c);
    }
  }
});
