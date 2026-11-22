// Tests of the common measures (package D of phase 9) on the samples, the
// hand-written log (viewer/fixtures/README.md) and tiny hand-made logs.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FIXTURE, loadLog, SAMPLES } from '../../core/testing.js';
import { buildSummary } from '../../summary/build.js';
import {
  arrivalOrder,
  attendOk,
  gameScore,
  halfTick,
  informedAt,
  informedEnd,
  keptQuiet,
  lastOfRow,
  lastWhenShift,
  noGoodHour,
  telephonePoints,
  modeOf,
  neighborId,
  priestOf,
  subjectTick,
  tickOfTime,
  toldDirectly,
  topTellers,
} from './index.js';
import { chainLog, end, header, inject, injected, mem, tell } from './testlogs.js';

// From `scripts/rumor.sh metrics <log>` (engine/src/metrics), run on the logs
// as they are in the repo (phase 9, package D):
//   informed   reach.informed at the end
//   right      attendance.right
//   points     [tick, informed] from reach.timeline (the state at the end of tick T),
//              the two around the half of the village
// half, priest and its tick were read from the logs and agree with the points.
const ENGINE = {
  'runs/samples/party-100-es-s2.jsonl': {
    informed: 50,
    right: 33,
    points: [[1200, 49], [1230, 50], [600, 8], [900, 23]],
    half: 1203,
    priest: ['n008', 1052],
  },
  'runs/samples/party-25-en-s4.jsonl': {
    informed: 21,
    right: 8,
    points: [[690, 12], [720, 13], [600, 9], [1140, 21]],
    half: 700,
    priest: ['n018', 684],
  },
  'runs/samples/telephone-20-en-s5.jsonl': {
    informed: 20,
    right: 0,
    points: [[960, 9], [990, 10], [1260, 19], [1280, 20]],
    half: 982,
    priest: ['n014', 1074],
  },
  'runs/samples/telephone-20-es-s5.jsonl': {
    informed: 20,
    right: 0,
    points: [[960, 9], [990, 10], [1260, 19], [1280, 20]],
    half: 982,
    priest: ['n014', 1074],
  },
  [FIXTURE]: {
    informed: 5,
    right: 2,
    points: [[1200, 0], [1230, 4], [1260, 5]],
    half: 1228,
    priest: [null, null],
  },
};

test('measures: the samples and the fixture agree with the engine metrics', () => {
  for (const rel of [...SAMPLES, FIXTURE]) {
    const log = loadLog(rel);
    const want = ENGINE[rel];
    assert.equal(informedEnd(log).size, want.informed, rel);
    assert.equal(informedEnd(log, 'f1').size, want.informed, rel);
    for (const [tick, n] of want.points) assert.equal(informedAt(log, tick).size, n, `${rel} @${tick}`);
    assert.equal(attendOk(log), want.right, rel);
    assert.equal(attendOk(log, 'f1'), buildSummary(log, 'es').attendance.right, rel);
    const half = halfTick(log);
    assert.equal(half, want.half, rel);
    const need = Math.ceil(log.header.neighbors.length / 2);
    assert.ok(informedAt(log, half - 1, 'f1').size < need && informedAt(log, half, 'f1').size >= need, rel);
    const [priest, tick] = want.priest;
    assert.equal(priestOf(log.header), priest, rel);
    if (priest) assert.equal(subjectTick(log, priest), tick, rel);
    assert.equal(toldDirectly(log, 'n001'), true, rel);
    assert.equal(toldDirectly(log, 'n002'), false, rel);
    const order = arrivalOrder(log);
    assert.equal(order.length, want.informed, rel);
    assert.equal(order[0].who, 'n001', rel);
    for (let k = 1; k < order.length; k++) assert.ok(order[k - 1].tick <= order[k].tick, rel);
    assert.equal(gameScore(null, log).value, want.informed, rel);
  }
});

test('measures: the fixture story', () => {
  const log = loadLog(FIXTURE);
  // Carmen (inject 1210), Luis (10, 1213), Inma (15, 1217), Ana (20, 1228), Elena (25, 1236).
  assert.deepEqual(
    arrivalOrder(log).map((x) => [x.who, x.tick, x.from]),
    [
      ['n001', 1210, null],
      ['n002', 1213, 'n001'],
      ['n007', 1217, 'n001'],
      ['n003', 1228, 'n002'],
      ['n005', 1236, 'n003'],
    ],
  );
  assert.equal(subjectTick(log, 'n005'), 1236);
  assert.equal(subjectTick(log, 'n006'), null); // Manuel never knows
  assert.equal(subjectTick(log, 'n005', 'f2'), null);
  assert.equal(lastOfRow(log.header), 'n007');
  assert.equal(lastWhenShift(log), 0); // Inma holds 22:00, the original
  assert.equal(modeOf(log.header), 'ai');
  assert.equal(modeOf(loadLog(SAMPLES[0]).header), 'rules');
});

test('measures: the telephone samples score the hour of the furthest neighbor holding one', () => {
  for (const rel of SAMPLES.filter((s) => s.includes('telephone'))) {
    const log = loadLog(rel);
    assert.equal(lastOfRow(log.header), 'n020');
    assert.equal(lastWhenShift(log), 3, rel); // n020 never hears it; the furthest with an hour holds it 3 half hours off
    assert.equal(noGoodHour(log), 13, rel);
    assert.equal(telephonePoints(log), 16, rel);
  }
});

test('measures: hand-made chain', () => {
  const log = chainLog();
  assert.deepEqual([...informedAt(log, 499)].sort(), ['n001']);
  assert.deepEqual([...informedAt(log, 500)].sort(), ['n001', 'n002']);
  assert.equal(informedEnd(log).size, 3);
  assert.equal(halfTick(log), 500); // 2 of 4
  assert.equal(attendOk(log), 2); // n001 (first arrive) and n002; n003 elsewhere
  assert.equal(attendOk(chainLog({ change: true })), 2); // n003 at the square, but at 22:00
  assert.equal(priestOf(log.header), 'n004');
  assert.equal(subjectTick(log, 'n004'), null);
  assert.equal(subjectTick(log, 'n003'), 520);
  assert.equal(lastWhenShift(log), 0); // n004 never hears it; n003, the furthest with an hour, holds the original
  assert.equal(informedEnd({ header: log.header, events: [] }).size, 0);
  assert.equal(halfTick({ header: log.header, events: [] }), null);
  assert.equal(attendOk({ header: log.header, events: [] }), 0);
});

test('measures: a rejected tell does not inform, an inject by place counts as told directly', () => {
  const h = header(3, { priest: 'n003' });
  const [turn] = tell(500, 1, 'n001', 'n002', 'f1', { when: 42 });
  const rejected = { ...turn, reject: 'malformed', action: 'none', act: null, fact: null, claim: null, verdict: null };
  const log = { header: h, events: [inject(480, 'f1', ['n001', 'n003'], { when: 42 }), rejected, end(600)] };
  assert.deepEqual([...informedEnd(log)].sort(), ['n001', 'n003']);
  assert.equal(toldDirectly(log, 'n003'), true);
  assert.equal(subjectTick(log, 'n003'), 480);
});

test('measures: telephone shift in half hours, null when the hour is forgotten', () => {
  const h = header(3);
  const base = [
    inject(600, 'f1', ['n001'], { when: 42 }),
    ...injected(600, 'n001', 'f1', { when: 42 }),
    ...tell(620, 1, 'n001', 'n002', 'f1', { when: 43 }, { guess: ['when'] }),
    ...tell(640, 2, 'n002', 'n003', 'f1', { when: 45 }, { guess: ['when'] }),
  ];
  assert.equal(lastWhenShift({ header: h, events: base }), 3);
  const forgot = [...base, mem(700, 'n003', 'f1', 'when', 'forgotten', null, 'forgot')];
  assert.equal(lastWhenShift({ header: h, events: forgot }), 3); // n003 forgot it later: it reached n003 as 45
  const earlier = [...base, ...tell(700, 3, 'n002', 'n003', 'f1', { when: 40 })];
  assert.equal(lastWhenShift({ header: h, events: earlier }), 2);
});

test('measures: telephone points, neighbors without the right hour plus the shift', () => {
  const h = header(4);
  const base = [
    inject(600, 'f1', ['n001'], { when: 42 }),
    ...injected(600, 'n001', 'f1', { when: 42 }),
    ...tell(620, 1, 'n001', 'n002', 'f1', { when: 42 }), // the right hour
    ...tell(640, 2, 'n002', 'n003', 'f1', { when: 45 }, { guess: ['when'] }), // changed
    ...tell(660, 3, 'n003', 'n004', 'f1', {}), // no hour
  ];
  const log = { header: h, events: base };
  assert.equal(noGoodHour(log), 2); // n003 and n004
  assert.equal(telephonePoints(log), 5); // + n003 holds it 3 half hours off
  // Held the right hour and forgot it later: still had it.
  const forgot = [...base, mem(700, 'n002', 'f1', 'when', 'forgotten', null, 'forgot')];
  assert.equal(noGoodHour({ header: h, events: forgot }), 2);
  // Nobody else heard it: 0 points, not «not scored».
  assert.equal(telephonePoints({ header: h, events: base.slice(0, 1 + injected(600, 'n001', 'f1', { when: 42 }).length) }), 0);
  // No original hour: not scored.
  assert.equal(telephonePoints({ header: h, events: [inject(600, 'f1', ['n001'], {})] }), null);
});

test('measures: times and names', () => {
  assert.equal(tickOfTime('hoy 21:00'), 1260);
  assert.equal(tickOfTime('today 9:30'), 570);
  assert.equal(tickOfTime('mañana 10:00'), 2040);
  assert.equal(tickOfTime('tomorrow 00:30'), 1470);
  assert.equal(tickOfTime('13:00'), 780);
  assert.equal(tickOfTime(615), 615);
  assert.equal(tickOfTime('ayer 10:00'), null);
  assert.equal(tickOfTime('25:00'), null);
  assert.equal(tickOfTime(null), null);
  const h = loadLog(FIXTURE).header;
  assert.equal(neighborId(h, 'n003'), 'n003');
  assert.equal(neighborId(h, 'elena'), 'n005');
  assert.equal(neighborId(h, 'Nadie'), null);
  assert.equal(neighborId(h, null), null);
});

test('topTellers: the order of the summary\'s «Quién lo contó más», with where they told it most', () => {
  for (const rel of [...SAMPLES, FIXTURE]) {
    const log = loadLog(rel);
    const ranking = buildSummary(log, 'es').ranking.tellers;
    const all = topTellers(log, null, 1000);
    assert.deepEqual(all.map(({ who, tells, firsts }) => ({ who, tells, firsts })), ranking, rel);
    assert.deepEqual(topTellers(log), all.slice(0, 3), rel);
    const places = new Set(log.header.places.map((p) => p.id));
    for (const m of all) assert.ok(m.place === null || places.has(m.place), rel);
  }
  // The fixture (viewer/fixtures/README.md): Carmen tells it in the bar (c3, c4), Luis at the square (c5).
  const top = topTellers(loadLog(FIXTURE));
  assert.equal(top[0].who, 'n001');
  assert.equal(top[0].place, 'p02');
  assert.equal(top.find((m) => m.who === 'n002')?.place, 'p01');
});

test('topTellers: tells by place, the first place wins a tie, rejected tells do not count', () => {
  const h = header(4);
  const conv = (tick, id, place) => ({ type: 'conv_start', tick, conv: id, a: 'n001', b: 'n002', place });
  const at = (events, c) => events.map((e) => (e.type === 'turn' ? { ...e, conv: c } : e));
  const [rejected] = tell(560, 9, 'n003', 'n004', 'f1', { when: 42 });
  const log = {
    header: h,
    events: [
      inject(480, 'f1', ['n001'], { when: 42 }),
      conv(490, 'a', 'p02'),
      ...at(tell(500, 1, 'n001', 'n002', 'f1', { when: 42 }), 'a'),
      conv(505, 'b', 'p01'),
      ...at(tell(510, 2, 'n001', 'n003', 'f1', { when: 42 }), 'b'),
      ...at(tell(520, 3, 'n002', 'n001', 'f1', { when: 42 }), 'a'), // to someone who knew: a tell, no first
      { ...rejected, conv: 'b', reject: 'malformed', action: 'none' },
      end(600),
    ],
  };
  assert.deepEqual(topTellers(log), [
    { who: 'n001', tells: 2, firsts: 2, place: 'p02' },
    { who: 'n002', tells: 1, firsts: 0, place: 'p02' },
  ]);
  assert.deepEqual(topTellers(log, null, 1), [{ who: 'n001', tells: 2, firsts: 2, place: 'p02' }]);
  assert.deepEqual(topTellers({ header: h, events: [] }), []);
});

test('keptQuiet: who knew it and told nobody, in order of arrival', () => {
  // chainLog: n001 ─► n002 ─► n003; n003 tells nobody, n004 never hears it.
  assert.deepEqual(keptQuiet(chainLog()), [{ who: 'n003', tick: 520 }]);
  // The player's recipient who never tells it counts too.
  const h = header(3);
  const log = { header: h, events: [inject(480, 'f1', ['n001', 'n002'], { when: 42 }), ...tell(500, 1, 'n001', 'n003', 'f1', { when: 42 }), end(600)] };
  assert.deepEqual(keptQuiet(log), [{ who: 'n002', tick: 480 }, { who: 'n003', tick: 500 }]);
  assert.deepEqual(keptQuiet(log, 'f9'), []);
  assert.deepEqual(keptQuiet({ header: h, events: [] }), []);
  // On the samples: never a teller, always informed.
  for (const rel of SAMPLES) {
    const l = loadLog(rel);
    const tellers = new Set(topTellers(l, null, 1000).map((m) => m.who));
    const quiet = keptQuiet(l);
    assert.ok(quiet.length > 0, rel);
    assert.deepEqual(quiet.map((x) => x.who), arrivalOrder(l).map((x) => x.who).filter((w) => !tellers.has(w)), rel);
  }
});
