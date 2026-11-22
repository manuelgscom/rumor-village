// Tests of the summary card (package B of phase 6) against the engine's
// metrics, the hand-written log (viewer/fixtures/README.md) and the samples.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { slotValueText } from '../core/names.js';
import { FIXTURE, loadLog, SAMPLES } from '../core/testing.js';
import { createHistory } from '../rumor/history.js';
import { buildSummary } from './build.js';
import { cardOf } from './card.js';
import { drawCardImage } from './image.js';
import { treeAt } from '../rumor/tree.js';
import { STRINGS } from './strings.js';

// From `scripts/rumor.sh metrics <log>` (engine/src/metrics), run on the logs
// as they are in the repo (phase 6, package B); the same figures as ENGINE in
// viewer/js/rumor/rumor.test.js and REACH in viewer/js/core/version.test.js.
//   final   reach {informed, correct, incomplete, wrong} at the end
//   points  [tick, informed, correct] from reach.timeline: the state at tick T
const REACH = {
  [FIXTURE]: {
    final: [5, 1, 2, 2],
    points: [
      [1230, 4, 1],
      [1260, 5, 1],
    ],
  },
  'runs/samples/party-100-es-s2.jsonl': {
    final: [50, 30, 12, 8],
    points: [
      [600, 8, 6],
      [900, 23, 16],
      [1200, 49, 31],
      [1380, 50, 31],
    ],
  },
  'runs/samples/party-25-en-s4.jsonl': {
    final: [21, 6, 6, 9],
    points: [
      [600, 9, 6],
      [900, 17, 5],
      [1140, 21, 9],
    ],
  },
  'runs/samples/telephone-20-en-s5.jsonl': {
    final: [20, 0, 10, 10],
    points: [
      [690, 4, 0],
      [1050, 12, 0],
      [1260, 19, 0],
    ],
  },
  'runs/samples/telephone-20-es-s5.jsonl': {
    final: [20, 0, 10, 10],
    points: [
      [690, 4, 0],
      [1050, 12, 0],
      [1260, 19, 0],
    ],
  },
};

/** Number of events with tick <= tick. */
const countUntil = (events, tick) => events.filter((e) => e.tick <= tick).length;

const logs = {};
const load = (rel) => (logs[rel] ??= loadLog(rel));

test('the samples and the fixture are all covered', () => {
  assert.deepEqual(Object.keys(REACH).sort(), [FIXTURE, ...SAMPLES].sort());
});

for (const [rel, want] of Object.entries(REACH)) {
  test(`${rel}: told and versions match the engine's reach`, () => {
    const rec = load(rel);
    const s = buildSummary(rec, rec.header.lang);
    const [informed, correct, incomplete, wrong] = want.final;
    assert.equal(s.fact, 'f1');
    assert.deepEqual([s.told, s.correct, s.incomplete, s.wrong], [informed, correct, incomplete, wrong]);
    assert.equal(s.changed, s.wrong);
    assert.equal(s.ended, true);
    assert.equal(s.tick, rec.events[rec.events.length - 1].tick);
  });

  test(`${rel}: halfway (until), told and correct match reach.timeline`, () => {
    const rec = load(rel);
    for (const [tick, inf, corr] of want.points) {
      const s = buildSummary(rec, rec.header.lang, { until: countUntil(rec.events, tick) });
      assert.deepEqual([tick, s.told, s.correct], [tick, inf, corr]);
      assert.equal(s.ended, false);
    }
  });
}

// From `scripts/rumor.sh metrics <log>`: attendance {right, other_time,
// other_place}, the same figures as ENGINE in viewer/js/rumor/rumor.test.js.
const ATTENDANCE = {
  [FIXTURE]: [2, 2, 0],
  'runs/samples/party-100-es-s2.jsonl': [33, 2, 4],
  'runs/samples/party-25-en-s4.jsonl': [8, 3, 2],
  'runs/samples/telephone-20-en-s5.jsonl': [0, 0, 0],
  'runs/samples/telephone-20-es-s5.jsonl': [0, 0, 0],
};

for (const [rel, [right, otherTime, otherPlace]] of Object.entries(ATTENDANCE)) {
  test(`${rel}: attendance matches the engine's`, () => {
    const rec = load(rel);
    const s = buildSummary(rec, rec.header.lang);
    assert.deepEqual(s.attendance, { right, other_time: otherTime, other_place: otherPlace, arrived: right + otherTime + otherPlace });
    // Every told neighbor has its version.
    assert.equal(Object.keys(s.versionOf).length, s.told);
  });
}

test('attendance grows with the position and is 0 before the inject', () => {
  const rec = load('runs/samples/party-100-es-s2.jsonl');
  assert.deepEqual(buildSummary(rec, 'es', { until: 0 }).attendance, { right: 0, other_time: 0, other_place: 0, arrived: 0 });
  let prev = -1;
  for (const tick of [1000, 1200, 1260, 1300, 1440]) {
    const a = buildSummary(rec, 'es', { until: countUntil(rec.events, tick) }).attendance;
    assert.ok(a.arrived >= prev, `${tick}`);
    prev = a.arrived;
  }
  assert.equal(prev, 39);
});

test('before the inject: no fact and every figure at 0', () => {
  const rec = load(FIXTURE);
  const s = buildSummary(rec, 'es', { until: 0 });
  assert.equal(s.fact, null);
  assert.deepEqual([s.told, s.correct, s.incomplete, s.wrong, s.changed, s.changes.length], [0, 0, 0, 0, 0, 0]);
  assert.equal(s.lines.length, 2);
});

test('fixture: one change, Luis turn 20 on `when`, 44 → 46 by guess, believed by Ana and Elena', () => {
  const rec = load(FIXTURE);
  const s = buildSummary(rec, 'es');
  assert.deepEqual(s.changes, [
    {
      who: 'n002',
      turn: 20,
      tick: 1228,
      slot: 'when',
      from: 44,
      to: 46,
      cause: 'guess',
      affected: ['n003', 'n005'],
    },
  ]);
  assert.deepEqual(s.unexplained, []);
});

test('no template has a digit', () => {
  const walk = (v, path) => {
    if (typeof v === 'string') assert.doesNotMatch(v, /\d/, path);
    else for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
  };
  walk(STRINGS.es, 'es');
  walk(STRINGS.en, 'en');
  assert.deepEqual(Object.keys(STRINGS.es).sort(), Object.keys(STRINGS.en).sort());
});

test('fixture lines in es and en name Luis and both hours', () => {
  const rec = load(FIXTURE);
  const from = slotValueText('when', 44, rec.header);
  const to = slotValueText('when', 46, rec.header);
  assert.equal(from, '22:00');
  assert.equal(to, '23:00');
  for (const lang of ['es', 'en']) {
    const lines = buildSummary(rec, lang).lines;
    const line = lines.find((l) => l.includes('Luis'));
    assert.ok(line, `${lang}: no line with Luis`);
    assert.ok(line.includes(from) && line.includes(to), `${lang}: ${line}`);
    assert.ok(line.indexOf(from) < line.indexOf(to), `${lang}: ${line}`);
  }
});

test('the title says "up to" until the end', () => {
  const rec = load(FIXTURE);
  const s = buildSummary(rec, 'es', { until: countUntil(rec.events, 1230) });
  // The last event counted is at tick 1229.
  assert.equal(s.lines[0], 'Resumen del día, hasta las 20:29');
  assert.equal(buildSummary(rec, 'en').lines[0], 'Summary of the day');
});

for (const rel of SAMPLES) {
  test(`${rel}: every change has believers, and no one is counted twice for a slot`, () => {
    const rec = load(rel);
    const s = buildSummary(rec, rec.header.lang);
    const seen = new Set();
    for (const c of s.changes) {
      assert.ok(c.affected.length > 0);
      for (const who of c.affected) {
        const k = `${who}|${c.slot}`;
        assert.ok(!seen.has(k), `${k} twice`);
        seen.add(k);
      }
    }
    for (const u of s.unexplained) assert.ok(!seen.has(`${u.who}|${u.slot}`));
    for (let i = 1; i < s.changes.length; i++) {
      const [a, b] = [s.changes[i - 1], s.changes[i]];
      assert.ok(a.affected.length > b.affected.length || (a.affected.length === b.affected.length && a.tick <= b.tick));
    }
  });
}

test('ranking, before the inject: both lists empty', () => {
  const rec = load(FIXTURE);
  assert.deepEqual(buildSummary(rec, 'es', { until: 0 }).ranking, { tellers: [], distorters: [] });
});

test('ranking, fixture: Luis is the only distorter, one change believed by two', () => {
  const rec = load(FIXTURE);
  const r = buildSummary(rec, 'es').ranking;
  assert.deepEqual(r.distorters, [{ who: 'n002', changes: 1, affected: 2 }]);
  assert.ok(r.tellers.some((x) => x.who === 'n002' && x.tells > 0));
});

for (const rel of [FIXTURE, ...SAMPLES]) {
  test(`${rel}: the ranking adds up to the tells, the informed and the changes`, () => {
    const rec = load(rel);
    const s = buildSummary(rec, rec.header.lang);
    const h = createHistory();
    h.ingest(rec.events);
    const n = rec.events.length;
    const { tellers, distorters } = s.ranking;
    const sum = (list, k) => list.reduce((a, x) => a + x[k], 0);

    assert.equal(sum(tellers, 'tells'), h.tellsBefore(s.fact, n).length);
    const informs = rec.header.neighbors.map((x) => h.informed(x.id, s.fact, n)).filter(Boolean);
    assert.equal(sum(tellers, 'firsts'), informs.filter((x) => x.from !== null).length);
    assert.equal(sum(distorters, 'changes'), s.changes.length);
    for (const d of distorters) {
      const people = new Set(s.changes.filter((c) => c.who === d.who).flatMap((c) => c.affected));
      assert.equal(d.affected, people.size);
    }

    assert.equal(new Set(tellers.map((x) => x.who)).size, tellers.length);
    for (let i = 1; i < tellers.length; i++) {
      const [a, b] = [tellers[i - 1], tellers[i]];
      assert.ok(a.tells > b.tells || (a.tells === b.tells && a.firsts >= b.firsts));
    }
    for (let i = 1; i < distorters.length; i++) {
      const [a, b] = [distorters[i - 1], distorters[i]];
      assert.ok(a.affected > b.affected || (a.affected === b.affected && a.changes >= b.changes));
    }
  });
}

/**
 * The fixture with a second rumor dropped at 21:30 (tick 1290): a lottery
 * prize of 1000 euros told by Inma (n007) to Carmen (n001) as 2000, by guess.
 */
function twoRumors() {
  const { header, events } = load(FIXTURE);
  const t = 1290;
  const slots = { who: 'n004', where: 'p02', when: 48, amount: 1000 };
  const mem = (who, slot, value, state, cause, turn) => ({ type: 'memory', tick: t, who, fact: 'f2', slot, state, value, cause, turn });
  const extra = [
    { type: 'inject', tick: t, fact: 'f2', text: null, what: 'lottery', slots, to: ['n007'] },
    ...Object.entries(slots).map(([s, v]) => mem('n007', s, v, 'sure', 'inject', null)),
    { type: 'conv_start', tick: t, conv: 'c90', a: 'n007', b: 'n001', place: 'p02' },
    {
      type: 'turn', tick: t, id: 900, conv: 'c90', n: 1, who: 'n007', to: 'n001', card: 'x', action: 'say', act: 'tell', fact: 'f2',
      claim: { ...slots, amount: 2000, guess: ['amount'] }, reject: null,
      verdict: { who: 'faithful', where: 'faithful', when: 'faithful', amount: 'declared_guess' }, conflicts: [], text: null,
    },
    ...Object.entries(slots).map(([s, v]) => (s === 'amount' ? mem('n001', s, 2000, 'doubt', 'told', 900) : mem('n001', s, v, 'sure', 'told', 900))),
    { type: 'conv_end', tick: t, conv: 'c90', reason: 'bye' },
  ];
  const end = events.findIndex((e) => e.type === 'end');
  const at = events.findIndex((e) => e.tick > t);
  const cut = at < 0 || at > end ? end : at;
  return { header, events: [...events.slice(0, cut), ...extra, ...events.slice(cut)] };
}

test('two rumors: without `fact` the first is measured, as before, and the title names it', () => {
  const rec = twoRumors();
  const s = buildSummary(rec, 'es');
  const one = buildSummary(load(FIXTURE), 'es');
  assert.equal(s.fact, 'f1');
  assert.deepEqual([s.told, s.correct, s.incomplete, s.wrong], [one.told, one.correct, one.incomplete, one.wrong]);
  assert.deepEqual(s.changes, one.changes);
  assert.equal(s.lines[0], 'Resumen del día · rumor 1 de 2: fiesta');
  // Before the second inject there is only one rumor: the title as always.
  const before = buildSummary(rec, 'es', { until: countUntil(rec.events, 1289) });
  assert.match(before.lines[0], /^Resumen del día, hasta las \d\d:\d\d$/);
});

test('two rumors: `fact` measures the second one and says so in the title', () => {
  const rec = twoRumors();
  const s = buildSummary(rec, 'es', { fact: 'f2' });
  assert.equal(s.fact, 'f2');
  assert.equal(s.what, 'lottery');
  assert.deepEqual(s.original, { who: 'n004', where: 'p02', when: 48, amount: 1000 });
  assert.deepEqual([s.told, s.correct, s.incomplete, s.wrong, s.changed], [2, 1, 0, 1, 1]);
  assert.deepEqual(s.changes, [
    { who: 'n007', turn: 900, tick: 1290, slot: 'amount', from: 1000, to: 2000, cause: 'guess', affected: ['n001'] },
  ]);
  assert.deepEqual(s.ranking.distorters, [{ who: 'n007', changes: 1, affected: 1 }]);
  assert.equal(s.lines[0], 'Resumen del día · rumor 2 de 2: premio de lotería');
  assert.equal(buildSummary(rec, 'en', { fact: 'f2' }).lines[0], 'Summary of the day · rumor 2 of 2: lottery prize');
  // Asked before it came in: no rumor yet.
  const early = buildSummary(rec, 'es', { fact: 'f2', until: countUntil(rec.events, 1289) });
  assert.equal(early.fact, null);
  assert.equal(early.lines[1], STRINGS.es.noFact);
  // An unknown id measures nothing either.
  assert.equal(buildSummary(rec, 'es', { fact: 'f9' }).fact, null);
});

/** A 2D context that only records the texts drawn. */
function fakeCtx() {
  const texts = [];
  const noop = () => {};
  const grad = { addColorStop: noop };
  return new Proxy(
    { texts, measureText: (s) => ({ width: String(s).length * 9 }), fillText: (s) => texts.push(String(s)), createLinearGradient: () => grad },
    {
      get: (o, k) => (k in o ? o[k] : noop),
      set: (o, k, v) => {
        o[k] = v;
        return true;
      },
    },
  );
}

for (const rel of [FIXTURE, ...SAMPLES]) {
  test(`${rel}: the final card and its image carry the figures of the summary`, () => {
    const rec = load(rel);
    const s = buildSummary(rec, rec.header.lang);
    const card = cardOf(s, rec.header, rec.header.lang);
    assert.deepEqual(
      card.figs.map((f) => [f.key, f.n]),
      [
        ['told', s.told],
        ['right', s.attendance.right],
        ['changed', s.changed],
      ],
    );
    assert.equal(card.bar.reduce((a, b) => a + b.n, 0), s.total);
    assert.ok(card.tellers.length <= 3 && card.distorters.length <= 2);
    const h = createHistory();
    h.ingest(rec.events);
    const tree = treeAt(h, s.fact, rec.events.length, rec.header.neighbors.map((n) => n.id));
    const ctx = fakeCtx();
    drawCardImage(ctx, card, { tree, nodeColor: () => '#000', portrait: () => null, footer: 'x', url: 'https://example.org/r', titles: { tree: 'T', gossips: 'G', brand: 'B' } });
    for (const f of card.figs) assert.ok(ctx.texts.includes(String(f.n)), `${rel}: ${f.key}`);
    assert.ok(ctx.texts.includes('example.org/r'));
  });
}

test('the final card in the game: «Fin de la partida», no attendance without place and hour, firsts by gender', () => {
  const rec = load(FIXTURE);
  const s = buildSummary(rec, 'es');
  const ended = { ...s, ended: true };
  assert.equal(cardOf(ended, rec.header, 'es', { game: true }).kicker, 'Fin de la partida');
  assert.equal(cardOf(ended, rec.header, 'es').kicker, 'Fin del día');
  const noWhen = { ...s, original: { ...s.original, when: null } };
  assert.deepEqual(cardOf(noWhen, rec.header, 'es').figs.map((f) => f.key), ['told', 'changed']);
  const card = cardOf(s, rec.header, 'es');
  for (const p of card.tellers) {
    assert.doesNotMatch(p.sub, /oy[eó]|\{/);
    if (p.sub) assert.match(p.sub, rec.header.neighbors.find((n) => n.id === p.who).gender === 'f' ? /por ella$/ : /por él$/);
  }
});

test('the final card: the hour of the rumor after the end of the game, instead of «0 llegaron»', () => {
  const rec = load(FIXTURE);
  const s = buildSummary(rec, 'es');
  const late = { ...s, ended: true, tick: 1300, original: { ...s.original, when: 46 }, attendance: { ...s.attendance, right: 0 } };
  const header = { ...rec.header, params: { ...rec.header.params, end_tick: 1300 } };
  const fig = cardOf(late, header, 'es').figs.find((f) => f.key === 'right');
  assert.deepEqual([fig.n, fig.label], [null, 'La fiesta era a las 23:00, después del final de la partida']);
  // Before the end, or with someone there, the figure as always.
  assert.equal(cardOf({ ...late, original: { ...late.original, when: 40 } }, header, 'es').figs.find((f) => f.key === 'right').n, 0);
  assert.equal(cardOf({ ...late, attendance: { ...late.attendance, right: 2 } }, header, 'es').figs.find((f) => f.key === 'right').n, 2);
});

test('the final card: ended with «Terminar ya» before the hour of the rumor', () => {
  const rec = load(FIXTURE);
  const s = buildSummary(rec, 'es');
  const header = { ...rec.header, params: { ...rec.header.params, end_tick: 1440 } };
  // Ended at 21:30 (tick 1290), the party was at 23:00 (slot 46), planned end 24:00.
  const stopped = { ...s, ended: true, tick: 1290, original: { ...s.original, when: 46 }, attendance: { ...s.attendance, right: 0 } };
  const fig = cardOf(stopped, header, 'es').figs.find((f) => f.key === 'right');
  assert.deepEqual([fig.n, fig.label], [null, 'Terminaste la partida a las 21:30, antes de la fiesta (23:00)']);
});
