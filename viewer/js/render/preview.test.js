import { test } from 'node:test';
import assert from 'node:assert/strict';
import { focusTags, panShift, placeCaption, playNames, previewTags } from './preview.js';

const HEADER = {
  lang: 'es',
  neighbors: [{ id: 'n01', name: 'Ana' }, { id: 'n02', name: 'Luis' }, { id: 'n03', name: 'Francisco', job: 'priest' }],
  places: [
    { id: 'p01', key: 'square', name: 'plaza', kind: 'public' },
    { id: 'p02', key: 'bar', name: 'bar', kind: 'public' },
    { id: 'p16', key: 'lower_quarter', name: 'barrio bajo', kind: 'home' },
  ],
};

const rumor = (to, fact = { what: 'party', where: 'square' }) => ({ fact, to, at: 'start' });
const game = (phase, r, editing = null) => ({ phase, draft: { rumors: r ? [r] : [] }, editing });

test('previewTags: the first neighbors and the place of the fact, while preparing', () => {
  const tags = previewTags(game('prepare', rumor({ neighbors: ['n01'] })), HEADER, 'es');
  assert.deepEqual([...tags.names], [['n01', 'Lo sabe primero']]);
  assert.deepEqual([...tags.places], [['p01', 'Lugar de la fiesta']]);
  const en = previewTags(game('prepare', rumor({ neighbors: ['n01'] })), HEADER, 'en');
  assert.deepEqual([...en.names], [['n01', 'Hears it first']]);
  assert.deepEqual([...en.places], [['p01', 'Where the party is']]);
});

test('previewTags: nothing outside prepare, without a rumor or without an event', () => {
  for (const phase of ['boot', 'menu', 'playing', 'ended']) assert.equal(previewTags(game(phase, rumor({ neighbors: ['n01'] })), HEADER, 'es'), null);
  assert.equal(previewTags(game('prepare', null), HEADER, 'es'), null);
  assert.equal(previewTags(null, HEADER, 'es'), null);
  assert.equal(previewTags({ phase: 'prepare' }, HEADER, 'es'), null);
});

test('previewTags: the rumor open in the editor wins over the draft', () => {
  const draft = rumor({ neighbors: ['n01'] });
  const open = rumor({ neighbors: ['n02'] }, { what: 'concert', where: 'bar' });
  const tags = previewTags(game('prepare', draft, { index: 0, rumor: open }), HEADER, 'es');
  assert.deepEqual([...tags.names], [['n02', 'Lo sabe primero']]);
  assert.deepEqual([...tags.places], [['p02', 'Lugar del concierto']]);
});

test('previewTags: a drop place, alone or at the place of the fact', () => {
  const apart = previewTags(game('prepare', rumor({ place: 'bar' })), HEADER, 'es');
  assert.equal(apart.names.size, 0);
  assert.deepEqual([...apart.places], [['p01', 'Lugar de la fiesta'], ['p02', 'Aquí empieza a contarse']]);
  const same = previewTags(game('prepare', rumor({ place: 'p01' })), HEADER, 'en');
  assert.deepEqual([...same.places], [['p01', 'It starts being told here']]);
});

test('previewTags: unknown neighbors and places are left out', () => {
  const tags = previewTags(game('prepare', rumor({ neighbors: ['n99', 'n02'] }, { what: 'party', where: 'moon' })), HEADER, 'es');
  assert.deepEqual([...tags.names], [['n02', 'Lo sabe primero']]);
  assert.equal(tags.places.size, 0);
});

test('placeCaption: the article fits or the caption is neutral', () => {
  assert.equal(placeCaption('wedding', 'es'), 'Lugar de la boda');
  assert.equal(placeCaption('lottery', 'es'), 'Lugar del rumor');
  assert.equal(placeCaption('fine', 'en'), 'Where it happens');
  assert.equal(placeCaption(null, 'es'), 'Lugar del rumor');
  assert.equal(placeCaption('mystery', 'en'), 'Where it happens');
});

test('focusTags: the quarter and the place of the day of the card under the pointer', () => {
  const tags = focusTags({ neighbor: 'n01', home: 'p16', usual: 'bar' }, HEADER, 'es');
  assert.deepEqual([...tags], [['p02', 'Pasa el día aquí'], ['p16', 'Vive aquí']]);
  const en = focusTags({ neighbor: 'n01', home: 'p16', usual: null }, HEADER, 'en');
  assert.deepEqual([...en], [['p16', 'Lives here']]);
  assert.equal(focusTags({ neighbor: null, home: null, usual: null }, HEADER, 'es'), null);
  assert.equal(focusTags(null, HEADER, 'es'), null);
  assert.equal(focusTags({ neighbor: 'n01', home: 'nowhere', usual: 'moon' }, HEADER, 'es').size, 0);
});

test('playNames: whom the rumors were told to, and the subject of the challenge', () => {
  const events = [
    { type: 'move', tick: 1 },
    { type: 'inject', tick: 2, fact: 'f1', what: 'party', slots: { who: 'n02' }, to: ['n01', 'n99'] },
  ];
  assert.deepEqual([...playNames({ header: HEADER, events }, 'es')], [['n01', 'Se lo contaste']]);
  const priest = playNames({ header: HEADER, events, challenge: { subject: 'priest' } }, 'es');
  assert.deepEqual([...priest], [['n01', 'Se lo contaste'], ['n03', 'El cura']]);
  const party = playNames({ header: HEADER, events, challenge: { subject: 'who' } }, 'en');
  assert.deepEqual([...party], [['n01', 'You told them'], ['n02', "It's their party"]]);
  // Before the rumor starts, the «who» of the draft.
  const draft = { rumors: [{ fact: { what: 'party', who: 'n01' } }] };
  assert.deepEqual([...playNames({ header: HEADER, events: [], challenge: { subject: 'who' }, draft }, 'es')], [['n01', 'Es su fiesta']]);
  assert.equal(playNames({ header: HEADER, events: [] }, 'es').size, 0);
});

test('panShift: out from under the panel, never off the right edge', () => {
  assert.equal(panShift([{ x: 300, w: 100 }], 476, 1600), 192);
  assert.equal(panShift([{ x: 600, w: 100 }], 476, 1600), 0);
  assert.equal(panShift([{ x: 300, w: 100 }, { x: 1450, w: 120 }], 476, 1600), 14);
  assert.equal(panShift([], 476, 1600), 0);
});
