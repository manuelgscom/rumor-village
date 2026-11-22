// The fake `rumor play` (server.js) with a made-up engine (testing.js): the
// states, the pace, stop and reset, the reload of the page, and the routes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, GAMES_KEY, PROFILE_KEY, SESSION_KEY, validGameId } from './server.js';
import { DEFAULT_DRAFT, fakeClock, fakeEngine, memoryStorage, memoryStore, RUMOR } from './testing.js';

function setup({ ticks = 10, session = memoryStorage(), local = memoryStorage(), clock = fakeClock() } = {}) {
  const engine = fakeEngine({ ticks });
  let n = 0;
  const server = createServer({
    engine,
    session: memoryStore(session),
    local: memoryStore(local),
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    runId: () => `run${++n}`,
  });
  const call = async (method, path, body, query = '') => {
    const text = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body);
    return server.handle(method, path, new URLSearchParams(query), text);
  };
  return { server, engine, clock, call, session, local };
}

const draft = (extra = {}) => ({ ...DEFAULT_DRAFT, rumors: [RUMOR], ...extra });

test('a new tab waits with the default draft, Sin IA and the web platform', async () => {
  const { call, server } = setup();
  const st = (await call('GET', 'state')).body;
  assert.equal(st.state, 'waiting');
  assert.equal(st.platform, 'web');
  assert.deepEqual(st.ai, { available: false, reason: 'web' });
  assert.equal(st.check.state, 'skipped');
  assert.deepEqual(st.draft, DEFAULT_DRAFT);
  assert.equal(st.game, null);
  assert.equal(st.version, '1.0.0-test');
  assert.deepEqual(server.stream.lines(0).map((l) => JSON.parse(l).seed), [1]);
  const control = (await call('GET', 'control')).body;
  assert.deepEqual(control, { ended: false, extract: false, paused: false, run: st.run, speed: 2, tick: null });
});

test('the routes without a model and the errors of play_server', async () => {
  const { call } = setup();
  assert.equal((await call('POST', 'extract', { text: 'x' })).status, 501);
  assert.equal((await call('POST', 'inject', {})).status, 409);
  assert.equal((await call('POST', 'stop', {})).status, 409);
  assert.deepEqual((await call('POST', 'quit', {})).body, { quit: true });
  assert.equal((await call('POST', 'preview', '[1]')).status, 400);
  assert.equal((await call('POST', 'start', 'nope')).status, 400);
  assert.equal((await call('POST', 'reset', { clear: 1 })).status, 400);
  assert.equal((await call('POST', 'control', {})).status, 400);
  assert.equal((await call('POST', 'control', { hold_ms: 10001 })).status, 400);
  assert.equal((await call('POST', 'control', { speed: 0 })).status, 400);
  assert.equal((await call('POST', 'viewport', { neighbors: ['n004'] })).status, 400);
  assert.equal((await call('POST', 'viewport', { neighbors: ['n003'] })).status, 204);
  assert.equal((await call('GET', 'card', undefined, 'tick=1&who=n001')).status, 404);
  assert.deepEqual((await call('GET', 'timetable')).body, { jobs: {} });
  // An empty draft cannot start: the 400 of the engine as it is.
  const res = await call('POST', 'start', '');
  assert.equal(res.status, 400);
  assert.equal(res.body.errors[0].field, 'rumors');
});

test('preview keeps the draft; another town is a new run', async () => {
  const { call } = setup();
  const run0 = (await call('GET', 'state')).body.run;
  let res = await call('POST', 'preview', draft());
  assert.equal(res.status, 200);
  assert.equal(res.body.town_changed, false);
  assert.equal((await call('GET', 'state')).body.run, run0);
  assert.deepEqual((await call('GET', 'state')).body.draft.rumors, [RUMOR]);
  res = await call('POST', 'preview', draft({ settings: { ...DEFAULT_DRAFT.settings, town: 9 } }));
  assert.equal(res.body.town_changed, true);
  assert.equal(res.body.header.seed, 9);
  assert.notEqual((await call('GET', 'state')).body.run, run0);
  assert.equal((await call('POST', 'preview', draft({ settings: { town: 0 } }))).status, 400);
});

test('a game goes at the pace of /control: speed, quiet ticks, pause, hold and max', async () => {
  const { call, clock, server } = setup();
  const res = await call('POST', 'start', draft());
  assert.equal(res.status, 200);
  const id = res.body.game.id;
  assert.ok(validGameId(id));
  let st = (await call('GET', 'state')).body;
  assert.equal(st.state, 'playing');
  assert.equal(st.game.id, id);
  // The first tick goes at once; tick 100 is quiet, so the next one at 10/s.
  assert.equal(server.stream.count(), 2);
  assert.equal((await call('GET', 'control')).body.tick, 101);
  clock.advance(99);
  assert.equal(server.stream.count(), 2);
  clock.advance(1);
  assert.equal(server.stream.count(), 3); // tick 101 (not quiet): the next at 2/s
  clock.advance(499);
  assert.equal(server.stream.count(), 3);
  clock.advance(1);
  assert.equal(server.stream.count(), 4);
  // Pause: nothing goes; resume: the next tick at once.
  await call('POST', 'control', { action: 'pause' });
  clock.advance(5000);
  assert.equal(server.stream.count(), 4);
  const resumed = await call('POST', 'control', { action: 'resume' });
  assert.equal(resumed.body.paused, false);
  assert.equal(server.stream.count(), 5);
  // A reading pause holds the next tick.
  await call('POST', 'control', { hold_ms: 3000 });
  clock.advance(2999);
  assert.equal(server.stream.count(), 5);
  clock.advance(1);
  assert.equal(server.stream.count(), 6);
  // Max: everything at once, the end included.
  const max = await call('POST', 'control', { speed: 'max' });
  assert.equal(max.body.speed, 'max');
  assert.equal(server.stream.count(), 12);
  assert.equal(JSON.parse(server.stream.lines(11)[0]).type, 'end');
  st = (await call('GET', 'state')).body;
  assert.equal(st.state, 'ended');
  const control = (await call('GET', 'control')).body;
  assert.equal(control.ended, true);
  assert.equal(control.tick, 109);
  const games = (await call('GET', 'games')).body.games;
  assert.equal(games.length, 1);
  assert.equal(games[0].id, id);
  assert.equal(games[0].stopped, false);
  assert.equal(games[0].end_tick, 110);
  assert.match(games[0].ended, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  assert.equal((await call('POST', 'start', draft())).status, 409);
});

test('POST stop ends the game before the next tick, with the same lines before it', async () => {
  const { call, server, engine } = setup();
  const id = (await call('POST', 'start', draft())).body.game.id;
  await call('POST', 'control', { speed: 1000 });
  const before = server.stream.lines(0);
  const res = await call('POST', 'stop', {});
  assert.deepEqual(res.body, { state: 'ended', game: { id } });
  const after = server.stream.lines(0);
  assert.deepEqual(after.slice(0, before.length), before);
  const end = JSON.parse(after.at(-1));
  assert.equal(end.type, 'end');
  const stopAt = engine.calls.at(-1)[2];
  assert.equal(end.tick, stopAt);
  assert.equal((await call('GET', 'control')).body.tick, stopAt);
  const game = (await call('GET', 'games')).body.games[0];
  assert.equal(game.stopped, true);
  assert.equal(game.end_tick, stopAt);
  assert.equal((await call('POST', 'stop', {})).status, 409);
});

test('a reload goes on with the game where it was, and an ended game stays ended', async () => {
  const session = memoryStorage();
  const local = memoryStorage();
  const clock = fakeClock();
  const a = setup({ session, local, clock });
  const id = (await a.call('POST', 'start', draft())).body.game.id;
  clock.advance(700);
  const count = a.server.stream.count();
  assert.ok(count > 2);
  const run = (await a.call('GET', 'state')).body.run;
  // The page reloads: a new server over the same stores.
  const b = setup({ session, local, clock });
  const st = (await b.call('GET', 'state')).body;
  assert.equal(st.state, 'playing');
  assert.equal(st.game.id, id);
  assert.equal(st.run, run);
  assert.deepEqual(b.server.stream.lines(0), a.server.stream.lines(0));
  await b.call('POST', 'control', { speed: 'max' });
  assert.equal((await b.call('GET', 'state')).body.state, 'ended');
  const c = setup({ session, local, clock });
  assert.equal((await c.call('GET', 'state')).body.state, 'ended');
  assert.deepEqual(c.server.stream.lines(0), b.server.stream.lines(0));
  // The log of the game, computed again, and its data.
  const file = await c.call('GET', `games/${id}.jsonl`);
  assert.equal(file.text, b.server.stream.lines(0).map((l) => `${l}\n`).join(''));
  const data = await c.call('GET', `games/${id}.game.json`);
  assert.equal(JSON.parse(data.text).id, id);
});

test('a preview sent as the page goes is kept and taken up by the next page', async () => {
  const session = memoryStorage();
  const a = setup({ session });
  await a.server.ready;
  // The synchronous part only: the page is gone before the engine answers.
  a.engine.preview = () => new Promise(() => {});
  a.server.handle('POST', 'preview', new URLSearchParams(), JSON.stringify(draft({ settings: { ...DEFAULT_DRAFT.settings, town: 5 } })));
  assert.equal(JSON.parse(session.getItem(SESSION_KEY)).pending.settings.town, 5);
  const b = setup({ session });
  const st = (await b.call('GET', 'state')).body;
  assert.equal(st.draft.settings.town, 5);
  assert.equal(JSON.parse(b.server.stream.lines(0)[0]).seed, 5);
  assert.equal(JSON.parse(session.getItem(SESSION_KEY)).pending, null);
});

test('reset: back to waiting with the draft, or the default one; a game under way is stopped', async () => {
  const { call } = setup();
  const id = (await call('POST', 'start', draft({ settings: { ...DEFAULT_DRAFT.settings, town: 4 } }))).body.game.id;
  let res = await call('POST', 'reset', {});
  assert.equal(res.body.state, 'waiting');
  let st = (await call('GET', 'state')).body;
  assert.equal(st.state, 'waiting');
  assert.equal(st.game, null);
  assert.equal(st.draft.settings.town, 4);
  assert.equal(st.run, res.body.run);
  const game = (await call('GET', 'games')).body.games.find((g) => g.id === id);
  assert.equal(game.stopped, true);
  res = await call('POST', 'reset', { clear: true });
  st = (await call('GET', 'state')).body;
  assert.deepEqual(st.draft, DEFAULT_DRAFT);
});

test('cards of «¿Qué pensó?», of this game and of one opened again', async () => {
  const { call } = setup();
  const id = (await call('POST', 'start', draft())).body.game.id;
  const res = await call('GET', 'card', undefined, `tick=100&who=n001`);
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(res.text), { tick: 100, who: 'n001', kind: 'turn', policy: 'baseline', card: null, rule: { rule: 'tell_chance', rolls: [] } });
  assert.equal((await call('GET', 'card', undefined, `game=${id}&tick=100&who=n001&kind=plan`)).status, 404);
  assert.equal((await call('GET', 'card', undefined, `game=${id}&tick=x&who=n001`)).status, 400);
  await call('POST', 'control', { speed: 'max' });
  await call('POST', 'reset', { clear: true });
  assert.equal((await call('GET', 'card', undefined, `game=${id}&tick=105&who=n001`)).status, 200);
  assert.equal((await call('GET', 'card', undefined, `game=20261117-100405-rules-t99&tick=105&who=n001`)).status, 404);
});

test('the profile: {format: 1} at first, kept whole, at most 1 MB', async () => {
  const local = memoryStorage();
  const { call } = setup({ local });
  assert.deepEqual((await call('GET', 'profile')).body, { format: 1 });
  const profile = { format: 1, stars: { c1: 2 } };
  assert.deepEqual((await call('POST', 'profile', profile)).body, profile);
  assert.deepEqual(JSON.parse(local.getItem(PROFILE_KEY)), profile);
  assert.deepEqual((await call('GET', 'profile')).body, profile);
  assert.equal((await call('POST', 'profile', '[]')).status, 400);
  assert.equal((await call('POST', 'profile', JSON.stringify({ x: 'a'.repeat(1 << 20) }))).status, 400);
});

test('«Mis partidas»: newest first, by start', async () => {
  const local = memoryStorage();
  const { call } = setup({ local, clock: fakeClock(Date.UTC(2026, 10, 17, 10, 4, 5)) });
  const store = memoryStore(local);
  store.set(GAMES_KEY, {
    '20261101-090000-rules-t1': { id: '20261101-090000-rules-t1', started: '2026-11-01T09:00:00Z' },
    '20261102-090000-rules-t1': { id: '20261102-090000-rules-t1', started: '2026-11-02T09:00:00Z' },
  });
  await call('POST', 'start', draft());
  const games = (await call('GET', 'games')).body.games;
  assert.deepEqual(games.slice(1).map((g) => g.id), ['20261102-090000-rules-t1', '20261101-090000-rules-t1']);
});
