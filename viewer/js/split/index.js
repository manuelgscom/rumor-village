// Package A of phase 6: split screen. See viewer/js/split/README.md.
//
//   ┌ .sp-side (left) ───────────────┬ .sp-side (right) ──────────────┐
//   │ .sp-head  title · model · fails │ .sp-head                       │
//   │ .sp-score  bars of fails.js     │ .sp-score                      │
//   │ iframe index.html?log=…&embed=1 │ iframe index.html?log=…&embed=1│
//   ├ .sp-bar ────────────────────────┴────────────────────────────────┤
//   │ ◀◀ ▶ ▶▶  x1 x4 fast  [── track ──●──]  Tuesday 20:30  RECORDING   │
//   └───────────────────────────────────────────────────────────────────┘
//
// Each side is the whole viewer in a same-origin iframe, paused; this page
// owns the only clock (clock.js) and moves both with bus 'seek'. Selection,
// group and camera are mirrored between the sides.
//
// Each side is titled with its model; with ?labels=base,ft, «Sin afinar» and
// «Afinado» (sideTitles of pair.js). A refused pair is the coded error
// split-mismatch: data-error on <html> and, on the cover, the plain message
// of core/strings.js with the reason in the reader's language. The tick
// («t 1055 / 1440») only in the technical view (?ui=tech).
//
// Scoreboard (phase 8-2, 2.11): under each title, one bar per figure of
// fails.js (decisions, endless chats, rejected, made up, the opposite, doubts
// as sure), each over the larger of the two sides so the lengths compare
// across the screen. A row flashes when one of its failures goes up (not with
// reduced motion, nor on the first draw). Both sides run in quality `mid`.

import { clockOf } from '../core/clock.js';
import { langOf, pick } from '../core/lang.js';
import { errorText, STRINGS as CORE_STRINGS } from '../core/strings.js';
import { parseSpeed, speedOf } from '../replay/playback.js';
import { fill, STRINGS as REPLAY_STRINGS } from '../replay/strings.js';
import { rangeOf, tickAtX } from '../replay/timeline.js';
import { drawTrack, TRACK_HEIGHT } from '../replay/track.js';
import { createSplitClock } from './clock.js';
import { createFails, SCORE_KEYS, scoreBars } from './fails.js';
import { checkPair, mismatchText, sideTitles } from './pair.js';
import { STRINGS } from './strings.js';

/** URL parameters passed on to both sides. */
const SIDE_PARAMS = ['zoom', 'focus', 'select', 'group', 't'];

// Icons as SVG paths in a 16x16 box (as in replay/index.js).
const ICONS = {
  start: 'M1 2h2v12H1zM15 2v12L9 8zM9 2v12L3 8z',
  play: 'M4 2v12l10-6z',
  pause: 'M3 2h4v12H3zM9 2h4v12H9z',
  end: 'M13 2h2v12h-2zM1 2v12l6-6zM7 2v12l6-6z',
};

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function setIcon(b, name) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('class', 'rp-icon');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', ICONS[name]);
  svg.append(path);
  b.replaceChildren(svg);
}

function button(cls, content, onClick) {
  const b = el('button', `rp-btn ${cls}`);
  if (content in ICONS) setIcon(b, content);
  else b.textContent = content;
  b.type = 'button';
  b.addEventListener('click', (ev) => {
    onClick(ev);
    b.blur(); // the space bar stays the pause key
  });
  return b;
}

function setTitle(b, title) {
  b.title = title;
  b.setAttribute('aria-label', title);
}

/**
 * URL of one side: the viewer, paused and embedded, in quality `mid` (two
 * scenes at once), with the shared parameters and the decorative clock if any.
 * @param {string} log
 * @param {import('../core/params.js').Params} params
 * @returns {string}
 */
export function sideUrl(log, params) {
  const q = new URLSearchParams({ log, embed: '1', paused: '1', q: 'mid' });
  for (const key of SIDE_PARAMS) if (params[key] !== null && params[key] !== undefined) q.set(key, String(params[key]));
  if (params.clock !== null && params.clock !== undefined) q.set('clock', String(params.clock));
  return `index.html?${q}`;
}

/**
 * Rows of the scoreboard of one side: {key: {row, label, fill, n}}. Built
 * with the page, before the sides load, so the header keeps its height and
 * the scenes never resize once they are ready.
 */
function scoreRows(box) {
  const rows = {};
  for (const key of SCORE_KEYS) {
    const row = el('div', `sp-row sp-${key} zero`);
    const label = el('span', 'sp-rlabel', '\u00a0');
    const track = el('span', 'sp-track');
    const fill = el('i', 'sp-fill');
    track.append(fill);
    const n = el('b', 'sp-n', '\u00a0');
    row.append(label, track, n);
    box.append(row);
    rows[key] = { row, label, fill, n };
  }
  return rows;
}

/** Whether a key event comes from a text field. */
function typing(ev) {
  const t = ev.target;
  return !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName ?? ''));
}

/**
 * Replaces the page with the split screen of params.left and params.right.
 * @param {import('../core/params.js').Params} params
 */
export function startSplit(params) {
  const root = document.documentElement;
  let lang = params.lang ?? ((navigator.language ?? '').toLowerCase().startsWith('es') ? 'es' : 'en');
  let titles = null; // sideTitles, once both headers are in
  let failed = false;
  if (params.ui) root.dataset.ui = params.ui;

  // DOM.
  const page = el('div', 'sp');
  const sidesEl = el('div', 'sp-sides');
  const sides = ['left', 'right'].map((which) => {
    const box = el('section', `sp-side sp-${which}`);
    const head = el('header', 'sp-head');
    const label = el('div', 'sp-label');
    const meta = el('div', 'sp-meta');
    const model = el('span', 'sp-model');
    const fails = el('span', 'sp-fails');
    meta.append(model, fails);
    const score = el('div', 'sp-score');
    const rows = scoreRows(score);
    head.append(label, meta, score);
    const frame = el('iframe', 'sp-frame');
    frame.title = which;
    box.append(head, frame);
    sidesEl.append(box);
    return { which, label, model, fails, rows, frame, app: null, failsOf: null, last: null };
  });
  const cover = el('div', 'sp-cover');
  sidesEl.append(cover);

  const bar = el('footer', 'sp-bar');
  const rp = el('div', 'rp');
  const bStart = button('rp-start', 'start', () => clock?.toStart());
  const bPlay = button('rp-play', 'play', () => clock?.togglePause());
  const bEnd = button('rp-end', 'end', () => clock?.toEnd());
  const transport = el('div', 'rp-group');
  transport.append(bStart, bPlay, bEnd);
  const speeds = el('div', 'rp-group rp-speeds');
  const speedButtons = {};
  for (const key of ['x1', 'x4', 'fast']) {
    speedButtons[key] = button('rp-speed', key, () => clock?.setSpeed(speedOf(key)));
    speeds.append(speedButtons[key]);
  }
  const track = el('div', 'rp-track');
  track.setAttribute('role', 'slider');
  const canvas = el('canvas', 'rp-canvas');
  const hover = el('div', 'rp-hover');
  hover.hidden = true;
  track.append(canvas, hover);
  const time = el('div', 'rp-time');
  const timeClock = el('span', 'rp-clock');
  const timeTick = el('span', 'rp-tick tech-only');
  time.append(timeClock, timeTick);
  const recording = el('span', 'sp-recording');
  rp.append(transport, speeds, track, time, recording);
  bar.append(rp);
  page.append(sidesEl, bar);
  document.body.replaceChildren(page);

  /** Texts in the current language (the run's once known). */
  function renderTexts() {
    root.lang = lang;
    const t = pick(STRINGS, lang);
    const r = pick(REPLAY_STRINGS, lang);
    sides.forEach((s, i) => {
      const label = params.labels?.[i];
      s.label.textContent = titles ? titles[i].title : label ? (t.labels[label] ?? label) : '';
      s.model.textContent = titles ? titles[i].model : '';
      for (const key of SCORE_KEYS) {
        s.rows[key].label.textContent = t.score[key];
        s.rows[key].row.title = t.scoreTitle[key];
      }
    });
    setTitle(bStart, r.toStart);
    setTitle(bEnd, r.toEnd);
    speeds.title = r.speedTitle;
    for (const [key, b] of Object.entries(speedButtons)) {
      b.textContent = r[key];
      setTitle(b, key === 'fast' ? r.fastTitle : `${r.speedTitle} ${r[key]}`);
    }
    track.setAttribute('aria-label', r.timeline);
    recording.textContent = pick(CORE_STRINGS, lang).recording;
    if (!clock) cover.textContent = pick(CORE_STRINGS, lang).loading;
  }

  /**
   * Stops with an error: data-error (as core/app.js does) and the cover with
   * the plain message and, smaller, the detail.
   * @param {string} message plain message in the reader's language
   * @param {string} [detail]
   * @param {{code?: string, error?: string}} [data] code and text of data-error
   */
  function fail(message, detail = '', { code = '', error = '' } = {}) {
    if (failed) return;
    failed = true;
    const text = error || (code ? (detail ? `${code}: ${detail}` : code) : message);
    console.error(`viewer: ${text}`);
    root.dataset.error = text;
    if (code) root.dataset.errorCode = code;
    cover.classList.add('error');
    cover.replaceChildren(el('div', 'sp-error', message));
    if (detail) cover.append(el('div', 'sp-detail', detail));
    cover.hidden = false;
  }

  let clock = null;
  let shownPaused = null;
  let shownKey;
  renderTexts();
  renderButtons();
  if (!params.left || !params.right) return fail(pick(STRINGS, lang).missing);
  sides[0].frame.src = sideUrl(params.left, params);
  sides[1].frame.src = sideUrl(params.right, params);

  // Track canvas.
  const css = getComputedStyle(root);
  const colors = {
    accent: css.getPropertyValue('--accent').trim() || '#2f5d8a',
    line: css.getPropertyValue('--line').trim() || '#d9ddd3',
    text: css.getPropertyValue('--text').trim() || '#26313a',
    live: css.getPropertyValue('--live').trim() || '#c0392b',
  };
  const ctx = canvas.getContext('2d');
  let cw = 0;
  let dpr = 1;
  let dirty = true;
  const resize = () => {
    const r = track.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    cw = Math.max(1, Math.round(r.width));
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(TRACK_HEIGHT * dpr);
    canvas.style.width = `${cw}px`;
    canvas.style.height = `${TRACK_HEIGHT}px`;
    dirty = true;
  };
  resize();
  new ResizeObserver(resize).observe(track);

  function renderButtons() {
    const paused = clock ? clock.paused : true;
    if (paused !== shownPaused) {
      shownPaused = paused;
      setIcon(bPlay, paused ? 'play' : 'pause');
      const r = pick(REPLAY_STRINGS, lang);
      setTitle(bPlay, paused ? r.play : r.pause);
    }
    const key = clock ? clock.speed.key : null;
    if (key !== shownKey) {
      shownKey = key;
      for (const [k, b] of Object.entries(speedButtons)) b.classList.toggle('on', k === key);
    }
  }

  // Wait for both sides: data-ready (or data-error) on their <html>.
  const poll = () => {
    if (failed) return;
    let ready = 0;
    for (const s of sides) {
      let doc = null;
      try {
        doc = s.frame.contentDocument?.documentElement ?? null;
      } catch {
        doc = null;
      }
      const error = doc?.dataset.error;
      if (error) {
        const code = doc.dataset.errorCode ?? 'unknown';
        const side = pick(STRINGS, lang).sides[s.which];
        return fail(errorText(code, lang), `${side}: ${error}`, { code, error: `${s.which}: ${error}` });
      }
      if (doc?.dataset.ready && s.frame.contentWindow?.rumorApp) ready++;
    }
    if (ready === sides.length) begin();
    else requestAnimationFrame(poll);
  };
  requestAnimationFrame(poll);

  function begin() {
    const apps = sides.map((s) => s.frame.contentWindow.rumorApp);
    const pair = checkPair(apps[0].header, apps[1].header);
    if (!pair.ok) {
      const detail = mismatchText(pair, pick(CORE_STRINGS, lang).mismatch);
      return fail(errorText('split-mismatch', lang), detail, { code: 'split-mismatch', error: `split-mismatch: ${pair.reason}` });
    }
    lang = langOf(apps[0].header);
    titles = sideTitles([apps[0].header, apps[1].header], params.labels, lang);
    sides.forEach((s, i) => {
      s.app = apps[i];
      s.model.title = apps[i].header.model ?? '';
      s.failsOf = createFails(apps[i].store.events);
    });

    // The common range: from the lowest start to the highest end.
    const ranges = apps.map((a) => rangeOf(a.header, a.store.events));
    const range = { start: Math.min(...ranges.map((r) => r.start)), end: Math.max(...ranges.map((r) => r.end)) };

    // Seeks of this page do not come back as seeks of a side.
    let seeking = false;
    const adapters = apps.map((a) => ({
      seek(pos) {
        if (a.store.pos === pos) return;
        seeking = true;
        try {
          a.bus.emit('seek', { pos });
        } finally {
          seeking = false;
        }
        dirty = true;
      },
    }));
    clock = createSplitClock({
      start: range.start,
      end: range.end,
      speed: parseSpeed(params.speed),
      paused: params.paused ?? false,
      pos: params.t ?? range.start,
      sides: adapters,
    });
    for (const a of apps) {
      a.bus.on('seek', ({ pos } = {}) => {
        if (!seeking && Number.isFinite(pos) && pos !== clock.pos) clock.seek(pos);
      });
    }

    // Mirror selection, group and camera, with a guard against loops.
    let mirroring = false;
    const mirror = (fn) => {
      if (mirroring) return;
      mirroring = true;
      try {
        fn();
      } finally {
        mirroring = false;
      }
    };
    const copyCamera = (from, to) => to.camera.set({ x: from.camera.x, y: from.camera.y, scale: from.camera.scale });
    apps.forEach((a, i) => {
      const other = apps[1 - i];
      a.bus.on('select', ({ neighbor = null } = {}) => mirror(() => other.bus.emit('select', { neighbor })));
      a.bus.on('group', ({ key = null } = {}) => mirror(() => other.bus.emit('group', { key })));
      // Only cameras moved by the user or the URL; each side fits its own home view.
      a.bus.on('zoom', () => {
        if (a.camera.moved) mirror(() => copyCamera(a, other));
      });
    });
    // URL zoom or focus: each side chose its own spot; the left one leads.
    if (apps[0].camera.moved) mirror(() => copyCamera(apps[0], apps[1]));

    // Keyboard: space pauses, arrows move one tick; here and inside each side.
    const onKey = (ev) => {
      if (ev.defaultPrevented || ev.ctrlKey || ev.metaKey || ev.altKey || typing(ev)) return;
      if (ev.key === ' ' || ev.code === 'Space') {
        ev.preventDefault();
        clock.togglePause();
      } else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') {
        ev.preventDefault();
        clock.step(ev.key === 'ArrowLeft' ? -1 : 1);
      }
    };
    document.addEventListener('keydown', onKey);
    for (const s of sides) s.frame.contentWindow.addEventListener('keydown', onKey, true);

    // Track: click or drag to seek, hover to read the clock.
    let dragging = false;
    let hoverX = null;
    const xOf = (ev) => ev.clientX - track.getBoundingClientRect().left;
    const tickOf = (x) => tickAtX(x, range, cw);
    const showHover = (x) => {
      hoverX = Math.max(0, Math.min(cw, x));
      const t = tickOf(hoverX);
      hover.textContent = clockOf(t, apps[0].header.start_weekday ?? 0, lang).text;
      hover.hidden = false;
      const half = hover.offsetWidth / 2;
      hover.style.left = `${Math.max(half, Math.min(cw - half, hoverX))}px`;
      dirty = true;
    };
    track.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      dragging = true;
      track.setPointerCapture(ev.pointerId);
      clock.seek(tickOf(xOf(ev)));
      showHover(xOf(ev));
    });
    track.addEventListener('pointermove', (ev) => {
      if (dragging) {
        const t = tickOf(xOf(ev));
        if (t !== clock.pos) clock.seek(t);
      }
      showHover(xOf(ev));
    });
    const endDrag = () => {
      dragging = false;
    };
    track.addEventListener('pointerup', endDrag);
    track.addEventListener('pointercancel', endDrag);
    track.addEventListener('pointerleave', () => {
      if (dragging) return;
      hoverX = null;
      hover.hidden = true;
      dirty = true;
    });

    // Frames: one clock for both sides; never the wall clock for the state.
    const weekday = apps[0].header.start_weekday ?? 0;
    let shownClock = '';
    let shownTick = '';
    let last = null;
    const t = pick(STRINGS, lang);
    const loop = (now) => {
      const dt = last === null ? 0 : now - last;
      last = now;
      if (!dragging) {
        const chars = Math.max(...apps.map((a) => Number(a.hooks.readingChars?.()) || 0));
        clock.frame(dt, chars);
      }
      adapters.forEach((s) => s.seek(clock.pos));
      renderButtons();
      renderScore();
      if (dirty) {
        dirty = false;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawTrack(ctx, { w: cw, range, pos: clock.pos, edge: null, marks: [], hoverX, colors });
        const c = clockOf(clock.pos, weekday, lang).text;
        const tk = `${t.tick} ${Math.floor(clock.pos)} / ${range.end}`;
        if (c !== shownClock) timeClock.textContent = shownClock = c;
        if (tk !== shownTick) timeTick.textContent = shownTick = tk;
        track.setAttribute('aria-valuemin', String(range.start));
        track.setAttribute('aria-valuemax', String(range.end));
        track.setAttribute('aria-valuenow', String(Math.floor(clock.pos)));
      }
      requestAnimationFrame(loop);
    };

    // The scoreboard: both sides at once, since each bar is over the larger one.
    let shownScore = '';
    const renderScore = () => {
      const now = sides.map((s) => s.failsOf.at(s.app.store.index));
      const key = JSON.stringify(now);
      if (key === shownScore) return;
      shownScore = key;
      const calm = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      const bars = scoreBars(now);
      sides.forEach((s, i) => {
        const f = now[i];
        s.fails.textContent = fill(t.fails, { n: f.total });
        s.fails.title = fill(t.failsTitle, f);
        s.fails.classList.toggle('some', f.total > 0);
        for (const b of bars[i]) {
          const r = s.rows[b.key];
          r.fill.style.width = `${(100 * b.share).toFixed(2)}%`;
          r.n.textContent = String(b.n);
          r.row.classList.toggle('zero', b.n === 0);
          // A failure that goes up flashes its row (decisions only grow).
          if (b.key !== 'decisions' && s.last && b.n > s.last[b.key] && !calm) {
            r.row.classList.remove('flash');
            void r.row.offsetWidth; // restart the animation
            r.row.classList.add('flash');
          }
        }
        s.last = f;
      });
    };

    renderTexts();
    shownPaused = null;
    renderButtons();
    clock.seek(clock.pos); // the first position, on both sides
    renderScore();
    // Bars glide from the second draw on (the first is already in place).
    requestAnimationFrame(() => page.classList.add('sp-anim'));
    cover.hidden = true;
    requestAnimationFrame(loop);
    // Ready once both sides and the bar have drawn that position.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        root.dataset.ready = '1';
      }),
    );
  }
}
