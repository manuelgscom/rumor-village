// «Preparar la partida» and the profile, without DOM (prepare.js, profile.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canAddRumor,
  canStart,
  challengeLocks,
  challengeRumor,
  DEFAULT_SETTINGS,
  editorFits,
  effectiveDraft,
  emptyRumor,
  exampleFact,
  exampleRumor,
  extractedFact,
  factSentence,
  firstOfRow,
  fitToHeader,
  hardBlockers,
  indexAfterRemove,
  previewOf,
  isEmptyDraft,
  modeLabel,
  modeOfHeader,
  newDraft,
  normalizeBets,
  normalizeDraft,
  NEIGHBORS,
  neighborsHint,
  neighborsOptions,
  normalizeSettings,
  measureUnit,
  villageSizeOf,
  parseCarry,
  raceAvailable,
  randomTown,
  restoreVillage,
  retryCarry,
  rumorIssues,
  rumorSummary,
  rumorTitle,
  settingsErrors,
  stashVillage,
  startBlockers,
  WHATS,
  atHours,
  atOutside,
  attendOf,
  atWindow,
  betRumor,
  clockText,
  countText,
  lastTryText,
  nameList,
  namesOf,
  pickRecipient,
  raceStashOf,
  readyCard,
  restoreRace,
  switchAt,
  switchTo,
  textPending,
  townChanges,
  windowText,
  yourPartText,
  endSentence,
  subjectWarning,
  blockerLines,
  cardLines,
  challengeSubject,
  fieldErrorText,
  fixedPartText,
  proposeText,
  sortCards,
  suggestNeighbor,
  firstByName,
  sameVillage,
  lastVillage,
  villageNote,
  defaultWhenTime,
  lateWarning,
  goalLines,
  isBlankRumor,
  MAX_TO,
  profileLine,
  shortNames,
  startLabel,
  starsText,
  subjectText,
  tellHour,
  toLimit,
} from './prepare.js';
import { markGuided, markTutorial, normalizeProfile, offerTutorial, prefsOf, starsOf, starText, updateProfile, wantsTutorial, withPrefs } from './profile.js';
import { STRINGS } from './strings.js';
import { neighborProfile } from '../core/neighbors.js';

const HEADER = {
  lang: 'es',
  policy: 'baseline',
  seed: 417,
  neighbors: [
    { id: 'n001', name: 'Carmen' },
    { id: 'n002', name: 'Luis' },
    { id: 'n003', name: 'Rosa' },
  ],
  places: [
    { id: 'p01', key: 'square', name: 'plaza', kind: 'public' },
    { id: 'p02', key: 'bar', name: 'bar', kind: 'public' },
    { id: 'p13', key: 'upper_quarter', name: 'barrio alto', kind: 'home' },
  ],
  // The row of a telephone game: n002 → n003 → n001.
  relations: [
    { a: 'n002', b: 'n003', type: 'friend' },
    { a: 'n003', b: 'n001', type: 'family' },
  ],
};

const party = (to = { place: 'square' }) => ({
  fact: { what: 'party', who: 'n001', where: 'square', when: 'hoy 21:00', amount: 50 },
  text: null,
  to,
  at: 'start',
});

const FILL = {
  format: 1,
  id: 'fill-the-square',
  settings: { type: 'village', neighbors: 25, town: 417, trait_mix: 0, distortion: 'normal' },
  rumor: { fact: { what: 'party', who: null, where: 'square', when: 'hoy 21:00', amount: null } },
  open: ['to', 'at', 'mode'],
  max_to: 2,
  to_place: false,
};

test('settings: defaults, valid values kept, wrong ones replaced', () => {
  assert.deepEqual(normalizeSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(settingsErrors(DEFAULT_SETTINGS), []);
  const s = normalizeSettings({ type: 'telephone', neighbors: 100, town: 7, lang: 'en', trait_mix: -2, distortion: 'high', mode: 'rules', until: '15:00' });
  assert.deepEqual(s, { type: 'telephone', neighbors: 100, town: 7, lang: 'en', trait_mix: -2, distortion: 'high', mode: 'rules', until: '15:00' });
  const bad = { type: 'city', neighbors: 30, town: -1, lang: 'fr', trait_mix: 3, distortion: 'extreme', mode: 'god', until: '25:00' };
  assert.deepEqual(settingsErrors(bad).sort(), ['distortion', 'lang', 'mode', 'neighbors', 'town', 'trait_mix', 'type', 'until']);
  assert.deepEqual(settingsErrors(normalizeSettings(bad)), []);
  assert.equal(normalizeSettings({ town: '12' }).town, 12);
  assert.equal(normalizeSettings({}, { lang: 'en' }).lang, 'en');
});

test('9-6 settings: the five sizes of a village, 25 by default', () => {
  assert.deepEqual(NEIGHBORS, [10, 25, 50, 70, 100]);
  assert.equal(DEFAULT_SETTINGS.neighbors, 25);
  for (const n of NEIGHBORS) {
    assert.equal(normalizeSettings({ neighbors: n }).neighbors, n);
    assert.equal(normalizeSettings({ neighbors: String(n) }).neighbors, n);
    assert.deepEqual(settingsErrors({ ...DEFAULT_SETTINGS, neighbors: n }), []);
  }
  for (const n of [0, 20, 30, 99, 101, '25x', null]) {
    assert.equal(normalizeSettings({ neighbors: n }).neighbors, 25, String(n));
    if (typeof n === 'number') assert.deepEqual(settingsErrors({ ...DEFAULT_SETTINGS, neighbors: n }), ['neighbors'], String(n));
  }
  // The selector: one button per size, in order.
  assert.deepEqual(neighborsOptions(), [
    { value: 10, label: '10' },
    { value: 25, label: '25' },
    { value: 50, label: '50' },
    { value: 70, label: '70' },
    { value: 100, label: '100' },
  ]);
  // The hint: only above 25, and never in a row.
  for (const n of [10, 25]) assert.equal(neighborsHint({ type: 'village', neighbors: n }, STRINGS.es), null);
  for (const n of [50, 70, 100]) assert.equal(neighborsHint({ type: 'village', neighbors: n }, STRINGS.es), STRINGS.es.neighborsMore);
  assert.equal(neighborsHint({ type: 'telephone', neighbors: 100 }, STRINGS.es), null);
  assert.match(STRINGS.es.neighborsMore, /más de 25 vecinos/);
  // The last village keeps any of the sizes.
  assert.equal(lastVillage([{ settings: { type: 'village', neighbors: 70, town: 3, trait_mix: 0 } }]).neighbors, 70);
  assert.equal(lastVillage([{ settings: { type: 'village', neighbors: 30, town: 3, trait_mix: 0 } }]).neighbors, 25);
});

test('9-6 villageSizeOf: party-N of the header, else its count of neighbors', () => {
  const people = (n) => Array.from({ length: n }, (_, i) => ({ id: `n${String(i + 1).padStart(3, '0')}` }));
  for (const n of [10, 25, 50, 70, 100]) assert.equal(villageSizeOf({ scenario: `party-${n}` }), n);
  assert.equal(villageSizeOf({ scenario: 'party-30' }), null);
  assert.equal(villageSizeOf({ scenario: 'telephone-20', neighbors: people(20) }), null);
  assert.equal(villageSizeOf({ scenario: 'custom', neighbors: people(50) }), 50);
  assert.equal(villageSizeOf({ neighbors: people(7) }), null);
  assert.equal(villageSizeOf(null), null);
});

test('settings: without the model the mode is «Sin IA»', () => {
  assert.equal(normalizeSettings({ mode: 'ai' }, { aiAvailable: false }).mode, 'rules');
  assert.equal(normalizeSettings({ mode: 'ai' }, { aiAvailable: true }).mode, 'ai');
  assert.equal(normalizeSettings({}, { aiAvailable: true }).mode, 'ai');
});

test('randomTown: an integer from 1 to 9999', () => {
  assert.equal(randomTown(() => 0), 1);
  assert.equal(randomTown(() => 0.99999999), 9999);
  for (let i = 0; i < 50; i++) {
    const n = randomTown();
    assert.ok(Number.isInteger(n) && n >= 1 && n <= 9999);
  }
});

test('«Empezar» is disabled without a rumor and with a rumor half done', () => {
  const d = normalizeDraft(newDraft(DEFAULT_SETTINGS));
  assert.equal(canStart(d), false);
  assert.deepEqual(startBlockers(d), ['noRumor']);
  const half = normalizeDraft({ ...d, rumors: [{ ...emptyRumor(), fact: { ...emptyRumor().fact, what: 'party' } }] });
  assert.deepEqual(startBlockers(half), ['incomplete']);
  assert.deepEqual(rumorIssues(half.rumors[0], half.settings), ['to']);
  const ok = normalizeDraft({ ...d, rumors: [party()] });
  assert.equal(canStart(ok), true);
  assert.deepEqual(startBlockers(ok, { checkRunning: true }), ['check']);
  assert.deepEqual(startBlockers(ok, { aiAvailable: false }), ['noAi']);
  assert.deepEqual(startBlockers(ok, { violations: [{ field: 'to', error: 'max_to' }] }), ['challenge']);
  assert.deepEqual(startBlockers(ok, { busy: true }), ['busy']);
});

test('rumor: `to` by place or by neighbors, `at` at the start or at a half hour', () => {
  const s = DEFAULT_SETTINGS;
  assert.deepEqual(rumorIssues(party({ neighbors: ['n002'] }), s), []);
  assert.deepEqual(rumorIssues(party({ neighbors: [] }), s), ['to']);
  assert.deepEqual(rumorIssues({ ...party(), at: '09:30' }, s), []);
  assert.deepEqual(rumorIssues({ ...party(), at: '09:15' }, s), ['at']);
  assert.deepEqual(rumorIssues({ ...party(), fact: { ...party().fact, what: 'fire' } }, s), ['what']);
});

test('Telephone: one rumor only, to the first of the row, at the start', () => {
  assert.equal(firstOfRow(HEADER), 'n002');
  assert.equal(firstOfRow({ neighbors: [{ id: 'n009' }] }), 'n009');
  assert.equal(firstOfRow({}), null);
  const d = normalizeDraft(
    { settings: { type: 'telephone' }, rumors: [{ ...party({ place: 'bar' }), at: '10:00' }, party()], race: { at: 'hoy 14:00', pick: 1 } },
    { header: HEADER },
  );
  assert.equal(d.rumors.length, 1);
  assert.deepEqual(d.rumors[0].to, { neighbors: ['n002'] });
  assert.equal(d.rumors[0].at, 'start');
  assert.equal(d.race, null);
  assert.equal(canAddRumor(d), false);
  assert.deepEqual(rumorIssues({ ...party(), to: null }, d.settings), []);
  assert.equal(canAddRumor(normalizeDraft({ settings: { type: 'village' }, rumors: [party()] })), true);
});

test('race: only with two rumors in the village, and with its hour', () => {
  const two = { settings: { type: 'village' }, rumors: [party(), party({ place: 'bar' })] };
  assert.equal(raceAvailable(normalizeDraft(two)), true);
  assert.equal(raceAvailable(normalizeDraft({ ...two, rumors: [party()] })), false);
  assert.equal(raceAvailable(normalizeDraft({ ...two, settings: { type: 'telephone' } }, { header: HEADER })), false);
  assert.deepEqual(normalizeDraft({ ...two, race: { at: 'hoy 14:00', pick: 1 } }).race, { at: 'hoy 14:00', pick: 1 });
  assert.equal(normalizeDraft({ ...two, race: { at: null, pick: 0 } }).race, null);
  assert.equal(normalizeDraft({ ...two, rumors: [party()], race: { at: 'hoy 14:00', pick: 0 } }).race, null);
});

test('a change of language rewrites the hours of rumors, bets and race', () => {
  const d = normalizeDraft({
    settings: { lang: 'en' },
    rumors: [party(), party({ place: 'bar' })],
    bets: { attend: 3, half: 'mañana 10:30', last: 'n002' },
    race: { at: 'hoy 14:00', pick: 0 },
  });
  assert.equal(d.rumors[0].fact.when, 'today 21:00');
  assert.equal(d.bets.half, 'tomorrow 10:30');
  assert.equal(d.race.at, 'today 14:00');
});

test('bets: null when nothing is bet; each part checked', () => {
  assert.equal(normalizeBets(null), null);
  assert.equal(normalizeBets({ attend: '', half: null, last: '' }), null);
  assert.deepEqual(normalizeBets({ attend: '12', half: 'hoy 15:00', last: 'n003' }), { attend: 12, half: 'hoy 15:00', last: 'n003' });
  assert.deepEqual(normalizeBets({ attend: -1, half: 'luego', last: 'n003' }), { attend: null, half: null, last: 'n003' });
});

test('challenge: fixed settings and slots locked, open parts editable', () => {
  const locks = challengeLocks(FILL);
  assert.deepEqual([...locks.settings].sort(), ['distortion', 'neighbors', 'town', 'trait_mix', 'type']);
  assert.deepEqual([...locks.slots].sort(), ['amount', 'what', 'when', 'where', 'who']);
  assert.equal(locks.to, false);
  assert.equal(locks.at, false);
  assert.equal(locks.maxTo, 2);
  assert.equal(locks.toPlace, false);
  const free = challengeLocks(null);
  assert.equal(free.settings.size + free.slots.size, 0);
  assert.equal(free.toPlace, true);
  // A challenge with mode not open locks the mode too.
  assert.ok(challengeLocks({ ...FILL, open: ['to'] }).settings.has('mode'));
  assert.ok(challengeLocks({ ...FILL, open: ['to', 'at', 'mode', 'trait_mix'] }).settings.has('trait_mix') === false);
});

test('challenge: the draft keeps its fixed parts whatever the player sends', () => {
  const tampered = {
    settings: { type: 'village', neighbors: 100, town: 5, trait_mix: 2, distortion: 'high', mode: 'rules', lang: 'en' },
    rumors: [
      { fact: { what: 'fine', who: 'n002', where: 'bar', when: 'hoy 10:00', amount: 9 }, text: null, to: { neighbors: ['n001', 'n002', 'n003'] }, at: '10:00' },
      party(),
    ],
    challenge: 'fill-the-square',
  };
  const d = normalizeDraft(tampered, { challenge: FILL });
  assert.equal(d.challenge, 'fill-the-square');
  assert.deepEqual(d.settings, { ...DEFAULT_SETTINGS, town: 417, mode: 'rules', lang: 'en' });
  assert.equal(d.rumors.length, 1);
  // The fixed parts go as the challenge file writes them.
  assert.deepEqual(d.rumors[0].fact, FILL.rumor.fact);
  assert.deepEqual(d.rumors[0].to, { neighbors: ['n001', 'n002'] });
  assert.equal(d.rumors[0].at, '10:00');
  // No place allowed: a place becomes an empty list of neighbors.
  const placed = normalizeDraft({ ...tampered, rumors: [party({ place: 'square' })] }, { challenge: FILL });
  assert.deepEqual(placed.rumors[0].to, { neighbors: [] });
  assert.equal(canStart(placed), false);
  // Its starting rumor: the fixed parts, the rest empty.
  const r = challengeRumor(FILL);
  assert.deepEqual(r.fact, FILL.rumor.fact);
  assert.deepEqual(r.to, { neighbors: [] });
  assert.equal(r.at, 'start');
});

test('extraction: only the seven kinds; names become ids and keys', () => {
  assert.equal(WHATS.length, 7);
  const got = extractedFact({ what: 'fiesta', who: 'carmen', where: 'Plaza', when: 'hoy 21:00', amount: 50 }, HEADER, 'es');
  assert.deepEqual(got, { fact: { what: 'party', who: 'n001', where: 'square', when: 'hoy 21:00', amount: 50 }, outside: null });
  const fire = extractedFact({ what: 'incendio', who: 'Nadie', where: 'barrio alto', when: 'mañana 9:30', amount: null }, HEADER, 'en');
  assert.deepEqual(fire, { fact: { what: null, who: null, where: null, when: 'tomorrow 09:30', amount: null }, outside: 'incendio' });
  assert.deepEqual(extractedFact({ what: 'party' }, HEADER, 'es').fact.what, 'party');
  assert.deepEqual(extractedFact(null, HEADER, 'es'), { fact: { what: null, who: null, where: null, when: null, amount: null }, outside: null });
  // With the type empty, the rumor cannot be accepted until one of the seven is picked.
  assert.deepEqual(rumorIssues({ ...party(), fact: fire.fact }, DEFAULT_SETTINGS), ['what']);
});

test('empty draft: no rumor and no challenge', () => {
  assert.equal(isEmptyDraft(null), true);
  assert.equal(isEmptyDraft(newDraft(DEFAULT_SETTINGS)), true);
  assert.equal(isEmptyDraft({ ...newDraft(DEFAULT_SETTINGS), rumors: [party()] }), false);
  assert.equal(isEmptyDraft({ ...newDraft(DEFAULT_SETTINGS), challenge: 'fill-the-square' }), false);
});

test('mode label from a header: «Con IA» / «Sin IA»', () => {
  assert.equal(modeOfHeader(HEADER), 'rules');
  assert.equal(modeOfHeader({ policy: 'model' }), 'ai');
  assert.equal(modeLabel(modeOfHeader(HEADER), STRINGS.es), 'Sin IA');
  assert.equal(modeLabel(modeOfHeader({ policy: 'model' }), STRINGS.es), 'Con IA');
  assert.equal(modeLabel('rules', STRINGS.en), 'Without AI');
  assert.equal(modeLabel('ai', STRINGS.en), 'With AI');
});

test('profile: stars keep the maximum, games get their mark, the rest stays', () => {
  const p0 = { format: 1, tutorial_seen: true, stars: { 'fill-the-square': { ai: 2, rules: 1 } }, games: { old: { score: 4, stars: 1 } }, extra: 'kept' };
  const p1 = updateProfile(p0, { id: 'g1', challenge: 'fill-the-square', mode: 'ai', score: '7', stars: 1 });
  assert.deepEqual(p1.stars['fill-the-square'], { ai: 2, rules: 1 });
  assert.deepEqual(p1.games.g1, { score: '7', stars: 1 });
  assert.deepEqual(p1.games.old, { score: 4, stars: 1 });
  assert.equal(p1.extra, 'kept');
  assert.equal(p1.tutorial_seen, true);
  const p2 = updateProfile(p1, { id: 'g2', challenge: 'fill-the-square', mode: 'rules', score: 9, stars: 3 });
  assert.deepEqual(p2.stars['fill-the-square'], { ai: 2, rules: 3 });
  const p3 = updateProfile({}, { id: 'g3', challenge: 'patient-zero', mode: 'ai', score: 2, stars: 5 });
  assert.deepEqual(p3.stars['patient-zero'], { ai: 3, rules: 0 });
  const free = updateProfile(null, { id: 'g4', challenge: null, mode: 'ai', score: 12, stars: null });
  assert.deepEqual(free.stars, {});
  assert.deepEqual(free.games.g4, { score: 12, stars: null });
  assert.equal(p0.games.g1, undefined, 'the input is not changed');
});

test('profile: tutorial, stars per challenge, star text', () => {
  assert.deepEqual(normalizeProfile('nonsense'), { format: 1, tutorial_seen: false, stars: {}, games: {} });
  assert.equal(markTutorial({}).tutorial_seen, true);
  assert.equal(offerTutorial({}, []), true);
  assert.equal(offerTutorial({}, [{ id: 'g' }]), false);
  assert.equal(offerTutorial({ tutorial_seen: true }, []), false);
  assert.deepEqual(starsOf({ stars: { a: { ai: 2 } } }, 'a'), { ai: 2, rules: 0 });
  assert.deepEqual(starsOf({}, 'a'), { ai: 0, rules: 0 });
  assert.equal(starText(2), '★★☆');
  assert.equal(starText(null), '☆☆☆');
});

// --- Phase 9-2: what «Empezar» starts, the example, Pueblo ↔ Teléfono, the guided game ---

const kind = (what, to = { place: 'square' }) => ({ ...party(to), fact: { ...party().fact, what } });

test('effective draft: the rumor in the editor goes with the draft, in its place or at the end', () => {
  const d = normalizeDraft({ settings: { type: 'village' }, rumors: [kind('party'), kind('wedding'), kind('concert')] });
  // Editing the wedding into a party, without saving: «Empezar» starts the party.
  const eff = normalizeDraft(effectiveDraft(d, { index: 1, rumor: kind('party') }));
  assert.deepEqual(eff.rumors.map((r) => r.fact.what), ['party', 'party', 'concert']);
  assert.deepEqual(d.rumors.map((r) => r.fact.what), ['party', 'wedding', 'concert'], 'the draft is not changed');
  // A new rumor goes at the end; no editor, the draft as it is.
  assert.equal(effectiveDraft(d, { index: null, rumor: kind('fine') }).rumors.length, 4);
  assert.equal(effectiveDraft(d, null), d);
  // The blockers are those of what would start: a half-done rumor open in the editor counts.
  const empty = normalizeDraft(newDraft(DEFAULT_SETTINGS));
  assert.deepEqual(startBlockers(normalizeDraft(effectiveDraft(empty, { index: null, rumor: emptyRumor() }))), ['incomplete']);
  assert.deepEqual(startBlockers(normalizeDraft(effectiveDraft(empty, { index: null, rumor: party() }))), []);
  // Only what the player cannot fix in the form disables «Empezar».
  assert.deepEqual(hardBlockers(['noRumor', 'incomplete', 'check', 'busy']), ['check', 'busy']);
  assert.deepEqual(hardBlockers([]), []);
});

test('removing a row above the one edited moves the editor with its rumor', () => {
  const rumors = [kind('party'), kind('wedding'), kind('concert')];
  // Edit row 2 (index 1), remove row 1, save: row 2 changes and row 3 stays.
  let index = indexAfterRemove(1, 0);
  assert.equal(index, 0);
  const left = rumors.filter((_, k) => k !== 0);
  left[index] = kind('fine');
  assert.deepEqual(left.map((r) => r.fact.what), ['fine', 'concert']);
  assert.equal(indexAfterRemove(1, 1), -1, 'the edited rumor itself was removed');
  assert.equal(indexAfterRemove(1, 2), 1);
  assert.equal(indexAfterRemove(null, 0), null, 'a new rumor stays new');
});

test('the example rumor: a party in the square today at 12:00, to the first neighbor by name, valid', () => {
  const r = exampleRumor(HEADER, 'es');
  assert.deepEqual(r, {
    fact: { what: 'party', who: null, where: 'square', when: 'hoy 12:00', amount: null },
    text: null,
    to: { neighbors: ['n001'] },
    at: 'start',
  });
  assert.deepEqual(rumorIssues(r, DEFAULT_SETTINGS), []);
  assert.equal(exampleFact(HEADER, 'en').when, 'today 12:00');
  // Without a square, the first public place; the first by name, not by id.
  const other = { neighbors: [{ id: 'n001', name: 'Zoe' }, { id: 'n002', name: 'Ana' }], places: [{ id: 'p02', key: 'bar', name: 'bar', kind: 'public' }] };
  assert.equal(exampleRumor(other, 'es').fact.where, 'bar');
  assert.deepEqual(exampleRumor(other, 'es').to, { neighbors: ['n002'] });
});

test('the live summary says who will know first, when, and the fact', () => {
  const t = STRINGS.es;
  const r = exampleRumor(HEADER, 'es');
  assert.equal(rumorSummary(r, { header: HEADER, lang: 'es', t }), 'Lo sabrá primero Carmen nada más empezar. Una fiesta en la plaza, hoy a las 12:00.');
  const placed = { ...r, to: { place: 'square' }, at: '09:00' };
  assert.equal(rumorSummary(placed, { header: HEADER, lang: 'es', t }), 'Lo sabrán primero quienes estén en la plaza a las 09:00. Una fiesta en la plaza, hoy a las 12:00.');
  const two = { ...party({ neighbors: ['n001', 'n002'] }) };
  assert.equal(rumorSummary(two, { header: HEADER, lang: 'es', t }), 'Lo sabrán primero Carmen y Luis nada más empezar. Una fiesta de Carmen en la plaza, hoy a las 21:00, 50 personas.');
  assert.equal(rumorSummary(emptyRumor(), { header: HEADER, lang: 'es', t }), `${t.summaryNoTo} ${t.summaryNoWhat}`);
  assert.equal(
    rumorSummary({ ...r, at: '09:00' }, { header: HEADER, lang: 'en', t: STRINGS.en }),
    'Carmen will know first, at 09:00. A party at the plaza, today at 12:00.',
  );
});

test('race options are named «Rumor 1 · Fiesta»', () => {
  assert.equal(rumorTitle(STRINGS.es, 'es', 0, kind('party')), 'Rumor 1 · Fiesta');
  assert.equal(rumorTitle(STRINGS.en, 'en', 1, kind('wedding')), 'Rumor 2 · Wedding');
  assert.equal(rumorTitle(STRINGS.es, 'es', 1, emptyRumor()), 'Rumor 2');
});

test('Pueblo → Teléfono → Pueblo keeps recipients, hours, the second rumor and the race', () => {
  const village = normalizeDraft({
    settings: { type: 'village' },
    rumors: [{ ...party({ neighbors: ['n003'] }), at: '10:00' }, kind('wedding', { place: 'bar' })],
    race: { at: 'hoy 14:00', pick: 1 },
  });
  const stash = stashVillage(village, { index: 1, rumor: kind('concert'), text: '' });
  const tel = normalizeDraft({ ...village, settings: { ...village.settings, type: 'telephone' } }, { header: HEADER });
  assert.equal(tel.rumors.length, 1);
  assert.equal(tel.race, null);
  // In Teléfono the fact of the first rumor changes; back to Pueblo it keeps it.
  const edited = { ...tel, rumors: [{ ...tel.rumors[0], fact: { ...tel.rumors[0].fact, what: 'fine' } }] };
  const back = normalizeDraft(restoreVillage({ ...edited, settings: { ...edited.settings, type: 'village' } }, stash), { header: HEADER });
  assert.equal(back.rumors.length, 2);
  assert.equal(back.rumors[0].fact.what, 'fine');
  assert.deepEqual(back.rumors[0].to, { neighbors: ['n003'] });
  assert.equal(back.rumors[0].at, '10:00');
  assert.deepEqual(back.rumors[1], village.rumors[1]);
  assert.deepEqual(back.race, { at: 'hoy 14:00', pick: 1 });
  assert.deepEqual(stash.editor, { index: 1, rumor: kind('concert'), text: '' });
  // Without a stash, nothing changes.
  assert.equal(restoreVillage(edited, null), edited);
});

test('after a reload in a new town: unknown neighbors and places are dropped, the editor fits or not', () => {
  const small = { ...HEADER, neighbors: HEADER.neighbors.slice(0, 2), places: HEADER.places.slice(0, 1) };
  const d = {
    settings: { type: 'village' },
    rumors: [{ ...party({ neighbors: ['n001', 'n003'] }), fact: { ...party().fact, who: 'n003', where: 'bar' } }, party({ place: 'bar' })],
    bets: { attend: 2, half: null, last: 'n003' },
  };
  const fit = fitToHeader(d, small);
  assert.deepEqual(fit.rumors[0].to, { neighbors: ['n001'] });
  assert.equal(fit.rumors[0].fact.who, null);
  assert.equal(fit.rumors[0].fact.where, null);
  assert.deepEqual(fit.rumors[1].to, { place: null });
  assert.equal(fit.bets.last, null);
  const one = normalizeDraft({ settings: { type: 'telephone' }, rumors: [party()] }, { header: HEADER });
  assert.equal(editorFits({ index: 1, rumor: party() }, one), null, 'no row 2 in Teléfono');
  assert.equal(editorFits({ index: null, rumor: party() }, one), null, 'no room for another rumor');
  assert.ok(editorFits({ index: 0, rumor: party() }, one));
});

test('the carry read back from sessionStorage: checked, anything odd dropped', () => {
  assert.equal(parseCarry(null), null);
  assert.equal(parseCarry('x'), null);
  assert.deepEqual(parseCarry({}), { village: null, editor: null, example: false, focus: null, names: null, last: null, race: null, intro: false });
  const c = parseCarry({ village: { rumors: [party(), 7], race: { at: 'hoy 14:00', pick: 0 }, editor: { index: -3, rumor: {} } }, editor: { index: 0, rumor: { fact: { what: 'party' } }, text: 'hi' }, example: true });
  assert.equal(c.village.rumors.length, 1);
  assert.equal(c.village.editor, null);
  assert.deepEqual(c.editor.rumor.fact, { ...emptyRumor().fact, what: 'party' });
  assert.equal(c.editor.text, 'hi');
  assert.equal(c.example, true);
  // A round trip through JSON keeps it.
  const s = stashVillage({ rumors: [party()], race: null }, { index: null, rumor: party(), text: '' });
  assert.deepEqual(parseCarry(JSON.parse(JSON.stringify({ village: s, editor: null }))).village, s);
  // The focus of «Probar con otro vecino»: only 'to' is kept.
  assert.equal(parseCarry({ editor: null, focus: 'to' }).focus, 'to');
  assert.equal(parseCarry({ editor: null, focus: 'what' }).focus, null);
  assert.equal(parseCarry({ editor: null, focus: 7 }).focus, null);
});

test('«Probar con otro vecino»: the same rumor, open on its recipients, emptied; only Village with one rumor', () => {
  const d = normalizeDraft({ settings: { type: 'village' }, rumors: [{ ...party({ neighbors: ['n001', 'n003'] }), text: 'hay fiesta' }] }, { header: HEADER });
  const before = structuredClone(d);
  const c = retryCarry(d);
  assert.equal(c.village, null);
  assert.equal(c.example, false);
  assert.equal(c.focus, 'to');
  assert.equal(c.editor.index, 0);
  assert.deepEqual(c.editor.rumor.to, { neighbors: [] });
  assert.deepEqual(c.editor.rumor.fact, d.rumors[0].fact);
  assert.equal(c.editor.rumor.at, d.rumors[0].at);
  assert.equal(c.editor.text, 'hay fiesta');
  assert.deepEqual(d, before, 'the draft of the game is left untouched');
  c.editor.rumor.fact.what = 'theft';
  assert.equal(d.rumors[0].fact.what, 'party', 'a copy, not the same object');
  // A recipient by place is emptied the same way.
  assert.deepEqual(retryCarry({ ...d, rumors: [party()] }).editor.rumor.to, { neighbors: [] });
  // Round trip through sessionStorage: the editor opens on row 0 with the focus on `to`.
  const back = parseCarry(JSON.parse(JSON.stringify(c)));
  assert.equal(back.focus, 'to');
  assert.equal(back.editor.index, 0);
  assert.deepEqual(back.editor.rumor.to, { neighbors: [] });
  assert.ok(editorFits(back.editor, d));
  // Not offered: Teléfono, two rumors, no rumor, no draft.
  assert.equal(retryCarry({ ...d, settings: { ...d.settings, type: 'telephone' } }), null);
  assert.equal(retryCarry({ ...d, rumors: [party(), party()] }), null);
  assert.equal(retryCarry({ ...d, rumors: [] }), null);
  assert.equal(retryCarry(null), null);
});

test('profile: the guided game chosen comes back until it ends; a starless challenge leaves the stars', () => {
  const p = markGuided({ format: 1, tutorial_seen: true, stars: { a: { ai: 1, rules: 0 } }, games: {} });
  assert.equal(p.tutorial_guided, true);
  assert.equal(wantsTutorial(p), true, '«Ahora no» first, then chosen from the menu');
  assert.deepEqual(p.stars, { a: { ai: 1, rules: 0 } });
  const done = markTutorial(p);
  assert.equal(done.tutorial_guided, undefined);
  assert.equal(wantsTutorial(done), false);
  assert.equal(wantsTutorial({}), true, 'never seen');
  const after = updateProfile(p, { id: 'g9', challenge: 'tutorial', mode: 'ai', score: 12, stars: null });
  assert.equal(after.stars.tutorial, undefined);
  assert.deepEqual(after.games.g9, { score: 12, stars: null });
});

test('previewOf: the rumor in the editor, else the first of the draft', () => {
  const r1 = { fact: { what: 'party', who: null, where: 'square', when: 'hoy 12:00', amount: null }, text: null, to: { neighbors: ['n001'] }, at: 'start' };
  const r2 = { fact: { what: 'wedding', who: null, where: 'church', when: null, amount: null }, text: null, to: { place: 'bar' }, at: '09:00' };
  const draft = { settings: {}, rumors: [r1] };
  assert.deepEqual(previewOf(draft), { first: ['n001'], drop: null, place: 'square', what: 'party', at: 'start' });
  assert.deepEqual(previewOf(draft, { index: null, rumor: r2 }), { first: [], drop: 'bar', place: 'church', what: 'wedding', at: '09:00' });
  assert.deepEqual(previewOf(draft, r2).drop, 'bar');
  assert.equal(previewOf({ settings: {}, rumors: [] }), null);
  assert.equal(previewOf(null), null);
});

// --- Phase 9-4: the first experience -------------------------------------------------

const T = STRINGS.es;
const WIN_HEADER = { ...HEADER, start_tick: 420, params: { end_tick: 1440 } };

test('«Rumor listo»: the first rumor, whom and when, the count and the start button', () => {
  const d = normalizeDraft({ settings: DEFAULT_SETTINGS, rumors: [{ ...party({ neighbors: ['n001'] }), fact: { ...party().fact, who: null, amount: null, when: 'hoy 12:00' } }] });
  const c = readyCard(d, { header: WIN_HEADER, lang: 'es', t: T });
  assert.equal(c.news, 'Una fiesta en la plaza, hoy a las 12:00.');
  assert.equal(c.tell, 'Se lo contarás a Carmen nada más empezar, a las 07:00.');
  assert.equal(c.start, 'Contárselo a Carmen y empezar');
  assert.equal(c.count, null);
  // A place, or several neighbors: «Soltar el rumor y empezar»; with more rumors, the count.
  const place = readyCard({ ...d, rumors: [{ ...d.rumors[0], to: { place: 'bar' }, at: '09:00' }, party()] }, { header: WIN_HEADER, lang: 'es', t: T });
  assert.equal(place.tell, 'Lo oirán quienes estén en el bar a las 09:00.');
  assert.equal(place.start, 'Soltar 2 rumores y empezar');
  assert.equal(place.count, 'Sueltas 2 rumores.');
  assert.equal(readyCard({ ...d, rumors: [party({ neighbors: ['n001', 'n002'] })] }, { header: WIN_HEADER, lang: 'es', t: T }).start, 'Empezar · se lo cuentas a Carmen y Luis');
  // Not in a challenge, not without rumors, not with one half done or told outside the game.
  assert.equal(readyCard({ ...d, challenge: 'x' }, { header: WIN_HEADER, lang: 'es', t: T }), null);
  assert.equal(readyCard({ ...d, rumors: [] }, { header: WIN_HEADER, lang: 'es', t: T }), null);
  assert.equal(readyCard({ ...d, rumors: [party({ neighbors: [] })] }, { header: WIN_HEADER, lang: 'es', t: T }), null);
  const early = { ...d, rumors: [{ ...party(), at: '06:30' }] };
  assert.ok(readyCard(early, { header: WIN_HEADER, lang: 'es', t: T }));
  assert.equal(readyCard(early, { header: WIN_HEADER, lang: 'es', t: T, window: atWindow(WIN_HEADER, d.settings) }), null);
  // The example of a new free game is ready as it is.
  const ex = normalizeDraft({ settings: DEFAULT_SETTINGS, rumors: [exampleRumor(WIN_HEADER, 'es')] });
  assert.equal(readyCard(ex, { header: WIN_HEADER, lang: 'es', t: T }).start, 'Contárselo a Carmen y empezar');
});

test('hours to tell a rumor: inside the game, from its start to its end or `until`', () => {
  const w = atWindow(WIN_HEADER, DEFAULT_SETTINGS);
  assert.deepEqual(w, { from: 420, to: 1440 });
  assert.equal(atHours(w)[0], '07:00');
  assert.equal(atHours(w).at(-1), '23:30');
  assert.ok(!atHours(w).includes('06:30'));
  assert.deepEqual(atWindow(WIN_HEADER, { until: '13:00' }), { from: 420, to: 780 });
  assert.equal(atHours(atWindow(WIN_HEADER, { until: '13:00' })).at(-1), '12:30');
  assert.deepEqual(windowText(atWindow(WIN_HEADER, { until: '13:00' })), { from: '07:00', to: '13:00' });
  assert.equal(clockText(1440), '00:00');
  assert.equal(atOutside('06:30', w), true);
  assert.equal(atOutside('07:00', w), false);
  assert.equal(atOutside('start', w), false);
  assert.equal(atOutside('06:30', null), false);
  // rumorIssues and startBlockers say it only with the window (the 'at' blocker).
  const s = DEFAULT_SETTINGS;
  const early = { ...party(), at: '06:30' };
  assert.deepEqual(rumorIssues(early, s), []);
  assert.deepEqual(rumorIssues(early, s, w), ['at']);
  assert.deepEqual(rumorIssues({ ...party(), at: '07:00' }, s, w), []);
  const d = normalizeDraft({ settings: s, rumors: [early] });
  assert.deepEqual(startBlockers(d), []);
  assert.deepEqual(startBlockers(d, { window: w }), ['at']);
  assert.deepEqual(hardBlockers(['at', 'pending']), [], 'explained on press, not disabled');
  // Teléfono is always at the start.
  assert.deepEqual(rumorIssues(early, { type: 'telephone' }, w), []);
});

test('a second press keeps the choice; going back recovers the last one of each option', () => {
  const to = { neighbors: ['n001', 'n002'] };
  assert.equal(switchTo(to, 'neighbors', {}, { header: HEADER }).to, to, 'the option already on: nothing changes');
  const toPlace = switchTo(to, 'place', {}, { header: HEADER });
  assert.deepEqual(toPlace.to, { place: null });
  const placed = switchTo({ place: 'bar' }, 'neighbors', toPlace.memo, { header: HEADER });
  assert.deepEqual(placed.to, { neighbors: ['n001', 'n002'] });
  assert.deepEqual(switchTo(placed.to, 'place', placed.memo, { header: HEADER }).to, { place: 'bar' });
  // Only while it is valid: a neighbor the town lacks is left out; the limit holds.
  assert.deepEqual(switchTo({ place: null }, 'neighbors', { neighbors: ['n001', 'n099'] }, { header: HEADER }).to, { neighbors: ['n001'] });
  assert.deepEqual(switchTo({ place: null }, 'neighbors', { neighbors: ['n001', 'n002'] }, { header: HEADER, max: 1 }).to, { neighbors: ['n001'] });
  assert.deepEqual(switchTo({ neighbors: [] }, 'place', { place: 'gone' }, { header: HEADER }).to, { place: null });
  // «A una hora»: the hour stays; back to it, the last hour; else the first of the game.
  const w = atWindow(WIN_HEADER, DEFAULT_SETTINGS);
  assert.equal(switchAt('10:30', 'hour', {}, w).at, '10:30');
  const back = switchAt('10:30', 'start', {}, w);
  assert.equal(back.at, 'start');
  assert.equal(switchAt('start', 'hour', back.memo, w).at, '10:30');
  assert.equal(switchAt('start', 'hour', {}, w).at, '07:00');
  assert.equal(switchAt('start', 'hour', { hour: '06:00' }, w).at, '07:00');
  assert.equal(switchAt('start', 'hour', {}).at, '09:00');
});

test('recipients: one at most replaces, several add up, past the limit the oldest goes', () => {
  assert.deepEqual(pickRecipient(['n001'], 'n002', true, 1), ['n002']);
  assert.deepEqual(pickRecipient(['n001'], 'n002', true, 2), ['n001', 'n002']);
  assert.deepEqual(pickRecipient(['n001', 'n002'], 'n003', true, 2), ['n002', 'n003']);
  assert.deepEqual(pickRecipient(['n001', 'n002'], 'n003', true, null), ['n001', 'n002', 'n003']);
  assert.deepEqual(pickRecipient(['n001', 'n002'], 'n001', false, 2), ['n002']);
  assert.deepEqual(pickRecipient(['n001'], 'n001', true, 1), ['n001']);
});

test('Con IA: text not read yet is pending, and «Empezar» does not start the fact before', () => {
  assert.equal(textPending({ text: '', read: null }), null);
  assert.equal(textPending({ text: 'una boda en la iglesia a las nueve', read: null }), 'pending');
  assert.equal(textPending({ text: ' una boda ', read: 'una boda' }), null);
  assert.equal(textPending({ text: 'una boda', read: 'una fiesta' }), 'pending');
  assert.equal(textPending({ text: 'una boda', read: 'una boda', busy: true }), 'busy');
  // The example party is complete, but a pending text blocks it (a content blocker: the press reads it).
  const d = normalizeDraft({ settings: DEFAULT_SETTINGS, rumors: [party()] });
  assert.deepEqual(startBlockers(d, { pending: 'pending' }), ['pending']);
  assert.deepEqual(startBlockers(d, { pending: 'busy' }), ['pending']);
  assert.equal(canStart(d, { pending: 'pending' }), false);
});

test('the race set aside comes back with the same pair, its hour and its bet on the same rumor', () => {
  const a = party({ neighbors: ['n001'] });
  const b = { ...party({ place: 'bar' }), fact: { ...party().fact, what: 'wedding' } };
  const c = { ...party({ neighbors: ['n003'] }), fact: { ...party().fact, what: 'death' } };
  const two = normalizeDraft({ settings: DEFAULT_SETTINGS, rumors: [a, b], race: { at: 'hoy 15:00', pick: 1 } });
  assert.deepEqual(two.race, { at: 'hoy 15:00', pick: 1 });
  const stash = raceStashOf(two);
  const three = normalizeDraft({ ...two, rumors: [a, b, c] });
  assert.equal(three.race, null, 'three rumors: no race');
  assert.equal(raceStashOf(three), null);
  // The same pair, in the same order or swapped: the bet stays on b.
  assert.deepEqual(restoreRace(normalizeDraft({ ...three, rumors: [a, b] }), stash).race, { at: 'hoy 15:00', pick: 1 });
  assert.deepEqual(restoreRace(normalizeDraft({ ...three, rumors: [b, a] }), stash).race, { at: 'hoy 15:00', pick: 0 });
  // Another pair, even in the same places: nothing comes back.
  assert.equal(restoreRace(normalizeDraft({ ...three, rumors: [a, c] }), stash).race, null);
  assert.equal(restoreRace(normalizeDraft({ ...three, rumors: [a, { ...b, to: { place: 'square' } }] }), stash).race, null);
  // A race already there is never replaced.
  const own = normalizeDraft({ ...two, race: { at: 'hoy 18:00', pick: 0 } });
  assert.deepEqual(restoreRace(own, stash).race, { at: 'hoy 18:00', pick: 0 });
  // Across a reload, with the carry.
  assert.deepEqual(parseCarry(JSON.parse(JSON.stringify({ race: stash }))).race, stash);
});

test('a new census: what it took away, rumor by rumor, with the names of the town before', () => {
  const r = { ...party({ neighbors: ['n001', 'n099'] }), fact: { ...party().fact, who: 'n098', where: 'fountain' } };
  const before = { settings: DEFAULT_SETTINGS, rumors: [party(), r], bets: { attend: null, half: null, last: 'n097' } };
  const names = { n099: 'Inma', n098: 'Paco', n097: 'Lola' };
  const after = fitToHeader(before, HEADER);
  assert.deepEqual(townChanges(before, after, { names, t: T }), [
    'Rumor 2: Inma ya no vive aquí.',
    'Rumor 2: la persona de la que se habla ya no vive aquí.',
    'Rumor 2: el lugar ya no existe.',
    T.townLostLast,
  ]);
  assert.deepEqual(townChanges(before, before, { names, t: T }), []);
  // The names go in the carry, taken from the town before the reload.
  assert.deepEqual(namesOf({ rumors: [party({ neighbors: ['n002'] })], bets: { last: 'n003' } }, HEADER), { n001: 'Carmen', n002: 'Luis', n003: 'Rosa' });
  assert.deepEqual(parseCarry({ names: { n001: 'Carmen', bad: 7 } }).names, { n001: 'Carmen' });
});

test('the attendance bet: only with a place and an hour, about the rumor told first', () => {
  const noWhere = { ...party(), fact: { ...party().fact, where: null } };
  const later = { ...party({ place: 'bar' }), at: '10:00' };
  assert.equal(betRumor({ rumors: [later, noWhere] }), noWhere, 'at the start goes first');
  assert.equal(attendOf({ rumors: [later, noWhere] }), null);
  assert.deepEqual(attendOf({ rumors: [party()] }), { place: 'square', when: 'hoy 21:00' });
  // It is not kept without them; the other bets are.
  const d = normalizeDraft({ settings: DEFAULT_SETTINGS, rumors: [noWhere], bets: { attend: 0, half: null, last: 'n002' } });
  assert.deepEqual(d.bets, { attend: null, half: null, last: 'n002' });
  assert.equal(normalizeDraft({ settings: DEFAULT_SETTINGS, rumors: [noWhere], bets: { attend: 0 } }).bets, null);
  assert.equal(normalizeDraft({ settings: DEFAULT_SETTINGS, rumors: [party()], bets: { attend: 0 } }).bets.attend, 0);
});

test('the summary: how many rumors go in, and long lists of names cut short', () => {
  assert.equal(countText(T, 1), 'Sueltas 1 rumor.');
  assert.equal(countText(T, 3), 'Sueltas 3 rumores.');
  assert.equal(nameList(['Ana', 'Luis', 'Rosa'], T), 'Ana, Luis y Rosa');
  assert.equal(nameList(['Ana', 'Luis', 'Rosa', 'Inma', 'Paco', 'Lola', 'Pepe'], T), 'Ana, Luis y 5 más');
  assert.equal(nameList(['Ana', 'Luis', 'Rosa', 'Inma'], { and: ' y ' }), 'Ana, Luis, Rosa y Inma');
  const many = { neighbors: [] };
  const h = { ...HEADER, neighbors: [] };
  for (let k = 1; k <= 7; k++) {
    h.neighbors.push({ id: `n${k}`, name: `V${k}` });
    many.neighbors.push(`n${k}`);
  }
  assert.match(rumorSummary(party(many), { header: h, lang: 'es', t: T }), /^Lo sabrán primero V1, V2 y 5 más nada más empezar\./);
});

test('«Probar con otro vecino» says whom it was told to and how far it went', () => {
  const d = normalizeDraft({ settings: DEFAULT_SETTINGS, rumors: [party({ neighbors: ['n002'] })] });
  const c = retryCarry(d, { header: HEADER, informed: 2, lang: 'es', t: T });
  assert.deepEqual(c.last, { name: 'Luis', n: 2, total: 3 });
  assert.equal(lastTryText(parseCarry(JSON.parse(JSON.stringify(c))).last, T), 'La otra vez se lo contaste a Luis y llegó a 2 de 3.');
  assert.equal(retryCarry(d).last, null, 'without the log, nothing is said');
  assert.equal(lastTryText(null, T), null);
});

test('the head of a challenge: what the player decides', () => {
  const fill = { ...FILL, measure: 'attend_ok', stars: { ai: [10, 12, 14], rules: [6, 10, 16] } };
  assert.equal(yourPartText(fill, T), 'Tú decides: a quién se lo cuentas y cuándo se lo cuentas.');
  assert.equal(yourPartText({ ...fill, open: ['what', 'who', 'trait_mix', 'mode'] }, T), 'Tú decides: el rumor y el carácter del pueblo.');
  assert.equal(yourPartText({ ...fill, open: ['where', 'when', 'to', 'mode'] }, T), 'Tú decides: dónde, cuándo pasa y a quién se lo cuentas.');
  assert.equal(yourPartText({ ...fill, open: ['mode'] }, T), null);
  assert.equal(yourPartText(null, T), null);
});

test('factSentence: the rumor as a sentence in the language of the interface', () => {
  const header = {
    places: [{ id: 'p01', key: 'square', name: 'plaza', kind: 'public' }],
    neighbors: [{ id: 'n006', name: 'Manuel', gender: 'm' }],
  };
  assert.equal(factSentence({ what: 'party', who: null, where: 'square', when: 'hoy 12:00', amount: null }, { header, lang: 'es' }), 'Una fiesta en la plaza, hoy a las 12:00');
  assert.equal(factSentence({ what: 'party', where: 'square', when: 'today 12:00' }, { header, lang: 'es' }), 'Una fiesta en la plaza, hoy a las 12:00');
  assert.equal(factSentence({ what: 'lottery', who: 'n006', amount: 500 }, { header, lang: 'es' }), 'Un premio de lotería para Manuel, 500 euros');
  assert.equal(factSentence({ what: 'wedding', when: 'mañana 18:30' }, { header, lang: 'en' }), 'A wedding, tomorrow at 18:30');
  assert.equal(factSentence({ what: 'fire' }, { header, lang: 'es' }), null);
});

// --- Phase 9-5 -------------------------------------------------------------------------

/** A village with jobs, characters, homes and ties, and a timetable of two jobs. */
const H95 = {
  start_tick: 420,
  params: { end_tick: 1440 },
  neighbors: [
    { id: 'n001', name: 'Carmen', gender: 'f', job: 'baker', trait: 'gossip', home: 'p13' },
    { id: 'n002', name: 'Luis', gender: 'm', job: 'priest', trait: 'discreet', home: 'p13' },
    { id: 'n003', name: 'Rosa', gender: 'f', job: 'baker', trait: 'shy', home: 'p13' },
  ],
  places: [
    { id: 'p01', key: 'square', name: 'plaza', kind: 'public' },
    { id: 'p02', key: 'bar', name: 'bar', kind: 'public' },
    { id: 'p13', key: 'upper_quarter', name: 'barrio alto', kind: 'home' },
  ],
  relations: [
    { a: 'n001', b: 'n002', type: 'friend' },
    { a: 'n001', b: 'n003', type: 'rival' },
  ],
};
const TT = {
  jobs: {
    baker: Array.from({ length: 24 }, (_, h) => (h >= 8 && h < 14 ? 'square' : 'home')),
    priest: Array.from({ length: 24 }, (_, h) => (h >= 9 && h < 20 ? 'bar' : 'home')),
  },
};

test('9-5 the main button says what it does', () => {
  const d = (rumors) => normalizeDraft({ settings: DEFAULT_SETTINGS, rumors });
  const o = { header: H95, lang: 'es', t: T };
  assert.equal(startLabel(d([party({ neighbors: ['n001'] })]), o), 'Contárselo a Carmen y empezar');
  assert.equal(startLabel(d([{ ...party({ neighbors: ['n001'] }), at: '10:00' }]), o), 'Empezar · Carmen lo oirá a las 10:00');
  assert.equal(startLabel(d([{ ...party({ neighbors: ['n001', 'n002'] }), at: '10:00' }]), o), 'Empezar · Carmen y Luis lo oirán a las 10:00');
  assert.equal(startLabel(d([party({ place: 'square' })]), o), 'Soltarlo en la plaza y empezar');
  assert.equal(startLabel(d([{ ...party({ place: 'bar' }), at: '10:30' }]), o), 'Empezar · se soltará en el bar a las 10:30');
  assert.equal(startLabel(d([party(), party(), party()]), o), 'Soltar 3 rumores y empezar');
  assert.equal(startLabel(d([emptyRumor()]), o), 'Empezar');
  assert.equal(startLabel(d([]), o), 'Empezar');
});

test('9-5 a new rumor untouched; the limit of recipients', () => {
  assert.ok(isBlankRumor(emptyRumor()));
  assert.ok(!isBlankRumor({ ...emptyRumor(), fact: { ...emptyRumor().fact, what: 'party' } }));
  assert.ok(!isBlankRumor({ ...emptyRumor(), to: { neighbors: ['n001'] } }));
  assert.ok(!isBlankRumor({ ...emptyRumor(), text: 'fiesta' }));
  assert.equal(toLimit(challengeLocks(null)), MAX_TO);
  assert.equal(toLimit(challengeLocks(FILL)), 2);
  assert.equal(shortNames(['A', 'B', 'C', 'D']), 'A, B, C…');
  assert.equal(shortNames(['A', 'B']), 'A, B');
});

test('9-5 the head: goal, hours, duration only where measured; stars with their unit', () => {
  const free = normalizeDraft({ settings: DEFAULT_SETTINGS, rumors: [] });
  const g = goalLines(free, { header: H95, t: T });
  assert.equal(g.goal, 'Objetivo: que se entere el mayor número de vecinos.');
  assert.equal(g.hours, 'La partida va de las 07:00 a las 24:00.');
  assert.match(g.duration, /^Dura unos 3 minutos/);
  const big = normalizeDraft({ settings: { ...DEFAULT_SETTINGS, neighbors: 100, until: '13:00' }, rumors: [] });
  const g100 = goalLines(big, { challenge: { measure: 'attend_ok' }, header: H95, t: T });
  assert.equal(g100.goal, 'Objetivo: que acudan muchos vecinos al sitio y a la hora.');
  assert.equal(g100.hours, 'La partida va de las 07:00 a las 13:00.');
  assert.doesNotMatch(g100.duration, /\d/, 'no figure with 100 neighbors');
  const fill = { ...FILL, measure: 'attend_ok', stars: { ai: [10, 12, 14], rules: [6, 10, 16] } };
  assert.equal(starsText(fill, 'rules', T), 'Metas (Sin IA): ★ con 6 · ★★ con 10 · ★★★ con 16 o más vecinos al sitio y a la hora.');
  assert.equal(
    starsText({ ...fill, measure: 'informed_end', stars: { ai: [12, 17, 21] } }, 'ai', STRINGS.en),
    'Targets (With AI): ★ with 12 · ★★ with 17 · ★★★ with 21 or more neighbors who heard about it.',
  );
  assert.equal(starsText({ ...fill, stars: null }, 'ai', T), null);
});

test('9-5 what a challenge fixes, and its subject with the people close to them', () => {
  const fill = { ...FILL, settings: { ...FILL.settings, until: '14:00' } };
  assert.equal(
    fixedPartText(fill, { header: HEADER, lang: 'es', t: T }),
    'El reto fija el rumor («Una fiesta en la plaza, hoy a las 21:00»), el pueblo y la hora de final (14:00).',
  );
  const surprise = { ...FILL, open: ['where', 'when', 'to', 'at', 'mode'], rumor: { fact: { what: 'party', who: 'n002', where: null, when: null, amount: null } }, subject: 'who' };
  assert.match(fixedPartText(surprise, { header: H95, lang: 'es', t: T }), /^El reto fija parte del rumor \(«Una fiesta de Luis»\)/);
  assert.equal(fixedPartText({ ...fill, tutorial: true }, { header: HEADER, lang: 'es', t: T }), null, 'the tutorial says nothing of it');
  assert.equal(challengeSubject({ subject: 'priest' }, H95), 'n002');
  assert.equal(challengeSubject(surprise, H95), 'n002');
  assert.equal(challengeSubject({ subject: null }, H95), null);
  assert.equal(subjectText({ subject: 'priest' }, { header: H95, timetable: TT, lang: 'es', t: T }), 'El cura es Luis. Familia y amigos: Carmen.');
  assert.equal(subjectText({ subject: null }, { header: H95, lang: 'es', t: T }), null);
});

test('9-5 the card of a neighbor and «Rumor listo» say what they are like', () => {
  const p = neighborProfile(H95, TT, 'n001', 'es');
  assert.equal(profileLine(p, T), 'panadera, cotilla (lo cuenta casi siempre), familia y amigos: Luis, pasa el día en plaza');
  assert.equal(profileLine(p, T, { header: H95, lang: 'es' }), 'panadera, cotilla (lo cuenta casi siempre), familia y amigos: Luis, pasa el día en la plaza');
  const c = cardLines(p, { header: H95, timetable: TT, at: '10:00', lang: 'es', t: T });
  assert.equal(c.trait, 'cotilla: lo cuenta casi siempre');
  assert.equal(c.ties, 'Familia y amigos (1): Luis · Rivales: Rosa');
  assert.deepEqual(c.signs, ['🗣 cotilla', '👥 1 familia y amigos', '📍 plaza: poca gente']);
  assert.equal(c.home, 'Vive en el barrio alto');
  assert.equal(c.usual, 'Pasa el día en la plaza, de 08:00 a 14:00 · poca gente');
  assert.equal(c.now, 'A las 10:00 está en la plaza');
  assert.equal(cardLines(p, { header: H95, timetable: TT, at: '20:00', lang: 'es', t: T }).now, 'A las 20:00 está en casa');
  assert.equal(cardLines(neighborProfile(H95, null, 'n001', 'es'), { header: H95, timetable: null, lang: 'es', t: T }).usual, null);
  const d = normalizeDraft({ settings: DEFAULT_SETTINGS, rumors: [party({ neighbors: ['n001'] })] });
  assert.equal(readyCard(d, { header: H95, lang: 'es', t: T, timetable: TT }).about, `Carmen: ${profileLine(p, T, { header: H95, lang: 'es' })}.`);
  assert.equal(tellHour({ at: 'start' }, H95), 7);
  assert.equal(tellHour({ at: '10:30' }, H95), 10);
});

test('9-5 why «Empezar» cannot start, and the errors of the engine, in words', () => {
  const one = normalizeDraft({ settings: DEFAULT_SETTINGS, rumors: [{ ...party({ neighbors: [] }) }] });
  assert.deepEqual(blockerLines(one, startBlockers(one), { t: T }), ['Falta elegir a quién se lo cuentas.']);
  const two = normalizeDraft({ settings: DEFAULT_SETTINGS, rumors: [party(), emptyRumor()] });
  assert.deepEqual(blockerLines(two, startBlockers(two), { t: T }), ['Al rumor 2 le falta elegir qué ha pasado y elegir a quién se lo cuentas.']);
  assert.deepEqual(blockerLines(one, ['check', 'challenge'], { t: T }), [T.blockers.check]);
  assert.equal(fieldErrorText({ rumor: 0, field: 'where', error: 'unknown' }, T), 'Rumor 1, dónde: no existe en este pueblo.');
  assert.equal(fieldErrorText({ rumor: null, field: 'mode', error: 'no_model' }, T), 'Quién decide: Con IA no está disponible en tu ordenador.');
  assert.equal(fieldErrorText({ rumor: 2, field: 'odd', error: 'odd' }, T), 'Rumor 3, el rumor: no es válido.');
});

test('9-5 the carry keeps that the tutorial was chosen and its part 1 is still to show', () => {
  assert.equal(parseCarry({ intro: true }).intro, true);
  assert.equal(parseCarry({ intro: 'yes' }).intro, false);
});

test('9-5 fixes: stars before a deadline, the second example, the subject warned, no double stop', () => {
  const clock = { measure: 'half_tick', deadline: '14:00', stars: { ai: [0, 30, 60], rules: [0, 20, 45] } };
  assert.equal(starsText(clock, 'rules', T), 'Metas (Sin IA): ★ si llega antes de las 14:00 · ★★ 20 minutos antes · ★★★ 45 minutos antes.');
  // One unit for the minutes: «minutos antes de las 14:00», in the list, the score and «Mis partidas».
  assert.equal(measureUnit(clock, T), 'minutos antes de las 14:00');
  assert.equal(measureUnit({ measure: 'subject_tick', deadline: '14:00' }, STRINGS.en), 'minutes before 14:00');
  assert.equal(measureUnit(null, T), 'enterados');
  const h = { ...HEADER, places: [...HEADER.places, { id: 'p05', key: 'church', name: 'iglesia', kind: 'public' }] };
  assert.equal(exampleFact(h, 'es').what, 'party');
  const second = exampleFact(h, 'es', [party()]);
  assert.deepEqual([second.what, second.where, second.when], ['wedding', 'church', 'hoy 18:00']);
  assert.equal(exampleFact(h, 'es', [party(), { fact: { what: 'wedding' } }]).what, 'concert');
  assert.deepEqual(subjectWarning({ subject: 'priest', zero_if: 'told_directly' }, H95, T), { id: 'n002', text: T.warnToldDirectly });
  const surprise = { subject: 'who', zero_if: 'subject_informed', rumor: { fact: { who: 'n003' } } };
  assert.deepEqual(subjectWarning(surprise, H95, T), { id: 'n003', text: T.warnInformed });
  assert.equal(subjectWarning({ subject: null }, H95, T), null);
  assert.equal(endSentence('Familia y amigos: A, B, C…'), 'Familia y amigos: A, B, C…');
  assert.equal(endSentence('Hola'), 'Hola.');
  const big = { ...H95, relations: ['n003', 'n004', 'n005', 'n006'].map((b) => ({ a: 'n002', b, type: 'friend' })), neighbors: [...H95.neighbors, ...['n004', 'n005', 'n006'].map((id) => ({ id, name: id, gender: 'm', job: 'baker', trait: 'shy', home: 'p13' }))] };
  assert.doesNotMatch(subjectText({ subject: 'priest' }, { header: big, lang: 'es', t: T }), /…\./);
});

test('9-5 last round: an hour the game does not reach, the default hour, how busy a place is', () => {
  const tut = { ...DEFAULT_SETTINGS, until: '13:00' };
  const win = atWindow(WIN_HEADER, tut);
  const f = { what: 'party', where: 'square', when: 'hoy 21:00' };
  assert.equal(lateWarning(f, win, tut, T), 'La partida acaba a las 13:00: a las 21:00 ya no verás a nadie ir.');
  assert.equal(lateWarning({ ...f, when: 'hoy 12:00' }, win, tut, T), null);
  assert.equal(lateWarning({ ...f, when: 'mañana 10:00' }, win, tut, T), 'La partida acaba a las 13:00: mañana a las 10:00 ya no verás a nadie ir.');
  assert.equal(lateWarning({ ...f, where: null }, win, tut, T), null, 'without where nobody goes anyway');
  // Without an end hour, tomorrow makes the game longer instead (t.tomorrowWarn).
  assert.equal(lateWarning({ ...f, when: 'mañana 10:00' }, atWindow(WIN_HEADER, DEFAULT_SETTINGS), DEFAULT_SETTINGS, T), null);
  assert.equal(defaultWhenTime(win), '12:00');
  assert.equal(defaultWhenTime(atWindow(WIN_HEADER, DEFAULT_SETTINGS)), '21:00');
  // The example of the tutorial (12:00) falls inside a game until 13:00.
  assert.equal(lateWarning(exampleFact(WIN_HEADER, 'es'), win, tut, T), null);
  const crowd = { ...H95, neighbors: [...H95.neighbors, ...['n004', 'n005', 'n006'].map((id) => ({ id, name: id, gender: 'm', job: 'baker', trait: 'shy', home: 'p13' }))] };
  const many = cardLines(neighborProfile(crowd, TT, 'n001', 'es'), { header: crowd, timetable: TT, lang: 'es', t: T });
  assert.equal(many.usual, 'Pasa el día en la plaza, de 08:00 a 14:00 · mucha gente');
  const few = cardLines(neighborProfile(H95, TT, 'n002', 'es'), { header: H95, timetable: TT, lang: 'es', t: T });
  assert.equal(few.usual, 'Pasa el día en el bar, de 09:00 a 20:00 · poca gente');
});

test('9-5 the free game opens in the village of the last game, and the head says whether it is the same', () => {
  const games = [
    { id: 'g3', settings: { type: 'telephone', town: 20 } },
    { id: 'g2', settings: { type: 'village', neighbors: 25, town: 7, trait_mix: 0 } },
    { id: 'g1', settings: { type: 'village', neighbors: 100, town: 99, trait_mix: 1 } },
  ];
  assert.deepEqual(lastVillage(games), { type: 'village', neighbors: 25, town: 7, trait_mix: 0 });
  assert.equal(lastVillage([]), null);
  assert.equal(lastVillage(null), null);
  const same = { ...DEFAULT_SETTINGS, town: 7 };
  assert.equal(villageNote(same, lastVillage(games), T), 'El mismo pueblo de tu última partida (n.º 7).');
  assert.equal(villageNote({ ...same, town: 5272 }, lastVillage(games), T), 'Pueblo nuevo (n.º 5272): los nombres se repiten, pero cambian los oficios, los caracteres y las amistades; mira sus fichas.');
  assert.match(villageNote({ ...same, trait_mix: 2 }, lastVillage(games), T), /^Pueblo nuevo/);
  assert.equal(villageNote(same, null, T), null);
});

test('9-5 «Rumor listo» says the neighbor of the example is only a proposal; the signs without timetable', () => {
  const d = normalizeDraft({ settings: DEFAULT_SETTINGS, rumors: [exampleRumor(H95, 'es')] });
  assert.equal(firstByName(H95), 'n001');
  assert.equal(readyCard(d, { header: H95, lang: 'es', t: T, timetable: TT }).propose, T.proposeF);
  const other = normalizeDraft({ settings: DEFAULT_SETTINGS, rumors: [{ ...exampleRumor(H95, 'es'), to: { neighbors: ['n002'] } }] });
  assert.equal(readyCard(other, { header: H95, lang: 'es', t: T, timetable: TT }).propose, null);
  const p = neighborProfile(H95, null, 'n003', 'es');
  assert.deepEqual(cardLines(p, { header: H95, lang: 'es', t: T }).signs, ['😳 tímida', '👥 0 familia y amigos', '📍 —']);
  assert.equal(sameVillage({ ...DEFAULT_SETTINGS, town: 7 }, { type: 'village', neighbors: 25, town: 7, trait_mix: 0 }), true);
  assert.equal(sameVillage({ ...DEFAULT_SETTINGS, town: 8 }, { type: 'village', neighbors: 25, town: 7, trait_mix: 0 }), false);
  assert.equal(sameVillage(DEFAULT_SETTINGS, null), null);
});

test('9-5 the proposal of a free game: the advised neighbor, else the one with most reasons; the cards by talk', () => {
  // reasonsOf as endview.js strongReasons: talkative, or many family and friends.
  const reasonsOf = (h, tt, id, lang, closeTop) => {
    const p = neighborProfile(h, tt, id, lang);
    const trait = ['gossip', 'sociable', 'exaggerator'].includes(p.trait) ? p.trait : null;
    const close = p.close > 0 && p.close >= closeTop ? p.close : null;
    return trait || close ? { trait, close, busy: null } : null;
  };
  const best = suggestNeighbor(H95, TT, 'es', reasonsOf);
  assert.equal(best.id, 'n001', 'Carmen: gossip and the most family and friends');
  assert.equal(suggestNeighbor(H95, TT, 'es', reasonsOf, ['n001']).id, 'n002');
  assert.equal(suggestNeighbor(H95, TT, 'es', () => null), null);
  const carmen = neighborProfile(H95, TT, 'n001', 'es');
  assert.equal(proposeText(carmen, { id: 'n001', kind: 'tip' }, { header: H95, lang: 'es', t: T }), 'Propuesta: Carmen, como te sugerimos al acabar. Elige tú mirando las fichas →');
  assert.equal(
    proposeText(carmen, { id: 'n001', kind: 'best', reasons: best.reasons }, { header: H95, lang: 'es', t: T }),
    'Propuesta: Carmen, porque es cotilla y tiene 1 de familia y amigos. Elige tú mirando las fichas →',
  );
  assert.equal(proposeText(carmen, { id: 'n002', kind: 'tip' }, { header: H95, lang: 'es', t: T }), null);
  assert.equal(exampleRumor(H95, 'es', 'n003').to.neighbors[0], 'n003');
  assert.equal(exampleRumor(H95, 'es', 'nope').to.neighbors[0], 'n001');
  const order = sortCards(['n001', 'n002', 'n003'].map((id) => neighborProfile(H95, TT, id, 'es')), 'talk').map((p) => p.name);
  assert.deepEqual(order, ['Carmen', 'Rosa', 'Luis']);
  const d = normalizeDraft({ settings: DEFAULT_SETTINGS, rumors: [exampleRumor(H95, 'es', 'n002')] });
  assert.match(readyCard(d, { header: H95, lang: 'es', t: T, proposal: { id: 'n002', kind: 'tip' } }).propose, /^Propuesta: Luis, como te sugerimos/);
});

test('profile: the mode and the language of the player, remembered and kept', () => {
  assert.deepEqual(prefsOf(null), { mode: null, lang: null });
  assert.deepEqual(prefsOf({ mode: 'robot', lang: 'fr' }), { mode: null, lang: null });
  const p = withPrefs({ format: 1, tutorial_seen: true, stars: { a: { ai: 2, rules: 1 } } }, { mode: 'rules' });
  assert.deepEqual(prefsOf(p), { mode: 'rules', lang: null });
  const q = withPrefs(p, { lang: 'en', mode: 'nonsense' });
  assert.deepEqual(prefsOf(q), { mode: 'rules', lang: 'en' });
  // The rest of the profile stays, and a game written later keeps the choice.
  assert.equal(q.tutorial_seen, true);
  assert.deepEqual(q.stars.a, { ai: 2, rules: 1 });
  assert.deepEqual(prefsOf(updateProfile(q, { id: 'g1', mode: 'rules' })), { mode: 'rules', lang: 'en' });
  assert.deepEqual(prefsOf(markTutorial(q)), { mode: 'rules', lang: 'en' });
});
