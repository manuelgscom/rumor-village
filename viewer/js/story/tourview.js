// The story mode on screen (#tour): the card with the sentence of each chapter
// and its controls, and the driving of the viewer (seek, speed, pause, camera,
// zones, selection). The chapters are pure (tour.js); the only wall clock here
// is the time spent in a chapter, which decides when the next one comes.
//
//   ┌ #tour ───────────────────────────────────────────────┐
//   │ LA HISTORIA · sin modelo: reglas                   × │
//   │ Entra el rumor                                       │
//   │ Carmen es la primera en oírlo: fiesta de …           │
//   │ ‹  ● ● ○ ○ ○ ○  ❚❚  ›          [Explorar por mi cuenta] │
//   └──────────────────────────────────────────────────────┘
//
// Each chapter: seek to its start, speed = its ticks / its time (a still when
// it has no ticks), the camera flies to its shot (a cut with reduced motion),
// app.ui.only shows the zones uncovered so far. Moving the camera by hand or
// pausing playback pauses the tour; resuming playback resumes it. Escape or
// «Explorar por mi cuenta» leaves it (app.ui.only(null)).
//
// Opens with tour=1, or by itself on the first visit when the URL is not a
// capture (isCapture) nor a shared view; never with tour=0. chapter=N opens it
// there; with paused=1 it stays still there (captures): the cut, the zones
// and the selection are in place before the first draw after 'loaded'.

import { inGame, isCapture } from '../core/params.js';
import { parseSpeed } from '../replay/playback.js';
import { marksOf } from '../replay/timeline.js';
import { legendList } from './help.js';
import { chaptersOf, FAST_TPS, partAt } from './tour.js';

const SEEN_KEY = 'rumor-village.tour.seen';

/** Longest frame counted by the chapter clock (a hidden tab does not skip chapters). */
const MAX_DT = 1000;

const ICONS = {
  back: 'M10.5 2.5 5 8l5.5 5.5',
  next: 'M5.5 2.5 11 8l-5.5 5.5',
  play: 'M4 2v12l10-6z',
  pause: 'M3 2h4v12H3zM9 2h4v12H9z',
};

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function segs(parent, list) {
  for (const s of list) parent.append(s.strong ? el('b', '', s.text) : document.createTextNode(s.text));
  return parent;
}

function icon(name) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', `tr-icon tr-${name}`);
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', ICONS[name]);
  svg.append(p);
  return svg;
}

function seen() {
  try {
    return window.localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

function markSeen() {
  try {
    window.localStorage.setItem(SEEN_KEY, '1');
  } catch {
    // No storage: the tour opens again on the next first visit.
  }
}

/**
 * Whether the tour opens by itself for these params (tour=1 forces it, tour=0
 * forbids it; otherwise only on a first visit to a plain recording URL).
 * On a phone the story mode is all there is: it opens on any plain URL.
 * @param {import('../core/params.js').Params} p
 * @param {boolean} visited
 * @param {boolean} [phone]
 */
export function opensByItself(p, visited, phone = false) {
  // Inside the game (play, or «Mis partidas → Ver») never: the game has its own tutorial.
  if (inGame(p)) return false;
  if (p.tour !== null) return p.tour;
  if (isCapture(p)) return false;
  if (phone) return true;
  if (visited) return false;
  return !(p.select || p.group || p.focus || p.cam || p.zoom !== null || p.director);
}

/**
 * Builds the story mode of a recording.
 * @param {object} app
 * @param {object} t strings of story/strings.js
 * @param {ReturnType<import('./phrase.js').createPhraser>} phraser
 * @returns {{start: () => void, open: (n?: number) => void, close: () => void, active: () => boolean}}
 */
export function createTour(app, t, phraser) {
  const { bus, store } = app;
  const tt = t.tour;
  const root = document.documentElement;
  const zone = document.getElementById('tour');
  if (zone) zone.hidden = true;

  let chapters = [];
  let k = -1; // current chapter
  let part = -1; // current part of it
  let elapsed = 0; // ms spent in the chapter
  let active = false;
  let running = false;
  let over = false; // the last chapter has run its time
  let self = false; // our own emits on the bus
  let userSpeed = parseSpeed(app.params.speed).tps;

  const emit = (type, payload) => {
    self = true;
    try {
      bus.emit(type, payload);
    } finally {
      self = false;
    }
  };
  const setPlaying = (on) => emit('pause', { paused: !on, engine: false });
  const setSpeed = (tps) => emit('speed', { value: tps, fast: tps >= FAST_TPS, engine: false });
  const setDock = (open) => {
    const dock = document.querySelector('.dock');
    if (dock) dock.open = open;
  };

  // ── Card ───────────────────────────────────────────────────────────
  const card = el('div', 'tr-card');
  card.setAttribute('role', 'region');
  card.setAttribute('aria-label', tt.label);
  card.setAttribute('aria-live', 'polite');
  const top = el('div', 'tr-top');
  const label = el('span', 'tr-label', tt.label);
  const who = segs(el('span', 'tr-who'), phraser.decider());
  const x = el('button', 'tr-x', '×');
  x.type = 'button';
  x.title = tt.explore;
  x.setAttribute('aria-label', tt.explore);
  top.append(label, who, x);
  const title = el('h2', 'tr-title');
  const body = el('div', 'tr-body');
  const nav = el('div', 'tr-nav');
  const btn = (name, text, fn) => {
    const b = el('button', `tr-btn tr-${name}`);
    b.type = 'button';
    b.title = text;
    b.setAttribute('aria-label', text);
    b.append(icon(name));
    b.addEventListener('click', () => {
      fn();
      b.blur();
    });
    return b;
  };
  const bBack = btn('back', tt.back, () => back());
  const dots = el('div', 'tr-dots');
  const bPause = btn('pause', tt.pause, () => (running ? pause(true) : resume()));
  const bNext = btn('next', tt.next, () => go(k + 1));
  const bExplore = el('button', 'tr-explore', tt.explore);
  bExplore.type = 'button';
  bExplore.addEventListener('click', () => close());
  x.addEventListener('click', () => close());
  nav.append(bBack, dots, bPause, bNext, bExplore);
  const bar = el('div', 'tr-progress');
  const fillBar = el('span');
  bar.append(fillBar);
  card.append(top, title, body, nav, bar);
  zone?.replaceChildren(card);

  const renderButtons = () => {
    bPause.replaceChildren(icon(running ? 'pause' : 'play'));
    bPause.title = running ? tt.pause : tt.play;
    bPause.setAttribute('aria-label', bPause.title);
    bPause.disabled = over && !running;
    bBack.disabled = k <= 0 && elapsed < 1500;
    bNext.disabled = k >= chapters.length - 1;
    bExplore.classList.toggle('last', k === chapters.length - 1);
  };

  const render = () => {
    const ch = chapters[k];
    const p = phraser.chapter(ch.line);
    title.replaceChildren();
    segs(title, p.title);
    body.replaceChildren(...p.body.map((s) => segs(el('p', 'tr-text'), s)));
    if (ch.key === 'spread') body.append(legendList(t));
    dots.replaceChildren(
      ...chapters.map((c, i) => {
        const d = el('button', i === k ? 'tr-dot on' : i < k ? 'tr-dot done' : 'tr-dot');
        d.type = 'button';
        const name = phraser.chapter(c.line).title.map((s) => s.text).join('');
        d.title = `${tt.chapter.replace('{n}', i + 1).replace('{total}', chapters.length)} · ${name}`;
        d.setAttribute('aria-label', d.title);
        if (i === k) d.setAttribute('aria-current', 'step');
        d.addEventListener('click', () => go(i));
        return d;
      }),
    );
    if (zone) zone.dataset.chapter = String(ch.n);
    renderButtons();
  };

  // ── Driving the viewer ─────────────────────────────────────────────
  /** Puts part j of the current chapter on screen. */
  const applyPart = (j, { instant = false, play = running } = {}) => {
    const ch = chapters[k];
    const p = ch.parts[j];
    part = j;
    if (p.group) {
      bus.emit('select', { neighbor: null });
      bus.emit('group', { key: p.group });
    } else {
      bus.emit('group', { key: null });
      bus.emit('select', { neighbor: p.select });
    }
    if (play) {
      const moving = p.to > p.from;
      if (moving) setSpeed(p.speed);
      setPlaying(moving);
    }
    if (app.story.director) app.story.setDirector(false);
    const shot = p.shot;
    app.story.fly(() => app.story.viewOf(shot), shot.kind !== 'home', instant || app.reducedMotion());
  };

  /** Enters chapter i from its start. */
  const enter = (i, { instant = false } = {}) => {
    k = i;
    elapsed = 0;
    over = false;
    const ch = chapters[k];
    app.ui.only(ch.zones);
    setDock(ch.zones.includes('dock'));
    if (Math.abs(store.pos - ch.from) > 1e-6) bus.emit('seek', { pos: ch.from });
    render();
    applyPart(0, { instant });
    fillBar.style.transform = 'scaleX(0)';
    bus.emit('chapter', { n: ch.n, key: ch.key });
  };

  const go = (i) => {
    if (!active || i < 0 || i >= chapters.length) return;
    running = true;
    enter(i);
  };

  const back = () => {
    if (elapsed >= 1500 || k === 0) go(k);
    else go(k - 1);
  };

  const pause = (byUs) => {
    if (!running) return;
    running = false;
    if (byUs) setPlaying(false);
    renderButtons();
  };

  const resume = () => {
    if (running || !active) return;
    if (over) return;
    running = true;
    // Back to the chapter's shot and pace (the camera may have been moved).
    applyPart(Math.max(0, part), { play: true });
    renderButtons();
  };

  const open = (n = null, { still = false } = {}) => {
    if (!chapters.length) return;
    markSeen();
    active = true;
    root.toggleAttribute('data-tour', true);
    if (zone) zone.hidden = false;
    // chapter=N: that chapter, or the next one in number if it was left out.
    let at = n === null ? 0 : chapters.findIndex((c) => c.n === n);
    if (at < 0) {
      const later = chapters.filter((c) => c.n > n).sort((p, q) => p.n - q.n)[0];
      at = later ? chapters.indexOf(later) : 0;
    }
    running = !still;
    enter(at, { instant: true });
    // Chapter 1 (the village) opens with the flight from high above (phase 8-2).
    if (!still && chapters[at].key === 'village' && !app.reducedMotion()) app.story.opening();
  };

  const close = () => {
    if (!active) return;
    active = false;
    running = false;
    if (zone) zone.hidden = true;
    root.removeAttribute('data-tour');
    bus.emit('chapter', { n: null });
    app.ui.only(null);
    setDock(app.ui.mode === 'tech');
    setSpeed(userSpeed);
  };

  // ── Bus and frames ─────────────────────────────────────────────────
  bus.on('camera-user', () => {
    if (active) pause(true);
  });
  bus.on('pause', ({ paused, engine } = {}) => {
    if (self || engine || !active) return;
    if (paused) pause(false);
    else resume();
  });
  bus.on('speed', ({ value, engine } = {}) => {
    if (self || engine || !(value > 0)) return;
    if (!active) userSpeed = value;
  });
  document.addEventListener('keydown', (e) => {
    if (active && e.key === 'Escape' && !e.defaultPrevented) close();
  });

  app.onFrame((dt) => {
    if (!active || !running) return;
    const ch = chapters[k];
    elapsed += Math.min(MAX_DT, Math.max(0, dt));
    const j = partAt(ch, elapsed);
    if (j !== part) applyPart(j);
    fillBar.style.transform = `scaleX(${Math.min(1, elapsed / ch.ms)})`;
    if (elapsed < ch.ms) return;
    if (k < chapters.length - 1) {
      enter(k + 1);
      return;
    }
    over = true;
    running = false;
    setPlaying(false);
    renderButtons();
  });

  return {
    /** The recording is in: compute the chapters and open if it should. */
    start() {
      const marks = marksOf(store.events, app.factId());
      chapters = chaptersOf({ header: app.header, events: store.events, marks });
      const phone = !!window.matchMedia?.('(max-width: 600px)').matches;
      if (!opensByItself(app.params, seen(), phone)) return;
      open(app.params.chapter, { still: !!app.params.paused });
    },
    open: (n) => open(n ?? null),
    close,
    active: () => active,
  };
}
