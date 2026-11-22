import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  allPlaces,
  amountLabel,
  answerNotes,
  busiestPlace,
  extractedBody,
  halfHours,
  injectBody,
  parseDraft,
  parseWhen,
  presentAt,
  publicPlaces,
  whatKey,
  whatLabels,
} from './inject.js';
import { STRINGS } from './strings.js';
import { loadLog, loadStore } from '../core/testing.js';

const ES = 'runs/samples/party-100-es-s2.jsonl';
const EN = 'runs/samples/party-25-en-s4.jsonl';

test('vocabulary of the fields, in the language of the run', () => {
  const { header } = loadLog(ES);
  assert.ok(whatLabels('es').includes('fiesta'));
  assert.ok(whatLabels('en').includes('party'));
  assert.ok(publicPlaces(header).includes('plaza'));
  assert.ok(!publicPlaces(header).some((p) => p.startsWith('barrio')));
  assert.ok(allPlaces(header).some((p) => p.startsWith('barrio')));
  const hours = halfHours();
  assert.equal(hours.length, 48);
  assert.equal(hours[0], '00:00');
  assert.equal(hours[43], '21:30');
});

test('when: words of either language, half hours', () => {
  assert.deepEqual(parseWhen('hoy 21:00'), { day: 'today', time: '21:00' });
  assert.deepEqual(parseWhen('Mañana 9:30'), { day: 'tomorrow', time: '09:30' });
  assert.deepEqual(parseWhen('tomorrow 10:30'), { day: 'tomorrow', time: '10:30' });
  assert.equal(parseWhen('ayer 21:00'), null);
  assert.equal(parseWhen('hoy 25:00'), null);
  assert.equal(parseWhen(''), null);
});

test('inject body from the fields', () => {
  const fields = { what: ' fiesta ', where: 'plaza', day: 'today', time: '21:00', who: '', amount: '', to: 'bar' };
  assert.deepEqual(injectBody(fields, 'es', { dryRun: true }), {
    fact: { what: 'fiesta', where: 'plaza', when: 'hoy 21:00' },
    to: { place: 'bar' },
    dryRun: true,
  });
  assert.deepEqual(
    injectBody({ what: 'wedding', who: 'Rosa', amount: '50', day: 'tomorrow', time: '12:00', to: 'church' }, 'en'),
    { fact: { what: 'wedding', who: 'Rosa', when: 'tomorrow 12:00', amount: 50 }, to: { place: 'church' } },
  );
  // A day without hour is no `when`; a bad amount goes as is (the engine says no).
  assert.deepEqual(injectBody({ what: 'multa', day: 'today', amount: 'x', to: 'p01' }, 'es').fact, { what: 'multa', amount: 'x' });
  assert.throws(() => injectBody({ what: '', to: 'bar' }, 'es'), /what/);
  assert.throws(() => injectBody({ what: 'fiesta', to: ' ' }, 'es'), /to/);
});

test('inject body for an extracted fact keeps the sentence', () => {
  const fact = { what: 'fiesta', who: null, where: 'plaza', when: 'hoy 21:00', amount: null };
  assert.deepEqual(extractedBody(fact, 'esta noche hay fiesta en la plaza a las 9', 'bar'), {
    fact: { what: 'fiesta', where: 'plaza', when: 'hoy 21:00' },
    to: { place: 'bar' },
    text: 'esta noche hay fiesta en la plaza a las 9',
  });
});

test('draft: the sentence with the extractor, what|where|when|to without it', () => {
  assert.equal(parseDraft(null, false), null);
  assert.deepEqual(parseDraft('fiesta en la plaza', true), { text: 'fiesta en la plaza' });
  const d = parseDraft('fiesta|plaza|hoy 21:00|bar', false);
  assert.deepEqual(d, { what: 'fiesta', where: 'plaza', day: 'today', time: '21:00', who: '', amount: '', to: 'bar' });
  assert.deepEqual(injectBody(d, 'es', { dryRun: true }), {
    fact: { what: 'fiesta', where: 'plaza', when: 'hoy 21:00' },
    to: { place: 'bar' },
    dryRun: true,
  });
  assert.deepEqual(parseDraft('boda', false), { what: 'boda', where: '', day: '', time: '', who: '', amount: '', to: '' });
});

test('default recipients: the place with most neighbors in view', () => {
  const store = loadStore(EN, 600);
  const { header, state } = store;
  const ids = header.neighbors.map((n) => n.id);
  const counts = new Map();
  for (const id of ids) {
    const p = state.neighbors.get(id).place;
    if (p) counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  const name = busiestPlace(header, state, ids);
  assert.equal(counts.get(header.places.find((p) => p.name === name).id), top[1]);
  // Nobody in view: the first public place.
  assert.equal(busiestPlace(header, state, []), 'square');
});

test('notes: empty slots and unknown names', () => {
  const es = STRINGS.es;
  const people = amountLabel('fiesta', 'es', es);
  assert.deepEqual(answerNotes({ empty: ['who', 'amount'] }, es, people), ['Sin dato: quién, cuánta gente']);
  assert.deepEqual(answerNotes({ empty: ['who', 'amount'], unknown: { who: 'Nadie' } }, es, people), [
    'Sin dato: cuánta gente',
    'No reconocido: quién «Nadie»',
  ]);
  assert.deepEqual(answerNotes({ empty: ['amount'] }, es, amountLabel('premio de lotería', 'es', es)), ['Sin dato: cuántos euros']);
  assert.deepEqual(answerNotes({ empty: ['amount'] }, es), ['Sin dato: cuántos']);
  assert.deepEqual(answerNotes({ empty: [] }, es), []);
});

test('amount label: «Cuánta gente» only when the rumor counts people', () => {
  const { es, en } = STRINGS;
  assert.equal(amountLabel('fiesta', 'es', es), 'Cuánta gente');
  assert.equal(amountLabel('party', 'es', es), 'Cuánta gente');
  assert.equal(amountLabel(' Concierto ', 'es', es), 'Cuánta gente');
  assert.equal(amountLabel('boda', 'es', es), 'Cuántos invitados');
  assert.equal(amountLabel('multa', 'es', es), 'Cuántos euros');
  assert.equal(amountLabel('obra', 'es', es), 'Cuántos días');
  assert.equal(amountLabel('algo raro', 'es', es), 'Cuántos');
  assert.equal(amountLabel('', 'es', es), 'Cuántos');
  assert.equal(amountLabel('party', 'en', en), 'How many people');
  assert.equal(amountLabel('lottery prize', 'en', en), 'How many euros');
  assert.equal(amountLabel('building works', 'en', en), 'How many days');
  assert.equal(whatKey('Herencia'), 'inheritance');
  assert.equal(whatKey('wedding'), 'wedding');
  assert.equal(whatKey('nada'), null);
});

test('presentAt: neighbors at a place and not on a trip', () => {
  const store = loadStore(EN, 600);
  const { header, state } = store;
  let total = 0;
  for (const p of header.places) total += presentAt(header, state, p.name);
  const still = [...state.neighbors.values()].filter((n) => n.place && !n.trip).length;
  assert.equal(total, still);
  const p0 = header.places[0];
  assert.equal(presentAt(header, state, p0.id), presentAt(header, state, p0.name.toUpperCase()));
  assert.equal(presentAt(header, state, 'nowhere'), null);
  const empty = header.places.find((p) => presentAt(header, state, p.name) === 0);
  if (empty) assert.equal(presentAt(header, state, empty.name), 0);
});
