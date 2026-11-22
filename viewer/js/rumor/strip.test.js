// Tests of the strip of the telephone game (phase 8-2, 2.12) against the
// telephone samples and the hand-written log.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FIXTURE, loadStore } from '../core/testing.js';
import { SLOTS } from '../core/version.js';
import { chainOf } from './chain.js';
import { createHistory } from './history.js';
import { stripAt } from './strip.js';

const TEL = 'runs/samples/telephone-20-es-s5.jsonl';

function at(rel, pos) {
  const store = loadStore(rel, pos);
  const h = createHistory();
  h.ingest(store.events);
  return { store, h, s: stripAt(h, store.header, store.firstFact, store.index) };
}

const text = (c) => c.slots.map((x) => `${x.value ?? '—'}${x.state === 'doubt' ? '?' : ''}${x.changed ? '!' : ''}`).join(' ');

test('strip: null before the inject, the inject recipient first', () => {
  const { store } = at(TEL, 600);
  const h = createHistory();
  h.ingest(store.events);
  assert.equal(stripAt(h, store.header, store.firstFact, 0), null);
  assert.equal(stripAt(h, store.header, null, store.index), null);
  const { s } = at(TEL, 700);
  assert.deepEqual(s.original, { who: 'n006', where: 'p01', when: 42, amount: 50 });
  assert.deepEqual(
    s.cells.map((c) => c.who),
    store.header.neighbors.map((n) => n.id).sort(),
  );
  assert.deepEqual([s.cells[0].told, s.cells[0].from, text(s.cells[0])], [true, null, 'n006 p01 42 50']);
});

test('strip: telephone at 20:10, the message hand to hand with its changes in red', () => {
  const { s } = at(TEL, 1210.5);
  assert.deepEqual(
    s.cells.map((c) => [c.who, c.from, text(c)]),
    [
      ['n001', null, 'n006 p01 42 50'],
      ['n002', 'n001', 'n006 p01 42 0?!'],
      ['n003', 'n002', 'n006 p01 42 0?'],
      ['n004', 'n003', 'n006 p01 42 0!'],
      ['n005', 'n004', 'n006 p01 42 0'],
      ['n006', 'n005', 'n006 p01 42 0'],
      ['n007', 'n006', 'n006 p01 42 0'],
      ['n008', 'n007', '—! p01 39?! 0'],
      ['n009', 'n008', '— —! 39! 6?!'],
      ['n010', 'n009', '— — 39 6!'],
      ['n011', 'n010', '— — 39 6'],
      ['n012', 'n011', '— — 39 6'],
      ['n013', 'n012', '— — 39 6'],
      ['n014', 'n013', '— — 39 6'],
      ['n015', 'n014', '— — 39 6'],
      ['n016', 'n015', '— — 39 6'],
      ['n017', 'n016', '— — 39 6'],
      ['n018', null, '— — — —'],
      ['n019', null, '— — — —'],
      ['n020', null, '— — — —'],
    ],
  );
  // What came out: the last one told, against the original.
  assert.equal(s.out.who, 'n017');
  assert.deepEqual(
    s.out.slots.map((x) => [x.slot, x.value, x.changed]),
    [
      ['who', null, true],
      ['where', null, true],
      ['when', 39, true],
      ['amount', 6, true],
    ],
  );
});

test('strip: each cell follows the told chain, and red is the chain\'s own change', () => {
  for (const rel of [TEL, 'runs/samples/telephone-20-en-s5.jsonl', FIXTURE]) {
    const { s, h, store } = at(rel);
    for (const c of s.cells) {
      if (!c.told || c.from === null) continue;
      // The informing turn is the speaker's tell to this neighbor.
      const e = h.event(c.i);
      assert.deepEqual([e.type, e.who, e.to], ['turn', c.from, c.who], `${rel} ${c.who}`);
      for (const x of c.slots) {
        const chain = chainOf(h, c.who, store.firstFact, c.i + 1, x.slot);
        const hop = chain?.steps.at(-1);
        if (hop && hop.turn.id === e.id) {
          assert.equal(hop.slots.find((y) => y.slot === x.slot).changed, x.changed, `${rel} ${c.who} ${x.slot}`);
        }
      }
    }
    assert.equal(s.cells.length, store.header.neighbors.length);
    for (const c of s.cells) assert.equal(c.slots.length, SLOTS.length);
  }
});

test('strip: the same position gives the same strip, played or jumped to', () => {
  const end = at(TEL);
  const { s } = at(TEL, 1100);
  const h = end.h; // fed with the whole log, asked as of 11:00
  const store = loadStore(TEL, 1100);
  assert.deepEqual(stripAt(h, store.header, store.firstFact, store.index), s);
});
