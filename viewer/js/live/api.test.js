// The routes of the game mode in the client (api.js), with a fake fetch.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from './api.js';

const BASE = 'http://127.0.0.1:8080/';

/** A fake fetch that records each call and answers `status` with `body`. */
function fakeFetch(status = 200, body = { ok: 1 }) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, method: init.method, body: init.body === undefined ? undefined : JSON.parse(init.body) });
    const text = body === null ? '' : JSON.stringify(body);
    return { ok: status >= 200 && status < 300, status, text: async () => text };
  };
  return { fn, calls };
}

test('each game route has its method, path and body', async () => {
  const { fn, calls } = fakeFetch();
  const api = createApi({ base: BASE, fetch: fn });
  const draft = { settings: { type: 'village', neighbors: 25, town: 417, mode: 'ai' }, rumors: [] };
  await api.state();
  await api.preview(draft);
  await api.start(draft);
  await api.stop();
  await api.reset();
  await api.reset({ clear: true });
  await api.quit();
  await api.games();
  await api.profile();
  await api.saveProfile({ format: 1, tutorial_seen: true });
  assert.deepEqual(calls, [
    { url: `${BASE}state`, method: 'GET', body: undefined },
    { url: `${BASE}preview`, method: 'POST', body: draft },
    { url: `${BASE}start`, method: 'POST', body: draft },
    { url: `${BASE}stop`, method: 'POST', body: {} },
    { url: `${BASE}reset`, method: 'POST', body: {} },
    { url: `${BASE}reset`, method: 'POST', body: { clear: true } },
    { url: `${BASE}quit`, method: 'POST', body: {} },
    { url: `${BASE}games`, method: 'GET', body: undefined },
    { url: `${BASE}profile`, method: 'GET', body: undefined },
    { url: `${BASE}profile`, method: 'POST', body: { format: 1, tutorial_seen: true } },
  ]);
});

test('the download of the AI: POST ai/download and ai/activate, relative to the page', async () => {
  const { fn, calls } = fakeFetch();
  // The downloaded game may be served under a folder: the paths stay relative.
  const api = createApi({ base: 'http://127.0.0.1:8080/game/index.html?play=1', fetch: fn });
  await api.aiDownload();
  await api.aiActivate();
  assert.deepEqual(calls, [
    { url: 'http://127.0.0.1:8080/game/ai/download', method: 'POST', body: {} },
    { url: 'http://127.0.0.1:8080/game/ai/activate', method: 'POST', body: {} },
  ]);
});

test('card puts game, tick and who in the query; without game, the current one', async () => {
  const { fn, calls } = fakeFetch();
  const api = createApi({ base: BASE, fetch: fn });
  await api.card({ game: '20261117-101500-ai-t417', tick: 540, who: 'n003' });
  await api.card({ tick: 12, who: 'n010' });
  assert.equal(calls[0].url, `${BASE}card?game=20261117-101500-ai-t417&tick=540&who=n003`);
  assert.equal(calls[1].url, `${BASE}card?tick=12&who=n010`);
  assert.equal(calls[0].method, 'GET');
});

test('a reply keeps the parsed body; an error status gives its message', async () => {
  const ok = createApi({ base: BASE, fetch: fakeFetch(200, { state: 'waiting', run: 'r1' }).fn });
  assert.deepEqual(await ok.state(), { ok: true, status: 200, body: { state: 'waiting', run: 'r1' }, error: null });

  const bad = createApi({ base: BASE, fetch: fakeFetch(409, { error: 'not waiting' }).fn });
  const r = await bad.start({});
  assert.equal(r.ok, false);
  assert.equal(r.status, 409);
  assert.equal(r.error, 'not waiting');

  const errs = { errors: [{ rumor: 0, field: 'who', error: 'unknown' }] };
  const r400 = await createApi({ base: BASE, fetch: fakeFetch(400, errs).fn }).start({});
  assert.deepEqual(r400.body, errs);
  assert.equal(r400.error, 'HTTP 400');
});

test('without an answer the call resolves with status 0, never rejects', async () => {
  const api = createApi({
    base: BASE,
    fetch: async () => {
      throw new Error('connection refused');
    },
  });
  for (const r of [await api.state(), await api.quit(), await api.card({ tick: 1, who: 'n001' })]) {
    assert.deepEqual(r, { ok: false, status: 0, body: null, error: 'connection refused' });
  }
});
