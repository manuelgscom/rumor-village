import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIXTURE, loadLog, SAMPLES } from '../core/testing.js';
import { START_LEAD } from './constants.js';
import { pick } from '../core/lang.js';
import { STRINGS } from './strings.js';
import { marksNear, marksOf, markText, preparingRange, rangeOf, startTick, stepMark, tickAtX, xOfTick } from './timeline.js';

test('marks of the hand-written log', () => {
  const { events } = loadLog(FIXTURE);
  const marks = marksOf(events, 'f1');
  const brief = marks.map((m) => [m.tick, m.kind, m.slot ?? m.fact ?? m.ok, m.who ?? null]);
  assert.deepEqual(brief, [
    [1210, 'inject', 'f1', null],
    [1225, 'forget', 'when', 'n002'],
    [1228, 'change', 'when', 'n003'],
    [1320, 'arrive', true, ['n001', 'n007']],
    [1380, 'arrive', false, ['n003', 'n005']],
  ]);
  // Forgetting is not distorting: Luis forgets the hour, then tells Ana a guess.
  assert.deepEqual(
    { from: marks[2].from, cause: marks[2].cause, value: marks[2].value, original: marks[2].original, state: marks[2].state },
    { from: 'n002', cause: 'told', value: 46, original: 44, state: 'doubt' },
  );
  // Another fact: only the injects.
  assert.deepEqual(
    marksOf(events, 'f9').map((m) => m.kind),
    ['inject'],
  );
});

test('range: end_tick, or the end event when the run ended sooner', () => {
  const hand = loadLog(FIXTURE);
  assert.deepEqual(rangeOf(hand.header, hand.events), { start: 1200, end: 1440, ended: true });
  const party = loadLog(SAMPLES[0]);
  assert.deepEqual(rangeOf(party.header, party.events), { start: 420, end: 1440, ended: true });
  const tel = loadLog(SAMPLES[2]);
  assert.equal(tel.header.params.end_tick, 3840);
  assert.deepEqual(rangeOf(tel.header, tel.events), { start: tel.header.start_tick, end: 1280, ended: true });
  // Live, before the end: the planned end, or later events if any.
  const some = party.events.slice(0, 100);
  assert.deepEqual(rangeOf(party.header, some), { start: 420, end: 1440, ended: false });
  assert.deepEqual(rangeOf(party.header, []), { start: 420, end: 1440, ended: false });
  assert.equal(rangeOf({ start_tick: 0, params: {} }, [{ tick: 50, type: 'move' }]).end, 50);
});

test('a doubt about the right value is neither distorted nor forgotten', () => {
  const events = [
    { type: 'inject', tick: 1, fact: 'f', what: 'party', slots: { who: null, where: 'p1', when: 40, amount: null } },
    { type: 'turn', tick: 2, id: 7, who: 'a', to: 'b' },
    { type: 'memory', tick: 2, who: 'b', fact: 'f', slot: 'when', state: 'doubt', value: 40, cause: 'told', turn: 7 },
    { type: 'memory', tick: 3, who: 'b', fact: 'f', slot: 'who', state: 'forgotten', value: null, cause: 'forgot', turn: null },
    { type: 'memory', tick: 4, who: 'c', fact: 'f', slot: 'who', state: 'sure', value: 'x', cause: 'guess', turn: null },
    { type: 'memory', tick: 5, who: 'c', fact: 'f', slot: 'where', state: 'forgotten', value: null, cause: 'forgot', turn: null },
  ];
  const marks = marksOf(events, 'f').map((m) => [m.tick, m.kind, m.slot ?? null, m.from ?? null]);
  // The forgotten «who» was never in the rumor; the invented one is a distortion, with no speaker.
  assert.deepEqual(marks, [
    [1, 'inject', null, null],
    [4, 'change', 'who', null],
    [5, 'forget', 'where', null],
  ]);
});

test('every sample has its inject mark and changes after it', () => {
  for (const rel of SAMPLES) {
    const { events } = loadLog(rel);
    const fact = events.find((e) => e.type === 'inject').fact;
    const marks = marksOf(events, fact);
    assert.equal(marks[0].kind, 'inject', rel);
    for (const kind of ['change', 'forget']) {
      const slots = marks.filter((m) => m.kind === kind).map((m) => m.slot);
      assert.equal(new Set(slots).size, slots.length, `one ${kind} per slot: ${rel}`);
    }
    for (const m of marks.filter((x) => x.kind === 'change')) assert.notEqual(m.value, m.original, rel);
    for (const m of marks) assert.ok(m.tick >= marks[0].tick);
  }
});

test('ticks and pixels', () => {
  const range = { start: 400, end: 1400 };
  assert.equal(xOfTick(900, range, 1000), 500);
  assert.equal(tickAtX(500, range, 1000), 900);
  assert.equal(tickAtX(-50, range, 1000), 400);
  assert.equal(tickAtX(5000, range, 1000), 1400);
  assert.equal(tickAtX(900, range, 1000, 1000), 1000, 'not past the live edge');
  for (let x = 0; x <= 1000; x += 37) assert.ok(Math.abs(xOfTick(tickAtX(x, range, 1000), range, 1000) - x) <= 0.5);
  const marks = [
    { tick: 900, kind: 'inject' },
    { tick: 903, kind: 'change' },
    { tick: 1000, kind: 'arrive' },
  ];
  assert.deepEqual(
    marksNear(marks, xOfTick(902, range, 1000), range, 1000, 4).map((m) => m.tick),
    [903, 900],
  );
});

test('next and previous moment: one tick of marks at a time', () => {
  const { events } = loadLog(FIXTURE);
  const marks = marksOf(events, 'f1');
  const ticks = [...new Set(marks.map((m) => m.tick))];
  // Forward from the start visits every moment once, in order.
  const seen = [];
  for (let pos = 1200, s; (s = stepMark(marks, pos, 1)); pos = s.tick) seen.push(s.tick);
  assert.deepEqual(seen, ticks);
  // Backward from the end visits them again, reversed.
  const back = [];
  for (let pos = 1440, s; (s = stepMark(marks, pos, -1)); pos = s.tick) back.push(s.tick);
  assert.deepEqual(back, [...ticks].reverse());
  // In between ticks; on a mark, «previous» goes further back.
  assert.equal(stepMark(marks, 1224.6, 1).tick, 1225);
  assert.equal(stepMark(marks, 1225, 1).tick, 1228);
  assert.equal(stepMark(marks, 1225.3, -1).tick, 1210);
  assert.equal(stepMark(marks, 1226, -1).tick, 1225);
  assert.equal(stepMark(marks, 1380, 1), null);
  assert.equal(stepMark(marks, 1210, -1), null);
  // Every mark of the moment comes with it; live: nothing past the edge.
  const shared = [{ tick: 5, kind: 'arrive', ok: true, who: ['a'] }, { tick: 5, kind: 'arrive', ok: false, who: ['b'] }, { tick: 9, kind: 'change' }];
  assert.equal(stepMark(shared, 0, 1).marks.length, 2);
  assert.equal(stepMark(shared, 5, 1, 8), null);
  assert.equal(stepMark(shared, 20, -1, 8).tick, 5);
  assert.equal(stepMark([], 0, 1), null);
});

test('a recording without t starts just before the rumor comes in', () => {
  for (const rel of [...SAMPLES, FIXTURE]) {
    const { header, events } = loadLog(rel);
    const inject = events.find((e) => e.type === 'inject');
    const t = startTick(header, events, START_LEAD);
    assert.ok(t >= header.start_tick, rel);
    assert.ok(t <= inject.tick, rel);
    assert.equal(t, Math.max(header.start_tick, inject.tick - 20), rel);
    // The first moment ahead is the rumor coming in (or the start is on it).
    const next = stepMark(marksOf(events, inject.fact), t - 1e-6, 1);
    assert.equal(next.marks[0].kind, 'inject', rel);
    assert.ok(next.tick - t <= 20, rel);
  }
  // No inject: the start of the range.
  assert.equal(startTick({ start_tick: 420 }, [{ tick: 430, type: 'move' }], 20), 420);
  assert.equal(startTick({ start_tick: 420 }, [{ tick: 430, type: 'inject' }], 20), 420);
  assert.equal(startTick({ start_tick: 0 }, [{ tick: 430, type: 'inject' }], 20), 410);
});

test('markText: who told it distorted to whom, apart from forgetting', () => {
  const { header, events } = loadLog(FIXTURE);
  const marks = marksOf(events, 'f1');
  const say = (m, lang = 'es') => markText(m, header, lang, pick(STRINGS, lang));
  const name = (id) => header.neighbors.find((n) => n.id === id).name;
  const forget = marks.find((m) => m.kind === 'forget');
  const change = marks.find((m) => m.kind === 'change');
  assert.equal(say(forget), `${name('n002')} se olvida de la hora: le queda incompleto`);
  assert.equal(say(change), `${name('n002')} se lo contó deformado a ${name('n003')} · cambió la hora: 22:00 → 23:00?`);
  assert.equal(say(change, 'en'), `${name('n002')} told ${name('n003')} a distorted version · changed the time: 22:00 → 23:00?`);
  // No speaker, and a detail the rumor did not have.
  const alone = { ...change, from: null, slot: 'amount', original: null, value: 80, state: 'sure' };
  assert.equal(say(alone), `A ${name('n003')} le llegó deformado · añadió la cifra: 80`);
  assert.match(say(marks[0]), /^Empieza a correr el rumor: /);
  for (const m of marks) assert.doesNotMatch(say(m), /\{|undefined|null/);
});

test('preparingRange: one day, cut at the until of the draft', () => {
  const tel = { start: 420, end: 3840, ended: false };
  assert.deepEqual(preparingRange(tel, null), { start: 420, end: 1440, ended: false });
  assert.deepEqual(preparingRange({ start: 420, end: 1440, ended: false }, '14:00'), { start: 420, end: 840, ended: false });
  assert.equal(preparingRange({ start: 420, end: 1440, ended: false }, 'nope').end, 1440);
  assert.equal(preparingRange({ start: 420, end: 1440, ended: false }, '06:00').end, 421);
});
