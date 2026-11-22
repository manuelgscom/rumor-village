// The download of the AI in the downloaded game (aidownload.js): the texts of
// each state, the figures, and the polling and «Activar Con IA» with a fake
// server (network failures while it restarts, then the reload).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAiDownload, downloadOf, downloadView, gbText, percentOf } from './aidownload.js';
import { STRINGS } from './strings.js';

const es = STRINGS.es;
const en = STRINGS.en;
const TOTAL = 5335287008;
const FOLDER = '/home/ana/Rumor Village/models';
const FILE = 'rumor-village-q4.gguf';
const dl = (state, extra = {}) => ({ state, bytes: 0, total: TOTAL, reason: null, folder: FOLDER, file: FILE, ...extra });

test('gbText and percentOf: one decimal in each language, whole percent', () => {
  assert.equal(gbText(TOTAL, 'es'), '5,3');
  assert.equal(gbText(TOTAL, 'en'), '5.3');
  assert.equal(gbText(2e9, 'es'), '2,0');
  assert.equal(gbText(0, 'en'), '0.0');
  assert.equal(gbText(undefined, 'es'), '0,0');
  assert.equal(percentOf(1974056193, TOTAL), 37);
  assert.equal(percentOf(TOTAL - 1, TOTAL), 99, '100 only when it is all there');
  assert.equal(percentOf(TOTAL, TOTAL), 100);
  assert.equal(percentOf(TOTAL * 2, TOTAL), 100);
  assert.equal(percentOf(-5, TOTAL), 0);
  assert.equal(percentOf(10, 0), 0);
  assert.equal(percentOf(null, TOTAL), 0);
});

test('downloadOf: only a known state', () => {
  assert.equal(downloadOf(null), null);
  assert.equal(downloadOf({ ai: { available: false, reason: 'no_model' } }), null);
  assert.equal(downloadOf({ ai: { download: { state: 'sleeping' } } }), null);
  assert.equal(downloadOf({ ai: { download: dl('idle') } }).state, 'idle');
});

test('downloadView: each state, its lines and its one button', () => {
  const idle = downloadView(dl('idle'), es, 'es');
  assert.deepEqual(idle.lines, ['Falta la IA del juego. Se descarga una vez (5,3 GB) y luego todo va sin conexión.']);
  assert.equal(idle.action, 'download');
  assert.equal(idle.actionLabel, 'Descargar la IA (5,3 GB)');
  assert.equal(idle.progress, null);

  const un = downloadView(dl('unavailable'), es, 'es');
  assert.deepEqual(un.lines, [
    'La IA del juego aún no se puede descargar desde aquí.',
    `Si tienes el fichero ${FILE}, ponlo en esta carpeta y vuelve a abrir el juego: lo encontrará solo.`,
  ]);
  assert.equal(un.folder, FOLDER);
  assert.equal(un.action, null, 'nothing to press but «Copiar la carpeta»');

  const run = downloadView(dl('running', { bytes: 1974056193 }), es, 'es');
  assert.deepEqual(run.lines, ['Descargando la IA: 37 % (2,0 de 5,3 GB)']);
  assert.deepEqual(run.progress, { value: 37, label: 'Descarga de la IA' });
  assert.equal(run.hint, 'Mientras tanto puedes jugar Sin IA.');
  assert.equal(run.action, null);
  const runEn = downloadView(dl('running', { bytes: 1974056193 }), en, 'en');
  assert.deepEqual(runEn.lines, ['Downloading the AI: 37% (2.0 of 5.3 GB)']);

  const check = downloadView(dl('checking', { bytes: TOTAL }), es, 'es');
  assert.deepEqual(check.lines, ['Comprobando la IA…']);
  assert.equal(check.action, null);

  const ready = downloadView(dl('ready', { bytes: TOTAL }), es, 'es');
  assert.deepEqual(ready.lines, ['La IA del juego ya está descargada.']);
  assert.equal(ready.action, 'activate');
  assert.equal(ready.actionLabel, 'Activar Con IA');
  assert.equal(ready.hint, 'El juego se recarga en unos segundos.');

  const act = downloadView(dl('activating'), es, 'es', { note: 'busy' });
  assert.deepEqual(act.lines, ['Cargando la IA…']);
  assert.equal(act.action, null);
  assert.equal(act.note, null, 'no old message while it loads');
});

test('downloadView: failed says why in plain words and offers to try again', () => {
  const why = (reason) => downloadView(dl('failed', { reason }), es, 'es');
  assert.deepEqual(why('no_space').lines, [`No hay sitio en el disco: hacen falta 5,3 GB en ${FOLDER}.`]);
  assert.deepEqual(why('download_cut').lines, ['La descarga se cortó.']);
  assert.deepEqual(why('download_bad').lines, ['El fichero llegó dañado y se ha borrado.']);
  assert.deepEqual(why('no_curl').lines, ['Falta el programa curl, que hace la descarga.']);
  assert.deepEqual(why(null).lines, ['La descarga no salió bien.']);
  for (const r of ['no_space', 'download_cut', 'download_bad', 'no_curl', null]) {
    assert.equal(why(r).action, 'download');
    assert.equal(why(r).actionLabel, 'Descargar la IA (5,3 GB)');
  }
  assert.deepEqual(downloadView(dl('failed', { reason: 'no_space' }), en, 'en').lines, [`There is no room on the disk: 5.3 GB are needed in ${FOLDER}.`]);
});

test('downloadView: notes and a pending action', () => {
  const v = downloadView(dl('ready'), es, 'es', { note: 'busy', acting: true });
  assert.equal(v.note, 'Ahora no se puede: termina la partida y vuelve al menú.');
  assert.equal(v.busy, true);
  assert.equal(downloadView(dl('idle'), es, 'es', { note: 'downloadFailed' }).note, 'No se pudo empezar la descarga. Prueba otra vez.');
  // Without a size, the button says no figure.
  assert.equal(downloadView(dl('idle', { total: null }), es, 'es').actionLabel, 'Descargar la IA');
});

// --- The polling and the actions, with a fake server -----------------------------

const reply = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, body, error: status >= 200 && status < 300 ? null : `HTTP ${status}` });
const DOWN = { ok: false, status: 0, body: null, error: 'refused' };
const stateBody = (download, ai = {}) => ({ state: 'waiting', ai: { available: false, reason: 'no_model', ...(download ? { download } : {}), ...ai }, check: { state: 'skipped' } });

/** The page around the controller: its state, fake timers and a scripted server. */
function rig({ download, states = [], posts = {}, clock = { now: 0 } } = {}) {
  const page = { state: stateBody(download), changed: 0, reloads: 0, expected: [], activating: 0 };
  const timers = [];
  const queue = [...states];
  const calls = [];
  const api = {
    state: async () => {
      calls.push('state');
      return queue.length ? queue.shift() : reply(page.state);
    },
    aiDownload: async () => (calls.push('download'), posts.download ?? reply({ download: dl('running') })),
    aiActivate: async () => (calls.push('activate'), posts.activate ?? reply({ activating: true })),
  };
  const ctl = createAiDownload({
    api,
    getState: () => page.state,
    update: (body) => {
      page.state = { ...page.state, ai: body.ai ?? page.state.ai, check: body.check ?? page.state.check };
    },
    changed: () => page.changed++,
    reload: () => page.reloads++,
    onActivating: () => page.activating++,
    expectRestart: (on) => page.expected.push(on),
    setTimer: (fn, ms) => (timers.push({ fn, ms }), timers.length),
    clearTimer: () => {},
    now: () => clock.now,
    maxMs: 60000,
    graceMs: 5000,
  });
  /** Runs the next poll; false when none is waiting. */
  const step = async () => {
    const t = timers.shift();
    if (!t) return false;
    clock.now += t.ms;
    await t.fn();
    return true;
  };
  return { page, ctl, step, calls, timers, clock };
}

test('the progress is polled every second until it is ready, and drawn each time', async () => {
  const { page, ctl, step, timers } = rig({
    download: dl('running', { bytes: 1e9 }),
    states: [reply(stateBody(dl('running', { bytes: 3e9 }))), reply(stateBody(dl('checking', { bytes: TOTAL }))), reply(stateBody(dl('ready', { bytes: TOTAL })))],
  });
  ctl.sync();
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, 1000);
  await step();
  assert.equal(downloadOf(page.state).bytes, 3e9);
  await step();
  assert.equal(downloadOf(page.state).state, 'checking');
  await step();
  assert.equal(downloadOf(page.state).state, 'ready');
  assert.equal(page.changed, 3);
  assert.equal(timers.length, 0, 'ready: no more polling');
  // A network failure in between keeps polling with the state it had.
  const r = rig({ download: dl('running', { bytes: 1e9 }), states: [DOWN] });
  r.ctl.sync();
  await r.step();
  assert.equal(downloadOf(r.page.state).bytes, 1e9);
  assert.equal(r.timers.length, 1);
});

test('nothing to poll while idle, unavailable, failed or ready', () => {
  for (const s of ['idle', 'unavailable', 'failed', 'ready']) {
    const { ctl, timers } = rig({ download: dl(s) });
    ctl.sync();
    assert.equal(timers.length, 0, s);
  }
  const none = rig({ download: null });
  none.ctl.sync();
  assert.equal(none.timers.length, 0);
});

test('«Descargar la IA»: POST, the reply is the new state, then polling; a refusal says so', async () => {
  const { page, ctl, calls, timers } = rig({ download: dl('idle') });
  const going = ctl.download();
  assert.equal(ctl.acting(), true, 'the button is disabled while it is asked');
  await going;
  assert.equal(ctl.acting(), false);
  assert.deepEqual(calls, ['download']);
  assert.equal(downloadOf(page.state).state, 'running');
  assert.equal(timers.length, 1);
  assert.equal(ctl.note(), null);

  const no = rig({ download: dl('failed', { reason: 'download_cut' }), posts: { download: reply({ error: 'busy' }, 409) } });
  await no.ctl.download();
  assert.equal(no.ctl.note(), 'downloadFailed');
  assert.deepEqual(no.calls, ['download', 'state'], 'it reads the state again');
});

test('«Activar Con IA»: the server goes down and comes back Con IA; the page reloads once', async () => {
  const { page, ctl, step, calls, timers } = rig({
    download: dl('ready', { bytes: TOTAL }),
    states: [
      reply(stateBody(dl('activating'))), // the old server, closing
      DOWN,
      DOWN,
      DOWN,
      reply({ state: 'waiting', ai: { available: true, reason: null }, check: { state: 'running' } }),
    ],
  });
  await ctl.activate();
  assert.deepEqual(calls, ['activate']);
  assert.equal(ctl.activating(), true);
  assert.deepEqual(page.expected, [true], 'live/lost.js is told the restart is expected');
  assert.equal(page.activating, 1);
  assert.equal(downloadOf(page.state).state, 'activating', '«Cargando la IA…» at once');
  assert.equal(downloadView(downloadOf(page.state), es, 'es').action, null);
  for (let i = 0; i < 4; i++) {
    await step();
    assert.equal(page.reloads, 0);
  }
  await step();
  assert.equal(page.reloads, 1);
  assert.equal(timers.length, 0, 'no polling after the reload');
  // A second press does nothing.
  await ctl.activate();
  assert.equal(calls.filter((c) => c === 'activate').length, 1);
});

test('«Activar Con IA»: no answer to the POST counts as the server closing', async () => {
  const { page, ctl, step } = rig({ download: dl('ready'), posts: { activate: DOWN }, states: [DOWN, reply(stateBody(null, { available: true, reason: null }))] });
  await ctl.activate();
  assert.equal(ctl.activating(), true);
  await step();
  await step();
  assert.equal(page.reloads, 1);
});

test('«Activar Con IA»: the AI does not start (model_error) also reloads, to say so', async () => {
  const { page, ctl, step } = rig({ download: dl('ready'), states: [DOWN, reply(stateBody(null, { available: false, reason: 'model_error' }))] });
  await ctl.activate();
  await step();
  await step();
  assert.equal(page.reloads, 1);
});

test('«Activar Con IA» with a game under way: 409 says so, nothing restarts', async () => {
  const { page, ctl, timers } = rig({ download: dl('ready'), posts: { activate: reply({ error: 'playing' }, 409) } });
  await ctl.activate();
  assert.equal(ctl.note(), 'busy');
  assert.equal(ctl.activating(), false);
  assert.deepEqual(page.expected, []);
  assert.equal(timers.length, 0);
  assert.equal(downloadView(downloadOf(page.state), es, 'es', { note: ctl.note() }).action, 'activate', 'the button is still there');
});

test('the restart that never comes back gives up with a message; the lost card may show again', async () => {
  const clock = { now: 0 };
  const { page, ctl, step, timers } = rig({ download: dl('ready'), clock, states: Array(100).fill(DOWN) });
  await ctl.activate();
  while (timers.length && clock.now < 70000) await step();
  assert.equal(ctl.activating(), false);
  assert.equal(ctl.note(), 'slow');
  assert.deepEqual(page.expected, [true, false]);
  assert.equal(page.reloads, 0);
  assert.equal(timers.length, 0);
  const v = downloadView(downloadOf(page.state), es, 'es', { note: ctl.note() });
  assert.equal(v.action, 'activate', 'the button comes back');
  assert.equal(v.note, 'La IA no ha arrancado. Cierra el juego y vuelve a abrirlo.');
});

test('a server that answers «ready» after the grace did not activate: the button comes back', async () => {
  const ready = reply(stateBody(dl('ready')));
  const { page, ctl, step } = rig({ download: dl('ready'), states: [ready, ready, ready, ready, ready, ready, ready] });
  await ctl.activate();
  for (let i = 0; i < 5; i++) await step();
  assert.equal(ctl.activating(), true, 'within the grace, the old server may still answer');
  await step();
  assert.equal(ctl.activating(), false);
  assert.equal(ctl.note(), 'activateFailed');
  assert.deepEqual(page.expected, [true, false]);
});

test('a page opened while the engine restarts waits for it too', async () => {
  const { page, ctl, step } = rig({ download: dl('activating'), states: [DOWN, reply(stateBody(null, { available: true, reason: null }))] });
  ctl.sync();
  assert.equal(ctl.activating(), true);
  assert.deepEqual(page.expected, [true]);
  await step();
  await step();
  assert.equal(page.reloads, 1);
});
