// Tests of «Tu primera partida», part 2 of the tutorial (tutorial.js): the
// chapters, the chapter derived from (phase, draft, log) on the hand-written
// log and on hand-made states, how a rumor reached someone, the walk through a
// whole game with reloads, and the profile.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FIXTURE, loadLog } from '../core/testing.js';
import { effectiveDraft, normalizeDraft } from '../game/prepare.js';
import { STRINGS } from './strings.js';
import {
  BASE_ZONES,
  TUTORIAL_KEYS,
  tutorialAdvance,
  tutorialChapterAt,
  tutorialChapters,
  tutorialEntry,
  tutorialFacts,
  tutorialFocus,
  tutorialLeft,
  tutorialNext,
  tutorialResult,
  tutorialStory,
  tutorialHolds,
  tutorialShowsNext,
  tutorialTargets,
  turnHow,
  MISSING_TARGETS,
  SEEN_FROM,
  withTutorialSeen,
} from './tutorial.js';

const keyAt = (input) => tutorialChapters({ mode: input.mode, inspect: input.inspect ?? true })[tutorialChapterAt(input)].key;

const DRAFT_EMPTY = { settings: { type: 'village', neighbors: 25, town: 1, mode: 'ai', until: '13:00' }, rumors: [], challenge: 'tutorial' };
const rumor = (extra = {}) => ({ fact: { what: null, who: null, where: null, when: null, amount: null }, text: '', to: null, at: 'start', ...extra });
const draftWith = (...rumors) => ({ ...DRAFT_EMPTY, rumors });

// The placeholders each chapter may fill, and those of each line of the summary of «¿Qué pensó?».
const PLACEHOLDERS = { write: [], tell: [], start: [], watch: [], heard: [], think: ['name'], retry: [], missing: [] };
const STORY_PLACEHOLDERS = {
  received: ['name', 'from'],
  receivedIncomplete: ['name', 'from'],
  receivedDistorted: ['name', 'from'],
  receivedYou: ['name'],
  told: ['list'],
  toldChanged: ['list'],
  toldMixed: ['list', 'changed'],
  toldNone: [],
  alone: ['name'],
  aloneMany: ['list'],
  more: ['n'],
  exchange: ['from', 'name', 'time'],
  exchangeIncomplete: ['from', 'name', 'time'],
  exchangeDistorted: ['from', 'name', 'time'],
  result: ['n', 'total', 'name'],
  resultAlone: ['n', 'total'],
  resultChanged: [],
  then: ['time'],
  now: [],
  decidedAt: ['time'],
  nowCorrect: [],
  nowIncomplete: [],
  nowWrong: [],
};
// What «Empezar» will do (chapter start).
const IMPLIES_PLACEHOLDERS = { one: ['at', 'fact', 'to'], many: ['at', 'fact', 'to'], place: ['at', 'fact', 'place'], atStart: [], atTime: ['time'] };

test('the chapters, in order, with cumulative zones', () => {
  const ai = tutorialChapters({ mode: 'ai' });
  assert.deepEqual(
    ai.map((c) => c.key),
    TUTORIAL_KEYS,
  );
  assert.deepEqual(TUTORIAL_KEYS, ['write', 'tell', 'start', 'watch', 'heard', 'think', 'retry'], 'seven steps, no village (phase 9-5)');
  assert.deepEqual(
    tutorialChapters({ mode: 'rules' }).map((c) => c.key),
    TUTORIAL_KEYS,
  );
  ai.forEach((c, i) => {
    assert.equal(c.n, i + 1);
    for (const z of BASE_ZONES) assert.ok(c.zones.includes(z), `${c.key}: zone ${z}`);
    if (i > 0) for (const z of ai[i - 1].zones) assert.ok(c.zones.includes(z), `${c.key}: keeps ${z}`);
  });
  const by = Object.fromEntries(ai.map((c) => [c.key, c]));
  assert.ok(by.watch.zones.includes('rumor'));
  assert.ok(!by.start.zones.includes('rumor'), 'the rumor card comes with the game');
  assert.ok(by.think.zones.includes('inspect'));
  assert.ok(by.watch.zones.includes('side'), '«Quién va a ir», and exploring the map opens a neighbor');
  assert.ok(by.retry.zones.includes('summary'));
  assert.ok(by.watch.hold && by.watch.next);
  assert.ok(!by.write.hold);
  assert.equal(by.retry.last, true);
  assert.equal(SEEN_FROM, 'retry');
  assert.equal(ai.filter((c) => c.last).length, 1);
  // «Siguiente» only where the player's action does not drive the step.
  assert.deepEqual(
    ai.filter((c) => c.next).map((c) => c.key),
    ['watch', 'heard'],
  );
  assert.deepEqual(
    tutorialChapters({ mode: 'rules' })
      .filter((c) => c.next)
      .map((c) => c.key),
    ['write', 'watch', 'heard'],
  );
  for (const c of ai) assert.ok(c.targets.length > 0, `${c.key}: points somewhere`);
  assert.ok(by.start.targets.includes('gm:start'));
  // The control to use in each mode: Con IA the free text (or «Interpretar rumor») first, Sin IA the example or the kinds.
  assert.deepEqual(by.write.targets, ['freetext', 'gm:rumor-example', 'gm:rumor-what']);
  assert.deepEqual(by.tell.targets, ['gm:rumor-to', 'gm:neighbor-card'], 'the list of whom to tell, else a card');
  assert.deepEqual(by.heard.targets, ['listener', 'gm:rumor-count'], 'who heard it, else the counter');
  assert.deepEqual(by.think.targets, ['neighbor']);
  assert.deepEqual(by.retry.targets, ['gm:retry', 'gm:final']);
});

test('without the «¿Qué pensó?» card the chapter is left out, and «Siguiente» never jumps a phase', () => {
  const list = tutorialChapters({ mode: 'ai', inspect: false });
  assert.deepEqual(
    list.map((c) => c.key),
    ['write', 'tell', 'start', 'watch', 'heard', 'retry'],
  );
  const heard = list.find((c) => c.key === 'heard');
  assert.equal(heard.next, false, 'heard is the last of the playing phase: the end moves on');
  assert.equal(list.find((c) => c.key === 'watch').next, true);
  assert.ok(!heard.zones.includes('inspect'));
  for (const mode of ['ai', 'rules'])
    for (const inspect of [true, false]) {
      const ch = tutorialChapters({ mode, inspect });
      ch.forEach((c, i) => {
        if (c.next) assert.ok(ch[i + 1].phases.some((p) => c.phases.includes(p)), `${mode} ${c.key}`);
      });
    }
});

test('every chapter has its title and its paragraphs in both languages and modes', () => {
  for (const lang of ['es', 'en']) {
    const t = STRINGS[lang].tutorial;
    assert.ok(t, lang);
    assert.equal(t.mode.ai, lang === 'es' ? 'Con IA' : 'With AI');
    assert.equal(t.mode.rules, lang === 'es' ? 'Sin IA' : 'Without AI');
    for (const key of [...TUTORIAL_KEYS, 'missing']) {
      assert.ok(t.title[key], `${lang} title ${key}`);
      const raw = t.body[key];
      // {ai, rules} by mode, {wait, known} for «Ya lo sabe», or the same for both.
      const variants = key === 'heard' ? ['wait', 'known'] : ['ai', 'rules'];
      if (!Array.isArray(raw)) assert.deepEqual(Object.keys(raw).sort(), [...variants].sort(), `${lang} ${key}: variants`);
      for (const v of variants) {
        const paras = Array.isArray(raw) ? raw : raw[v];
        assert.ok(Array.isArray(paras) && paras.length >= 1 && paras.length <= 2, `${lang} ${key} ${v}: one or two paragraphs`);
        for (const p of paras) {
          for (const [, name] of p.matchAll(/\{(\w+)\}/g)) assert.ok(PLACEHOLDERS[key].includes(name), `${lang} ${key}: unknown {${name}}`);
          assert.ok(p.length < 220, `${lang} ${key}: short paragraphs`);
        }
      }
    }
    assert.match(t.body.think.ai[0], /\{name\}/);
    assert.ok(t.decide, `${lang} decide`);
    assert.ok(t.someone, `${lang} someone`);
    for (const [key, names] of Object.entries(STORY_PLACEHOLDERS)) {
      const line = t.story[key];
      assert.ok(typeof line === 'string' && line.length < 160, `${lang} story ${key}`);
      assert.deepEqual([...line.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(), [...names].sort(), `${lang} story ${key}`);
    }
    for (const [key, names] of Object.entries(IMPLIES_PLACEHOLDERS)) {
      const line = t.implies[key];
      assert.ok(typeof line === 'string' && line.length < 120, `${lang} implies ${key}`);
      assert.deepEqual([...line.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(), [...names].sort(), `${lang} implies ${key}`);
    }
    assert.match(t.step, /\{n\}.*\{total\}/);
    // The card's controls: short labels.
    for (const key of ['label', 'skip', 'skipTitle', 'fold', 'unfold', 'unfoldTitle', 'goTo', 'back', 'done', 'next']) {
      assert.ok(typeof t[key] === 'string' && t[key].length > 0 && t[key].length < 50, `${lang} ${key}`);
    }
    assert.equal(t.label, 'Tutorial');
  }
  assert.match(STRINGS.es.tutorial.body.think.ai.join(' '), /Ver qué decidió/);
  assert.equal(STRINGS.es.tutorial.decide, 'Ver qué decidió');
  // What B2 asks of each step (docs/fases/fase-9.md, 9-5).
  const es = STRINGS.es.tutorial;
  assert.match(es.step, /^Tu primera partida · Paso \{n\} de \{total\}$/);
  assert.match(es.body.write.ai.join(' '), /7 tipos/);
  assert.match(es.body.write.ai.join(' '), /Rellenar la frase/);
  assert.match(es.body.write.rules.join(' '), /7 tipos/);
  assert.match(es.body.missing.ai.join(' '), /Rellenar la frase/);
  assert.match(es.body.tell.join(' '), /ficha/);
  assert.match(es.body.tell.join(' '), /carácter/);
  assert.match(es.body.start.join(' '), /solo miras/);
  assert.match(es.body.watch.ai.join(' '), /los escribe la IA ahora mismo/);
  assert.match(es.body.think.ai.join(' '), /lo especial/);
  // The glossary: retired words do not come back (rumor, enterarse, deformado, partida).
  const retired = /\b(noticia|mensaje|hecho|suceso|oyeron|versión|ejecución|motor|modelo|equipo|Interpretar rumor|cambiado)\b/i;
  const all = JSON.stringify({ title: es.title, body: es.body, story: es.story, implies: es.implies });
  for (const m of all.matchAll(new RegExp(retired, 'gi'))) {
    // «7 tipos de noticia» is the glossary's own way of saying the kind.
    assert.ok(/tipos de noticia/.test(all.slice(Math.max(0, m.index - 12), m.index + 10)), `retired word: ${m[0]}`);
  }
  assert.equal(STRINGS.es.tutorial.skip, 'Seguir sin guía');
  // The end says the exchange and the question; the figure is on the end card.
  assert.doesNotMatch(STRINGS.es.tutorial.body.retry.join(' '), /\{n\}/);
  assert.match(STRINGS.es.tutorial.body.retry.join(' '), /Probar con otro vecino/);
});

test('hand-made states before the game: menu, rumor written, recipients chosen, as the form counts them', () => {
  assert.equal(keyAt({}), 'write');
  assert.equal(keyAt({ phase: 'boot' }), 'write');
  assert.equal(keyAt({ phase: 'menu', draft: draftWith(rumor({ text: 'fiesta' })) }), 'write');
  assert.equal(keyAt({ phase: 'prepare', draft: DRAFT_EMPTY }), 'write');
  assert.equal(keyAt({ phase: 'prepare', draft: draftWith(rumor()) }), 'write', 'the open rumor of the challenge is not written yet');
  assert.equal(keyAt({ phase: 'prepare', draft: draftWith(rumor({ text: 'esta noche hay fiesta en la plaza a las 9' })) }), 'write', 'a sentence not understood yet');
  assert.equal(keyAt({ phase: 'prepare', draft: draftWith(rumor({ fact: { what: 'fire' } })) }), 'write', 'not one of the seven kinds');
  assert.equal(keyAt({ phase: 'prepare', draft: draftWith(rumor({ fact: { what: 'party' } })) }), 'tell');
  assert.equal(keyAt({ phase: 'prepare', draft: draftWith(rumor({ fact: { what: 'party' }, to: { neighbors: [] } })) }), 'tell', 'an empty row is not told');
  assert.equal(keyAt({ phase: 'prepare', draft: draftWith(rumor({ fact: { what: 'party' }, to: { place: 'square' } })) }), 'start');
  assert.equal(keyAt({ phase: 'prepare', draft: draftWith(rumor({ fact: { what: 'party' }, to: { neighbors: ['n003'] } })) }), 'start');
  // Teléfono: the first of the row gets it, so a type is enough.
  const tel = { ...DRAFT_EMPTY, settings: { ...DRAFT_EMPTY.settings, type: 'telephone' } };
  assert.equal(keyAt({ phase: 'prepare', draft: { ...tel, rumors: [rumor({ fact: { what: 'party' } })] } }), 'start');
  assert.equal(keyAt({ phase: 'playing' }), 'watch');
  assert.equal(keyAt({ phase: 'ended' }), 'retry');
  assert.equal(keyAt({ phase: 'ended', inspect: false }), 'retry');
});

test('the guide follows the effective draft: an empty row, a valid rumor not saved, back to the editor', () => {
  for (const mode of ['ai', 'rules']) {
    const base = normalizeDraft({ ...DRAFT_EMPTY, settings: { ...DRAFT_EMPTY.settings, mode }, challenge: null });
    const at = (editing, d = base) => keyAt({ phase: 'prepare', mode, draft: normalizeDraft(effectiveDraft(d, editing)) });
    // The editor open on an empty rumor: still to write.
    assert.equal(at({ index: null, rumor: rumor() }), 'write', mode);
    // A type chosen in the editor, nobody yet: whom to tell.
    assert.equal(at({ index: null, rumor: rumor({ fact: { what: 'party' } }) }), 'tell', mode);
    // Complete in the editor, not added to the list: «Empezar» would start it.
    assert.equal(at({ index: null, rumor: rumor({ fact: { what: 'party' }, to: { neighbors: ['n003'] } }) }), 'start', mode);
    // Saved, then opened again and its recipients removed: the edited one replaces it.
    const saved = normalizeDraft({ ...base, rumors: [rumor({ fact: { what: 'party' }, to: { neighbors: ['n003'] } })] });
    assert.equal(at(null, saved), 'start', mode);
    assert.equal(at({ index: 0, rumor: rumor({ fact: { what: 'party' }, to: { neighbors: [] } }) }, saved), 'tell', mode);
  }
});

test('the log says it after a reload: started, ended', () => {
  const { events } = loadLog(FIXTURE);
  const inject = events.findIndex((e) => e.type === 'inject');
  const before = events.slice(0, inject);
  const during = events.slice(0, events.findIndex((e) => e.tick > 1300));
  // Phase unknown (just reloaded): the log alone decides.
  assert.equal(keyAt({ phase: null, log: before }), 'write');
  assert.equal(keyAt({ phase: null, log: during }), 'watch');
  assert.equal(keyAt({ phase: null, log: { events } }), 'retry', 'the log ends with its end');
  assert.equal(keyAt({ phase: 'prepare', log: during }), 'watch', 'a started log wins over a stale phase');
  const f = tutorialFacts({ phase: 'playing', log: during });
  assert.equal(f.started, true);
  assert.equal(f.ended, false);
  assert.equal(f.fact, 'f1');
  assert.equal(tutorialFacts({ phase: null, log: before }).heard, null);
  assert.equal(tutorialFacts({ phase: null, log: before }).decision, null);
});

test('the first transmission and the decision to open', () => {
  const { events } = loadLog(FIXTURE);
  // Inject to Carmen (n001) at 1210; turn 10, Carmen tells Luis (n002) at 1213, all faithful.
  const f = tutorialFacts({ phase: 'playing', log: events });
  assert.deepEqual(f.heard, { who: 'n002', from: 'n001', tick: 1213, turn: 10, intact: true, how: 'intact' });
  // «¿Qué pensó?» opens Luis on his first tell of the rumor (turn 20, to Ana).
  assert.deepEqual(f.decision, { who: 'n002', tick: 1228, turn: 20, told: true });
  // Cut before Carmen tells it: nobody heard it from a neighbor; the decision is
  // Carmen's first one after hearing it (turn 1), not the newest whatever it is.
  const early = events.filter((e) => e.tick < 1213);
  const e = tutorialFacts({ phase: 'playing', log: early });
  assert.equal(e.heard, null);
  assert.deepEqual(e.decision, { who: 'n001', tick: 1210, turn: 1, told: false });
  // Without any decision of theirs yet, none: «¿Qué pensó?» opens the newest.
  const bare = early.filter((x) => !((x.type === 'turn' || x.type === 'plan') && x.who === 'n001'));
  assert.deepEqual(tutorialFacts({ phase: 'playing', log: bare }).decision, { who: 'n001', tick: 1210, turn: null, told: false });
  // Just after: Luis heard it and has not told it yet.
  const just = events.filter((x) => x.tick <= 1213);
  // Luis has not told it yet: Carmen's tell to him, which Sin IA carries the dice (not a greeting).
  assert.deepEqual(tutorialFacts({ phase: 'playing', log: just }).decision, { who: 'n001', tick: 1213, turn: 10, told: true });
  // An ask is not a transmission: it does not make anyone know the rumor.
  const ask = { ...events.find((x) => x.type === 'turn' && x.id === 10), id: 99, tick: 1212, act: 'ask', to: 'n003' };
  const withAsk = [...early, ask];
  assert.equal(tutorialFacts({ phase: 'playing', log: withAsk }).heard, null);
  // Nor is a tell rejected, nor one to who already knew it (the inject recipient).
  const rejected = { ...ask, act: 'tell', reject: 'bad_fields', action: 'none' };
  const back = { ...ask, act: 'tell', who: 'n003', to: 'n001' };
  assert.equal(tutorialFacts({ phase: 'playing', log: [...early, rejected, back] }).heard, null);
  // The words of the turn do not matter (Sin IA they have none).
  const silent = events.map((x) => (x.type === 'turn' ? { ...x, text: null } : x));
  assert.deepEqual(tutorialFacts({ phase: 'playing', log: silent }).heard, f.heard);
});

test('what happened around a neighbor: what reached them and to whom they told it', () => {
  const { events } = loadLog(FIXTURE);
  // Luis heard it intact from Carmen, then told Ana (turn 20) with the hour as a guess.
  const luis = tutorialStory(events, 'n002');
  assert.deepEqual(luis.received, { from: 'n001', intact: true, how: 'intact', tick: 1213 });
  assert.deepEqual(luis.told, [{ to: 'n003', intact: false, how: 'distorted', turn: 20 }], 'a guessed hour is a change');
  // Carmen heard it from the player, told Luis intact and Inma without the amount.
  const carmen = tutorialStory({ events }, 'n001', 'f1');
  assert.deepEqual(carmen.received, { from: null, intact: true, how: 'intact', tick: 1210 });
  assert.deepEqual(carmen.told, [
    { to: 'n002', intact: true, how: 'intact', turn: 10 },
    { to: 'n007', intact: false, how: 'incomplete', turn: 15 },
  ]);
  // Inma (n007): told without the amount: incomplete, not distorted; she told nobody.
  assert.deepEqual(tutorialStory(events, 'n007'), { received: { from: 'n001', intact: false, how: 'incomplete', tick: 1217 }, told: [] });
  // As far as the log is shown, and nothing before the rumor.
  assert.deepEqual(tutorialStory(events.filter((e) => e.tick < 1213), 'n001').told, []);
  assert.deepEqual(tutorialStory(events.filter((e) => e.tick < 1213), 'n002'), { received: null, told: [] });
  assert.deepEqual(tutorialStory([], 'n001'), { received: null, told: [] });
  assert.deepEqual(tutorialStory(events, 'n001', 'f9'), { received: null, told: [] });
  // A detail the original rumor does not have comes out 'omitted': not a change
  // (the engine's party at the square at 12:00, without who or how many).
  const bare = [
    { type: 'inject', tick: 420, fact: 'f1', what: 'party', slots: { who: null, where: 'p01', when: 24, amount: null }, to: ['n003'] },
    { type: 'turn', tick: 439, id: 6, who: 'n003', to: 'n005', action: 'say', act: 'tell', fact: 'f1', reject: null, verdict: { who: 'omitted', where: 'faithful', when: 'faithful', amount: 'omitted' } },
    { type: 'turn', tick: 450, id: 9, who: 'n005', to: 'n008', action: 'say', act: 'tell', fact: 'f1', reject: null, verdict: { who: 'omitted', where: 'omitted', when: 'faithful', amount: 'omitted' } },
  ];
  assert.deepEqual(tutorialStory(bare, 'n005'), {
    received: { from: 'n003', intact: true, how: 'intact', tick: 439 },
    told: [{ to: 'n008', intact: false, how: 'incomplete', turn: 9 }],
  });
  // The first exchange counts the same way.
  assert.equal(tutorialFacts({ phase: 'playing', log: bare }).heard.intact, true);
});

test('entry, advance and «Siguiente»', () => {
  const ch = tutorialChapters({ mode: 'ai' });
  const at = (key) => ch.findIndex((c) => c.key === key);
  // It opens where the facts are (part 1, «Cómo funciona», came before if at all).
  for (const k of ['write', 'tell', 'start', 'watch', 'retry']) assert.equal(tutorialEntry(ch, at(k)), at(k), k);
  assert.equal(tutorialEntry(ch, -1), 0);
  // «¿Qué ha pasado?» is not held: a rumor written moves on.
  for (const k of ['tell', 'start', 'watch']) assert.equal(tutorialAdvance(ch, 0, at(k)), at(k), k);
  // Only forward: back to a rumor without a type, the card stays where it is
  // and points at the type instead (tutorialTargets, below).
  assert.equal(tutorialAdvance(ch, at('tell'), at('write')), at('tell'));
  assert.deepEqual(tutorialTargets(ch[at('tell')], tutorialFacts({ phase: 'prepare', draft: DRAFT_EMPTY })), { targets: MISSING_TARGETS, missing: true });
  assert.equal(tutorialAdvance(ch, at('write'), at('start')), at('start'));
  // While playing the facts say «watch»: the card waits for «Siguiente», and the end jumps to the last one.
  assert.equal(tutorialAdvance(ch, at('watch'), at('watch')), at('watch'));
  assert.equal(tutorialAdvance(ch, at('heard'), at('watch')), at('heard'));
  assert.equal(tutorialAdvance(ch, at('think'), at('watch')), at('think'));
  for (const k of ['watch', 'heard', 'think']) assert.equal(tutorialAdvance(ch, at(k), at('retry')), at('retry'), k);
  // «Siguiente» goes one on, or to where the facts already are.
  assert.equal(tutorialNext(ch, 0, at('write')), at('tell'));
  assert.equal(tutorialNext(ch, 0, at('start')), at('start'));
  assert.equal(tutorialNext(ch, at('watch'), at('watch')), at('heard'));
  assert.equal(tutorialNext(ch, at('heard'), at('watch')), at('think'));
  assert.equal(tutorialNext(ch, ch.length - 1, at('retry')), ch.length - 1);
  // Leaving the end («Probar con otro vecino», «Otra vez», «Partida nueva») closes the guided game; a reload ('boot') does not.
  assert.equal(tutorialLeft(ch, at('retry'), 'prepare'), true);
  assert.equal(tutorialLeft(ch, at('retry'), 'menu'), true);
  assert.equal(tutorialLeft(ch, at('retry'), 'playing'), true);
  assert.equal(tutorialLeft(ch, at('retry'), 'boot'), false);
  assert.equal(tutorialLeft(ch, at('retry'), 'ended'), false);
  assert.equal(tutorialLeft(ch, at('retry'), null), false);
  assert.equal(tutorialLeft(ch, at('think'), 'prepare'), false);
  assert.equal(tutorialLeft(ch, at('watch'), 'prepare'), false);
});

test('Sin IA «Siguiente» without a type: the card asks for the type until there is one', () => {
  // The jam of the review (9-4): «Siguiente» on «¿Qué ha pasado?» with no type,
  // then a recipient chosen; the ring stayed on rumor-to although the type was missing.
  const mode = 'rules';
  const ch = tutorialChapters({ mode });
  const at = (key) => ch.findIndex((c) => c.key === key);
  const draft = (r) => ({ ...DRAFT_EMPTY, settings: { ...DRAFT_EMPTY.settings, mode }, rumors: r ? [r] : [] });
  const input = (d) => ({ phase: 'prepare', mode, draft: d });
  const targetsAt = (k, d) => tutorialTargets(ch[k], tutorialFacts(input(d)));
  let k = at('write');
  // «Siguiente» with the editor empty: on to «¿A quién?», which asks for the type.
  k = tutorialNext(ch, k, tutorialChapterAt(input(draft(rumor()))));
  assert.equal(ch[k].key, 'tell');
  assert.deepEqual(targetsAt(k, draft(rumor())), { targets: MISSING_TARGETS, missing: true });
  assert.equal(MISSING_TARGETS[0], 'gm:rumor-what');
  // A recipient without a type: still there, still the type.
  const noType = draft(rumor({ to: { neighbors: ['n003'] } }));
  k = tutorialAdvance(ch, k, tutorialChapterAt(input(noType)));
  assert.equal(ch[k].key, 'tell');
  assert.deepEqual(targetsAt(k, noType).targets, MISSING_TARGETS);
  // The type chosen: the rumor is complete and the guide goes on to «Empezar», pointing at it.
  const done = draft(rumor({ fact: { what: 'party' }, to: { neighbors: ['n003'] } }));
  k = tutorialAdvance(ch, k, tutorialChapterAt(input(done)));
  assert.equal(ch[k].key, 'start');
  assert.deepEqual(targetsAt(k, done), { targets: ['gm:start'], missing: false });
  // The type cleared again at «Empezar»: back to asking for it.
  assert.equal(tutorialAdvance(ch, k, tutorialChapterAt(input(noType))), k);
  assert.equal(targetsAt(k, noType).missing, true);
  // A type and no recipient: «¿A quién?» points at the recipients as always.
  assert.deepEqual(targetsAt(at('tell'), draft(rumor({ fact: { what: 'party' } }))), { targets: ['gm:rumor-to', 'gm:neighbor-card'], missing: false });
  // The other chapters never ask for it, and without facts nothing is missing.
  assert.equal(targetsAt(at('write'), draft(rumor())).missing, false);
  assert.equal(tutorialTargets(ch[at('tell')], null).missing, false);
});

test('a whole guided game, with the reload after «Empezar»', () => {
  const { events } = loadLog(FIXTURE);
  for (const mode of ['ai', 'rules'])
    for (const inspect of [true, false]) {
      const ch = tutorialChapters({ mode, inspect });
      const seen = [];
      let k = -1;
      const step = (input) => {
        const d = tutorialChapterAt({ ...input, mode, inspect });
        k = k < 0 ? tutorialEntry(ch, d) : tutorialAdvance(ch, k, d);
        if (seen.at(-1) !== ch[k].key) seen.push(ch[k].key);
      };
      const next = (input) => {
        assert.ok(ch[k].next, `${mode} ${ch[k].key}: «Siguiente» shown`);
        k = tutorialNext(ch, k, tutorialChapterAt({ ...input, mode, inspect }));
        seen.push(ch[k].key);
      };
      const draft = { ...DRAFT_EMPTY, settings: { ...DRAFT_EMPTY.settings, mode } };
      step({ phase: 'menu', draft });
      step({ phase: 'prepare', draft });
      const written = draftWith(rumor({ fact: { what: 'party' }, text: mode === 'ai' ? 'fiesta en la plaza' : '' }));
      step({ phase: 'prepare', draft: written });
      const told = draftWith(rumor({ fact: { what: 'party' }, to: { place: 'square' } }));
      step({ phase: 'prepare', draft: told });
      // «Empezar»: the page reloads and the guide starts again from the facts.
      k = -1;
      const early = events.filter((e) => e.tick < 1213);
      step({ phase: 'playing', log: early });
      // The rumor card waits for «Siguiente» while the log moves on.
      step({ phase: 'playing', log: events.slice(0, 40) });
      assert.equal(ch[k].key, 'watch', `${mode}: watch is held`);
      next({ phase: 'playing', log: events.slice(0, 40) });
      assert.ok(tutorialFacts({ phase: 'playing', log: events.slice(0, 40) }).heard, 'someone heard it by then');
      if (inspect) next({ phase: 'playing', log: events.slice(0, 40) });
      step({ phase: 'playing', log: events.slice(0, 60) });
      step({ phase: 'ended', log: events });
      assert.deepEqual(
        seen,
        TUTORIAL_KEYS.filter((key) => inspect || key !== 'think'),
        `${mode} inspect=${inspect}`,
      );
      assert.equal(ch[k].key, 'retry');
      assert.equal(ch[k].last, true);
      assert.equal(ch[k].next, false, 'the last one closes with «Listo»');
    }
});

test('how a rumor reached someone: intact, incomplete (forgotten) or distorted (changed)', () => {
  const slots = { who: null, where: 'p01', when: 24, amount: null };
  assert.equal(turnHow({ verdict: null }, slots), 'intact', 'a turn without claim');
  assert.equal(turnHow({}, slots), 'intact');
  assert.equal(turnHow({ verdict: { who: 'omitted', where: 'faithful', when: 'faithful', amount: 'omitted' } }, slots), 'intact', 'what the original lacks');
  assert.equal(turnHow({ verdict: { who: 'omitted', where: 'omitted', when: 'faithful', amount: 'omitted' } }, slots), 'incomplete');
  for (const v of ['contradiction', 'hardened_doubt', 'declared_guess', 'invented'])
    assert.equal(turnHow({ verdict: { who: 'omitted', where: 'omitted', when: v, amount: 'omitted' } }, slots), 'distorted', v);
  assert.equal(turnHow({ verdict: { where: 'omitted' } }), 'intact', 'no slots: nothing to forget');
});

test('the village waits while the guide waits for «Siguiente» in the game, and only then', () => {
  for (const mode of ['ai', 'rules'])
    for (const inspect of [true, false]) {
      const ch = tutorialChapters({ mode, inspect });
      const by = (key) => ch.find((c) => c.key === key);
      const holds = (key, o = {}) => tutorialHolds(by(key), { phase: 'playing', ...o });
      // «Míralo correr»: held from the start, whatever happened.
      assert.equal(holds('watch'), true, `${mode} ${inspect} watch`);
      assert.equal(holds('watch', { known: true }), true);
      // «Alguien se ha enterado»: the village runs until someone has; then it waits
      // (only when «Siguiente» leads somewhere: without «¿Qué pensó?» the end moves on).
      assert.equal(holds('heard'), false, 'nobody has heard it yet: it has to run');
      assert.equal(holds('heard', { known: true }), inspect, `${mode} inspect=${inspect} heard`);
      // Never in «¿Qué pensó?» nor out of the game.
      if (inspect) assert.equal(holds('think', { known: true }), false);
      for (const key of ['write', 'tell', 'start']) assert.equal(tutorialHolds(by(key), { phase: 'prepare' }), false, key);
      assert.equal(tutorialHolds(by('retry'), { phase: 'ended', known: true }), false);
      assert.equal(holds('watch', { phase: 'ended' }), false, 'the game is over: nothing to hold');
      // Folded, or resumed by the player on that step: not held.
      assert.equal(holds('watch', { folded: true }), false);
      assert.equal(holds('watch', { resumed: true }), false);
    }
  assert.equal(tutorialHolds(null, { phase: 'playing' }), false);
});

test('«¿Qué pensó?» gets «Siguiente» once one was opened, and says so', () => {
  for (const mode of ['ai', 'rules']) {
    const ch = tutorialChapters({ mode });
    const by = (key) => ch.find((c) => c.key === key);
    assert.equal(tutorialShowsNext(by('think')), false, 'before: the player opens one');
    assert.equal(tutorialShowsNext(by('think'), { thinkSeen: true }), true);
    assert.equal(tutorialShowsNext(by('retry')), true, '«Listo»');
    assert.equal(tutorialShowsNext(by('watch')), true);
    assert.equal(tutorialShowsNext(by('tell'), { thinkSeen: true }), false, 'only «¿Qué pensó?»');
  }
  assert.equal(tutorialShowsNext(null, { thinkSeen: true }), false);
  for (const lang of ['es', 'en']) {
    const paras = STRINGS[lang].tutorial.body.thinkSeen;
    assert.ok(Array.isArray(paras) && paras.length === 1 && paras[0].length < 220, lang);
    assert.doesNotMatch(paras[0], /\{/);
  }
  assert.match(STRINGS.es.tutorial.body.thinkSeen[0], /^Ya lo has visto: así decide cada vecino\. Pulsa «Siguiente»/);
  assert.equal(STRINGS.es.tutorial.goTo, 'Señálamelo');
  // «Quién va a ir» is named as the panel calls it, only while it is on screen (the view adds it).
  for (const lang of ['es', 'en']) {
    const w = STRINGS[lang].tutorial.body;
    assert.equal(w.watchGroups.length, 1);
    for (const v of ['ai', 'rules']) assert.doesNotMatch(w.watch[v].join(' '), /Consecuencias|Consequences|Quién va a ir|Who will go/, `${lang} ${v}`);
  }
  assert.match(STRINGS.es.tutorial.body.watchGroups[0], /^A la derecha, «Quién va a ir»: quién piensa ir al sitio del rumor/);
});

test('the last step says the result of the game, as the end card counts it', async () => {
  const { informedEnd, topTellers } = await import('../game/score/measures.js');
  const log = loadLog(FIXTURE);
  const r = tutorialResult(log.events);
  assert.equal(r.informed, informedEnd(log, 'f1').size);
  assert.equal(r.top, topTellers(log, 'f1', 1)[0].who);
  assert.ok(r.informed >= 2);
  // Luis told Ana with the hour as a guess: someone told it distorted (the guessing game).
  assert.equal(r.distorted, true);
  assert.deepEqual(tutorialResult({ events: log.events }), r, 'a log as {events} too');
  // Only forgotten details: incomplete, not changed.
  const bare = [
    { type: 'inject', tick: 420, fact: 'f1', what: 'party', slots: { who: null, where: 'p01', when: 24, amount: null }, to: ['n003'] },
    { type: 'turn', tick: 439, id: 6, who: 'n003', to: 'n005', action: 'say', act: 'tell', fact: 'f1', reject: null, verdict: { who: 'omitted', where: 'omitted', when: 'faithful', amount: 'omitted' } },
  ];
  assert.deepEqual(tutorialResult(bare), { informed: 2, top: 'n003', distorted: false });
  // Nobody passed it on: the recipient alone, nobody on top.
  assert.deepEqual(tutorialResult(bare.slice(0, 1)), { informed: 1, top: null, distorted: false });
  assert.equal(tutorialResult([]), null);
  assert.match(STRINGS.es.tutorial.story.result, /^Llegó a \{n\} de \{total\} vecinos; quien más lo movió fue \{name\}\.$/);
  const { STRINGS: GAME } = await import('../game/strings.js');
  for (const lang of ['es', 'en']) assert.ok(STRINGS[lang].tutorial.story.resultChanged.includes(GAME[lang].whoGuessTitle), `${lang}: the name on screen`);
  for (const lang of ['es', 'en']) assert.equal(STRINGS[lang].tutorial.body.watchHeld.length, 1, `${lang}: the village waits`);
  assert.match(STRINGS.es.tutorial.body.watchHeld[0], /el pueblo espera mientras lees; sigue al pulsar «Siguiente»/);
});

test('«Míralo correr» frames the first encounter that passes the rumor on, else who heard it from the player', () => {
  const { events } = loadLog(FIXTURE);
  // Carmen (n001) told Luis (n002) at 1213.
  assert.deepEqual(tutorialFocus(tutorialFacts({ phase: 'playing', log: events }), events), ['n001', 'n002']);
  const early = events.filter((e) => e.tick < 1213);
  assert.deepEqual(tutorialFocus(tutorialFacts({ phase: 'playing', log: early }), early), ['n001'], 'nobody told it yet: who heard it from you');
  const before = events.slice(0, events.findIndex((e) => e.type === 'inject'));
  assert.deepEqual(tutorialFocus(tutorialFacts({ phase: 'playing', log: before }), before), [], 'no rumor yet');
  assert.deepEqual(tutorialFocus(null, []), []);
  // While nobody has told it, «Alguien se ha enterado» says what to wait for.
  assert.equal(STRINGS.es.tutorial.title.heardWait, 'Espera a que se crucen');
  assert.ok(STRINGS.en.tutorial.title.heardWait);
});

test('the profile keeps everything and says the guided game was seen', () => {
  const profile = { format: 1, tutorial_seen: false, stars: { 'fill-the-square': { ai: 2, rules: 1 } }, games: { g1: { score: 7, stars: 2 } } };
  const out = withTutorialSeen(profile);
  assert.deepEqual(out, { ...profile, tutorial_seen: true });
  assert.equal(profile.tutorial_seen, false, 'the input is not changed');
  assert.deepEqual(withTutorialSeen({ format: 1 }), { format: 1, tutorial_seen: true });
  assert.deepEqual(withTutorialSeen(null), { format: 1, tutorial_seen: true });
  assert.deepEqual(withTutorialSeen([]), { format: 1, tutorial_seen: true });
  // Seen means no longer under way: the guide does not come back after a reload.
  assert.deepEqual(withTutorialSeen({ ...profile, tutorial_guided: true }), { ...profile, tutorial_seen: true });
});
