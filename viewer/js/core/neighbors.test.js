// What a card of a neighbor shows (neighbors.js, phase 9-5).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { neighborProfile, peopleAt, placeAt, sortProfiles, STRINGS, TRAITS, usualPlace } from './neighbors.js';

const hours = (day, rest = 'home') => Array.from({ length: 24 }, (_, h) => day[h] ?? rest);
const timetable = {
  jobs: {
    bartender: hours({ 11: 'bar', 12: 'bar', 13: 'bar', 14: 'bar', 15: 'bar', 17: 'bar', 18: 'bar', 19: 'bar', 20: 'bar', 21: 'bar', 10: 'market' }),
    retired: hours({ 9: 'square', 10: 'square', 11: 'chapel', 12: 'chapel', 16: 'bakery' }),
    clerk: hours({ 8: 'town_hall', 9: 'town_hall', 10: 'town_hall', 11: 'town_hall', 12: 'town_hall' }),
  },
};
const header = {
  places: [
    { id: 'p01', key: 'square', name: 'plaza', kind: 'public' },
    { id: 'p02', key: 'bar', name: 'bar', kind: 'public' },
    { id: 'p03', key: 'chapel', name: 'ermita', kind: 'public' },
    { id: 'p04', key: 'bakery', name: 'panadería', kind: 'public' },
    { id: 'p05', key: 'town_hall', name: 'ayuntamiento', kind: 'public' },
    { id: 'p13', key: 'lower_quarter', name: 'barrio bajo', kind: 'home' },
  ],
  neighbors: [
    { id: 'n001', name: 'Manuel', gender: 'm', job: 'bartender', trait: 'exaggerator', home: 'p13' },
    { id: 'n002', name: 'Luis', gender: 'm', job: 'clerk', trait: 'discreet', home: 'p13' },
    { id: 'n003', name: 'Carmen', gender: 'f', job: 'retired', trait: 'gossip', home: 'p13' },
    { id: 'n004', name: 'Ana', gender: 'f', job: 'retired', trait: 'sociable', home: 'p13' },
  ],
  relations: [
    { a: 'n001', b: 'n003', type: 'family' },
    { a: 'n002', b: 'n001', type: 'friend' },
    { a: 'n001', b: 'n004', type: 'rival' },
    { a: 'n002', b: 'n003', type: 'friend' },
  ],
};

test('every character has its phrase in both languages', () => {
  for (const lang of ['es', 'en']) for (const t of TRAITS) assert.ok(STRINGS[lang].phrase[t], `${lang} ${t}`);
});

test('usual place: the most frequent public place with its hours, or roaming', () => {
  assert.deepEqual(usualPlace(timetable, 'bartender'), { key: 'bar', from: 11, to: 22 });
  assert.deepEqual(usualPlace(timetable, 'retired'), { roaming: ['square', 'chapel', 'bakery'] });
  assert.equal(usualPlace(null, 'bartender'), null);
  assert.equal(usualPlace(timetable, 'unknown'), null);
});

test('where a job is at an hour, and who is usually at a place', () => {
  assert.equal(placeAt(timetable, 'bartender', 12), 'bar');
  assert.equal(placeAt(timetable, 'bartender', 7), 'home');
  assert.deepEqual(peopleAt(header, timetable, 'bar', 12), ['n001']);
  assert.deepEqual(peopleAt(header, timetable, 'lower_quarter', 7), ['n004', 'n003', 'n002', 'n001']);
  assert.deepEqual(peopleAt(header, null, 'bar', 12), []);
});

test('profile: character, people close, rivals, home and usual place', () => {
  const p = neighborProfile(header, timetable, 'n001', 'es');
  assert.equal(p.job, 'tabernero');
  assert.equal(p.traitName, 'exagerado');
  assert.equal(p.traitPhrase, 'lo cuenta a menudo, y a veces exagera');
  assert.deepEqual(p.family, ['Carmen']);
  assert.deepEqual(p.friends, ['Luis']);
  assert.deepEqual(p.rivals, ['Ana']);
  assert.equal(p.close, 2);
  assert.equal(p.home.name, 'barrio bajo');
  assert.deepEqual(p.usual, { key: 'bar', name: 'bar', from: 11, to: 22 });
  const roaming = neighborProfile(header, timetable, 'n003', 'en');
  assert.deepEqual(roaming.usual, { roaming: ['plaza', 'ermita', 'panadería'] });
  assert.equal(roaming.traitPhrase, 'nearly always tells it');
  assert.equal(neighborProfile(header, null, 'n002', 'es').usual, null);
  assert.equal(neighborProfile(header, timetable, 'n999', 'es'), null);
});

test('sorted by name, or by people close and then by how much they talk', () => {
  const ps = header.neighbors.map((n) => neighborProfile(header, timetable, n.id, 'es'));
  assert.deepEqual(sortProfiles(ps).map((p) => p.name), ['Ana', 'Carmen', 'Luis', 'Manuel']);
  assert.deepEqual(sortProfiles(ps, 'close').map((p) => p.name), ['Carmen', 'Manuel', 'Luis', 'Ana']);
});
