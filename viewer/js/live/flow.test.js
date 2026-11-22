// The input against a real HTTP server (devserver.mjs, the stand-in of the
// engine's routes) on a free port of 127.0.0.1.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { controlBody, createApi, engineState } from './api.js';
import { createDevServer, listen } from './devserver.mjs';
import { createFlow, createFollow } from './flow.js';
import { parseDraft } from './inject.js';
import { STRINGS } from './strings.js';
import { readRepoFile } from '../core/testing.js';

const lines = readRepoFile('runs/samples/party-100-es-s2.jsonl').split('\n').filter(Boolean);
const es = STRINGS.es;

async function start(opts = {}) {
  const server = createDevServer({ lines, paused: true, ...opts });
  const port = await listen(server);
  return { server, api: createApi({ base: `http://127.0.0.1:${port}/` }) };
}

let base;
before(async () => {
  base = await start();
});
after(() => base.server.close());

test('control: read, pause, speed', async () => {
  const { api, server } = base;
  const c = await api.control();
  assert.equal(c.status, 200);
  assert.equal(c.body.extract, false);
  assert.equal((await api.setControl(controlBody('pause', { paused: true, engine: true }))).body.paused, true);
  assert.equal((await api.setControl(controlBody('speed', { value: 7.6, fast: true, engine: true }))).body.speed, 8);
  assert.equal(server.control.speed, 8);
  const bad = await api.setControl({ speed: 0 });
  assert.equal(bad.status, 400);
  assert.match(bad.error, /speed/);
  await api.setControl({ action: 'pause', speed: 2 });
});

test('control bodies only for the engine', () => {
  assert.equal(controlBody('pause', { paused: true }), null);
  assert.equal(controlBody('pause', { paused: true, engine: false }), null);
  assert.deepEqual(controlBody('pause', { paused: false, engine: true }), { action: 'resume' });
  assert.deepEqual(controlBody('speed', { value: 0.2, engine: true }), { speed: 1 });
  assert.deepEqual(controlBody('speed', { value: 30, fast: true, engine: true }), { speed: 30 });
  assert.equal(controlBody('speed', { value: 'x', engine: true }), null);
  assert.equal(controlBody('zoom', { engine: true }), null);
});

test('viewport: 204, and 400 for an unknown id', async () => {
  const { api, server } = base;
  const ok = await api.viewport(['n001', 'n002']);
  assert.equal(ok.status, 204);
  assert.equal(ok.ok, true);
  assert.deepEqual(server.viewports.at(-1), ['n001', 'n002']);
  const bad = await api.viewport(['n999']);
  assert.equal(bad.status, 400);
});

test('without extractor: 501, fields, dry run, then drop', async () => {
  const { api, server } = base;
  const states = [];
  const flow = createFlow({ api, lang: 'es', text: es, extract: true, onChange: (s) => states.push(s.phase) });
  // The run said it had an extractor but answers 501: the fields take over.
  await flow.understand({ text: 'esta noche hay fiesta en la plaza a las 9' });
  assert.equal(flow.state.mode, 'fields');
  assert.equal(flow.state.phase, 'idle');

  await flow.understand(parseDraft('fiesta|plaza|hoy 21:00|bar', false));
  assert.equal(flow.state.phase, 'understood');
  assert.equal(flow.state.understood, 'Entendido: fiesta · plaza · hoy 21:00');
  assert.deepEqual(flow.state.notes, ['Sin dato: quién, cuánta gente']);
  assert.equal(server.injected.length, 0, 'the dry run drops nothing');
  assert.deepEqual(flow.pending, { fact: { what: 'fiesta', where: 'plaza', when: 'hoy 21:00' }, to: { place: 'bar' } });

  await flow.drop('iglesia');
  assert.equal(flow.state.phase, 'dropped');
  assert.equal(flow.state.droppedAt, 'iglesia');
  assert.deepEqual(server.injected.at(-1), {
    fact: { what: 'fiesta', where: 'plaza', when: 'hoy 21:00' },
    to: { place: 'iglesia' },
  });
  assert.ok(states.includes('busy'));

  // Nothing to drop twice.
  await flow.drop('bar');
  assert.equal(server.injected.length, 1);
});

test('nothing is dropped before it is understood, nor after an edit', async () => {
  const { api, server } = base;
  const flow = createFlow({ api, lang: 'es', text: es });
  const before = server.injected.length;
  await flow.drop('bar');
  assert.equal(flow.state.phase, 'idle');
  await flow.understand({ what: 'boda', to: 'bar' });
  assert.equal(flow.state.phase, 'understood');
  flow.edit();
  await flow.drop('bar');
  assert.equal(server.injected.length, before);
});

test('errors are shown with the server message', async () => {
  const { api } = base;
  const flow = createFlow({ api, lang: 'es', text: es });
  await flow.understand({ what: '', to: 'bar' });
  assert.equal(flow.state.error, es.needWhat);
  await flow.understand({ what: 'fiesta', where: 'luna', to: 'bar' });
  assert.equal(flow.state.phase, 'error');
  assert.equal(flow.state.error, 'Error 400: unknown place: luna');
  await flow.understand({ what: 'fiesta', to: 'marte' });
  assert.equal(flow.state.error, 'Error 400: unknown place: marte');
});

test('409 when the run has ended; network errors', async () => {
  const ended = await start();
  const flow = createFlow({ api: ended.api, lang: 'es', text: es });
  await flow.understand({ what: 'fiesta', to: 'bar' });
  ended.server.control.ended = true;
  await flow.drop();
  assert.equal(flow.state.phase, 'error');
  assert.equal(flow.state.error, es.ended409);
  ended.server.close();

  const gone = createFlow({ api: createApi({ base: 'http://127.0.0.1:1/' }), lang: 'es', text: es });
  await gone.understand({ what: 'fiesta', to: 'bar' });
  assert.equal(gone.state.error, es.network);
});

test('with extractor: the sentence, what it understood, then the drop with the text', async () => {
  const sentence = 'esta noche hay fiesta en la plaza a las 9';
  const x = await start({
    extractor: (text) => ({
      fact: { what: 'fiesta', who: null, where: 'plaza', when: 'hoy 21:00', amount: null },
      understood: 'Entendido: fiesta · plaza · hoy 21:00',
      empty: ['who', 'amount'],
      unknown: text.includes('Nadie') ? { who: 'Nadie' } : {},
    }),
  });
  assert.equal((await x.api.control()).body.extract, true);
  const flow = createFlow({ api: x.api, lang: 'es', text: es, extract: true });
  await flow.understand({ text: sentence });
  assert.equal(flow.state.phase, 'understood');
  assert.equal(flow.state.understood, 'Entendido: fiesta · plaza · hoy 21:00');
  assert.equal(x.server.injected.length, 0);
  await flow.drop('bar');
  assert.equal(flow.state.phase, 'dropped');
  assert.deepEqual(x.server.injected[0], {
    fact: { what: 'fiesta', where: 'plaza', when: 'hoy 21:00' },
    to: { place: 'bar' },
    text: sentence,
  });
  await flow.understand({ text: 'fiesta de Nadie' });
  assert.deepEqual(flow.state.notes, ['Sin dato: cuánta gente', 'No reconocido: quién «Nadie»']);
  x.server.close();

  // An answer without a fact cannot be dropped.
  const none = await start({ extractor: () => ({ fact: null, understood: 'Entendido: —', empty: [], unknown: {} }) });
  const f2 = createFlow({ api: none.api, lang: 'es', text: es, extract: true });
  await f2.understand({ text: 'hola' });
  assert.equal(f2.state.phase, 'error');
  assert.equal(f2.state.error, es.noFact);
  await f2.drop('bar');
  assert.equal(none.server.injected.length, 0);
  none.server.close();
});

test('engineState: from the control bodies', async () => {
  assert.deepEqual(engineState({ paused: true, speed: 8, tick: 3, ended: false, extract: false }), {
    paused: true,
    speed: 8,
    ended: false,
  });
  assert.deepEqual(engineState({ paused: false, speed: 'max', ended: true }), { paused: false, speed: 'max', ended: true });
  assert.equal(engineState(null), null);
  assert.equal(engineState({ error: 'x' }), null);
  const c = await base.api.control();
  assert.equal(typeof engineState(c.body).paused, 'boolean');
});

test('follow: after a drop, the first inject from then on is the rumor followed', () => {
  const followed = [];
  const follow = createFollow((fact) => followed.push(fact));
  const events = [
    { type: 'inject', tick: 1210, fact: 'f1' },
    { type: 'turn', tick: 1211 },
  ];
  // Nothing armed: an inject does not change the rumor followed.
  assert.equal(follow.check(events), null);
  follow.arm(events.length);
  assert.equal(follow.armed, true);
  events.push({ type: 'move', tick: 1212 });
  assert.equal(follow.check(events), null, 'no inject yet');
  events.push({ type: 'inject', tick: 1213, fact: 'f2' }, { type: 'inject', tick: 1213, fact: 'f3' });
  assert.equal(follow.check(events), 'f2');
  assert.equal(follow.armed, false);
  assert.equal(follow.check(events), null, 'only once');
  assert.deepEqual(followed, ['f2']);

  // The inject may reach the store before the answer of POST inject.
  follow.arm(events.length);
  events.push({ type: 'inject', tick: 1300, fact: 'f4' });
  assert.equal(follow.check(events), 'f4');
  // A drop that failed is forgotten.
  follow.arm(events.length);
  follow.disarm();
  events.push({ type: 'inject', tick: 1400, fact: 'f5' });
  assert.equal(follow.check(events), null);
  assert.deepEqual(followed, ['f2', 'f4']);
});
