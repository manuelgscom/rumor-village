// Tests of package F: sentences of the chronicle, headline and director shots,
// against the hand-written log (viewer/fixtures/README.md) and the samples.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { pick } from '../core/lang.js';
import { FIXTURE, loadLog, SAMPLES } from '../core/testing.js';
import { autoCamera, IDLE, MIN_HOLD, shotAt } from './director.js';
import { flightAt, flightMs, follow, FLY_MS } from './fly.js';
import { headlineAt, linesAt, MAX_LINES } from './lines.js';
import { createNarrator } from './narrate.js';
import { createPhraser, fill, plain } from './phrase.js';
import { STRINGS } from './strings.js';

function load(rel) {
  const { header, events } = loadLog(rel);
  const n = createNarrator(header);
  n.ingest(events);
  const lang = header.lang === 'es' ? 'es' : 'en';
  const ph = createPhraser(header, lang, pick(STRINGS, lang));
  /** idx of a tick: events with tick <= tick. */
  const idxAt = (tick) => events.filter((e) => e.tick <= tick).length;
  const text = (tick, limit) => linesAt(n.items, idxAt(tick), limit).map((l) => plain(ph.phrase(l).main));
  return { header, events, n, ph, idxAt, text };
}

test('fill marks values as strong and merges plain text', () => {
  const segs = fill('{a} le cuenta {what} a {b}', { a: 'Carmen', what: { text: 'la fiesta' }, b: 'Luis' });
  assert.deepEqual(segs, [
    { text: 'Carmen', strong: true },
    { text: ' le cuenta la fiesta a ' },
    { text: 'Luis', strong: true },
  ]);
});

test('every sentence of the hand log, in Spanish', () => {
  const { text, ph, n, idxAt } = load(FIXTURE);
  const all = text(1440).reverse();
  assert.deepEqual(all, [
    'Empieza a correr el rumor: fiesta de Manuel en la plaza a las 22:00',
    'Carmen le cuenta la fiesta a Luis en el bar',
    'Carmen le cuenta la fiesta a Inma en el bar',
    'Luis olvida a qué hora era',
    'Luis le cuenta la fiesta a Ana en la plaza',
    'Ana ya no duda de la hora: 23:00',
    'Ana le cuenta la fiesta a Elena en la plaza',
    '2 vecinos van a la plaza',
    '2 vecinos llegan a la plaza a las 22:00 ✓',
    '2 vecinos van a la plaza',
    '2 vecinos llegan a la plaza a las 23:00',
    'Fin del día: 5 de 7 vecinos se enteraron',
  ]);
  const lines = linesAt(n.items, idxAt(1440));
  const guess = ph.phrase(lines.find((l) => l.item.kind === 'tell' && l.item.d.a === 'n002'));
  assert.equal(plain(guess.details[0].segs), 'supone la hora: 23:00');
  assert.equal(guess.tag, 'lo supuso y lo dijo');
  assert.equal(guess.icon, '✎');
  assert.equal(plain(guess.head), 'Luis le cuenta la fiesta a Ana… pero supone la hora');
  const elena = ph.phrase(lines.find((l) => l.item.kind === 'tell' && l.item.d.b === 'n005'));
  assert.equal(plain(elena.details[0].segs), 'le pasa una versión deformada: 23:00');
  assert.equal(elena.tone, 'wrong');
  const late = ph.phrase(lines.find((l) => l.item.kind === 'arrive' && l.item.d.slot === 46));
  assert.equal(late.tag, 'tarde');
  assert.equal(plain(late.details[0].segs), 'era a las 22:00');
  assert.equal(plain(late.details[1].segs), 'Ana y Elena');
  const inject = ph.phrase(lines[lines.length - 1]);
  assert.equal(plain(inject.details[0].segs), 'Se lo cuentan a Carmen');
});

test('the chronicle is a function of the position: rewinding gives the same lines', () => {
  const { text } = load(FIXTURE);
  const before = text(1230);
  assert.deepEqual(text(1230), before);
  assert.equal(before[0], 'Luis le cuenta la fiesta a Ana en la plaza');
  assert.deepEqual(text(1209), []);
  // A merged line grows while its items come in.
  assert.equal(text(1318)[0], '2 vecinos van a la plaza');
});

test('versions follow the memory events of the same tick', () => {
  const { n } = load(FIXTURE);
  const tell = n.items.find((it) => it.kind === 'tell' && it.d.b === 'n005');
  assert.equal(tell.version, 'wrong');
  const first = n.items.find((it) => it.kind === 'tell' && it.d.b === 'n002');
  assert.equal(first.version, 'correct');
  const forgot = n.items.find((it) => it.kind === 'forgot');
  assert.equal(forgot.version, 'incomplete');
});

test('English sentences', () => {
  const { text } = load('runs/samples/party-25-en-s4.jsonl');
  const all = text(1440, Infinity);
  assert.ok(all.some((s) => s.startsWith('The rumor starts to spread: ')), all.at(-1));
  assert.ok(all.every((s) => !/\{\w+\}/.test(s)), 'no template left unfilled');
  assert.match(all[0], /^End of the day: \d+ of 25 neighbors heard it$/);
  assert.ok(all.some((s) => /^\d+ neighbors arrive at the square at 21:00 ✓$/.test(s)), 'arrive at');
});

test('every sample narrates without holes and within the line limit', () => {
  for (const rel of SAMPLES) {
    const { n, ph, events } = load(rel);
    const lines = linesAt(n.items, events.length);
    assert.ok(lines.length > 0 && lines.length <= MAX_LINES, rel);
    for (const l of lines) {
      const p = ph.phrase(l);
      const all = [p.main, p.head, ...p.details.map((d) => d.segs)].map(plain);
      for (const s of all) assert.ok(s && !/\{\w+\}|undefined|null|NaN/.test(s), `${rel}: ${s}`);
    }
  }
});

test('amounts carry their unit', () => {
  const { n, ph, events } = load('runs/samples/party-100-es-s2.jsonl');
  const details = linesAt(n.items, events.length, Infinity).flatMap((l) => ph.phrase(l).details.map((d) => plain(d.segs)));
  assert.ok(details.some((d) => /^supone la cifra: \d+ personas$/.test(d)), details.join('\n'));
});

test('repeated moves merge into one line', () => {
  const { n, idxAt, ph } = load('runs/samples/party-100-es-s2.jsonl');
  const lines = linesAt(n.items, idxAt(1259));
  const p = ph.phrase(lines.find((l) => l.item.kind === 'move'));
  assert.match(plain(p.main), /^\d+ vecinos van a la plaza$/);
  const arrive = linesAt(n.items, idxAt(1260)).find((l) => l.item.kind === 'arrive' && l.item.d.group === 'right');
  assert.ok(arrive.members.length > 20);
});

test('headline: the most important thing, held and then calm', () => {
  const { n, idxAt, ph } = load(FIXTURE);
  const at = (tick) => {
    const h = headlineAt(n.items, idxAt(tick), tick);
    return h ? plain(ph.phrase(h).head) : null;
  };
  assert.equal(at(1205), null);
  assert.equal(at(1211), 'Empieza a correr el rumor: fiesta de Manuel en la plaza a las 22:00');
  // A plain tell three ticks later does not push the inject out.
  assert.equal(at(1213), 'Empieza a correr el rumor: fiesta de Manuel en la plaza a las 22:00');
  // A deformation does, but only after the inject's hold (it is less important).
  assert.equal(at(1228), 'Luis le cuenta la fiesta a Ana… pero supone la hora');
  assert.equal(at(1300), null);
  assert.equal(at(1440), 'Fin del día: 5 de 7 vecinos se enteraron');
  assert.equal(plain(ph.calm({ what: 'party' }, 5, 7)), '5 de 7 vecinos se han enterado de la fiesta');
});

test('director: shots by priority, with a minimum hold', () => {
  const { n, idxAt } = load(FIXTURE);
  const at = (tick) => shotAt(n.items, idxAt(tick), tick);
  assert.equal(at(1200).kind, 'home');
  assert.equal(at(1211).key, 'n|n001');
  // The deformation at 1228 waits for the inject's hold, then takes the shot.
  assert.equal(at(1228).key, 'n|n001');
  const s = at(1230);
  assert.equal(s.key, 'pair|n002|n003');
  assert.equal(s.since, 1210 + MIN_HOLD);
  // Same input, same shot.
  assert.deepEqual(at(1230), s);
  // Arrivals take over a quiet camera; long silence goes home; the end too.
  assert.equal(at(1320).key, 'place|p01');
  const quiet = shotAt(n.items, idxAt(1260), 1260 + IDLE + 1);
  assert.equal(quiet.kind, 'home');
  assert.equal(at(1440).kind, 'home');
});

test('director: no shot shorter than the hold on a busy sample', () => {
  const { n, events } = load('runs/samples/party-100-es-s2.jsonl');
  let idx = 0;
  let prev = null;
  let cuts = 0;
  for (let tick = 420; tick <= 1440; tick++) {
    while (idx < events.length && events[idx].tick <= tick) idx++;
    const s = shotAt(n.items, idx, tick);
    if (prev && s.key !== prev.key) {
      cuts++;
      if (prev.kind !== 'home' && s.kind !== 'home' && s.item?.kind !== 'end') assert.ok(tick - prev.since >= MIN_HOLD, `cut at ${tick}`);
    }
    prev = s;
  }
  assert.ok(cuts > 10 && cuts < 1020 / MIN_HOLD + 2, `cuts ${cuts}`);
});

test('flights: ends where asked, longer for longer hops, follow converges', () => {
  const a = { x: 0, y: 0, scale: 1 };
  const b = { x: 2000, y: 0, scale: 4 };
  assert.deepEqual(flightAt(a, b, 0, 1000), a);
  const end = flightAt(a, b, 1, 1000);
  assert.ok(Math.abs(end.x - b.x) < 1e-9 && Math.abs(end.scale - b.scale) < 1e-9);
  // A long hop zooms out on the way.
  assert.ok(flightAt(a, b, 0.4, 1000).scale < 1);
  const short = flightMs(a, { x: 10, y: 0, scale: 1 }, 1000);
  assert.ok(short >= FLY_MS[0] && short < flightMs(a, b, 1000) && flightMs(a, b, 1000) <= FLY_MS[1]);
  let c = a;
  for (let i = 0; i < 200; i++) c = follow(c, b, 16);
  assert.ok(Math.abs(c.x - b.x) < 1 && Math.abs(c.scale - b.scale) < 0.01);
});

test('the automatic camera comes on when a game starts, unless the player switched it off in it', () => {
  assert.deepEqual(autoCamera('playing', false), { on: true, forget: false });
  assert.deepEqual(autoCamera('playing', true), { on: false, forget: false }, 'switched off in this game');
  assert.deepEqual(autoCamera('ended', false), { on: false, forget: false });
  for (const phase of ['boot', 'menu', 'prepare']) assert.deepEqual(autoCamera(phase, true), { on: false, forget: true }, phase);
  assert.deepEqual(autoCamera(null, false), { on: false, forget: false });
});
