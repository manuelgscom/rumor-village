// Package start (phase 8-1, package A): start screen, loading and error
// screens, and the shareable link.
//
//   startScreen(ctx)   nothing to open (no log, live, left/right): the start screen
//   showLoading(ctx)   a recording is loading: <html data-loading>; progress on
//                      ctx.bus 'progress' {part: 'log'|'models', loaded, total}
//   showError(err)     a coded error (core/strings.js) stopped the page
//   showLost(ctx)      inside the game, the game cannot be reached: «Reintentar»
//   hideLost()         it can again
//   init(app)          package of the list of core/app.js: the shareable link
//
//   ctx = {params, lang, zones, bus?, openFile?(file), openBackground?(path, extra)}
//   err = {code, message, detail, lang, zones, game?}
//
// Inside the game (phase 9-5; ctx.params.play or .game, err.game) the screens
// use the words of the game: «Abriendo la partida…», no error code, and a way
// back to the game (?play=1#games) instead of the start screen.
//
// The three screens live in #start (index.html; created if the page lost it,
// as the split screen does), which covers the window while <html> has
// data-start, data-loading or data-error (css/start.css).
//
//   ┌──────────────────────────────── #start ────────────────────────────┐
//   │ ┌ .start-card ───────────────────┐                                 │
//   │ │ Rumor Village          [EN|ES] │                                 │
//   │ │ lead                           │   (the village of the manifest, │
//   │ │ [tour]      [explore]          │    playing with the director:   │
//   │ │ [split]     [telephone] [live] │    openBackground)              │
//   │ │ (drop box: only without one)   │                                 │
//   │ │ in the background: … · rules   │                                 │
//   │ └────────────────────────────────┘                                 │
//   └────────────────────────────────────────────────────────────────────┘
//
// data-ready: once the start screen is painted and the village behind is
// drawn (core/app.js marks it), or at once without a village or if it fails.

import { pick } from '../core/lang.js';
import { inGame } from '../core/params.js';
import { STRINGS as CORE } from '../core/strings.js';
import { acceptDrop } from '../core/source.js';
import { backgroundOf, deciderOf, entriesOf, servedByEngine } from './entries.js';
import { linkOf, queryOf } from './link.js';
import { STRINGS } from './strings.js';

const root = document.documentElement;

/** Where the start screen looks for a manifest when the URL names none. */
const MANIFESTS = ['../runs/demo/manifest.json', '../runs/samples/manifest.json'];
/** Longest wait for the village behind once its source has finished. */
const BACKGROUND_WAIT_MS = 5000;
/** The shareable link is written at most this often. */
const LINK_EVERY_MS = 500;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** The zone of the screens: #start, created if the page has none. */
function startZone() {
  let zone = document.getElementById('start');
  if (!zone) {
    zone = el('div');
    zone.id = 'start';
    document.body.append(zone);
  }
  return zone;
}

function fill(template, vars) {
  return template.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

/** Who decides, in words: «sin modelo: reglas» or «decide <model>[, afinado]». */
function deciderText(rec, t) {
  const d = deciderOf(rec);
  if (d.kind === 'rules') return t.rules;
  return fill(d.finetuned ? t.modelFt : t.model, { model: d.model });
}

/** The first manifest that answers: {data, url} or null. */
async function loadManifest(params) {
  const list = params.manifest ? [params.manifest] : MANIFESTS;
  for (const path of list) {
    const url = new URL(path, location.href).href;
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) continue;
      const data = await res.json();
      if (Array.isArray(data?.recordings)) return { data, url };
    } catch {
      // Not there or not JSON: the next one.
    }
  }
  return null;
}

/** Whether the engine serving the page answers (live mode available). */
async function liveAvailable() {
  if (!servedByEngine(location.pathname)) return false;
  try {
    const res = await fetch('control', { cache: 'no-store' });
    return res.ok;
  } catch {
    return false;
  }
}

/** EN | ES: links to the same start screen in the other language. */
function langSwitch(params, lang, t) {
  const nav = el('nav', 'start-lang');
  nav.setAttribute('aria-label', t.langLabel);
  for (const l of ['en', 'es']) {
    const a = el('a', 'start-lang-option', l.toUpperCase());
    a.href = queryOf([['lang', l], ['manifest', params.manifest]]) || '?';
    a.hreflang = l;
    if (l === lang) {
      a.classList.add('on');
      a.setAttribute('aria-current', 'true');
    }
    nav.append(a);
  }
  return nav;
}

/** One entry: a link with its title, a line and who decides. */
function entryLink(id, query, deciders, t) {
  const s = t.entries[id];
  const a = el('a', `start-entry start-entry-${id}`);
  a.href = query;
  const head = el('span', 'start-entry-title', s.title);
  if (s.meta) head.append(el('span', 'start-entry-meta', s.meta));
  a.append(head, el('span', 'start-entry-sub', s.sub));
  if (deciders.length) a.append(el('span', 'start-entry-who', deciders.join(' · ')));
  return a;
}

/** The drop box (with a file chooser), only when nothing plays behind. */
function dropBox(t, onFile) {
  const box = el('label', 'start-drop');
  const input = el('input');
  input.type = 'file';
  input.accept = '.jsonl,application/x-ndjson';
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) onFile(file);
  });
  box.append(el('span', 'start-drop-title', t.drop), el('span', 'start-drop-sub', t.choose), input);
  return box;
}

/** data-ready after the next paint. */
function readySoon() {
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      root.dataset.ready = '1';
    }),
  );
}

/**
 * Start screen: title, lead, entries and language switch over the village.
 * @param {{params: object, lang: 'es'|'en', zones: object, openFile: (file: File) => void,
 *   openBackground: (path: string, extra?: object) => Promise<void>}} ctx
 */
export function startScreen(ctx) {
  const t = pick(STRINGS, ctx.lang);
  root.dataset.start = '1';
  const zone = startZone();
  const card = el('section', 'start-card');
  const head = el('div', 'start-head');
  head.append(el('h1', 'start-title', t.title), langSwitch(ctx.params, ctx.lang, t));
  const list = el('nav', 'start-entries');
  list.setAttribute('aria-label', t.entriesLabel);
  list.setAttribute('aria-busy', 'true');
  const note = el('p', 'start-note');
  card.append(head, el('p', 'start-lead', t.lead), list, note);
  zone.replaceChildren(el('div', 'start-page start-home'));
  zone.firstChild.append(card);

  let taken = false;
  const openFile = (file) => {
    if (taken) return;
    taken = true;
    delete root.dataset.start;
    zone.replaceChildren();
    ctx.openFile(file);
  };

  Promise.all([loadManifest(ctx.params), liveAvailable()]).then(([manifest, live]) => {
    const entries = manifest ? entriesOf(manifest.data, ctx.lang, manifest.url) : [];
    for (const e of entries) list.append(entryLink(e.id, e.query, e.recordings.map((r) => deciderText(r, t)), t));
    if (live) list.append(entryLink('live', '?live=1', [], t));
    list.removeAttribute('aria-busy');
    if (!list.childElementCount) list.replaceWith(el('p', 'start-none', t.none));

    const bg = manifest ? backgroundOf(manifest.data, ctx.lang, manifest.url) : null;
    if (!bg || typeof ctx.openBackground !== 'function') {
      // Nothing plays behind: a dropped file can take the page.
      note.before(dropBox(t, openFile));
      acceptDrop(zone, openFile);
      note.remove();
      return readySoon();
    }
    const name = bg.recording.id ?? bg.recording.scenario;
    note.textContent = fill(t.behind, { name, decider: deciderText(bg.recording, t) });
    readyWithBackground(ctx.openBackground(bg.path, { speed: 'x4' }));
  });
}

/**
 * data-ready for a start screen with a village behind: core/app.js marks it
 * after the village's first draw; if the village fails, the start screen
 * marks it itself.
 * @param {Promise<void>|void} started what openBackground returned
 */
function readyWithBackground(started) {
  const mark = () => {
    if (!root.dataset.ready) readySoon();
  };
  Promise.resolve(started).then(() => {
    if (root.dataset.ready) return;
    // No app: the header never came, the village failed.
    if (!(/** @type {any} */ (window).rumorApp)) return mark();
    setTimeout(mark, BACKGROUND_WAIT_MS);
  }, mark);
}

/** A progress row: label, bar and figures. */
function progressRow(label) {
  const row = el('div', 'start-progress indeterminate');
  const top = el('div', 'start-progress-top');
  const figure = el('span', 'start-progress-figure', '');
  top.append(el('span', 'start-progress-label', label), figure);
  const track = el('div', 'start-progress-track');
  const bar = el('div', 'start-progress-bar');
  track.append(bar);
  row.append(top, track);
  return {
    row,
    set(fraction, text) {
      const known = fraction !== null;
      row.classList.toggle('indeterminate', !known);
      bar.style.width = known ? `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%` : '';
      figure.textContent = text;
    },
  };
}

function megabytes(bytes, lang) {
  return `${(bytes / 1e6).toLocaleString(lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB`;
}

/**
 * Loading screen: the progress of the recording (bytes) and of the 3D models
 * (files); a total of 0 is unknown (an indeterminate bar).
 * @param {{bus?: object, lang: 'es'|'en', zones: object, params: object}} ctx
 */
export function showLoading(ctx) {
  const t = pick(STRINGS, ctx.lang);
  const game = inGame(ctx.params);
  const log = progressRow(game ? t.partGame : t.partLog);
  const models = progressRow(t.partModels);
  const card = el('section', 'start-card start-card-small');
  card.setAttribute('role', 'status');
  card.append(el('h1', 'start-title start-title-small', t.title), el('p', 'start-lead', game ? t.loadingGame : t.loading), log.row, models.row);
  startZone().replaceChildren(el('div', 'start-page start-center'));
  startZone().firstChild.append(card);
  ctx.bus?.on('progress', ({ part, loaded = 0, total = 0 } = {}) => {
    const pct = (f) => `${Math.round(f * 100)} %`;
    if (part === 'log') {
      if (total > 0) log.set(loaded / total, pct(loaded / total));
      else log.set(null, megabytes(loaded, ctx.lang));
    } else if (part === 'models') {
      if (total > 0) models.set(loaded / total, fill(t.files, { n: loaded, total }));
      else models.set(null, loaded ? fill(t.filesSoFar, { n: loaded }) : '');
    }
  });
}

/**
 * Error screen: the plain message of the code, big; the detail, small; and a
 * way back to the start screen in the same language.
 * @param {{code: string, message: string, detail: string, lang: 'es'|'en', zones?: object}} err
 */
export function showError(err) {
  // A failure of the village behind the start screen leaves the start screen
  // as it is (it only loses its village).
  if (root.dataset.start) {
    delete root.dataset.error;
    delete root.dataset.errorCode;
    if (!root.dataset.ready) readySoon();
    return;
  }
  const t = pick(STRINGS, err.lang);
  const card = el('section', 'start-card start-card-small start-error');
  card.setAttribute('role', 'alert');
  card.append(el('h1', 'start-title start-title-small', t.title), el('p', 'start-error-message', err.message));
  // Inside the game no code: the technical part stays in the console and data-error.
  const detail = err.game ? '' : [err.code, err.detail].filter(Boolean).join(' · ');
  if (detail) card.append(el('p', 'start-error-detail', detail));
  const back = el('a', 'start-back', err.game ? pick(CORE, err.lang).backToGame : t.back);
  back.href = err.game ? `?play=1&lang=${err.lang}#games` : `index.html${queryOf([['lang', err.lang]])}`;
  card.append(back);
  const zone = startZone();
  zone.replaceChildren(el('div', 'start-page start-center'));
  zone.firstChild.append(card);
}

/**
 * Inside the game, the game cannot be reached (the stream is down for a while,
 * live/lost.js): «No se encuentra el juego. ¿Sigue abierta la ventana de
 * play.sh?» and «Reintentar», which reloads the page. <html data-lost>.
 * @param {{lang: 'es'|'en'}} ctx
 */
export function showLost(ctx) {
  const c = pick(CORE, ctx.lang);
  const card = el('section', 'start-card start-card-small start-error start-lost');
  card.setAttribute('role', 'alert');
  const retry = el('button', 'start-back', c.retry);
  retry.type = 'button';
  retry.addEventListener('click', () => location.reload());
  card.append(el('h1', 'start-title start-title-small', pick(STRINGS, ctx.lang).title), el('p', 'start-error-message', c.lost), retry);
  const zone = startZone();
  zone.replaceChildren(el('div', 'start-page start-center'));
  zone.firstChild.append(card);
  root.dataset.lost = '1';
}

/** The game answers again: the card of showLost goes. */
export function hideLost() {
  if (!root.dataset.lost) return;
  delete root.dataset.lost;
  const zone = document.getElementById('start');
  if (zone?.querySelector('.start-lost')) zone.replaceChildren();
}

/**
 * The shareable link: app.link() and the URL kept up to date with
 * history.replaceState (not with embed, behind the start screen or live).
 * @param {object} app see viewer/js/core/app.js
 */
export function init(app) {
  const { params, bus, store, camera } = app;
  let select = params.select ?? null;
  let group = params.group ?? null;

  const stateOf = () => ({
    log: params.log,
    left: params.left,
    right: params.right,
    labels: params.labels,
    lang: params.lang,
    t: store.pos,
    select,
    group,
    cam: camera.moved && camera.base > 0 ? { x: camera.x, y: camera.y, zoom: camera.scale / camera.base } : null,
    director: !!app.story?.director,
    ui: app.ui?.mode ?? null,
  });
  const sharable = !!params.log && app.kind !== 'live';
  app.link = () => (sharable ? new URL(linkOf(stateOf()), location.href).href : location.href);
  if (!sharable || params.embed || params.bg) return;

  let started = false;
  let last = -Infinity;
  let timer = null;
  const write = () => {
    timer = null;
    last = performance.now();
    const query = linkOf(stateOf());
    if (query === location.search) return;
    try {
      history.replaceState(history.state, '', `${location.pathname}${query}${location.hash}`);
    } catch (err) {
      console.warn('viewer: the link could not be written', err);
    }
  };
  const schedule = () => {
    if (!started || timer !== null) return;
    timer = setTimeout(write, Math.max(0, last + LINK_EVERY_MS - performance.now()));
  };

  bus.on('select', ({ neighbor } = {}) => {
    select = neighbor ?? null;
    schedule();
  });
  bus.on('group', ({ key } = {}) => {
    group = key ?? null;
    schedule();
  });
  for (const type of ['seek', 'zoom', 'ui', 'camera-user']) bus.on(type, schedule);
  store.subscribe(schedule);
  // Before 'loaded' the position and the camera are still the URL's own.
  bus.on('loaded', () => {
    started = true;
    schedule();
  });
}
