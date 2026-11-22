// Tests of the bet, «¿Quién fue?», the race and the challenge code (package D
// of phase 9).

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { readRepoFile, FIXTURE, loadLog, SAMPLES } from '../../core/testing.js';
import {
  CodeError,
  comparable,
  decodeCode,
  encodeCode,
  GAME_VERSION,
  guessResult,
  raceFactsByDraft,
  raceResult,
  scoreBets,
  whoDidIt,
} from './index.js';
import { raceFacts } from '../endview.js';
import { chainLog, end, header, inject, mem, tell } from './testlogs.js';

test('bets: no attendance without a place and an hour (a 0 no longer scores 10)', () => {
  const h = header(3);
  const log = (slots) => ({ header: h, events: [inject(420, 'f1', ['n001'], slots), end(600)] });
  for (const slots of [{}, { where: 'p01' }, { when: 1260 }]) {
    const r = scoreBets({ attend: 0, half: null, last: null }, log(slots));
    assert.equal(r.attend, null, JSON.stringify(slots));
    assert.equal(r.total, 0);
  }
  const both = scoreBets({ attend: 0, half: null, last: null }, log({ where: 'p01', when: 1260 }));
  assert.deepEqual(both.attend, { bet: 0, actual: 0, points: 10 });
});

test('bets: closeness points on the fixture', () => {
  const log = loadLog(FIXTURE);
  // attend 2 · half 1228 (20:28) · arrival order Carmen, Luis, Inma, Ana, Elena.
  const r = scoreBets({ attend: 3, half: 'hoy 21:00', last: 'n003' }, log);
  assert.deepEqual(r.attend, { bet: 3, actual: 2, points: 8 });
  assert.deepEqual(r.half, { bet: 'hoy 21:00', actual: 1228, points: 8 }); // 32 min → 10 − 2
  assert.deepEqual(r.last, { bet: 'n003', actual: 'n005', points: 8 });
  assert.equal(r.total, 24);
  const exact = scoreBets({ attend: 2, half: 'today 20:30', last: 'Elena' }, log);
  assert.deepEqual([exact.attend.points, exact.half.points, exact.last.points, exact.total], [10, 10, 10, 30]);
  const far = scoreBets({ attend: 25, half: 'mañana 09:00', last: 'n001' }, log);
  assert.deepEqual([far.attend.points, far.half.points, far.last.points], [0, 0, 2]);
  // A neighbor who never knew it, and a tick for the hour.
  const never = scoreBets({ attend: null, half: 1228 + 44, last: 'n004' }, log);
  assert.equal(never.attend, null);
  assert.equal(never.half.points, 8); // 44 min → ⌊44/15⌋ = 2
  assert.equal(never.last.points, 0);
  assert.equal(never.total, 8);
});

test('bets: empty bets, and a village where half never knows', () => {
  const log = loadLog(FIXTURE);
  assert.deepEqual(scoreBets(null, log), { attend: null, half: null, last: null, total: 0 });
  assert.deepEqual(scoreBets({ attend: null, half: null, last: null }, log).total, 0);
  const small = { header: header(10), events: [inject(480, 'f1', ['n001'], { when: 42 }), end(600)] };
  const r = scoreBets({ attend: 0, half: 'hoy 08:00', last: 'n001' }, small);
  // The rumor has an hour but no place: the attendance is not scored (phase 9-4).
  assert.equal(r.attend, null);
  assert.deepEqual(r.half, { bet: 'hoy 08:00', actual: null, points: 0 });
  assert.deepEqual(r.last, { bet: 'n001', actual: 'n001', points: 10 });
  assert.equal(r.total, 10);
  const none = { header: header(3), events: [end(600)] };
  assert.deepEqual(scoreBets({ last: 'n001' }, none).last, { bet: 'n001', actual: null, points: 0 });
});

test('whoDidIt: the fixture culprit is Luis, turn 20 (viewer/fixtures/README.md)', () => {
  const r = whoDidIt(loadLog(FIXTURE));
  assert.deepEqual(r.culprit, { who: 'n002', tick: 1228, slot: 'when', from: 44, to: 46, turn: 20 });
  assert.equal(r.honest, false);
  assert.deepEqual(r.origin, { who: 'n001', tick: 1210 });
  assert.deepEqual(
    r.hops.map((h) => [h.from, h.to, h.turn, h.culprit, h.changed.includes('when')]),
    [
      ['n001', 'n002', 10, false, false],
      ['n002', 'n003', 20, true, true],
    ],
  );
  assert.equal(guessResult('n002', r), true);
  assert.equal(guessResult('n003', r), false);
  assert.equal(guessResult(null, r), false);
});

test('whoDidIt: a hand-made change and an honest village', () => {
  const changed = whoDidIt(chainLog({ change: true }));
  assert.deepEqual(changed.culprit, { who: 'n002', tick: 520, slot: 'when', from: 42, to: 44, turn: 2 });
  assert.equal(changed.honest, false);
  assert.deepEqual(
    changed.hops.map((h) => [h.from, h.to, h.culprit]),
    [
      ['n001', 'n002', false],
      ['n002', 'n003', true],
    ],
  );

  const honest = whoDidIt(chainLog());
  assert.equal(honest.culprit, null);
  assert.equal(honest.honest, true);
  assert.deepEqual(
    honest.hops.map((h) => [h.from, h.to, h.changed.length, h.culprit]),
    [
      ['n001', 'n002', 0, false],
      ['n002', 'n003', 0, false],
    ],
  );
  assert.equal(guessResult(null, honest), true);
  assert.equal(guessResult('n002', honest), false);

  assert.deepEqual(whoDidIt({ header: header(3), events: [] }), { culprit: null, honest: true, origin: null, hops: [], unexplained: [] });
});

test('whoDidIt: each hop says what changed, before and after', () => {
  const changed = whoDidIt(chainLog({ change: true }));
  assert.deepEqual(changed.hops[0].details, []);
  assert.deepEqual(changed.hops[1].details, [{ slot: 'when', from: 42, to: 44, cause: 'guess' }]);
  assert.deepEqual(changed.unexplained, []);
  const fixture = whoDidIt(loadLog(FIXTURE));
  const hop = fixture.hops.find((h) => h.culprit);
  const when = hop.details.find((d) => d.slot === 'when');
  assert.deepEqual([when.from, when.to], [44, 46]);
});

test('whoDidIt: a detail filled in by the neighbor itself has no culprit, and «Nadie lo cambió» is right', () => {
  // n002 hears 21:00 (slot 42) from n001, forgets it and fills in 22:00 by itself: no tell changed it.
  const log = chainLog();
  log.events.splice(log.events.length - 1, 0, mem(1000, 'n002', 'f1', 'when', 'forgotten', null, 'forgot'), mem(1010, 'n002', 'f1', 'when', 'doubt', 44, 'guess'));
  const r = whoDidIt(log);
  assert.equal(r.culprit, null);
  assert.equal(r.honest, false);
  assert.deepEqual(r.unexplained, ['n002']);
  assert.equal(guessResult(null, r), true);
  assert.equal(guessResult('n002', r), false);
});

test('whoDidIt: the samples have a culprit, the earliest change of the summary', () => {
  for (const rel of SAMPLES) {
    const r = whoDidIt(loadLog(rel));
    assert.ok(r.culprit, rel);
    assert.equal(r.honest, false, rel);
    assert.ok(r.hops.some((h) => h.culprit), rel);
  }
});

test('race: the leader at the chosen hour', () => {
  const h = header(6);
  const log = {
    header: h,
    events: [
      inject(500, 'f1', ['n001'], { where: 'p01', when: 42 }),
      inject(510, 'f2', ['n002'], { where: 'p02', when: 40 }),
      ...tell(520, 1, 'n001', 'n003', 'f1', { where: 'p01' }),
      ...tell(530, 2, 'n002', 'n004', 'f2', { where: 'p02' }),
      ...tell(600, 3, 'n004', 'n005', 'f2', { where: 'p02' }),
      ...tell(610, 4, 'n001', 'n003', 'f1', { where: 'p01' }), // already knew: no change
      end(700),
    ],
  };
  assert.deepEqual(raceResult({ at: 'today 08:40', pick: 0 }, log), {
    at: 520,
    facts: ['f1', 'f2'],
    counts: [2, 1],
    winner: 0,
    hit: true,
    interrupted: false,
    end: 700,
  });
  const tie = raceResult({ at: 'hoy 09:00', pick: 1 }, log);
  assert.deepEqual([tie.counts, tie.winner, tie.hit], [[2, 2], null, false]);
  const late = raceResult({ at: 650, pick: 0 }, log);
  assert.deepEqual([late.counts, late.winner, late.hit], [[2, 3], 1, false]);
  const one = raceResult({ at: 'hoy 23:00', pick: 0 }, loadLog(FIXTURE));
  assert.deepEqual([one.facts, one.counts, one.winner], [['f1'], [5, 0], null]);
});

// Two rumors entered in the opposite order to the draft: rumor 1 at 11:00,
// rumor 2 at the start (07:00, tick 420). The log has rumor 2's fact first.
function invertedLog() {
  return {
    header: header(8),
    events: [
      { ...inject(420, 'fA', ['n001'], { where: 'p02' }), what: 'wedding' }, // rumor 2
      ...tell(500, 1, 'n001', 'n003', 'fA', { where: 'p02' }),
      ...tell(510, 2, 'n003', 'n004', 'fA', { where: 'p02' }),
      inject(660, 'fB', ['n002'], { where: 'p01' }), // rumor 1, a party
      ...tell(680, 3, 'n002', 'n005', 'fB', { where: 'p01' }),
      end(900),
    ],
  };
}
const INVERTED = [
  { fact: { what: 'party' }, at: 'hoy 11:00' },
  { fact: { what: 'wedding' }, at: 'start' },
];

test('race: the rumors keep the identity of the draft, whatever the hours', () => {
  const log = invertedLog();
  assert.deepEqual(raceFactsByDraft(INVERTED, log), ['fB', 'fA']);
  // At 12:00 rumor 1 (fB) has 2 neighbors, rumor 2 (fA) 3: rumor 2 wins.
  const r = raceResult({ at: 'hoy 12:00', pick: 1 }, log, INVERTED);
  assert.deepEqual([r.facts, r.counts, r.winner, r.hit, r.interrupted], [['fB', 'fA'], [2, 3], 1, true, false]);
  assert.equal(raceResult({ at: 'hoy 12:00', pick: 0 }, log, INVERTED).hit, false);
  // Without the draft, inject order: the old reading, wrong here.
  assert.deepEqual(raceResult({ at: 'hoy 12:00', pick: 1 }, log).facts, ['fA', 'fB']);
  // While playing, before 11:00: only rumor 2 is in.
  const early = { header: log.header, events: log.events.filter((e) => e.tick < 600) };
  assert.deepEqual(raceFactsByDraft(INVERTED, early), [null, 'fA']);
  // Without the header, the first tick stands for the start.
  assert.deepEqual(raceFactsByDraft(INVERTED, { header: null, events: log.events }), ['fB', 'fA']);
});

test('race: the map colours and the legend take rumor 1 from the draft (endview raceFacts)', () => {
  const { events } = invertedLog();
  assert.deepEqual(raceFacts(events, INVERTED), ['fB', 'fA']);
  assert.deepEqual(raceFacts(events.filter((e) => e.tick < 600), INVERTED), []); // rumor 1 not in yet
  assert.deepEqual(raceFacts(events), ['fA', 'fB']); // without the draft: inject order
});

test('race: two rumors of the same type, and an hour equal to the start', () => {
  const h = header(6);
  // Both parties; rumor 1 at 10:00, rumor 2 at 09:00.
  const log = {
    header: h,
    events: [
      inject(540, 'f1', ['n001'], {}),
      inject(600, 'f2', ['n002'], {}),
      ...tell(610, 1, 'n002', 'n003', 'f2', {}),
      end(700),
    ],
  };
  const rumors = [{ at: 'hoy 10:00' }, { at: 'hoy 09:00' }];
  assert.deepEqual(raceFactsByDraft(rumors, log), ['f2', 'f1']);
  const r = raceResult({ at: 'hoy 11:00', pick: 0 }, log, rumors);
  assert.deepEqual([r.counts, r.winner, r.hit], [[2, 1], 0, true]);
  // "hoy 07:00" is the first tick, like 'start': same tick, draft order.
  const same = { header: h, events: [inject(420, 'g1', ['n001'], {}), inject(420, 'g2', ['n002'], {}), end(500)] };
  assert.deepEqual(raceFactsByDraft([{ at: 'hoy 07:00' }, { at: 'start' }], same), ['g1', 'g2']);
  assert.deepEqual(raceFactsByDraft([{ at: 'start' }, { at: null }], same), ['g1', 'g2']);
});

test('race: «Terminar ya» before the hour leaves it interrupted', () => {
  const log = invertedLog();
  log.events = log.events.filter((e) => e.type !== 'end' && e.tick <= 610);
  log.events.push(end(610)); // ended at 10:10, the race was at 14:00
  const r = raceResult({ at: 'hoy 14:00', pick: 1 }, log, INVERTED);
  assert.deepEqual(r, { at: 840, facts: [null, 'fA'], counts: [0, 3], winner: null, hit: false, interrupted: true, end: 610 });
  // Ending right at the hour is not an interruption.
  assert.equal(raceResult({ at: 610, pick: 1 }, log, INVERTED).interrupted, false);
});

test('code: round trip, non-ASCII included', () => {
  const payload = {
    mode: 'rules',
    settings: { type: 'village', neighbors: 25, town: 417, lang: 'es', trait_mix: -1, distortion: 'high', mode: 'rules' },
    rumors: [
      {
        fact: { what: 'boda', who: 'Muñoz', where: 'plaza', when: 'mañana 10:30', amount: 120 },
        text: 'Mañana se casa la señora Muñoz en la iglesia — ¡qué bombazo! 🎉',
        to: { neighbors: ['n003'] },
        at: 'start',
      },
    ],
    challenge: 'fill-the-square',
    bets: { attend: 12, half: 'hoy 15:00', last: 'n017' },
    race: null,
    score: { value: 8, stars: 2, label: 'attend_ok' },
  };
  const code = encodeCode(payload);
  assert.match(code, /^RV1-[A-Za-z0-9_-]+$/);
  const back = decodeCode(code);
  assert.deepEqual(back, { v: 1, game_version: GAME_VERSION, ...payload });
  // The link and stray spaces are fine.
  assert.deepEqual(decodeCode(`  http://127.0.0.1:8080/?play=1&code=${code}\n`), back);
  // Defaults for what is missing.
  const min = decodeCode(encodeCode({ mode: 'ai', settings: {}, rumors: [] }));
  assert.deepEqual(min, { v: 1, game_version: 1, mode: 'ai', settings: {}, rumors: [], challenge: null, bets: null, race: null, score: null });
});

test('code: errors have a code', () => {
  const code = (fn) => {
    try {
      fn();
    } catch (e) {
      assert.ok(e instanceof CodeError);
      return e.code;
    }
    return 'no error';
  };
  const b64 = (obj) => btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assert.equal(code(() => decodeCode('')), 'empty');
  assert.equal(code(() => decodeCode('hello')), 'prefix');
  assert.equal(code(() => decodeCode('RV2-abc')), 'version');
  assert.equal(code(() => decodeCode('RV1-')), 'malformed');
  assert.equal(code(() => decodeCode('RV1-a')), 'malformed');
  assert.equal(code(() => decodeCode(`RV1-${b64('not json')}`.slice(0, -2))), 'malformed');
  assert.equal(code(() => decodeCode(`RV1-${btoa('{"v":1').replace(/=+$/, '')}`)), 'malformed');
  assert.equal(code(() => decodeCode(`RV1-${b64({ v: 2, game_version: 1, mode: 'ai', settings: {}, rumors: [] })}`)), 'version');
  assert.equal(code(() => decodeCode(`RV1-${b64({ v: 1, game_version: 1, mode: 'gpu', settings: {}, rumors: [] })}`)), 'malformed');
  assert.equal(code(() => decodeCode(`RV1-${b64({ v: 1, game_version: 1, mode: 'ai', settings: {}, rumors: {} })}`)), 'malformed');
  assert.equal(code(() => decodeCode(`RV1-${b64([1, 2])}`)), 'malformed');
  // Bad UTF-8 (a lone 0xFF byte).
  assert.equal(code(() => decodeCode(`RV1-${btoa('\xff').replace(/=+$/, '')}`)), 'malformed');
});

test('code: only scores of the same mode and version compare', () => {
  const a = decodeCode(encodeCode({ mode: 'ai', settings: {}, rumors: [] }));
  const b = decodeCode(encodeCode({ mode: 'rules', settings: {}, rumors: [] }));
  const c = decodeCode(encodeCode({ mode: 'ai', game_version: 2, settings: {}, rumors: [] }));
  assert.equal(comparable(a, a), true);
  assert.equal(comparable(a, b), false);
  assert.equal(comparable(a, c), false);
  // Game data: the mode is in the settings.
  assert.equal(comparable(a, { game_version: 1, settings: { mode: 'ai' } }), true);
  assert.equal(comparable({ game_version: 1, settings: { mode: 'rules' } }, a), false);
  assert.equal(comparable(a, null), false);
});

test('code: no node-only APIs (it runs in the browser)', () => {
  const src = readRepoFile('viewer/js/game/score/code.js');
  assert.doesNotMatch(src, /Buffer|require\(|node:/);
});
