// Pure parts of film.mjs: keyframes, the follow path, the URL and the shot plan.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildUrl, EASE, interpolate, planShot, smoothPath } from './film.mjs';

const header = { lang: 'es', neighbors: [{ id: 'n006' }] };
const base = 'http://127.0.0.1:8098/';
const shot = (extra = {}) => ({ id: 'a', source: 'g1', size: '1920x1080', fps: 10, seconds: 1, ticks: [[0, 100], [1, 200]], ...extra });

test('interpolate: numbers, ends and empty keys', () => {
  const keys = [[0, 10], [0.5, 20], [1, 40]];
  assert.equal(interpolate(keys, -1), 10);
  assert.equal(interpolate(keys, 0.25), 15);
  assert.equal(interpolate(keys, 0.75), 30);
  assert.equal(interpolate(keys, 2), 40);
  assert.equal(interpolate([], 0.5), null);
  assert.equal(interpolate(undefined, 0.5), null);
  assert.equal(interpolate([[0.2, 7]], 0.9), 7);
});

test('interpolate: objects, zoom geometric, easing', () => {
  const keys = [[0, { x: 0, y: 0, zoom: 1 }], [1, { x: 100, y: 50, zoom: 4 }]];
  const mid = interpolate(keys, 0.5);
  assert.equal(mid.x, 50);
  assert.equal(mid.y, 25);
  assert.equal(mid.zoom, 2);
  assert.equal(interpolate([[0, 0], [1, 1]], 0.5, EASE.inOut), 0.5);
  assert.ok(interpolate([[0, 0], [1, 1]], 0.25, EASE.inOut) < 0.25);
  // A key with only the zoom (follow) keeps only the zoom.
  assert.deepEqual(interpolate([[0, { zoom: 2 }], [1, { zoom: 8 }]], 0.5), { zoom: 4 });
});

test('smoothPath: centred, ends held, radius 0 copies', () => {
  const pts = [[0, 0], [0, 0], [9, 3], [0, 0], [0, 0]];
  assert.deepEqual(smoothPath(pts, 0), pts);
  const s = smoothPath(pts, 1);
  assert.deepEqual(s[2], [4.5, 1.5]);
  assert.deepEqual(s[1], [2.25, 0.75]);
  assert.deepEqual(s[0], [0, 0]);
  const line = [[0, 0], [1, 0], [2, 0], [3, 0]];
  assert.deepEqual(smoothPath(line, 1)[1], [1, 0]);
  assert.deepEqual(smoothPath(pts, 2), smoothPath(pts, 2));
});

test('buildUrl: from the source, fixed q and clock', () => {
  const url = new URL(buildUrl(shot({ query: { select: 'n006', q: 'low', clock: '5' } }), { base, lang: 'es', tick: 100 }));
  assert.equal(url.origin + url.pathname, base);
  const q = url.searchParams;
  assert.equal(q.get('log'), 'games/g1.jsonl');
  assert.equal(q.get('game'), 'g1');
  assert.equal(q.get('lang'), 'es');
  assert.equal(q.get('tour'), '0');
  assert.equal(q.get('paused'), '1');
  assert.equal(q.get('photo'), '1');
  assert.equal(q.get('select'), 'n006');
  assert.equal(q.get('q'), 'high');
  assert.equal(q.get('clock'), '0');
  assert.equal(q.get('t'), '100');
  assert.ok(url.search.includes('log=games%2Fg1.jsonl'));
});

test('buildUrl: game ui has no photo; string query', () => {
  const q = new URL(buildUrl(shot({ ui: 'game', query: '&open=inspect&select=n006' }), { base, lang: 'en', tick: 7.5 })).searchParams;
  assert.equal(q.get('photo'), null);
  assert.equal(q.get('open'), 'inspect');
  assert.equal(q.get('lang'), 'en');
  assert.equal(q.get('t'), '7.5');
});

test('planShot: frames, holds, ticks and lang', () => {
  const p = planShot(shot({ holds: [[1, 5], [0, 2]] }), { header, base });
  assert.equal(p.total, 10);
  assert.equal(p.width, 1920);
  assert.equal(p.lang, 'es');
  assert.equal(p.tickAt(0), 100);
  assert.equal(p.tickAt(9), 200);
  assert.equal(p.holds.get(9), 5);
  assert.equal(p.holds.get(0), 2);
  assert.equal(p.cameraAt(3), null);
  assert.ok(p.url.includes('t=100'));
});

test('planShot: size override and follow', () => {
  const p = planShot(shot({ size: '1080x1920', follow: 'n006', camera: [[0, { zoom: 2 }]] }), { header, base, size: '640x360' });
  assert.equal(p.width, 640);
  assert.equal(p.follow, 'n006');
  assert.equal(p.smoothRadius, 5);
  assert.equal(p.cameraAt(5).zoom, 2);
});

test('planShot: rejects bad shots', () => {
  const bad = [
    { id: 'a b' },
    { size: '640x360' },
    { ticks: [] },
    { ticks: [[0.5, 1], [0.2, 2]] },
    { camera: [[0, { x: 1, y: 2 }]] },
    { follow: 'n999' },
    { ui: 'tv' },
    { ease: 'bounce' },
    { holds: [[0.5, 0]] },
    { fps: 0 },
    { query: [1] },
  ];
  for (const extra of bad) assert.throws(() => planShot(shot(extra), { header, base }), /film: shot/, JSON.stringify(extra));
});
