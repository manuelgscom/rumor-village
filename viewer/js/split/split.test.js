// Tests of package A of phase 6 (split screen): the single clock, the pair
// check and the failure counter, against the eval pair (base and fine-tuned,
// party-25, seed 1) and the samples.

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';

import { createStore } from '../core/store.js';
import { loadLog, loadStore, repoPath, SAMPLES } from '../core/testing.js';
import { speedOf } from '../replay/playback.js';
import { rangeOf } from '../replay/timeline.js';
import { createSplitClock } from './clock.js';
import { createFails, SCORE_KEYS, scoreBars } from './fails.js';
import { STRINGS as CORE } from '../core/strings.js';
import { checkPair, mismatchText, sideTitles } from './pair.js';

const BASE = 'runs/eval/base/party-25-es/seed-1.jsonl';
const FT = 'runs/eval/ft/party-25-es/seed-1.jsonl';
const FT_SEED2 = 'runs/eval/ft/party-25-es/seed-2.jsonl';
const FT_TELEPHONE = 'runs/eval/ft/telephone-20-es/seed-1.jsonl';
// The eval logs are not in git (runs/ is ignored): without them, their tests are skipped.
const EVAL = { skip: ![BASE, FT, FT_SEED2, FT_TELEPHONE].every((rel) => existsSync(repoPath(rel))) && 'needs runs/eval/ (not in git)' };

/**
 * From `scripts/rumor.sh metrics <log>` (engine/src/metrics):
 * [invented.count, contradictions.count, decisions.total, rejected.count,
 *  hardened_doubts.count, courtesy.max_turns].
 */
const ENGINE = {
  [BASE]: [2, 0, 1413, 2, 0, 163],
  [FT]: [0, 0, 397, 3, 0, 0],
  'runs/eval/base/party-25-en/seed-1.jsonl': [7, 9, 1269, 0, 1, 153],
  'runs/eval/ft/party-25-en/seed-1.jsonl': [0, 0, 473, 3, 0, 0],
  'runs/samples/party-100-es-s2.jsonl': [0, 0, 3318, 0, 0, 0],
  'runs/samples/party-25-en-s4.jsonl': [0, 0, 516, 0, 0, 0],
  'runs/samples/telephone-20-en-s5.jsonl': [0, 0, 109, 0, 0, 0],
  'runs/samples/telephone-20-es-s5.jsonl': [0, 0, 109, 0, 0, 0],
};

/** A store with the whole log appended, at the start. */
function side(rel) {
  const { header, events } = loadLog(rel);
  const store = createStore(header);
  store.append(events);
  return { rel, store, range: rangeOf(header, events) };
}

/** What a fresh store shows at a position. */
function summary(store) {
  const fact = store.firstFact;
  let informed = 0;
  for (const n of store.state.neighbors.values()) if (fact && n.memory[fact]) informed++;
  return { tick: store.state.tick, index: store.index, informed, arrivals: store.state.arrivals.length };
}

test('clock: both sides at the same position after every operation', EVAL, () => {
  const sides = [side(BASE), side(FT)];
  const start = Math.min(...sides.map((s) => s.range.start));
  const end = Math.max(...sides.map((s) => s.range.end));
  const clock = createSplitClock({
    start,
    end,
    paused: true,
    sides: sides.map((s) => ({ seek: (p) => s.store.seek(p) })),
  });
  const check = (what) => {
    for (const s of sides) {
      assert.equal(s.store.pos, clock.pos, `${what}: ${s.rel} pos`);
      const fresh = loadStore(s.rel, clock.pos);
      assert.deepEqual(summary(s.store), summary(fresh), `${what}: ${s.rel} state`);
    }
    assert.equal(sides[0].store.state.tick, sides[1].store.state.tick, `${what}: tick`);
  };

  clock.seek(1260);
  check('jump forward');
  assert.equal(clock.pos, 1260);
  clock.seek(900.5);
  check('rewind');
  clock.step(1);
  assert.equal(clock.pos, 901);
  check('step +1');
  clock.step(-1);
  assert.equal(clock.pos, 900);
  check('step -1');
  clock.toEnd();
  assert.equal(clock.pos, end);
  check('to end');
  clock.toStart();
  assert.equal(clock.pos, start);
  check('to start');
  clock.seek(start - 100);
  assert.equal(clock.pos, start, 'kept inside the range');
  clock.seek(end + 100);
  assert.equal(clock.pos, end, 'kept inside the range');

  // Play at the end starts again.
  assert.equal(clock.paused, true);
  clock.togglePause();
  assert.equal(clock.paused, false);
  assert.equal(clock.pos, start);
  check('play at the end');

  // Frames at each speed, with and without text on screen.
  for (const key of ['x1', 'x4', 'fast']) {
    clock.seek(1100);
    clock.setSpeed(speedOf(key));
    assert.equal(clock.speed.key, key);
    let before = clock.pos;
    for (let i = 0; i < 20; i++) clock.frame(100, i % 3 === 0 ? 120 : 0);
    assert.ok(clock.pos > before, `${key}: moves`);
    check(`frames at ${key}`);
    before = clock.pos;
    clock.togglePause();
    clock.frame(100, 0);
    assert.equal(clock.pos, before, `${key}: paused does not move`);
    clock.togglePause();
  }

  // Fast until the end: it stops and pauses there.
  clock.setSpeed(speedOf('fast'));
  for (let i = 0; i < 400 && !clock.paused; i++) clock.frame(250, 0);
  assert.equal(clock.paused, true);
  assert.equal(clock.pos, end);
  check('played to the end');
});

test('clock: a reading pause holds both sides and a seek ends it', () => {
  const calls = [];
  const clock = createSplitClock({
    start: 0,
    end: 100,
    speed: speedOf('x1'),
    pos: 10.9,
    sides: [{ seek: (p) => calls.push(['a', p]) }, { seek: (p) => calls.push(['b', p]) }],
  });
  clock.frame(100, 50); // crosses the end of tick 10 with text: holds just before 11
  const held = clock.pos;
  assert.ok(held < 11 && held > 10.99);
  clock.frame(100, 50);
  assert.equal(clock.pos, held, 'still reading');
  clock.seek(20);
  assert.equal(clock.pos, 20);
  clock.frame(100, 0);
  assert.ok(clock.pos > 20, 'the seek ended the pause');
  // Every change reached both sides with the same position.
  const a = calls.filter((c) => c[0] === 'a').map((c) => c[1]);
  const b = calls.filter((c) => c[0] === 'b').map((c) => c[1]);
  assert.deepEqual(a, b);
  assert.equal(a.at(-1), clock.pos);
});

test('checkPair: base against fine-tuned passes; seed and scenario are refused', EVAL, () => {
  const base = loadLog(BASE).header;
  const ft = loadLog(FT).header;
  assert.notEqual(base.model ?? base.policy, ft.model ?? ft.policy, 'the pair differs in its model');
  assert.deepEqual(checkPair(base, ft), { ok: true });

  const seed2 = checkPair(ft, loadLog(FT_SEED2).header);
  assert.equal(seed2.ok, false);
  assert.equal(seed2.reason, 'seed differs: 1 vs 2');

  const telephone = checkPair(ft, loadLog(FT_TELEPHONE).header);
  assert.equal(telephone.ok, false);
  assert.equal(telephone.reason, 'scenario differs: party-25 vs telephone-20');

  // The world counts too, deep.
  const moved = structuredClone(ft);
  moved.places[0].x += 1;
  assert.deepEqual(checkPair(ft, moved), { ok: false, key: 'places', values: null, reason: 'places differs' });
  assert.deepEqual(checkPair(ft, { ...ft, model: 'other.gguf', policy: 'baseline' }), { ok: true });
  assert.equal(checkPair(ft, null).ok, false);
});

test('fails: zero before the first event, monotonic, and the engine count at the end', EVAL, () => {
  const zero = { contradictions: 0, invented: 0, total: 0, decisions: 0, rejected: 0, hardened: 0, maxTurns: 0 };
  for (const [rel, [invented, contradictions, decisions, rejected, hardened, maxTurns]] of Object.entries(ENGINE)) {
    const { events } = loadLog(rel);
    const f = createFails(events);
    assert.deepEqual(f.at(0), zero, rel);
    let prev = f.at(0);
    for (let k = 1; k <= events.length; k++) {
      const cur = f.at(k);
      for (const key of SCORE_KEYS) assert.ok(cur[key] >= prev[key], `${rel}: ${key} monotonic at ${k}`);
      assert.equal(cur.total, cur.contradictions + cur.invented);
      prev = cur;
    }
    assert.deepEqual(
      f.at(events.length),
      { contradictions, invented, total: contradictions + invented, decisions, rejected, hardened, maxTurns },
      rel,
    );
    assert.deepEqual(f.at(events.length + 10), f.at(events.length), `${rel}: clamped`);
  }
  // Every sample is in the table.
  for (const rel of SAMPLES) assert.ok(rel in ENGINE, `${rel} missing from ENGINE`);
});

test('scoreboard: bars of the eval pair compare over the larger side', EVAL, () => {
  const sides = [BASE, FT].map((rel) => {
    const { events } = loadLog(rel);
    return createFails(events).at(events.length);
  });
  const [left, right] = scoreBars(sides);
  assert.deepEqual(left.map((b) => b.key), SCORE_KEYS);
  const of = (bars, key) => bars.find((b) => b.key === key);
  // The base model talks much more and loops until the turn limit.
  assert.deepEqual([of(left, 'decisions').share, of(left, 'maxTurns').share, of(left, 'maxTurns').n], [1, 1, 163]);
  assert.equal(of(right, 'maxTurns').share, 0);
  assert.equal(of(right, 'decisions').share, 397 / 1413);
  // Rejected: 2 against 3, so the right side leads.
  assert.deepEqual([of(left, 'rejected').share, of(right, 'rejected').share], [2 / 3, 1]);
  // Nobody hardened a doubt: both empty, not NaN.
  assert.deepEqual([of(left, 'hardened').share, of(right, 'hardened').share], [0, 0]);
});

test('fails: through the store index, with the position', EVAL, () => {
  const store = loadStore('runs/eval/base/party-25-en/seed-1.jsonl', 420);
  const f = createFails(store.events);
  assert.equal(f.at(store.index).total, 0);
  const end = store.events.at(-1).tick;
  store.seek(end);
  assert.equal(f.at(store.index).total, 16);
  assert.equal(f.at(store.countUntil(Math.floor(store.pos))).total, 16);
});

test('split-mismatch: the reason in the reader\'s language', EVAL, () => {
  const ft = loadLog(FT).header;
  const seed = checkPair(ft, { ...ft, seed: 2 });
  assert.deepEqual([seed.key, seed.values], ['seed', [1, 2]]);
  assert.equal(mismatchText(seed, CORE.es.mismatch), 'la semilla es distinta (1 / 2)');
  assert.equal(mismatchText(seed, CORE.en.mismatch), 'the seed differs (1 / 2)');
  const scenario = checkPair(ft, { ...ft, scenario: 'telephone-20' });
  assert.equal(mismatchText(scenario, CORE.es.mismatch), 'el escenario es distinto (party-25 / telephone-20)');
  const lang = checkPair(ft, { ...ft, lang: 'en' });
  assert.equal(mismatchText(lang, CORE.en.mismatch), 'the language differs (es / en)');
  const moved = structuredClone(ft);
  moved.places[0].x += 1;
  assert.equal(mismatchText(checkPair(ft, moved), CORE.es.mismatch), 'cambia places');
  assert.equal(mismatchText(checkPair(ft, null), CORE.es.mismatch), 'falta la cabecera');
  assert.equal(mismatchText(checkPair(ft, { ...ft, start_tick: 0 }), CORE.en.mismatch), 'start_tick differs (420 / 0)');
});

test('side titles: each side its model; «Sin afinar» and «Afinado» only with labels', () => {
  const ft = { policy: 'model', model: 'gemma-4-E4B-it-rumor-Q4_K_M.gguf' };
  const base = { policy: 'model', model: 'gemma-4-E4B-it-Q4_K_M.gguf' };
  const rules = { policy: 'baseline', model: null };
  assert.deepEqual(sideTitles([base, ft], null, 'es'), [
    { title: 'Gemma 4 E4B sin afinar', model: '' },
    { title: 'Gemma 4 E4B afinado', model: '' },
  ]);
  // The same recording on both sides is not «Sin afinar» against «Afinado».
  assert.deepEqual(sideTitles([rules, rules], null, 'es'), [
    { title: 'Sin modelo: reglas', model: '' },
    { title: 'Sin modelo: reglas', model: '' },
  ]);
  assert.deepEqual(sideTitles([base, ft], ['base', 'ft'], 'es'), [
    { title: 'Sin afinar', model: 'Gemma 4 E4B sin afinar' },
    { title: 'Afinado', model: 'Gemma 4 E4B afinado' },
  ]);
  assert.deepEqual(sideTitles([rules, ft], ['base', 'ft'], 'en'), [
    { title: 'Not fine-tuned', model: 'no model: rules' },
    { title: 'Fine-tuned', model: 'Gemma 4 E4B fine-tuned' },
  ]);
  assert.deepEqual(sideTitles([rules, ft], ['A', 'B'], 'en').map((x) => x.title), ['A', 'B']);
});

test('side titles of the eval pair base and ft', EVAL, () => {
  const titles = sideTitles([loadLog(BASE).header, loadLog(FT).header], null, 'es').map((x) => x.title);
  assert.deepEqual(titles, ['Gemma 4 E4B sin afinar', 'Gemma 4 E4B afinado']);
});
