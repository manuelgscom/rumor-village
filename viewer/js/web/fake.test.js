// fetch and EventSource of the web version (fake.js), the pace (pace.js), the
// stores (storage.js) and the query of the page (install.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEventSource, createFetch, routeOf } from './fake.js';
import { playSearch } from './install.js';
import { DEFAULT_CONTROL, dueAt, released } from './pace.js';
import { createServer } from './server.js';
import { createStore, nameMap } from './storage.js';
import { DEFAULT_DRAFT, fakeClock, fakeEngine, memoryStore, RUMOR } from './testing.js';

const PAGE = 'https://example.test/juego/sub/play-web.html?play=1';

test('the routes of the game are those under the folder of the page', () => {
  assert.equal(routeOf('https://example.test/juego/sub/state', PAGE).path, 'state');
  assert.equal(routeOf('state', PAGE).path, 'state');
  assert.equal(routeOf('games/20261117-100405-rules-t1.jsonl', PAGE).path, 'games/20261117-100405-rules-t1.jsonl');
  assert.equal(routeOf('card?tick=3&who=n001', PAGE).query.get('who'), 'n001');
  assert.equal(routeOf('js/core/app.js', PAGE), null);
  assert.equal(routeOf('/state', PAGE), null); // another folder
  assert.equal(routeOf('https://other.test/juego/sub/state', PAGE), null);
  assert.equal(routeOf('events', PAGE), null); // only for the EventSource
  assert.equal(routeOf('wasm/rumor_web.wasm', PAGE), null);
});

test('fetch answers the game routes and passes the rest on', async () => {
  const seen = [];
  const server = { handle: async (method, path, query, body) => (seen.push([method, path, query.toString(), body]), { status: 200, body: { path } }) };
  const real = async (input) => new Response(`real ${input}`);
  const fetch = createFetch(server, real, () => PAGE);
  const res = await fetch('https://example.test/juego/sub/preview', { method: 'post', body: '{"a":1}', keepalive: true });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { path: 'preview' });
  assert.deepEqual(seen[0], ['POST', 'preview', '', '{"a":1}']);
  assert.equal(await (await fetch('css/game.css')).text(), 'real css/game.css');
  await fetch('control', { cache: 'no-store' }); // no method: GET
  assert.deepEqual(seen[1], ['GET', 'control', '', '']);
  const none = createFetch({ handle: async () => ({ status: 204 }) }, real, () => PAGE);
  assert.equal((await none('viewport', { method: 'POST', body: '{}' })).status, 204);
  const file = createFetch({ handle: async () => ({ status: 200, text: 'a\nb\n', type: 'application/x-ndjson' }) }, real, () => PAGE);
  const r = await file('games/x.jsonl');
  assert.equal(r.headers.get('content-type'), 'application/x-ndjson');
  assert.equal(await r.text(), 'a\nb\n');
});

test('the stream sends every line with its number, and drops when the run changes', async () => {
  const clock = fakeClock();
  const engine = fakeEngine({ ticks: 4 });
  const server = createServer({ engine, session: memoryStore(), local: memoryStore(), now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  const later = (fn, ms) => clock.setTimer(fn, ms);
  const ES = createEventSource(server.stream, server.ready, undefined, () => PAGE, { later, cancel: clock.clearTimer });
  const es = new ES('events');
  const got = [];
  const states = [];
  es.onopen = () => states.push('open');
  es.onmessage = (ev) => got.push([ev.lastEventId, JSON.parse(ev.data).type ?? 'header']);
  es.onerror = () => states.push(`error ${es.readyState}`);
  await server.ready;
  clock.advance(0);
  assert.deepEqual(states, ['open']);
  assert.deepEqual(got, [['1', 'header']]);
  // A game: another run; the stream drops and comes back from the last id.
  await server.handle('POST', 'start', new URLSearchParams(), JSON.stringify({ ...DEFAULT_DRAFT, rumors: [RUMOR] }));
  assert.deepEqual(states, ['open', 'error 0']);
  clock.advance(1000);
  assert.deepEqual(states, ['open', 'error 0', 'open']);
  await server.handle('POST', 'control', new URLSearchParams(), '{"speed":"max"}');
  clock.advance(0);
  assert.deepEqual(got.map((g) => g[0]), ['1', '2', '3', '4', '5', '6']);
  assert.equal(got.at(-1)[1], 'end');
  es.close();
  assert.equal(es.readyState, 2);
  // Another URL is a real EventSource.
  class Real {
    constructor(url) {
      this.url = url;
    }
  }
  const Other = createEventSource(server.stream, server.ready, Real, () => PAGE);
  assert.ok(new Other('https://elsewhere.test/events') instanceof Real);
});

test('the pace: speed, quiet speed, hold, max and pause', () => {
  let c = { ...DEFAULT_CONTROL };
  assert.equal(dueAt(c), 0); // the first tick at once (no hold)
  c = released(c, 1000, false);
  assert.equal(dueAt(c), 1500);
  c = released(c, 1600, true); // late: counts from when it was due
  assert.equal(c.released, 1500);
  assert.equal(dueAt(c), 1600); // quiet: 10 per second
  assert.equal(dueAt({ ...c, holdUntil: 5000 }), 5000);
  assert.equal(dueAt({ ...c, speed: 0, holdUntil: 5000 }), -Infinity);
  assert.equal(dueAt({ ...c, paused: true }), null);
  assert.equal(released({ ...c, released: null }, 9000, false).released, 9000);
});

test('the stores: Web Storage when it works, window.name when it throws', () => {
  const holder = { name: '' };
  const blocked = createStore(() => {
    throw new Error('SecurityError');
  }, nameMap(holder));
  assert.equal(blocked.persistent, false);
  assert.equal(blocked.get('k'), null);
  blocked.set('k', { a: 1 });
  assert.deepEqual(blocked.get('k'), { a: 1 });
  assert.ok(holder.name.startsWith('rv-web:'));
  // The map in window.name survives a new page (a new store over it).
  assert.deepEqual(createStore(() => null, nameMap(holder)).get('k'), { a: 1 });
  blocked.set('k', null);
  assert.equal(blocked.get('k'), null);
  // A foreign window.name is left alone.
  assert.equal(nameMap({ name: 'something else' }).get('k'), null);
  const memory = memoryStore();
  assert.equal(memory.persistent, true);
  memory.set('x', [1, 2]);
  assert.deepEqual(memory.get('x'), [1, 2]);
  // No storage and no fallback: memory of the page.
  const bare = createStore(() => null);
  bare.set('y', 3);
  assert.equal(bare.get('y'), 3);
});

test('the page plays unless it opens a played game', () => {
  assert.equal(playSearch(''), '?play=1');
  assert.equal(playSearch('?lang=en'), '?lang=en&play=1');
  assert.equal(playSearch('?play=1&code=RV1-x'), null);
  assert.equal(playSearch('?log=games%2Fx.jsonl&game=x'), null);
});
