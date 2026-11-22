// The fake server over the real engine, build/wasm/rumor_web.js (skipped
// until scripts/wasm-build.sh made it): a game stopped half way, the ids of
// the games, and the answers of a draft that cannot be played.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { wrapModule } from './engine.js';
import { createServer } from './server.js';
import { fakeClock, memoryStore } from './testing.js';

const MODULE = new URL('../../../build/wasm/rumor_web.js', import.meta.url);
const DRAFT = new URL('../../../dist/drafts/default.json', import.meta.url);
const built = await access(fileURLToPath(MODULE)).then(
  () => true,
  () => false,
);
const skip = built ? false : 'build/wasm/rumor_web.js not built (scripts/wasm-build.sh)';

let enginePromise = null;
const engine = () => (enginePromise ??= import(MODULE.href).then(async (m) => wrapModule(await m.default())));

test('the engine: info, an invalid draft, Con IA refused, and "-2" for a second game of the same second', { skip }, async () => {
  const e = await engine();
  const info = await e.info();
  assert.ok(info.challenges.length > 0);
  assert.ok(info.timetable.jobs);
  assert.equal(info.default_draft.settings.mode, 'rules');
  const draft = JSON.parse(await readFile(DRAFT, 'utf8'));
  let r = await e.play({ ...draft, rumors: [] }, { nowMs: 0 });
  assert.deepEqual(r, { ok: false, status: 400, body: { errors: [{ rumor: null, field: 'rumors', error: 'empty' }] } });
  r = await e.play({ ...draft, settings: { ...draft.settings, mode: 'ai' } }, { nowMs: 0 });
  assert.equal(r.body.errors[0].error, 'no_model');
  const at = Date.UTC(2026, 10, 17, 10, 4, 5, 300);
  const first = await e.play(draft, { nowMs: at });
  assert.equal(first.game.id, '20261117-100405-rules-t1');
  assert.equal(first.game.started, '2026-11-17T10:04:05Z');
  const second = await e.play(draft, { nowMs: at, taken: [first.game.id] });
  assert.equal(second.game.id, '20261117-100405-rules-t1-2');
  assert.deepEqual(second.log, first.log);
  const p = await e.preview(draft, info.default_draft);
  assert.equal(p.ok, true);
  assert.equal(p.changed, false);
  assert.equal(p.body.header.seed, 1);
});

test('a game stopped half way: the same lines before, and the end at the next tick', { skip }, async () => {
  const clock = fakeClock(Date.UTC(2026, 10, 17, 10, 0, 0));
  const server = createServer({ engine: await engine(), session: memoryStore(), local: memoryStore(), now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  const call = async (method, path, body) => server.handle(method, path, new URLSearchParams(), body === undefined ? '' : JSON.stringify(body));
  const draft = JSON.parse(await readFile(DRAFT, 'utf8'));
  const start = await call('POST', 'start', draft);
  assert.equal(start.status, 200);
  await call('POST', 'control', { speed: 100 });
  clock.advance(3000);
  const before = server.stream.lines(0);
  assert.ok(before.length > 2);
  const control = (await call('GET', 'control')).body;
  await call('POST', 'stop', {});
  const after = server.stream.lines(0);
  assert.deepEqual(after.slice(0, before.length), before);
  const end = JSON.parse(after.at(-1));
  assert.equal(end.type, 'end');
  assert.equal(end.tick, control.tick);
  assert.equal(after.length, before.length + 1);
  // The whole game, from «Mis partidas», is the same game further on.
  const id = start.body.game.id;
  await call('POST', 'reset', { clear: true });
  const game = JSON.parse((await call('GET', `games/${id}.game.json`)).text);
  assert.equal(game.stopped, true);
  assert.equal(game.end_tick, end.tick);
  const again = (await call('GET', `games/${id}.jsonl`)).text.split('\n').filter(Boolean);
  assert.deepEqual(again, after);
});
