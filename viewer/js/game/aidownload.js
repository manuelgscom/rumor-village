// The download of the AI inside the downloaded game (phase 10): when the model
// is missing and the AI is possible, GET state carries `ai.download` and the
// menu offers to download it, shows the progress and, once it is there,
// «Activar Con IA», which restarts the engine with the AI. No DOM: the texts
// (downloadView) and the polling (createAiDownload); screens.js draws the
// block (aiDownloadBlock) and index.js wires it. The web version never has
// `ai.download`.
//
//   unavailable    nowhere to download it from yet: the file goes by hand in `folder`
//   idle / failed ──POST ai/download──► running ──► checking ──► ready
//   ready ──POST ai/activate──► activating: the server closes and comes back on
//        the same port, Con IA (up to ~30 s); GET state every second, network
//        failures tolerated, until ai.available (or reason model_error), then
//        the page reloads on the menu
//
// While the engine restarts, live/lost.js is told it is expected
// (expectRestart), so «No se encuentra el juego» does not show.

import { fill } from '../rumor/strings.js';

/** Polling of GET state while the download moves or the engine restarts, in ms. */
export const POLL_MS = 1000;
/** How long the restart with the AI may take before the page gives up waiting, in ms. */
export const ACTIVATE_MAX_MS = 120000;
/**
 * After POST ai/activate, how long an answer that is not «activating» is put
 * down to the old server still closing, in ms; after that it means the
 * activation did not happen.
 */
export const ACTIVATE_GRACE_MS = 5000;
/** The states of `ai.download` (docs/arquitectura.md, GET state). */
export const DL_STATES = ['unavailable', 'idle', 'running', 'checking', 'ready', 'failed', 'activating'];
const POLLED = new Set(['running', 'checking', 'activating']);

/** `ai.download` of a GET state body, or null when there is none (or it is not one). */
export function downloadOf(state) {
  const d = state?.ai?.download;
  return d && typeof d === 'object' && DL_STATES.includes(d.state) ? d : null;
}

/** Bytes as GB with one decimal, in the language: «5,3» / «5.3». */
export function gbText(bytes, lang) {
  const n = Number(bytes);
  const gb = Number.isFinite(n) && n > 0 ? n / 1e9 : 0;
  return gb.toLocaleString(lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** Whole percent done, 0 to 100 (rounded down: 100 only when it is all there). */
export function percentOf(bytes, total) {
  const b = Number(bytes);
  const n = Number(total);
  if (!Number.isFinite(b) || !Number.isFinite(n) || n <= 0) return 0;
  return Math.max(0, Math.min(100, Math.floor((b / n) * 100)));
}

/**
 * What the block says and offers for a download state.
 * @param {any} dl `ai.download`
 * @param {any} t STRINGS[lang]
 * @param {string} lang
 * @param {{note?: string|null, acting?: boolean}} [o] note: the key of the last
 *   message of an action (t.aiDl.notes); acting: an action is on its way
 * @returns {{state: string, lines: string[], progress: {value: number, label: string}|null,
 *   folder: string|null, action: 'download'|'activate'|null, actionLabel: string|null,
 *   busy: boolean, hint: string|null, note: string|null}}
 */
export function downloadView(dl, t, lang, { note = null, acting = false } = {}) {
  const s = t.aiDl;
  const total = Number(dl?.total) > 0 ? gbText(dl.total, lang) : null;
  const folder = typeof dl?.folder === 'string' && dl.folder ? dl.folder : null;
  const v = { state: dl?.state ?? 'idle', lines: [], progress: null, folder: null, action: null, actionLabel: null, busy: !!acting, hint: null, note: note ? (s.notes[note] ?? null) : null };
  const download = () => {
    v.action = 'download';
    v.actionLabel = total ? fill(s.download, { total }) : s.downloadPlain;
  };
  switch (v.state) {
    case 'unavailable':
      v.lines = [s.unavailable, fill(s.byHand, { file: dl.file || s.theFile })];
      v.folder = folder;
      break;
    case 'running': {
      const pct = percentOf(dl.bytes, dl.total);
      v.lines = [total ? fill(s.running, { pct, done: gbText(Math.min(Number(dl.bytes) || 0, Number(dl.total)), lang), total }) : s.runningPlain];
      v.progress = { value: total ? pct : 0, label: s.progress };
      v.hint = s.meanwhile;
      break;
    }
    case 'checking':
      v.lines = [s.checking];
      v.hint = s.meanwhile;
      break;
    case 'ready':
      v.lines = [s.ready];
      v.action = 'activate';
      v.actionLabel = s.activate;
      v.hint = s.activateHint;
      break;
    case 'failed':
      v.lines = [fill(s.failed[dl.reason] ?? s.failedOther, { total: total ?? '?', folder: folder ?? s.theFolder })];
      download();
      break;
    case 'activating':
      v.lines = [s.activating];
      v.note = null;
      break;
    default: // idle
      v.lines = [total ? fill(s.idle, { total }) : s.idlePlain];
      download();
  }
  return v;
}

/**
 * The polling and the two actions of the download.
 * @param {{
 *   api: {state: () => Promise<any>, aiDownload: () => Promise<any>, aiActivate: () => Promise<any>},
 *   getState: () => any,          the GET state body the page holds
 *   update: (body: any) => void,  takes a fresher {ai, check} into it
 *   changed: () => void,          the block is drawn again
 *   reload: () => void,           the engine is back with the AI: the page reloads
 *   onActivating?: () => void,    the restart begins (the page sets where a reload lands)
 *   expectRestart?: (on: boolean) => void,  live/lost.js
 *   setTimer?: typeof setTimeout, clearTimer?: typeof clearTimeout, now?: () => number,
 *   pollMs?: number, maxMs?: number, graceMs?: number,
 * }} o
 */
export function createAiDownload({
  api,
  getState,
  update,
  changed,
  reload,
  onActivating = () => {},
  expectRestart = () => {},
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  now = Date.now,
  pollMs = POLL_MS,
  maxMs = ACTIVATE_MAX_MS,
  graceMs = ACTIVATE_GRACE_MS,
}) {
  let timer = null;
  let since = null; // when the restart with the AI began, while it lasts
  let note = null;
  let acting = false;
  let done = false; // the page is reloading

  const dl = () => downloadOf(getState());
  const wants = () => !done && (since !== null || POLLED.has(dl()?.state));
  const schedule = () => {
    if (timer === null && wants()) timer = setTimer(tick, pollMs);
  };
  const ask = async (call) => {
    try {
      return (await call()) ?? { ok: false, status: 0, body: null };
    } catch {
      return { ok: false, status: 0, body: null };
    }
  };
  const withDownload = (download) => {
    const st = getState();
    update({ ai: { ...(st?.ai ?? {}), download }, check: st?.check });
  };

  function enterActivating() {
    if (since !== null) return;
    since = now();
    note = null;
    expectRestart(true);
    onActivating();
    const d = dl();
    if (d && d.state !== 'activating') withDownload({ ...d, state: 'activating' });
  }

  function leaveActivating(why) {
    since = null;
    note = why;
    expectRestart(false);
  }

  /** One GET state while the restart lasts: true when the page is going. */
  function restartStep(reply) {
    const body = reply.ok ? reply.body : null;
    if (body?.ai?.available === true || body?.ai?.reason === 'model_error') {
      done = true;
      reload();
      return true;
    }
    const state = downloadOf(body)?.state;
    if (state && state !== 'activating' && now() - since > graceMs) {
      // The engine answers and is not restarting: the activation did not happen.
      leaveActivating('activateFailed');
      update(body);
    } else if (now() - since > maxMs) {
      // Given up: the button comes back (the message says to open the game again).
      leaveActivating('slow');
      const d = dl();
      if (d?.state === 'activating') withDownload({ ...d, state: 'ready' });
    }
    return false;
  }

  async function tick() {
    timer = null;
    if (done) return;
    const reply = await ask(() => api.state());
    if (done) return;
    if (since !== null) {
      if (restartStep(reply)) return;
    } else if (reply.ok && reply.body?.ai) {
      update(reply.body);
      if (dl()?.state === 'activating') enterActivating();
    }
    changed();
    schedule();
  }

  /** GET state once, outside the loop (after an action that failed). */
  async function refresh() {
    const reply = await ask(() => api.state());
    if (reply.ok && reply.body?.ai) update(reply.body);
  }

  return {
    /** Starts polling if the state asks for it (after a page load, or a fresher state). */
    sync() {
      if (dl()?.state === 'activating') enterActivating();
      schedule();
    },
    note: () => note,
    acting: () => acting,
    activating: () => since !== null,
    /** «Descargar la IA»: POST ai/download, then the progress. */
    async download() {
      if (acting || since !== null || done) return;
      acting = true;
      note = null;
      changed();
      const reply = await ask(() => api.aiDownload());
      acting = false;
      if (reply.ok && downloadOf({ ai: { download: reply.body?.download } })) withDownload(reply.body.download);
      else {
        note = 'downloadFailed';
        await refresh();
      }
      changed();
      schedule();
    },
    /**
     * «Activar Con IA»: POST ai/activate. 200 (or no answer: the server may close
     * first) starts the wait; 409 (a game under way) says so.
     */
    async activate() {
      if (acting || since !== null || done) return;
      acting = true;
      note = null;
      changed();
      const reply = await ask(() => api.aiActivate());
      acting = false;
      if (reply.ok || reply.status === 0) enterActivating();
      else {
        note = reply.status === 409 ? 'busy' : 'activateFailed';
        await refresh();
      }
      changed();
      schedule();
    },
    /** Stops polling. */
    stop() {
      if (timer !== null) clearTimer(timer);
      timer = null;
      done = true;
    },
  };
}
