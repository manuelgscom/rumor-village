// Package B: rewind and timeline. See docs/fases/fase-3.md.
//
// Installs the snapshot-based stateAt in the store, builds the bar in
// #timeline and moves the playback position:
//
//   ⏮ (▶) ⏭  [x1|x4|rápida]  ‹ [▼ se deforma ›]  ◆──▼─── 18:00 ░░ 21:00 ▓▐▓▓  ☀ 17:35   [● EN DIRECTO]
//                                                ◆ entra el rumor ▼ se deforma …  martes (· t 1055)
//
// The track shows day and night, the marks of timeline.js (hover: what
// happened and when; click: jump there) and the cursor; drag to rewind. It
// takes the focus: arrows move a minute (Shift, an hour), Home and End.
// «‹» and «next moment» (keys P and N) jump between the ticks with marks;
// the next one is named on the button, and a jump shows what happened there.
// The tick (t 1055) is only seen in the technical view (.tech-only).
//
// Keys, never while typing: space pauses, ←/→ move, N/P moments, D the
// director (app.story), ? the help (bus 'help'). Space pauses with the focus on
// the map, the page or the bar (a button of the bar is not pressed then, the
// focus stays); on any other button, link, summary or control it keeps its
// usual meaning (keys.js).
//
// Recording: plays at the URL speed from `t` unless `paused`; without `t`, it
// opens START_LEAD ticks before the first inject (timeline.js startTick). Live: follows
// the live edge (store.lastTick) smoothly; seeking away plays locally until
// it catches up or «back to live» is pressed. Pause and speed go on the bus
// ('pause' {paused, engine}, 'speed' {value, fast, engine}); `engine` is true
// only while following the live edge, so package E forwards them. Package E
// tells the engine's own state with 'engine' {paused, speed, ended}: while
// following the edge the transport shows it, without emitting anything back.
//
// Live, in the game mode (bus 'game' {phase}, <html data-game-phase>): the
// pill is the one state of the game (phase 9-5): «Esperando a que empieces»
// (boot, menu, prepare; grey and still, no speeds), «Jugando», «Terminada»,
// and «Volver al ahora» when looking at the past, with «Estás mirando atrás
// (el pueblo sigue)». Outside the game, live: «EN DIRECTO», «TERMINADO»,
// «Volver al directo» and «Estás viendo las 10:15 · el pueblo va por las
// 11:02». The play button names what it pauses: the village while
// following, only what is seen otherwise.

import { clockOf, isNight, WEEKDAYS, weekdayOf } from '../core/clock.js';
import { pick } from '../core/lang.js';
import { inGame } from '../core/params.js';
import { focusOf, spacePauses } from './keys.js';
import { chase, engineView, liveLabel, liveStep, parseSpeed, playTitle, speedOf, step } from './playback.js';
import { createStateAt } from './snapshots.js';
import { fill, STRINGS } from './strings.js';
import { marksNear, marksOf, markText, preparingRange, rangeOf, startTick, stepMark, tickAtX, xOfTick } from './timeline.js';
import { drawTrack, MARK_COLORS, markKey, TRACK_HEIGHT } from './track.js';
import { BIG_STEP, SPEEDS, START_LEAD } from './constants.js';

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

// Icons as SVG paths in a 16x16 box (the fonts at hand lack some glyphs).
const ICONS = {
  start: 'M1 2h2v12H1zM15 2v12L9 8zM9 2v12L3 8z',
  play: 'M4 2v12l10-6z',
  pause: 'M3 2h4v12H3zM9 2h4v12H9z',
  end: 'M13 2h2v12h-2zM1 2v12l6-6zM7 2v12l6-6z',
  prev: 'M10.6 1.6L12.4 3.4 7.8 8l4.6 4.6-1.8 1.8L4.2 8z',
  next: 'M5.4 1.6L3.6 3.4 8.2 8l-4.6 4.6 1.8 1.8L11.8 8z',
};

const NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

function setIcon(b, name) {
  const svg = svgEl('svg', { viewBox: '0 0 16 16', class: 'rp-icon', 'aria-hidden': 'true' });
  svg.append(svgEl('path', { d: ICONS[name] }));
  b.replaceChildren(svg);
}

/** Sun or moon of the clock, in a 24x24 box. */
function skyIcon(night) {
  const svg = svgEl('svg', { viewBox: '0 0 24 24', class: `rp-sky ${night ? 'night' : 'day'}`, 'aria-hidden': 'true' });
  if (night) {
    svg.append(svgEl('path', { d: 'M15.5 3.2a9 9 0 1 0 5.3 13.9A7.5 7.5 0 0 1 15.5 3.2z' }));
    svg.append(svgEl('circle', { cx: 18.5, cy: 5.5, r: 1.1 }), svgEl('circle', { cx: 21, cy: 10, r: 0.8 }));
  } else {
    svg.append(svgEl('circle', { cx: 12, cy: 12, r: 4.6 }));
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      const c = Math.cos(a);
      const s = Math.sin(a);
      svg.append(
        svgEl('line', { x1: 12 + 7.2 * c, y1: 12 + 7.2 * s, x2: 12 + 10 * c, y2: 12 + 10 * s, 'stroke-linecap': 'round' }),
      );
    }
  }
  return svg;
}

/** Small glyph of a mark kind for the legend and the tooltip, in a 12x12 box. */
function markGlyph(key) {
  const svg = svgEl('svg', { viewBox: '0 0 12 12', class: 'rp-glyph', 'aria-hidden': 'true' });
  const fill = MARK_COLORS[key];
  if (key === 'inject') svg.append(svgEl('path', { d: 'M6 0.5L11 6 6 11.5 1 6z', fill }));
  else if (key === 'change') svg.append(svgEl('path', { d: 'M0.5 1.5h11L6 11z', fill }));
  else if (key === 'forget') svg.append(svgEl('rect', { x: 1.5, y: 1.5, width: 9, height: 9, fill }));
  else {
    // Arrivals: right (✓) and wrong (✗) differ in shape too, not only in color.
    svg.append(svgEl('circle', { cx: 6, cy: 6, r: 5.5, fill }));
    const d = key === 'arriveOk' ? 'M3.3 6.2l1.9 1.9 3.6-3.8' : 'M4 4l4 4M8 4l-4 4';
    svg.append(svgEl('path', { d, fill: 'none', stroke: '#ffffff', 'stroke-width': 1.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  }
  return svg;
}

function button(cls, text, title, onClick) {
  const b = el('button', `rp-btn ${cls}`);
  if (text in ICONS) setIcon(b, text);
  else b.textContent = text;
  b.type = 'button';
  b.title = title;
  b.setAttribute('aria-label', title);
  // The focus stays (keyboard navigation goes on); the space bar is still the
  // pause key, see the keyboard below.
  b.addEventListener('click', (ev) => onClick(ev));
  return b;
}

/**
 * Starts the package. Called once, with the header known and before any event.
 * @param {object} app see viewer/js/core/app.js
 */
export function init(app) {
  const { store, bus, header, params } = app;
  const text = pick(STRINGS, app.lang);
  const live = store.live;
  // Inside the game (phase 9-5): one state in the pill, no speeds while preparing.
  const game = inGame(params);
  const zone = app.zones.timeline;

  store.setStateAt(createStateAt(store));

  // Playback state.
  let speed = parseSpeed(params.speed);
  let paused = live ? false : (params.paused ?? false);
  let enginePaused = false;
  let engineKey; // speed button of the engine; undefined until it is known
  let engineEnded = false;
  let following = live && params.t === null;
  let loaded = live;
  let dragging = false;
  let waitMs = 0;
  let waitedTick = null;
  let selfSeek = false;
  // Inside the game, while preparing: one day, cut at the `until` of the draft.
  let until = null;
  const rangeNow = () => {
    const r = rangeOf(header, store.events);
    return game && preparing() ? preparingRange(r, until) : r;
  };
  let range = rangeOf(header, store.events);
  let marks = [];
  let marksDirty = true;
  let dirty = true;
  let hoverX = null;
  let pinned = null; // tick of the moment just jumped to: its marks stay told
  let started = live || params.t !== null; // where to open is decided

  // DOM.
  const rootEl = el('div', 'rp');
  const bStart = button('rp-start', 'start', text.toStart, () => toStart());
  const bPlay = button('rp-play', 'play', text.play, () => togglePause());
  const bEnd = button('rp-end', 'end', text.toEnd, () => toEnd());
  const transport = el('div', 'rp-group rp-transport');
  transport.append(bStart, bPlay, bEnd);
  const bPrev = button('rp-prev', 'prev', text.prev, () => jumpMark(-1));
  const bNext = button('rp-next', '', text.next, () => jumpMark(1));
  const moments = el('div', 'rp-group rp-moments');
  // Inside the game: «Momentos ‹ ›», with what they are in the title.
  if (game) {
    moments.title = text.momentsTitle;
    moments.append(el('span', 'rp-moments-label', text.moments));
  }
  moments.append(bPrev, bNext);
  const speeds = el('div', 'rp-group rp-speeds');
  speeds.setAttribute('role', 'group');
  speeds.title = text.speedTitle;
  const speedButtons = {};
  for (const key of ['x1', 'x4', 'fast']) {
    const b = button(`rp-speed`, text[key], key === 'fast' ? text.fastTitle : `${text.speedTitle} ${text[key]}`, () =>
      setSpeed(speedOf(key)),
    );
    speedButtons[key] = b;
    speeds.append(b);
  }
  const track = el('div', 'rp-track');
  track.setAttribute('role', 'slider');
  track.setAttribute('aria-label', text.timeline);
  track.title = text.timeline;
  track.tabIndex = 0;
  const canvas = el('canvas', 'rp-canvas');
  const hover = el('div', 'rp-hover');
  hover.hidden = true;
  track.append(canvas, hover);
  const legend = el('div', 'rp-legend');
  const line = el('div', 'rp-line');
  line.append(track, legend);
  const time = el('div', 'rp-time rich');
  const timeSky = el('span', 'rp-sky-box');
  const timeText = el('span', 'rp-time-text');
  const timeClock = el('span', 'rp-clock');
  const timeTick = el('span', 'rp-tick');
  const timeDay = el('span', 'rp-day');
  const timeTk = el('span', 'rp-tk tech-only');
  timeTick.append(timeDay, timeTk);
  timeText.append(timeClock, timeTick);
  time.append(timeSky, timeText);
  rootEl.append(transport, speeds, moments, line, time);
  let liveEl = null;
  let behindEl = null; // live, not following: the hour seen and the village's
  if (live) {
    behindEl = el('div', 'rp-behind');
    behindEl.hidden = true;
    liveEl = button('rp-live', '', text.backToLive, () => backToLive());
    rootEl.append(behindEl, liveEl);
  }
  zone.replaceChildren(rootEl);

  const css = getComputedStyle(document.documentElement);
  const colors = {
    accent: css.getPropertyValue('--accent').trim() || '#2f5d8a',
    line: css.getPropertyValue('--line').trim() || '#d9ddd3',
    text: css.getPropertyValue('--text').trim() || '#26313a',
    live: css.getPropertyValue('--live').trim() || '#c0392b',
  };
  const ctx = canvas.getContext('2d');
  let cw = 0;
  let dpr = 1;
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
  document.fonts?.ready.then(() => {
    dirty = true; // the hour labels of the band use the page font
  });

  // Helpers.
  const edge = () => (live ? store.lastTick : null);
  const lastPos = () => (live ? store.lastTick : range.end);
  const clampPos = (p) => Math.max(range.start, Math.min(lastPos(), p));

  const seekSelf = (pos) => {
    selfSeek = true;
    try {
      bus.emit('seek', { pos });
    } finally {
      selfSeek = false;
    }
    dirty = true;
  };

  /** A seek from the user: resets the reading pause; in live, follows if at the edge. */
  const userSeek = (pos) => {
    waitMs = 0;
    waitedTick = null;
    if (live) following = pos >= store.lastTick;
    seekSelf(pos);
    renderButtons();
  };

  let shownIcon = true;
  const shownPaused = () => (live && following ? enginePaused || range.ended : paused);
  const shownKey = () => (live && following && engineKey !== undefined ? engineKey : speed.key);

  /** Phase of the game mode (package game), or undefined outside it. */
  const gamePhase = () => document.documentElement.dataset.gamePhase;

  function renderButtons() {
    const p = shownPaused();
    if (p !== shownIcon) setIcon(bPlay, (shownIcon = p) ? 'play' : 'pause');
    bPlay.title = text[playTitle({ live, following, paused: p })];
    bPlay.setAttribute('aria-label', bPlay.title);
    bPlay.disabled = preparing();
    // Inside the game, while waiting: no transport, speeds nor moments.
    const waiting = game && preparing();
    for (const g of [transport, speeds, moments]) if (g.hidden !== waiting) g.hidden = waiting;
    const k = shownKey();
    for (const [key, b] of Object.entries(speedButtons)) b.classList.toggle('on', k === key);
    if (liveEl) {
      const kind = liveLabel({ following, over: engineEnded || range.ended, phase: gamePhase() });
      liveEl.classList.toggle('following', following);
      liveEl.classList.toggle('ended', kind === 'ended');
      liveEl.classList.toggle('preparing', kind === 'preparing');
      const label = game ? text.game[kind] : { preparing: text.preparing, live: text.live, ended: text.ended, back: text.backToLive }[kind];
      if (liveEl.dataset.label !== label) {
        liveEl.dataset.label = label;
        const mark = following ? el('span', 'rp-live-dot') : el('span', 'rp-live-arrow', '»');
        liveEl.replaceChildren(mark, el('span', 'rp-live-text', label));
        liveEl.title = kind === 'preparing' ? text.preparingTitle : label;
        liveEl.setAttribute('aria-label', liveEl.title);
      }
      liveEl.disabled = following;
      if (behindEl.hidden !== following) {
        behindEl.hidden = following;
        dirty = true; // its text is written with the clock
      }
    }
  }

  function setPaused(p) {
    const engine = live && following;
    if (engine) enginePaused = p;
    else paused = p;
    bus.emit('pause', { paused: p, engine });
    renderButtons();
  }

  /** Live while the game is still being prepared: the clock is stopped, nothing to pause. */
  const preparing = () => live && liveLabel({ following, over: false, phase: gamePhase() }) === 'preparing';

  function togglePause() {
    if (live && following && (engineEnded || range.ended)) return; // nothing left to resume
    if (preparing()) return;
    if (!shownPaused()) return setPaused(true);
    // Play at the end of a recording starts again.
    if (!live && store.pos >= range.end) userSeek(range.start);
    setPaused(false);
  }

  function setSpeed(s) {
    speed = s;
    if (live && following) engineKey = s.key;
    waitMs = 0;
    bus.emit('speed', { value: s.tps, fast: s.fast, engine: live && following });
    renderButtons();
  }

  function toStart() {
    userSeek(range.start);
  }

  /** Jumps to the next (1) or previous (-1) moment with marks, and tells what happened there. */
  function jumpMark(dir) {
    const s = stepMark(marks, store.pos, dir, live ? store.lastTick : Infinity);
    if (!s) return;
    userSeek(s.tick);
    pinned = s.tick;
    if (!dragging) hideHover();
  }

  function toEnd() {
    if (live) return backToLive();
    userSeek(range.end);
  }

  function backToLive() {
    following = true;
    waitMs = 0;
    renderButtons();
  }

  // Bus and store.
  bus.on('seek', ({ pos }) => {
    if (selfSeek) return;
    waitMs = 0;
    waitedTick = null;
    if (live) following = pos >= store.lastTick;
    dirty = true;
    renderButtons();
  });
  bus.on('pause', ({ paused: p, engine }) => {
    // Another package paused or resumed: show it (our own emits change nothing).
    if (engine) enginePaused = !!p;
    else paused = !!p;
    renderButtons();
  });
  bus.on('speed', ({ value, fast, engine } = {}) => {
    // Another package (the story mode) sets the speed; our own emits change nothing.
    if (engine || !(value > 0) || value === speed.tps) return;
    const key = Object.keys(SPEEDS).find((k) => SPEEDS[k] === value);
    speed = key ? speedOf(key) : { key: null, tps: value, fast: !!fast };
    waitMs = 0;
    renderButtons();
  });
  bus.on('engine', (e) => {
    // The engine's own state (package E): only shown, never sent back.
    const v = engineView(e);
    enginePaused = v.paused;
    engineKey = v.key;
    engineEnded = !!e?.ended;
    renderButtons();
  });
  bus.on('fact', () => {
    marksDirty = true;
  });
  bus.on('game', ({ draft } = {}) => {
    // The pill tells whether the game runs yet; the range follows the draft.
    if (draft) until = draft.settings?.until ?? null;
    range = rangeNow();
    dirty = true;
    renderButtons();
  });
  bus.on('loaded', () => {
    loaded = true;
    started = true; // no inject at all: it stays at the start
    marksDirty = true;
    if (!paused && store.pos >= range.end) paused = true;
    renderButtons();
  });
  store.subscribe((change) => {
    if (change.type === 'append') {
      // A recording without `t` opens just before its first inject, as soon as it is in.
      if (!started && store.firstFact !== null) {
        started = true;
        seekSelf(startTick(header, store.events, START_LEAD));
      }
      const wasEnded = range.ended;
      range = rangeNow();
      marksDirty = true;
      if (range.ended !== wasEnded) renderButtons();
    }
    dirty = true;
  });

  // Track: click or drag to seek, hover to read the clock and the marks.
  // Near a mark the pointer snaps to it: the tooltip tells what happened and
  // a click jumps to its tick.
  const SNAP_PX = 7;
  let hot = [];
  const weekday = header.start_weekday ?? 0;
  const xOf = (ev) => ev.clientX - track.getBoundingClientRect().left;
  const tickOf = (x) => tickAtX(x, range, cw, live ? store.lastTick : Infinity);
  const reachable = (m) => !live || m.tick <= store.lastTick;
  const nearMarks = (x) => marksNear(marks, x, range, cw, SNAP_PX).filter(reachable);
  /** Fills and places the tooltip: the clock of tick t and up to four marks. */
  const showTip = (t, list, anchor, hint) => {
    const c = clockOf(t, weekday, app.lang);
    const head = el('div', 'rp-hover-clock');
    head.append(el('b', '', c.time), el('span', '', ` ${c.weekdayName}`), el('span', 'tech-only', ` · ${text.tick} ${t}`));
    const rows = [head];
    for (const m of list.slice(0, 4)) {
      const row = el('div', 'rp-hover-mark');
      const when = m.tick !== t ? `${clockOf(m.tick, weekday, app.lang).time} · ` : '';
      row.append(markGlyph(markKey(m)), el('span', '', when + describe(m)));
      rows.push(row);
    }
    if (hint) rows.push(el('div', 'rp-hover-hint', text.jump));
    hover.replaceChildren(...rows);
    hover.classList.toggle('marks', list.length > 0);
    hover.hidden = false;
    // Centered on the mark (or the pointer), kept inside the track; the
    // arrow keeps pointing at the anchor.
    const half = hover.offsetWidth / 2;
    const left = Math.max(half, Math.min(cw - half, anchor));
    hover.style.left = `${left}px`;
    hover.style.setProperty('--arrow', `${Math.max(12 - half, Math.min(half - 12, anchor - left))}px`);
  };
  const showHover = (x) => {
    hoverX = Math.max(0, Math.min(cw, x));
    hot = dragging ? [] : nearMarks(hoverX);
    const t = hot.length ? hot[0].tick : tickOf(hoverX);
    showTip(t, hot, hot.length ? xOfTick(hot[0].tick, range, cw) : hoverX, hot.length > 0 && !dragging);
    track.classList.toggle('on-mark', hot.length > 0);
    dirty = true;
  };
  /** The moment just jumped to, told in the tooltip while the position is on it. */
  let pinnedShown = null;
  const showPinned = () => {
    if (pinned !== null && Math.floor(store.pos) !== pinned) pinned = null;
    const want = hoverX === null ? pinned : null;
    if (want === pinnedShown) return;
    pinnedShown = want;
    if (want === null) {
      if (hoverX === null) {
        hover.hidden = true;
        hot = [];
      }
      return;
    }
    const list = marks.filter((m) => m.tick === want);
    hot = list;
    showTip(want, list, xOfTick(want, range, cw), false);
    dirty = true;
  };
  const hideHover = () => {
    hoverX = null;
    hot = [];
    hover.hidden = true;
    pinnedShown = null;
    track.classList.remove('on-mark');
    dirty = true;
  };
  track.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    const x = xOf(ev);
    const snap = nearMarks(x)[0];
    dragging = true;
    track.setPointerCapture(ev.pointerId);
    track.classList.add('dragging');
    userSeek(snap ? snap.tick : tickOf(x));
    showHover(x);
  });
  track.addEventListener('pointermove', (ev) => {
    if (dragging) {
      const t = tickOf(xOf(ev));
      if (t !== Math.floor(store.pos) || store.pos !== t) userSeek(t);
    }
    showHover(xOf(ev));
  });
  const endDrag = () => {
    dragging = false;
    track.classList.remove('dragging');
  };
  track.addEventListener('pointerup', endDrag);
  track.addEventListener('pointercancel', endDrag);
  track.addEventListener('pointerleave', () => {
    if (!dragging) hideHover();
  });

  const describe = (m) => markText(m, header, app.lang, text);

  // Keyboard: space pauses, arrows move one tick (Shift: an hour), N/P the
  // moments, D the director, ? the help; Home/End on the focused track. Not
  // while typing, and not for the village behind the start screen. Space
  // leaves alone the controls outside the bar (keys.js).
  const typing = (t) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  const isSpace = (ev) => ev.key === ' ' || ev.code === 'Space';
  if (!params.bg) {
    document.addEventListener('keydown', (ev) => {
      if (ev.defaultPrevented || ev.ctrlKey || ev.metaKey || ev.altKey || typing(ev.target)) return;
      const key = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key;
      if (isSpace(ev)) {
        if (!spacePauses(focusOf(ev.target))) return;
        if (!ev.repeat) togglePause();
      } else if (key === 'ArrowLeft' || key === 'ArrowRight') {
        const step = (ev.shiftKey ? BIG_STEP : 1) * (key === 'ArrowLeft' ? -1 : 1);
        userSeek(clampPos(Math.floor(store.pos) + step));
      } else if ((key === 'Home' || key === 'End') && ev.target === track) {
        if (key === 'Home') toStart();
        else toEnd();
      } else if (key === 'n' || key === 'p') {
        jumpMark(key === 'n' ? 1 : -1);
      } else if (key === 'd') {
        if (!ev.repeat) app.story.setDirector(!app.story.director);
      } else if (key === '?') {
        if (!ev.repeat) bus.emit('help');
      } else {
        return;
      }
      ev.preventDefault();
    });
    // A focused button of the bar keeps the focus, but the space bar does not
    // press it; any other button is pressed as usual.
    document.addEventListener(
      'keyup',
      (ev) => {
        if (isSpace(ev) && ev.target instanceof HTMLButtonElement && spacePauses(focusOf(ev.target))) ev.preventDefault();
      },
      true,
    );
  }

  // Frames: move the position, then redraw the bar if needed.
  let shownClock = '';
  let shownTick = '';
  let shownDay = '';
  let shownNight = null;
  let shownLegend = '';
  const shortDays = (WEEKDAYS[app.lang] ?? WEEKDAYS.en).map((d) => d.slice(0, 3));
  const dayName = (t) => shortDays[weekdayOf(t, weekday)];
  const renderLegend = () => {
    const keys = ['inject', 'change', 'forget', 'arriveOk', 'arriveOther'].filter((k) => marks.some((m) => markKey(m) === k));
    const sig = keys.join('|');
    if (sig === shownLegend) return;
    shownLegend = sig;
    legend.replaceChildren(
      ...keys.map((k) => {
        const item = el('span', 'rp-legend-item');
        item.append(markGlyph(k), el('span', '', text.legend[k]));
        return item;
      }),
    );
  };
  // «Next moment»: the button names what comes next.
  let shownNext;
  const renderNext = () => {
    const s = stepMark(marks, store.pos, 1, live ? store.lastTick : Infinity);
    const sig = s ? `${s.tick}|${s.marks.map(markKey).join(',')}` : '';
    if (sig === shownNext) return;
    shownNext = sig;
    bNext.disabled = !s;
    const label = el('span', 'rp-next-text', s ? text.legend[markKey(s.marks[0])] : game ? '' : text.noNext);
    const parts = s ? [markGlyph(markKey(s.marks[0])), label] : [label];
    const arrow = svgEl('svg', { viewBox: '0 0 16 16', class: 'rp-icon', 'aria-hidden': 'true' });
    arrow.append(svgEl('path', { d: ICONS.next }));
    bNext.replaceChildren(...parts, arrow);
    const tip = s ? `${text.next} · ${fill(text.nextTo, { what: describe(s.marks[0]), time: clockOf(s.tick, weekday, app.lang).time })}` : text.next;
    bNext.title = tip;
    bNext.setAttribute('aria-label', tip);
    bPrev.disabled = !stepMark(marks, store.pos, -1, live ? store.lastTick : Infinity);
  };

  app.onFrame((dt) => {
    if (loaded && !dragging) {
      if (live && following && game) {
        // Inside the game a pause stops what is seen at once (playback.js
        // liveStep). An ended run reads as paused (engineView): it still plays to its end.
        const next = liveStep(store.pos, dt, { edge: store.lastTick, frozen: enginePaused && !engineEnded && !range.ended });
        if (next !== store.pos) seekSelf(next);
      } else if (live && following) {
        const next = chase(store.pos, store.lastTick, dt);
        if (next !== store.pos) seekSelf(next);
      } else if (!paused) {
        const r = step({ pos: store.pos, waitMs, waitedTick }, dt, {
          tps: speed.tps,
          fast: speed.fast,
          chars: Number(app.hooks.readingChars?.()) || 0,
          end: lastPos(),
        });
        waitMs = r.waitMs;
        waitedTick = r.waitedTick;
        if (r.pos !== store.pos) seekSelf(r.pos);
        if (r.atEnd) {
          if (live) following = true;
          else paused = true;
          renderButtons();
        }
      }
    }
    if (marksDirty) {
      marks = marksOf(store.events, app.factId());
      marksDirty = false;
      dirty = true;
      renderLegend();
    }
    if (!dirty) return;
    dirty = false;
    renderNext();
    showPinned();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawTrack(ctx, { w: cw, range, pos: store.pos, edge: edge(), marks, hoverX, colors, hot, dayName });
    const clock = clockOf(store.pos, weekday, app.lang);
    const tk = ` · ${text.tick} ${Math.floor(store.pos)}`;
    if (clock.time !== shownClock) {
      timeClock.textContent = shownClock = clock.time;
      track.setAttribute('aria-valuetext', `${clock.time} ${clock.weekdayName}`);
    }
    if (clock.weekdayName !== shownDay) timeDay.textContent = shownDay = clock.weekdayName;
    if (tk !== shownTick) timeTk.textContent = shownTick = tk;
    if (behindEl && !behindEl.hidden) {
      const behind = game ? text.behindGame : fill(text.behind, { seen: clock.time, edge: clockOf(store.lastTick, weekday, app.lang).time });
      if (behindEl.textContent !== behind) behindEl.textContent = behind;
    }
    const night = isNight(store.pos);
    if (night !== shownNight) {
      shownNight = night;
      timeSky.replaceChildren(skyIcon(night));
      time.title = night ? text.night : text.day;
      time.classList.toggle('night', night);
    }
    track.setAttribute('aria-valuemin', String(range.start));
    track.setAttribute('aria-valuemax', String(range.end));
    track.setAttribute('aria-valuenow', String(Math.floor(store.pos)));
  });

  range = rangeNow();
  renderButtons();
}
