// Tests of «Cómo funciona», part 1 of the tutorial (howto.js), and of the help
// of the game (help.js gameHelp): the cards, the intro option, the cast, the
// controls of each card, the texts in both languages and the glossary of the
// legend (phase 9-5).

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FIXTURE, loadLog } from '../core/testing.js';
import { STRINGS as NEIGHBOR_STRINGS, TRAITS } from '../core/neighbors.js';
import { ASK, SHOWCASE } from '../core/showcase.js';
import { gameHelp } from './help.js';
import { HOWTO_KEYS, howtoCast, howtoNav, howtoUntil, introOf } from './howto.js';
import { STRINGS } from './strings.js';

/** The shape of a value: the same keys (and list lengths) in es and en. */
const shape = (v) => {
  if (Array.isArray(v)) return v.map(shape);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, shape(v[k])]));
  return typeof v;
};

test('eight cards, in the order of the ficha', () => {
  assert.deepEqual(HOWTO_KEYS, ['village', 'start', 'meet', 'ai', 'move', 'distort', 'goal', 'read']);
});

test('the intro option: first, only, or part 2 straight away', () => {
  assert.equal(introOf('first'), 'first');
  assert.equal(introOf('only'), 'only');
  for (const v of [false, undefined, null, true, 'yes', 0]) assert.equal(introOf(v), false, String(v));
});

test('the controls of each card: back from the second, skip but on the last, the last hands over', () => {
  const total = HOWTO_KEYS.length;
  for (const intro of ['first', 'only']) {
    assert.deepEqual(howtoNav(0, total, intro), { back: false, next: 'next', skip: true });
    for (let k = 1; k < total - 1; k += 1) assert.deepEqual(howtoNav(k, total, intro), { back: true, next: 'next', skip: true });
  }
  assert.deepEqual(howtoNav(total - 1, total, 'first'), { back: true, next: 'game', skip: false });
  assert.deepEqual(howtoNav(total - 1, total, 'only'), { back: true, next: 'menu', skip: false });
});

test('the hour of «Tu objetivo» only when part 2 follows', () => {
  const draft = { settings: { until: '13:00' } };
  assert.equal(howtoUntil('first', draft), '13:00');
  assert.equal(howtoUntil('only', draft), null, '«Cómo se juega»: no game about to be played');
  assert.equal(howtoUntil('first', { settings: { until: null } }), null);
  assert.equal(howtoUntil('first', { settings: { until: 'tarde' } }), null);
  assert.equal(howtoUntil('first', null), null);
});

test('the cast: one neighbor per character, the first by id, the most talkative first', () => {
  const header = {
    places: [
      { id: 'p01', key: 'square', name: 'plaza', kind: 'public' },
      { id: 'p13', key: 'lower_quarter', name: 'barrio bajo', kind: 'home' },
    ],
    neighbors: [
      { id: 'n007', name: 'Inma', gender: 'f', job: 'baker', trait: 'gossip', home: 'p13' },
      { id: 'n006', name: 'Luis', gender: 'm', job: 'clerk', trait: 'discreet', home: 'p13' },
      { id: 'n001', name: 'Carmen', gender: 'f', job: 'baker', trait: 'gossip', home: 'p13' },
      { id: 'n003', name: 'Manuel', gender: 'm', job: 'bartender', trait: 'exaggerator', home: 'p13' },
      { id: 'n002', name: 'Ana', gender: 'f', job: 'seamstress', trait: 'sociable', home: 'p13' },
      { id: 'n004', name: 'Elena', gender: 'f', job: 'teacher', trait: 'prudent', home: 'p13' },
    ],
    relations: [],
  };
  const cast = howtoCast(header, null, 'es');
  // No shy neighbor in this town: left out.
  assert.deepEqual(
    cast.map((p) => p.name),
    ['Carmen', 'Ana', 'Manuel', 'Elena', 'Luis'],
  );
  assert.deepEqual(
    cast.map((p) => p.trait),
    TRAITS.filter((t) => t !== 'shy'),
  );
  for (const p of cast) {
    assert.ok(p.job && p.traitName && p.traitIcon, p.name);
    assert.equal(p.traitPhrase, NEIGHBOR_STRINGS.es.phrase[p.trait]);
    assert.equal(p.usual, null, 'no timetable yet');
  }
  // With the timetable, where they spend the day.
  const hours = Array.from({ length: 24 }, (_, h) => (h >= 8 && h < 14 ? 'square' : 'home'));
  const withDay = howtoCast(header, { jobs: { baker: hours } }, 'es');
  assert.deepEqual(withDay[0].usual, { key: 'square', name: 'plaza', from: 8, to: 14 });
  assert.deepEqual(howtoCast(null, null, 'es'), []);
  // The hand-written log: every character it has, each once.
  const { header: fixture } = loadLog(FIXTURE);
  const fromLog = howtoCast(fixture, null, 'en');
  assert.equal(new Set(fromLog.map((p) => p.trait)).size, fromLog.length);
  assert.ok(fromLog.length >= 1);
});

test('the texts of «Cómo funciona», in both languages with the same keys', () => {
  assert.deepEqual(shape(STRINGS.es.howto), shape(STRINGS.en.howto));
  for (const lang of ['es', 'en']) {
    const t = STRINGS[lang].howto;
    for (const key of HOWTO_KEYS) {
      assert.ok(t.title[key], `${lang} title ${key}`);
      const paras = t.body[key];
      assert.ok(Array.isArray(paras) && paras.length >= 1 && paras.length <= 3, `${lang} ${key}: one to three paragraphs`);
      for (const p of paras) {
        // Only the size of the village is filled: no other figure in the texts.
        for (const [, name] of p.matchAll(/\{(\w+)\}/g)) assert.equal(name, 'n', `${lang} ${key}: unknown {${name}}`);
        assert.ok(p.length < 220, `${lang} ${key}: short paragraphs`);
      }
    }
    assert.match(t.body.village[0], /\{n\}/, `${lang}: the size of the village comes from the header`);
    assert.match(t.goalUntil, /\{time\}/);
    assert.doesNotMatch(t.goalAny, /\{/);
    assert.match(t.step, /\{n\}.*\{total\}/);
    assert.match(t.usual, /\{place\}/);
    assert.match(t.show.think, /\{name\}/);
    assert.equal(t.readMore.length, 4);
  }
  const es = STRINGS.es.howto;
  assert.equal(es.label, 'Cómo funciona');
  assert.equal(es.skip, 'Saltar explicación');
  assert.equal(es.toGame, 'Preparar mi rumor ▶');
  assert.deepEqual(
    HOWTO_KEYS.map((k) => es.title[k]),
    ['Conoce a tus vecinos', 'Tú empiezas un rumor', 'Corre cuando se cruzan', 'Vecinos con IA', 'Dónde y cuándo mueven a la gente', 'El rumor se deforma', 'Tu objetivo', 'Cómo leer el pueblo'],
  );
  // Card 4 says what Sin IA misses; card 6 separates forgetting from distorting.
  assert.match(es.body.ai.join(' '), /Sin IA te pierdes/);
  assert.match(es.body.distort.join(' '), /incompleto/);
  assert.match(es.body.distort.join(' '), /deformado/);
  assert.match(es.goalUntil, /aunque le llegue deformado/);
  // Relations are named before card 3 uses them; the end game, in card 6; the cast note in card 1.
  assert.match(es.body.village[0], /familia, amigos y algún rival/);
  // The guessing game by the name it has on screen (game/strings.js whoGuessTitle).
  assert.match(es.body.distort.join(' '), /«Adivina: ¿quién cambió el rumor\?»/);
  assert.match(es.show.think, /^Otro momento: ¿qué pensó \{name\}\?/);
  // The six shown are one of each character; every other neighbor has one of them too (phase 9-6).
  assert.match(es.body.village[0], /^En este pueblo viven \{n\} vecinos; al preparar una partida puedes elegir pueblos de 10 a 100\./);
  assert.match(es.body.village[1], /Cada vecino tiene uno de estos seis caracteres; aquí tienes uno de cada, y estos seis viven en todos los pueblos:$/);
  assert.match(es.castNote, /^Los demás vecinos también tienen uno de estos seis caracteres\./);
  assert.match(es.castNote, /su oficio, su carácter, su casa y sus amigos cambian/);
  // The stars of the challenges start at 0; the help says that a challenge counts what it says.
  assert.match(es.body.goal.join(' '), /de 0 a 3 estrellas: una por cada meta que alcanzas/);
  assert.match(STRINGS.es.helpGame.goal[1], /en un reto, cuenta lo que diga el reto/);
  assert.doesNotMatch(STRINGS.es.helpGame.back[1], /marca/, '«marca» is the score, not a point of the timeline');
  // Card 4: the examples come from another game, in another village.
  assert.match(es.show.think, /\(de otra partida, en otro pueblo\)/);
  assert.match(es.show.other, /otra partida, en otro pueblo/);
  // The relations, said as core/neighbors.js says them.
  assert.match(NEIGHBOR_STRINGS.es.relationsHint, /familia y a los amigos; a un rival, casi nunca/);
  assert.match(es.body.meet.join(' '), /familia y a los amigos; a un rival, casi nunca/);
});

test('card 4 shows a moment only the AI has (ASK), and the decision folded', () => {
  for (const lang of ['es', 'en']) {
    const a = ASK[lang];
    assert.ok(a.forgot && a.rules, lang);
    // The question and the answer the card draws: the two lines after the greeting.
    const [q, r] = a.talk.slice(1, 3);
    assert.equal(q.who, 'Yolanda');
    assert.equal(r.who, 'Ana');
    assert.match(q.text, /\?/);
  }
  assert.equal(ASK.en.translated, true);
  assert.equal(STRINGS.es.howto.show.rules, 'Sin IA');
});

test('the real exchange of card 4 has what the card draws, and English says it is a translation', () => {
  for (const lang of ['es', 'en']) {
    const s = SHOWCASE[lang];
    assert.ok(s.talk.length >= 2 && s.talk.every((l) => l.who && l.text), lang);
    assert.ok(s.rules.who && s.rules.text, lang);
    assert.ok(s.think.who && s.think.read && s.think.decided && s.think.checked, lang);
  }
  assert.equal(SHOWCASE.es.translated, false);
  assert.equal(SHOWCASE.en.translated, true);
  assert.ok(STRINGS.en.howto.show.translated);
  // «Decidió contárselo…»: the label and the decision, lowered, make one sentence.
  assert.equal(STRINGS.es.howto.show.decided, 'Decidió');
  assert.equal(STRINGS.en.howto.show.decided, 'Decided to');
  assert.match(SHOWCASE.es.think.decided, /^Contárselo/);
});

test('the end line inside the game is the end of the game, not of the day', () => {
  assert.match(STRINGS.es.endGame, /^Fin de la partida: \{n\} de \{total\} vecinos se enteraron$/);
  assert.match(STRINGS.en.endGame, /\{n\}.*\{total\}/);
  assert.match(STRINGS.es.end, /^Fin del día/, 'the recording viewer keeps its line');
});

test('the legend says the glossary, in its order', () => {
  assert.deepEqual(STRINGS.es.legend, [
    ['unknown', 'no se ha enterado'],
    ['correct', 'se ha enterado'],
    ['incomplete', 'le llegó incompleto'],
    ['wrong', 'le llegó deformado'],
  ]);
  assert.deepEqual(
    STRINGS.en.legend.map(([v]) => v),
    STRINGS.es.legend.map(([v]) => v),
  );
});

test('the help of the game: who decides, what to look at, no keys of the recording viewer', () => {
  assert.deepEqual(shape(STRINGS.es.helpGame), shape(STRINGS.en.helpGame));
  for (const lang of ['es', 'en']) {
    const t = STRINGS[lang];
    for (const mode of ['ai', 'rules']) {
      const play = gameHelp(t, { mode, play: true });
      const seen = gameHelp(t, { mode, play: false });
      assert.equal(play.who, t.helpGame.who[mode]);
      assert.ok(play.items.includes(t.helpGame.stop), `${lang} ${mode}: «Terminar ya» while playing`);
      assert.ok(!seen.items.includes(t.helpGame.stop), `${lang} ${mode}: not in a game played before`);
      for (const k of ['goal', 'counter', 'speeds', 'fast', 'back', 'camera', 'summary', 'icons']) assert.ok(play.items.includes(t.helpGame[k]), `${lang} ${mode} ${k}`);
      assert.ok(play.items.includes(t.helpGame.think[mode]));
      // No single-letter keys (D, H, P, N): the recording viewer's.
      for (const [k] of play.controls) assert.doesNotMatch(k, /^[A-Z]( · [A-Z])?$/, `${lang}: key ${k}`);
      assert.equal(gameHelp(t, { mode, play: true, touch: true }).controls, t.controlsTouch);
    }
  }
  const es = STRINGS.es.helpGame;
  assert.match(es.who.ai, /Con IA/);
  assert.match(es.who.ai, /el juego lo comprueba/);
  assert.match(es.who.rules, /Sin IA/);
  // Sin IA «¿Qué pensó?» is still there: the rule and the dice, not a thought.
  assert.match(es.who.rules, /en «¿Qué pensó\?» verás la regla y el dado, no lo que pensó/);
  assert.equal(es.stop[0], 'Terminar ya');
  assert.match(es.speeds[1], /se paran un momento en cada bocadillo para que lo leas/);
  assert.match(es.fast[1], /pausas de lectura/);
  assert.equal(es.back[0], '‹ ›');
  assert.equal(es.camera[0], 'Cámara automática');
  assert.equal(es.summary[0], 'Resumen del día');
  assert.match(es.icons[1], /«\?» olvidó un dato; «≈» rellenó a ojo un dato que había olvidado/);
  assert.equal(es.think.ai[0], '¿Qué pensó?');
  assert.ok(es.icons[0].includes('?'));
  // Outside the game the help keeps its keys.
  assert.ok(STRINGS.es.controls.some(([k]) => k === 'D'));
  // Inside the game the director is «Cámara automática»; the headline says «se han enterado».
  assert.equal(STRINGS.es.camera, 'Cámara automática');
  for (const lang of ['es', 'en']) for (const k of ['camera', 'cameraOn', 'cameraOff']) assert.ok(STRINGS[lang][k], `${lang} ${k}`);
  assert.match(STRINGS.es.calm, /se han enterado de \{what\}/);
  assert.doesNotMatch(STRINGS.es.calm, /saben/);
  assert.match(STRINGS.en.calm, /heard about \{what\}/);
});
