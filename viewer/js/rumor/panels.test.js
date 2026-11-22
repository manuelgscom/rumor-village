// Tests of the pure parts of the rumor panels added in phase 7: the spread
// curve (spread.js), the neighbor card (person.js) and the vocabulary tables.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FIXTURE, loadLog, loadStore, readRepoFile, SAMPLES } from '../core/testing.js';
import { versionOf } from '../core/version.js';
import { createHistory } from './history.js';
import { buildModel } from './model.js';
import { beliefOf, gendered, toldTo } from './person.js';
import { countsAt, spreadBands, spreadSeries } from './spread.js';
import { STRINGS } from './strings.js';
import { versionsAt } from './tree.js';

const SINGLE = { correct: 0, incomplete: 0, wrong: 0 };

test('spread: the count at every tick agrees with versionsAt of the store there', () => {
  for (const rel of [FIXTURE, ...SAMPLES]) {
    const { header, events } = loadLog(rel);
    const ids = header.neighbors.map((n) => n.id);
    const end = loadStore(rel);
    const fact = end.firstFact;
    const s = spreadSeries(events, fact, ids);
    assert.equal(s.start, end.state.facts.get(fact).tick, rel);
    const first = events[0]?.tick ?? header.start_tick;
    const last = events.at(-1).tick;
    const step = Math.max(1, Math.floor((last - first) / 23));
    for (let tick = first; tick <= last + step; tick += step) {
      const store = loadStore(rel, tick);
      const { counts } = versionsAt(store.state, fact, ids);
      const { unknown, ...known } = counts;
      assert.deepEqual(countsAt(s, tick), known, `${rel} @${tick}`);
    }
  }
});

test('spread: nothing before the inject, and no fact gives an empty series', () => {
  const { header, events } = loadLog(FIXTURE);
  const ids = header.neighbors.map((n) => n.id);
  const s = spreadSeries(events, 'f1', ids);
  assert.deepEqual(countsAt(s, s.start - 1), SINGLE);
  assert.deepEqual(spreadSeries(events, null, ids).ticks, []);
  assert.deepEqual(spreadBands(s, s.start - 1, 1440, 7, 100, 50), { bands: [], head: null });
});

test('spread bands: stacked inside the box, head on top of the stack', () => {
  const { header, events } = loadLog(SAMPLES[0]);
  const ids = header.neighbors.map((n) => n.id);
  const s = spreadSeries(events, loadStore(SAMPLES[0]).firstFact, ids);
  const w = 200;
  const h = 60;
  const tick = 1100;
  const { bands, head } = spreadBands(s, tick, header.params.end_tick, ids.length, w, h);
  assert.deepEqual(
    bands.map((b) => b.key),
    ['wrong', 'incomplete', 'correct'],
  );
  for (const b of bands) {
    for (const p of b.points) {
      assert.ok(p.x >= 0 && p.x <= w + 1e-9 && p.y >= -1e-9 && p.y <= h + 1e-9, `${b.key} ${p.x},${p.y}`);
    }
  }
  const c = countsAt(s, tick);
  const known = c.correct + c.incomplete + c.wrong;
  assert.ok(Math.abs(head.y - (h - (known / ids.length) * h)) < 1e-9);
});

test('belief: rows agree with versionOf, and the fixture shows Elena at 23:00 instead of 22:00', () => {
  const store = loadStore(FIXTURE);
  const fact = store.firstFact;
  const original = store.state.facts.get(fact).slots;
  for (const [id, n] of store.state.neighbors) {
    const mem = n.memory[fact];
    const rows = beliefOf(mem, original);
    const v = versionOf(mem, original);
    if (!mem) continue;
    const expected = rows.some((r) => r.status === 'changed') ? 'wrong' : rows.some((r) => r.status === 'missing') ? 'incomplete' : 'correct';
    assert.equal(expected, v, id);
  }
  const elena = beliefOf(store.state.neighbors.get('n005').memory[fact], original);
  const when = elena.find((r) => r.slot === 'when');
  assert.equal(when.status, 'changed');
  assert.equal(when.original, 44);
  assert.equal(when.now.value, 46);
  // Nothing known: every slot of the original is missing.
  assert.ok(beliefOf(undefined, original).every((r) => r.status === 'missing' && !r.forgotten));
});

test('told to: each listener once, in order; the model carries the card', () => {
  const store = loadStore(FIXTURE);
  const h = createHistory();
  h.ingest(store.events);
  const fact = store.firstFact;
  const idx = store.index;
  assert.deepEqual(
    toldTo(h, 'n001', fact, idx).map((x) => x.to),
    ['n002', 'n007'],
  );
  assert.deepEqual(toldTo(h, 'n005', fact, idx), []);
  const ids = store.header.neighbors.map((n) => n.id);
  const m = buildModel({ h, state: store.state, idx, tick: Math.floor(store.pos), fact, ids, select: 'n005' });
  assert.equal(m.person.from.from, 'n003');
  assert.ok(m.person.belief.length >= 3);
  const none = buildModel({ h, state: store.state, idx, tick: Math.floor(store.pos), fact, ids });
  assert.equal(none.person, null);
});

test('job and trait tables match data/vocab, in both genders', () => {
  for (const lang of ['es', 'en']) {
    const vocab = JSON.parse(readRepoFile(`data/vocab/${lang}.json`));
    assert.deepEqual(STRINGS[lang].jobs, vocab.jobs, lang);
    assert.deepEqual(STRINGS[lang].traits, vocab.traits, lang);
  }
  assert.equal(gendered(STRINGS.es.jobs, 'baker', 'f'), 'panadera');
  assert.equal(gendered(STRINGS.es.traits, 'shy', 'm'), 'tímido');
  assert.equal(gendered(STRINGS.es.jobs, 'astronaut', 'm'), 'astronaut');
});
