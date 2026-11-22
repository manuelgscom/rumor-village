import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseParams } from '../core/params.js';
import { enc, linkOf, queryOf } from './link.js';

test('round trip: linkOf → parseParams', () => {
  const state = {
    log: '/runs/samples/party-100-es-s2.jsonl',
    lang: 'es',
    t: 1055.4321,
    select: 'n003',
    group: 'other_time',
    cam: { x: 312.345, y: -40.06, zoom: 2.4567 },
    director: false,
    ui: 'full',
  };
  const q = linkOf(state);
  assert.equal(q, '?log=/runs/samples/party-100-es-s2.jsonl&lang=es&t=1055.4&select=n003&group=other_time&cam=312.3,-40.1,2.46&ui=full');
  const p = parseParams(q);
  assert.equal(p.log, state.log);
  assert.equal(p.lang, 'es');
  assert.equal(p.t, 1055.4);
  assert.equal(p.select, 'n003');
  assert.equal(p.group, 'other_time');
  assert.deepEqual(p.cam, { x: 312.3, y: -40.1, zoom: 2.46 });
  assert.equal(p.ui, 'full');
  assert.equal(p.paused, null, 'never paused');
  assert.equal(p.tour, null, 'never tour');
  assert.equal(p.director, false);
});

test('split screen: left, right and labels are kept', () => {
  const q = linkOf({ left: '/runs/a.jsonl', right: '/runs/b.jsonl', labels: ['base', 'ft'], t: 900 });
  const p = parseParams(q);
  assert.equal(p.left, '/runs/a.jsonl');
  assert.equal(p.right, '/runs/b.jsonl');
  assert.deepEqual(p.labels, ['base', 'ft']);
  assert.equal(p.t, 900);
});

test('with the director on, director=1 and no camera', () => {
  const p = parseParams(linkOf({ log: '/x.jsonl', t: 1, cam: { x: 1, y: 2, zoom: 3 }, director: true }));
  assert.equal(p.director, true);
  assert.equal(p.cam, null);
});

test('empty values are left out; a bad camera is not written', () => {
  assert.equal(linkOf({}), '');
  assert.equal(linkOf({ log: '/x.jsonl', t: null, select: null, cam: null }), '?log=/x.jsonl');
  assert.equal(linkOf({ log: '/x.jsonl', cam: { x: Number.NaN, y: 0, zoom: 1 } }), '?log=/x.jsonl');
  assert.equal(linkOf({ log: '/x.jsonl', t: -0.01, cam: { x: -0.01, y: 0, zoom: 0.001 } }), '?log=/x.jsonl&t=0&cam=0,0,0.01');
  assert.deepEqual(parseParams('?cam=0,0,0.01').cam, { x: 0, y: 0, zoom: 0.01 });
});

test('values are encoded, with / : and , readable', () => {
  assert.equal(enc('http://h/a b.jsonl'), 'http://h/a%20b.jsonl');
  assert.equal(queryOf([['log', 'a&b=c'], ['x', 0], ['y', null]]), '?log=a%26b%3Dc&x=0');
  const odd = { log: 'http://h:8000/runs/a b&c.jsonl', select: 'n 1', group: 'a&b' };
  const p = parseParams(linkOf(odd));
  assert.equal(p.log, odd.log);
  assert.equal(p.select, odd.select);
  assert.equal(p.group, odd.group);
});
