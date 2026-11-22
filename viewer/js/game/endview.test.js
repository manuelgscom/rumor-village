// The texts of the playing bar without DOM (endview.js, phase 9-4): the goal
// near the clock, what the first rumor is waiting for, and a local install.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstRumorStatus, friendLink, goalText, isLocalHost } from './endview.js';
import { STRINGS } from './strings.js';
import { fill } from '../rumor/strings.js';

const t = STRINGS.es;
const HEADER = {
  neighbors: [
    { id: 'n001', name: 'Ana' },
    { id: 'n002', name: 'Luis' },
    { id: 'n003', name: 'Eva' },
  ],
  places: [{ id: 'square', key: 'square', name: 'plaza', kind: 'square' }],
};
const fact = { what: 'party', who: null, where: 'square', when: 'hoy 12:00', amount: null };
const rumor = (to, at) => ({ fact, text: null, to, at });
const draftOf = (r) => ({ settings: { until: null }, rumors: [r] });
const inject = { type: 'inject', id: 1, tick: 600, fact: 'f1', to: ['n001'], slots: { what: 'party', where: 'square', when: 720 } };
const tell = (who, to, id, tick) => ({ type: 'turn', id, tick, who, to, act: 'tell', fact: 'f1', action: 'say', reject: null });

test('goalText: the measure of the challenge, else the free game one, and the deadline', () => {
  assert.equal(goalText(t, null, draftOf(rumor({ neighbors: ['n001'] }, 'start'))), 'Objetivo: que se entere el mayor número de vecinos');
  const ch = { measure: 'half_tick' };
  assert.equal(goalText(t, ch, { settings: { until: '14:00' } }), 'Objetivo: que lo sepa la mitad del pueblo antes de las 14:00');
  assert.equal(goalText(t, { measure: 'unknown' }, null), '');
});

test('firstRumorStatus: waiting for the hour, then waiting for a first tell, then nothing', () => {
  const later = draftOf(rumor({ neighbors: ['n001'] }, '10:00'));
  assert.equal(firstRumorStatus(t, later, HEADER, [], 0), 'Se lo contarás a Ana a las 10:00.');
  const place = draftOf(rumor({ place: 'square' }, '09:30'));
  assert.equal(firstRumorStatus(t, place, HEADER, [], 0, 'es'), 'Se contará en la plaza a las 09:30.');
  // At the start there is nothing to wait for before the inject.
  assert.equal(firstRumorStatus(t, draftOf(rumor({ neighbors: ['n001'] }, 'start')), HEADER, [], 0), '');
  const events = [inject, tell('n001', 'n002', 2, 640)];
  assert.equal(firstRumorStatus(t, later, HEADER, events, 1), 'Ana ya lo sabe. Aún no se lo ha contado a nadie.');
  assert.equal(firstRumorStatus(t, later, HEADER, events, 2), '');
});

test('isLocalHost: loopback names only', () => {
  for (const h of ['localhost', '127.0.0.1', '::1', '[::1]']) assert.equal(isLocalHost(h), true, h);
  for (const h of ['example.org', '192.168.1.10', '', undefined]) assert.equal(isLocalHost(h), false, String(h));
});

// --- The end card (phase 9-5, package C): its texts without DOM. -------------------

import { FIXTURE, loadLog } from '../core/testing.js';
import {
  bestMark,
  hopChangeText,
  lastTryLine,
  markText,
  moverLines,
  nextStarText,
  notScoredText,
  starsOfMaxText,
  openDaySummary,
  originalText,
  lateHourText,
  reachTip,
  recommendNeighbor,
  stoppedLines,
  subjectText,
} from './endview.js';
import { chainLog, end, header } from './score/testlogs.js';

const en = STRINGS.en;

test('markText: the score with the unit of its measure, singular and plural', () => {
  assert.equal(markText(t, 'informed_end', 14, 25), '14 de 25 vecinos');
  assert.equal(markText(t, 'attend_ok', 1, 25), '1 vecino al sitio y a la hora');
  assert.equal(markText(t, 'attend_ok', 9, 25), '9 vecinos al sitio y a la hora');
  assert.equal(markText(t, 'half_tick', 45, 25, '14:00'), '45 minutos antes de las 14:00');
  assert.equal(markText(t, 'subject_tick', 1, 25, '14:00'), '1 minuto antes de las 14:00');
  assert.equal(markText(en, 'half_tick', 30, 25, '14:00'), '30 minutes before 14:00');
  assert.equal(markText(t, 'telephone_points', 12, 20), '12 puntos');
  assert.equal(markText(en, 'informed_end', 1, 25), '1 of 25 neighbors');
  assert.equal(fill(t.yourScore, { score: t.score, value: markText(t, 'informed_end', 14, 25) }), 'Tu marca: 14 de 25 vecinos');
});

test('nextStarText: what is missing, with its unit', () => {
  assert.equal(nextStarText(t, 'half_tick', { stars: 3, gap: 15 }), 'Te faltan 15 minutos para la siguiente estrella: ★★★');
  assert.equal(nextStarText(t, 'informed_end', { stars: 2, gap: 1 }), 'Te falta 1 vecino para la siguiente estrella: ★★');
  assert.equal(nextStarText(en, 'telephone_points', { stars: 2, gap: 1 }), 'You need 1 more point for the next star: ★★');
});

test('starsOfMaxText: the stars won out of three, with the mode', () => {
  assert.equal(starsOfMaxText(t, 2, 'ai'), '2 de 3 estrellas (Con IA)');
  assert.equal(starsOfMaxText(t, 0, 'rules'), '0 de 3 estrellas (Sin IA)');
  assert.equal(starsOfMaxText(en, 3, 'rules'), '3 of 3 stars (Without AI)');
});

test('notScoredText: the reason of each measure, with whom and until when', () => {
  assert.equal(notScoredText(t, 'half_tick', { deadline: '14:00' }), 'No puntúa: no lo supo la mitad del pueblo antes de las 14:00');
  assert.equal(
    notScoredText(t, 'subject_tick', { subject: fill(t.subjectPriest, { name: 'Francisco' }), deadline: '14:00' }),
    'No puntúa: el cura, Francisco, no se enteró antes de las 14:00',
  );
  assert.equal(notScoredText(t, 'telephone_points'), 'No puntúa: tu rumor no dice a qué hora');
  assert.equal(notScoredText(t, 'subject_tick', { deadline: '14:00' }), 'No puntúa: no se llegó a la medida'); // nobody to name
  assert.equal(notScoredText(t, 'other'), 'No puntúa: no se llegó a la medida');
});

test('subjectText: the priest and the guest of honor between commas, else the name', () => {
  const log = loadLog(FIXTURE); // a party for Manuel (n006); Carmen (n001) is a woman
  assert.equal(subjectText(t, log, 'priest', 'n002'), 'el cura, Luis,');
  assert.equal(subjectText(t, log, 'who', 'n006'), 'el homenajeado, Manuel,');
  assert.equal(subjectText(t, log, 'who', 'n001'), 'la homenajeada, Carmen,');
  assert.equal(fill(t.zeroStars, { why: fill(t.zeroSubjectInformed, { name: subjectText(t, log, 'who', 'n006') }) }), 'Cero estrellas: el homenajeado, Manuel, se enteró, y no debía saberlo');
  assert.equal(fill(t.zeroToldDirectly, { name: subjectText(t, log, 'priest', 'n002') }), 'el cura, Luis, lo supo por ti directamente');
});

test('lastTryLine: against the try before, only with a try before', () => {
  const last = { name: 'Luis', n: 12, total: 25 };
  assert.equal(lastTryLine(t, last, 'informed_end', 14), 'La otra vez, contándoselo a Luis: 12 de 25. Ahora, 2 más.');
  assert.equal(lastTryLine(t, last, 'informed_end', 9), 'La otra vez, contándoselo a Luis: 12 de 25. Ahora, 3 menos.');
  assert.equal(lastTryLine(t, last, 'informed_end', 12), 'La otra vez, contándoselo a Luis: 12 de 25. Ahora, los mismos.');
  assert.equal(lastTryLine(t, last, 'attend_ok', 4), 'La otra vez se lo contaste a Luis y se enteraron 12 de 25 vecinos.');
  assert.equal(lastTryLine(t, null, 'informed_end', 14), null);
});

test('originalText: the rumor as injected, in full', () => {
  const log = loadLog(FIXTURE);
  assert.equal(originalText(log, 'f1', 'es'), 'Una fiesta de Manuel en la plaza, hoy a las 22:00, 50 personas');
  assert.equal(originalText(chainLog(), null, 'en'), 'A party at the plaza, today at 21:00'); // place names are the header's
  assert.equal(originalText({ header: log.header, events: [] }, null, 'es'), null);
});

test('hopChangeText: distorted (before → after), added, forgotten, said without doubt', () => {
  const h = loadLog(FIXTURE).header;
  assert.deepEqual(hopChangeText(t, h, { slot: 'when', from: 44, to: 46, cause: 'guess' }), { text: 'cambió la hora: 22:00 → 23:00', distorted: true });
  assert.deepEqual(hopChangeText(t, h, { slot: 'where', from: null, to: 'p02', cause: null }), { text: 'añadió el sitio: bar', distorted: true });
  assert.deepEqual(hopChangeText(t, h, { slot: 'when', from: 44, to: null, cause: 'forgot' }), { text: 'se le olvidó la hora', distorted: false });
  assert.deepEqual(hopChangeText(t, h, { slot: 'who', from: 'n006', to: null, cause: 'contradiction' }), { text: 'no le pasó la persona', distorted: false });
  assert.deepEqual(hopChangeText(t, h, { slot: 'when', from: 44, to: 44, cause: 'hardened' }), { text: 'dijo la hora sin dudar: 22:00', distorted: false });
});

test('moverLines and stoppedLines: who moved it and where it stopped, with job and character', () => {
  const log = loadLog(FIXTURE);
  const movers = moverLines(t, log, 'f1', 'es');
  assert.ok(movers.length >= 1 && movers.length <= 3);
  assert.match(movers[0], /^Carmen, panadera: lo contó \d+ veces, sobre todo en el bar$/);
  const stopped = stoppedLines(t, log, 'f1', 'es');
  assert.ok(stopped.n >= stopped.lines.length);
  for (const line of stopped.lines) assert.match(line, /^\S+, [^:]+: .+$/);
  // chainLog: n003 hears it last and tells nobody.
  const quiet = stoppedLines(t, chainLog(), null, 'es');
  assert.deepEqual(quiet, { n: 1, lines: ['Vecino3, cotilla: lo cuenta casi siempre · se enteró a las 08:40'] });
  // Heard it in the last hour of the game: it shows.
  const short = chainLog();
  short.events = short.events.filter((e) => e.type !== 'arrive' && e.type !== 'end').concat(end(560));
  assert.deepEqual(stoppedLines(t, short, null, 'es').lines, ['Vecino3, cotilla: lo cuenta casi siempre · se enteró a las 08:40, casi al final']);
});

test('reachTip: a neighbor not told yet, only with strong reasons, and why', () => {
  // Six neighbors working at the bar from 11:00 to 22:00; the player told n001.
  const log = chainLog();
  const traits = { n001: 'gossip', n002: 'discreet', n003: 'exaggerator', n004: 'shy', n005: 'prudent', n006: 'prudent' };
  const base = header(6);
  log.header = {
    ...base,
    neighbors: base.neighbors.map((n) => ({ ...n, job: 'bartender', trait: traits[n.id] })),
    relations: [
      { a: 'n004', b: 'n002', type: 'friend' },
      { a: 'n004', b: 'n005', type: 'friend' },
      { a: 'n006', b: 'n004', type: 'family' },
    ],
  };
  const hours = Array.from({ length: 24 }, (_, h) => (h >= 11 && h < 22 ? 'bar' : 'home'));
  const timetable = { jobs: { bartender: hours } };
  // Two reasons each for Vecino3 (character, busy place) and Vecino4 (family and friends, busy place): more of them wins.
  assert.equal(reachTip(t, log, null, timetable, 'es'), 'Para llegar a más, prueba con Vecino4: tiene 3 de familia y amigos y pasa el día en el bar, donde hay mucha gente.');
  // Without the timetable, the busy place is not said.
  assert.equal(reachTip(t, log, null, null, 'es'), 'Para llegar a más, prueba con Vecino4: tiene 3 de familia y amigos.');
  assert.equal(reachTip(en, log, null, null, 'en'), 'To reach more, try Vecino4: has 3 family and friends.');
  // A talkative character alone is a reason.
  const lonely = { ...log, header: { ...log.header, relations: [] } };
  assert.equal(reachTip(t, lonely, null, null, 'es'), 'Para llegar a más, prueba con Vecino3: es exagerada.');
  // Nobody stands out: no name.
  const quiet = { ...lonely, header: { ...lonely.header, neighbors: lonely.header.neighbors.map((n) => ({ ...n, trait: 'discreet' })) } };
  assert.equal(reachTip(t, quiet, null, null, 'es'), t.tipNone);
  // The id the card gives to the next game.
  assert.equal(recommendNeighbor(log, null, timetable, 'es').id, 'n004');
  assert.equal(recommendNeighbor(lonely, null, null, 'es').id, 'n003');
  assert.equal(recommendNeighbor(quiet, null, null, 'es'), null);
});

test('lateHourText: the hour of the rumor after the end, and nobody came', () => {
  const late = chainLog(); // a party at the square at 21:00
  late.events = late.events.filter((e) => e.type !== 'arrive' && e.type !== 'end').concat(end(780));
  late.header = { ...late.header, params: { ...late.header.params, end_tick: 780 } }; // planned to end at 13:00
  assert.equal(lateHourText(t, late, null, 'es'), 'La fiesta era a las 21:00, después del final (13:00): nadie llegó a ir.');
  assert.equal(lateHourText(en, late, null, 'en'), 'The party was at 21:00, after the end (13:00): nobody got to go.');
  assert.equal(lateHourText(t, chainLog(), null, 'es'), null); // the game reaches 21:00
  // The same hour, but the game was planned until 24:00 and «Terminar ya» cut it at 13:00.
  const cut = { ...late, header: { ...late.header, params: { ...late.header.params, end_tick: 1440 } } };
  assert.equal(lateHourText(t, cut, null, 'es'), 'Terminaste la partida a las 13:00, antes de la fiesta (21:00): nadie llegó a ir.');
  assert.equal(lateHourText(en, cut, null, 'en'), 'You ended the game at 13:00, before the party (21:00): nobody got to go.');
  const concert = { ...cut, events: cut.events.map((e) => (e.type === 'inject' ? { ...e, what: 'concert' } : e)) };
  assert.equal(lateHourText(t, concert, null, 'es'), 'Terminaste la partida a las 13:00, antes del concierto (21:00): nadie llegó a ir.');
});

test('bestMark: the best score before, in the same town, measure and mode', () => {
  const settings = { town: 7, type: 'village', neighbors: 25, mode: 'rules' };
  const games = [
    { id: 'a', settings, challenge: null },
    { id: 'b', settings, challenge: 'tutorial' }, // the tutorial measures the reach too
    { id: 'c', settings: { ...settings, mode: 'ai' }, challenge: null }, // another mode
    { id: 'd', settings: { ...settings, town: 8 }, challenge: null }, // another town
    { id: 'e', settings, challenge: 'fill-the-square' }, // another measure
    { id: 'f', settings, challenge: null }, // no score saved
    { id: 'now', settings, challenge: null }, // this game
  ];
  const marks = { a: { score: 12 }, b: { score: 15 }, c: { score: 20 }, d: { score: 21 }, e: { score: 22 }, now: { score: 24 } };
  const challenges = [{ id: 'tutorial', measure: 'informed_end' }, { id: 'fill-the-square', measure: 'attend_ok' }];
  const now = { id: 'now', settings, measure: 'informed_end', mode: 'rules' };
  assert.equal(bestMark({ games, marks, challenges }, now), 15);
  assert.equal(bestMark({ games, marks, challenges }, { ...now, measure: 'attend_ok' }), 22);
  assert.equal(bestMark({ games: [], marks, challenges }, now), null);
  assert.equal(bestMark(null, now), null);
  assert.equal(fill(t.bestMark, { value: markText(t, 'informed_end', 15, 25) }), 'Tu mejor marca en este pueblo: 15 de 25 vecinos.');
});

test('codeWhat: what the share code is for, with the name of the menu entry', () => {
  assert.equal(fill(t.codeWhat, { friend: t.menuFriend }), '(código para pegar en «Reto del amigo»)');
  assert.equal(fill(en.codeWhat, { friend: en.menuFriend }), '(code to paste in «Friend’s challenge»)');
});

test('openDaySummary: the ⤢ of the summary card, when it is on the page', () => {
  let clicked = 0;
  const doc = { querySelector: (sel) => (sel === '#summary .sm-expand' ? { click: () => clicked++ } : null) };
  assert.equal(openDaySummary(doc), true);
  assert.equal(clicked, 1);
  assert.equal(openDaySummary({ querySelector: () => null }), false);
  assert.equal(openDaySummary(null), false);
});

test('friendLink: the web page itself, or the public web version from this computer', () => {
  const web = { hostname: 'example.org', origin: 'https://example.org', pathname: '/rumor/play-web.html' };
  assert.equal(friendLink('RV1-ab', web), 'https://example.org/rumor/play-web.html?play=1&code=RV1-ab');
  const local = { hostname: '127.0.0.1', origin: 'http://127.0.0.1:8080', pathname: '/' };
  assert.equal(friendLink('RV1-ab', local, ''), null);
  assert.equal(friendLink('RV1 ab', local, 'https://example.org/play-web.html'), 'https://example.org/play-web.html?play=1&code=RV1%20ab');
});
