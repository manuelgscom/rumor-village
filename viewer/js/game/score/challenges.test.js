// Tests of the challenge files, their stars, the draft skeleton and the draft
// check (package D of phase 9).

import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { test } from 'node:test';

import { FIXTURE, loadLog, readRepoFile, repoPath } from '../../core/testing.js';
import {
  challengeDraft,
  checkChallenge,
  checkDraft,
  gameScore,
  MEASURES,
  nextStar,
  OPEN_FIELDS,
  scoreChallenge,
  starsOf,
} from './index.js';
import { chainLog, end, header, inject, injected, tell } from './testlogs.js';

const files = readdirSync(repoPath('data/challenges')).filter((f) => f.endsWith('.json'));
const challenges = Object.fromEntries(
  files.map((f) => {
    const c = JSON.parse(readRepoFile(`data/challenges/${f}`));
    return [c.id, c];
  }),
);
const C = (id) => challenges[id];

const P25 = 'runs/samples/party-25-en-s4.jsonl';
const P100 = 'runs/samples/party-100-es-s2.jsonl';
const TEL = 'runs/samples/telephone-20-es-s5.jsonl';

test('challenges: every file of data/challenges follows the format', () => {
  assert.ok(files.length >= 7);
  for (const f of files) {
    const c = JSON.parse(readRepoFile(`data/challenges/${f}`));
    assert.deepEqual(checkChallenge(c), [], f);
    assert.equal(`${c.id}.json`, f);
    assert.ok(MEASURES.includes(c.measure), f);
    for (const k of c.open) assert.ok(OPEN_FIELDS.includes(k), `${f}: ${k}`);
  }
  const orders = Object.values(challenges).map((c) => c.order);
  assert.equal(new Set(orders).size, orders.length, 'orders are distinct');
  const six = Object.values(challenges)
    .filter((c) => !c.tutorial)
    .sort((a, b) => a.order - b.order)
    .map((c) => c.id);
  assert.deepEqual(six, [
    'fill-the-square',
    'patient-zero',
    'against-the-clock',
    'broken-telephone',
    'surprise-party',
    'tell-the-priest',
  ]);
  assert.equal(C('tutorial').tutorial, true);
  assert.equal(C('tutorial').order, 0);
});

test('challenges: the format check finds mistakes', () => {
  const bad = { ...C('fill-the-square'), measure: 'fastest', open: ['to', 'color'], extra: 1 };
  const problems = checkChallenge(bad);
  assert.ok(problems.includes('unknown measure fastest'));
  assert.ok(problems.includes('unknown open field color'));
  assert.ok(problems.includes('unknown key extra'));
  assert.ok(checkChallenge({ ...C('against-the-clock'), deadline: null }).includes('half_tick needs a deadline'));
  assert.ok(checkChallenge({ ...C('tell-the-priest'), subject: null }).includes('needs a subject'));
  assert.ok(checkChallenge({ ...C('patient-zero'), stars: { ai: [3, 2, 1], rules: [0, 0, 0] } }).length > 0);
  assert.deepEqual(checkChallenge(null), ['not an object']);
  // The sizes of a village are those of «Vecinos» (prepare.js NEIGHBORS).
  const sized = (neighbors) => checkChallenge({ ...C('fill-the-square'), settings: { ...C('fill-the-square').settings, neighbors } });
  for (const n of [10, 25, 50, 70, 100]) assert.deepEqual(sized(n), [], String(n));
  for (const n of [30, 20, 0]) assert.ok(sized(n).includes('bad settings.neighbors'), String(n));
});

test('challenges: each measure scores the samples', () => {
  // attend_ok: the engine's attendance.right (8); Sin IA thresholds 6/10/16 → 1 star.
  assert.deepEqual(scoreChallenge(C('fill-the-square'), loadLog(P25), 'rules'), {
    measure: 'attend_ok',
    value: 8,
    stars: 1,
    zero: null,
    scored: true,
    next: { stars: 2, gap: 2 },
  });
  assert.equal(scoreChallenge(C('patient-zero'), loadLog(P100)).value, 50);
  // half_tick: half at 700 (11:40), deadline 14:00 (840): 140 minutes of margin.
  assert.equal(scoreChallenge(C('against-the-clock'), loadLog(P25)).value, 140);
  // In party-100 the half comes at 1203 (20:03), after the deadline: not scored.
  const late = scoreChallenge(C('against-the-clock'), loadLog(P100));
  assert.deepEqual([late.value, late.stars, late.scored], [null, 0, false]);
  // telephone_points: 13 neighbors without the right hour + 3 half hours of
  // shift at the furthest holding one (baseline sample, below the Sin IA
  // thresholds: no star).
  const tel = scoreChallenge(C('broken-telephone'), loadLog(TEL));
  assert.deepEqual([tel.value, tel.stars, tel.scored], [16, 0, true]);
  // subject_tick: the priest n018 learns it at 684 (11:24), deadline 14:00 (840);
  // Sin IA thresholds 0/120/175 → 2 stars.
  assert.deepEqual(scoreChallenge(C('tell-the-priest'), loadLog(P25)), {
    measure: 'subject_tick',
    value: 156,
    stars: 2,
    zero: null,
    scored: true,
    next: { stars: 3, gap: 19 },
  });
  // surprise-party: Manuel (n006, the `who`) never knows in the fixture; 2 attend
  // right, one star with the thresholds of its mode.
  const fx = scoreChallenge(C('surprise-party'), loadLog(FIXTURE));
  assert.deepEqual([fx.value, fx.stars, fx.zero], [2, 1, null]);
});

test('challenges: zero stars when the subject is informed or told directly', () => {
  // The priest (n004) dropped the rumor himself.
  const direct = {
    header: header(4, { priest: 'n004' }),
    events: [inject(480, 'f1', ['n001', 'n004'], { when: 42 }), end(600)],
  };
  const s = scoreChallenge(C('tell-the-priest'), direct, 'rules');
  assert.deepEqual([s.value, s.stars, s.zero, s.scored, s.next], [360, 0, 'told_directly', true, null]); // 14:00 − 08:00
  // The guest of honour (n002, the `who`) hears of the party.
  const slots = { who: 'n002', where: 'p01', when: 42 };
  const heard = {
    header: header(3),
    events: [
      inject(480, 'f1', ['n001'], slots),
      ...injected(480, 'n001', 'f1', slots),
      ...tell(500, 1, 'n001', 'n002', 'f1', slots),
      end(600),
    ],
  };
  const p = scoreChallenge(C('surprise-party'), heard, 'rules');
  assert.deepEqual([p.stars, p.zero], [0, 'subject_informed']);
  // Not told: the subject in the chain log (n004) never hears it.
  assert.equal(scoreChallenge(C('tell-the-priest'), chainLog(), 'rules').scored, false);
});

test('challenges: stars by mode and threshold', () => {
  assert.equal(starsOf(null, [0, 0, 0]), 0);
  assert.equal(starsOf(0, [0, 0, 0]), 3);
  assert.equal(starsOf(5, [3, 6, 9]), 1);
  assert.equal(starsOf(6, [3, 6, 9]), 2);
  assert.equal(starsOf(2, [3, 6, 9]), 0);
  const c = { ...C('fill-the-square'), stars: { ai: [1, 2, 8], rules: [10, 20, 30] } };
  const log = loadLog(P25);
  assert.equal(scoreChallenge(c, log, 'ai').stars, 3);
  assert.equal(scoreChallenge(c, log, 'rules').stars, 0);
  assert.equal(scoreChallenge(c, log).stars, 0); // the sample is baseline: rules
  assert.equal(scoreChallenge({ ...c, stars: { ai: [1, 2, 3], rules: [0, 0, 0] } }, loadLog(FIXTURE)).stars, 2); // attend 2 (ai: the model)
  assert.deepEqual(gameScore({ settings: { mode: 'ai' } }, log, c), { value: 8, stars: 3, label: 'attend_ok', zero: null, next: null });
  assert.deepEqual(gameScore(null, log), { value: 21, stars: null, label: 'informed_end' });
});

test('challenges: what is missing for the next star', () => {
  assert.deepEqual(nextStar(8, [6, 9, 12]), { stars: 2, gap: 1 });
  assert.deepEqual(nextStar(0, [3, 6, 9]), { stars: 1, gap: 3 });
  assert.deepEqual(nextStar(5, [5, 5, 9]), { stars: 3, gap: 4 }); // equal thresholds: the first not reached
  assert.equal(nextStar(9, [3, 6, 9]), null); // three stars
  assert.equal(nextStar(null, [3, 6, 9]), null); // not scored
  assert.equal(nextStar(4, null), null); // no stars
  const c = { ...C('fill-the-square'), stars: { ai: [6, 9, 12], rules: [6, 9, 12] } };
  assert.deepEqual(gameScore({ settings: { mode: 'rules' } }, loadLog(P25), c).next, { stars: 2, gap: 1 }); // 8 → ★★ at 9
});

test('challenges: the tutorial has no stars', () => {
  const tut = C('tutorial');
  assert.equal(tut.stars, null);
  assert.deepEqual(checkChallenge(tut), []);
  // Zero neighbors informed: no stars at all (before, [0, 0, 0] gave ★★★).
  const none = { header: header(25), events: [end(600)] };
  for (const mode of ['ai', 'rules']) {
    const s = scoreChallenge(tut, none, mode);
    assert.deepEqual([s.value, s.stars, s.next], [0, null, null], mode);
  }
  assert.deepEqual(gameScore({ settings: { mode: 'rules' } }, loadLog(P25), tut), {
    value: 21,
    stars: null,
    label: 'informed_end',
    zero: null,
    next: null,
  });
  assert.ok(checkChallenge({ ...tut, stars: 3 }).includes('bad stars'));
  assert.ok(checkChallenge({ ...tut, stars: { ai: [0, 0, 0] } }).includes('stars.rules needs three numbers'));
});

test('challenges: draft skeleton', () => {
  const d = challengeDraft(C('fill-the-square'), 'rules');
  assert.deepEqual(d, {
    settings: { type: 'village', neighbors: 25, town: 417, trait_mix: 0, distortion: 'normal', mode: 'rules', until: null },
    rumors: [
      {
        fact: { what: 'party', who: null, where: 'square', when: 'hoy 21:00', amount: null },
        text: null,
        to: null,
        at: 'start',
      },
    ],
    challenge: 'fill-the-square',
    bets: null,
    race: null,
  });
  assert.equal(challengeDraft(C('against-the-clock'), 'ai').settings.until, '14:00');
  assert.equal(challengeDraft(C('tell-the-priest'), 'ai').settings.until, '14:00');
  assert.equal(challengeDraft(C('tutorial'), 'ai').settings.until, '13:00');
});

test('challenges: draft check', () => {
  const ch = C('fill-the-square');
  const draft = (patch = {}, rumor = {}) => {
    const d = challengeDraft(ch, 'ai');
    d.settings.lang = 'es';
    Object.assign(d.settings, patch);
    Object.assign(d.rumors[0], { to: { neighbors: ['n001', 'n002'] }, at: 'hoy 10:00' }, rumor);
    return d;
  };
  assert.deepEqual(checkDraft(ch, draft()), []);
  assert.deepEqual(checkDraft(ch, draft({ mode: 'rules' })), []);
  assert.deepEqual(checkDraft(ch, draft({}, { to: { neighbors: ['n001', 'n002', 'n003'] } })), [
    { field: 'to', error: 'too_many' },
  ]);
  assert.deepEqual(checkDraft(ch, draft({}, { to: { place: 'square' } })), [{ field: 'to', error: 'place_not_allowed' }]);
  assert.deepEqual(checkDraft(ch, draft({}, { to: null })), [{ field: 'to', error: 'missing' }]);
  assert.deepEqual(checkDraft(ch, draft({ town: 1, trait_mix: 2 })), [
    { field: 'settings.town', error: 'fixed' },
    { field: 'settings.trait_mix', error: 'fixed' },
  ]);
  const moved = draft();
  moved.rumors[0].fact = { ...moved.rumors[0].fact, where: 'bar' };
  assert.deepEqual(checkDraft(ch, moved), [{ field: 'rumor.where', error: 'fixed' }]);
  const two = draft();
  two.rumors.push(two.rumors[0]);
  assert.deepEqual(checkDraft(ch, two), [{ field: 'rumors', error: 'count' }]);

  const clock = challengeDraft(C('against-the-clock'), 'ai');
  clock.rumors[0].to = { neighbors: ['n001'] };
  assert.deepEqual(checkDraft(C('against-the-clock'), clock), []);
  clock.settings.until = '20:00';
  assert.deepEqual(checkDraft(C('against-the-clock'), clock), [{ field: 'settings.until', error: 'fixed' }]);

  // Telephone: the character is open and `to` is ignored.
  const tel = challengeDraft(C('broken-telephone'), 'rules');
  tel.settings.trait_mix = 2;
  tel.rumors[0].fact = { what: 'party', who: null, where: 'p01', when: 'hoy 21:00', amount: null };
  assert.deepEqual(checkDraft(C('broken-telephone'), tel), []);

  // Tutorial: `at` is fixed at the start.
  const tut = challengeDraft(C('tutorial'), 'ai');
  tut.rumors[0].to = { place: 'square' };
  assert.deepEqual(checkDraft(C('tutorial'), tut), []);
  tut.rumors[0].at = 'hoy 09:00';
  assert.deepEqual(checkDraft(C('tutorial'), tut), [{ field: 'at', error: 'fixed' }]);
});
