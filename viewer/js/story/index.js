// Package story: chronicle, "Now" headline, director mode, help, views
// (phase 7, package F) and the story mode (phase 8-1, package B). See
// docs/fases/fase-7.md and docs/fases/fase-8.md (section 8-1). Started by core/app.js
// after the other packages.
//
// Only wiring and DOM: the logic is pure and tested.
//
//   narrate.js   events → items (structured events only, never bubble text)
//   lines.js     items at a position → chronicle lines and the headline
//   phrase.js    lines → sentences (es/en)
//   director.js  items at a position → the shot the camera wants
//   fly.js       smooth flights (the only thing on the wall clock)
//   help.js      floating buttons (views, director, ?) and the help card
//   tour.js      the chapters of the story mode (pure)
//   tourview.js  the story mode on screen (#tour)
//
//   zones:   #story (chronicle) · #now (headline) · #help (buttons, card) · #tour
//   bus in:  'camera-user' (the director and the tour step aside) · 'loaded'
//            · 'pause' · 'help' (open/close the card) · 'ui'
//   bus out: 'select' {neighbor} · 'group' {key} (a line is clicked; the tour)
//            · 'seek' · 'speed' · 'pause' (the tour)
//   params:  director=1 · tour · chapter
//   app.story: the camera for other packages (fly, viewOf, goTo, setDirector,
//            director, opening)
//
// Opening shot (phase 8-2, 2.7): once loaded, a flight from high above down
// to the home view, unless the URL is a capture or names a view (cam, zoom,
// focus, select, group, director), the story mode took the camera, or the
// reader asked for less movement. opening=<k> forces it, frozen at fraction k
// (captures). app.story.opening() plays it on demand (the story mode's first
// chapter); at its end the camera counts as not moved, so the home view keeps
// following the panels and the window.
//
// Lines, headline and shot are functions of (store.events[0..store.index),
// floor(store.pos)); with embed=1 nothing of this is shown.

import { pitchAt } from '../core/camera.js';
import { iconSvg } from '../core/icons.js';
import { inGame, isCapture } from '../core/params.js';
import { pick } from '../core/lang.js';
import { autoCamera, shotAt } from './director.js';
import { flightAt, flightMs, follow, OPENING, openingAt, openingStart } from './fly.js';
import { createHelp } from './help.js';
import { createTour } from './tourview.js';
import { headlineAt, linesAt } from './lines.js';
import { createNarrator } from './narrate.js';
import { createPhraser, fill } from './phrase.js';
import { STRINGS } from './strings.js';
import { HEAD } from '../scene/world/plan.js';

/** Ticks during which a line counts as just happened. */
const FRESH_TICKS = 3;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Appends segments to an element, strong ones in <b>. */
function segs(parent, list) {
  for (const s of list) parent.append(s.strong ? el('b', '', s.text) : document.createTextNode(s.text));
  return parent;
}

/**
 * Whether the opening shot plays by itself when a recording loads: not in a
 * capture, nor when the URL asks for a view of its own.
 * @param {import('../core/params.js').Params} p
 * @returns {boolean}
 */
export function opensWithShot(p) {
  if (isCapture(p) || p.embed || p.live) return false;
  return !(p.cam || p.zoom !== null || p.focus || p.select || p.group || p.director);
}

/**
 * @param {object} app see viewer/js/core/app.js
 */
export function init(app) {
  if (app.params.embed) return;
  const { store, header, bus, camera: cam } = app;
  // Inside the game the end is the end of the game, not of the day (it may stop at 11:25).
  const base = pick(STRINGS, app.lang);
  const t = inGame(app.params) ? { ...base, end: base.endGame } : base;
  const narrator = createNarrator(header);
  const phraser = createPhraser(header, app.lang, t);
  const total = header.neighbors?.length ?? 0;

  // ── Chronicle (#story) ─────────────────────────────────────────────
  const story = app.zones.story;
  const head = el('div', 'st-head');
  head.append(el('span', 'st-title', t.title));
  const list = el('ol', 'st-list');
  story.replaceChildren(head, list);

  // «Press ▶ to start» only while paused.
  let paused = !store.live && !!app.params.paused;
  bus.on('pause', ({ paused: p, engine } = {}) => {
    if (!engine) paused = !!p;
  });

  let linesKey = '';
  let linesOf = { key: '', value: [] };
  const renderLines = (idx, tick) => {
    const at = `${idx}|${narrator.items.length}`;
    if (linesOf.key !== at) linesOf = { key: at, value: linesAt(narrator.items, idx) };
    const lines = linesOf.value;
    // Rebuilt only when the lines or the "just happened" ones change.
    const fresh = lines.filter((l) => tick - l.tick < FRESH_TICKS).length;
    const key = `${at}|${fresh}|${!lines.length && paused}`;
    if (key === linesKey) return;
    linesKey = key;
    list.replaceChildren();
    if (!lines.length) {
      list.append(el('li', 'st-empty', paused ? t.emptyPaused : t.empty));
      return;
    }
    for (const line of lines) {
      const p = phraser.phrase(line);
      const li = el('li', `st-line tone-${p.tone}`);
      if (line.importance >= 3.5) li.classList.add('hi');
      else if (line.importance < 2) li.classList.add('lo');
      if (tick - line.tick < FRESH_TICKS) li.classList.add('fresh');
      const btn = el('button', 'st-btn');
      btn.type = 'button';
      const icon = el('span', 'st-icon');
      if (p.iconName) icon.append(iconSvg(p.iconName));
      else icon.textContent = p.icon;
      const body = el('span', 'st-body');
      const main = segs(el('span', 'st-main'), p.main);
      if (p.tag) main.append(el('span', 'st-tag', p.tag));
      body.append(main);
      for (const d of p.details) body.append(segs(el('span', `st-detail tone-${d.tone}`), d.segs));
      btn.append(icon, body, el('span', 'st-time', p.time));
      btn.addEventListener('click', () => goTo(line));
      li.append(btn);
      list.append(li);
    }
  };

  // ── Headline (#now) ────────────────────────────────────────────────
  const now = app.zones.now;
  const nowBox = el('div', 'st-now');
  const nowLabel = el('span', 'st-now-label', t.now);
  const nowIcon = el('span', 'st-now-icon');
  const nowText = el('span', 'st-now-text');
  nowBox.append(nowLabel, nowIcon, nowText);
  now.replaceChildren(nowBox);
  let nowKey = null;
  let nowAt = '';
  const renderNow = (idx, tick) => {
    const at = `${idx}|${tick}|${narrator.items.length}|${app.factId()}`;
    if (at === nowAt) return;
    nowAt = at;
    const line = headlineAt(narrator.items, idx, tick);
    let segments;
    let icon = '';
    let iconName = '';
    let tone = 'unknown';
    if (line) {
      const p = phraser.phrase(line);
      segments = p.head;
      icon = p.icon;
      iconName = p.iconName ?? '';
      tone = p.tone;
    } else {
      const fact = app.factId();
      const f = fact ? store.state.facts.get(fact) : null;
      let knowers = 0;
      if (f) for (const n of store.state.neighbors.values()) if (n.memory[fact]) knowers++;
      segments = phraser.calm(f, knowers, total);
    }
    const key = `${tone}|${icon}|${segments.map((s) => s.text).join('')}`;
    if (key === nowKey) return;
    const first = nowKey === null;
    nowKey = key;
    nowBox.className = `st-now tone-${tone}`;
    if (iconName) nowIcon.replaceChildren(iconSvg(iconName));
    else nowIcon.textContent = icon;
    nowIcon.hidden = !icon && !iconName;
    nowText.replaceChildren();
    segs(nowText, segments);
    // A soft fade when it changes (never on the first draw: captures stay still).
    if (!first) {
      nowBox.classList.remove('swap');
      void nowBox.offsetWidth;
      nowBox.classList.add('swap');
    }
  };

  // ── Camera: flights for clicks and the director ────────────────────
  let insets = { l: 0, r: 0, t: 0, b: 0 };
  let insetsAt = -Infinity;
  const measureInsets = (nowMs) => {
    if (nowMs - insetsAt < 500) return;
    insetsAt = nowMs;
    const r = (sel) => {
      const e = typeof sel === 'string' ? document.querySelector(sel) : sel;
      const b = e?.getBoundingClientRect();
      return b && b.width > 0 && b.height > 0 ? b : null;
    };
    const left = r('#rumor');
    const right = r('.column-right');
    const top = r(app.zones.banner);
    const bar = r('.bar');
    const card = r('#tour:not([hidden]) .tr-card');
    const bottom = card && (!bar || card.top < bar.top) ? card : bar;
    insets = {
      l: left ? Math.max(0, left.right) : 0, // a folded drawer is off screen
      r: right ? Math.max(0, cam.w - right.left) : 0,
      t: top ? top.bottom : 0,
      b: bottom ? cam.h - bottom.top : 0,
    };
  };

  /** Camera view that frames world points at a zoom factor, in the free area. */
  const frame = (pts, zoom) => {
    const view = app.view;
    if (!view || !pts.length) return null;
    const c = pts.reduce((a, p) => ({ x: a.x + p.x / pts.length, y: a.y + p.y / pts.length }), { x: 0, y: 0 });
    const scale = view.baseScale(cam) * zoom;
    const pitch = pitchAt(zoom);
    const lift = (HEAD / 2) * Math.cos(pitch) * scale; // people stand up from the ground point
    return {
      x: c.x + (insets.r - insets.l) / (2 * scale),
      y: c.y - ((insets.t - insets.b) / 2 + lift) / (scale * Math.sin(pitch)),
      scale,
    };
  };

  const placeCrowd = (placeId) => {
    const pts = [];
    for (const [id, n] of store.state.neighbors) if (n.place === placeId && !n.trip) pts.push(app.positionOf(id));
    if (pts.length) return pts;
    const p = header.places?.find((q) => q.id === placeId);
    return p ? [{ x: p.x, y: p.y }] : [];
  };

  /** The camera view of a shot (director.js) right now. */
  const viewOf = (shot) => {
    const view = app.view;
    if (!view) return null;
    if (shot.kind === 'home' || (shot.kind === 'place' && view.row)) return view.homeView(cam);
    if (shot.kind === 'place') return frame(placeCrowd(shot.place), shot.zoom);
    return frame(shot.ids.map((id) => app.positionOf(id)), shot.zoom);
  };

  const camView = () => ({ x: cam.x, y: cam.y, scale: cam.scale });
  const apply = (v) => {
    if (!v || !(v.scale > 0)) return;
    const moved = Math.abs(v.x - cam.x) * cam.scale > 0.05 || Math.abs(v.y - cam.y) * cam.scale > 0.05 || Math.abs(v.scale / cam.scale - 1) > 1e-4;
    if (moved) cam.set(v);
  };

  /** Current flight: {target() → view, follow, from, start, dur}. */
  let flight = null;
  const fly = (target, followAfter, instant = false) => {
    const to = target();
    if (!to) return;
    // A cut instead of a flight when the reader asked for less movement.
    if (instant || app.reducedMotion()) {
      apply(to);
      flight = followAfter ? { target, follow: true, from: to, start: -Infinity, dur: 1 } : null;
      return;
    }
    const from = camView();
    flight = { target, follow: followAfter, from, start: app.now(), dur: flightMs(from, to, cam.w) };
  };

  /**
   * The opening shot: from high above down to the home view (fly.js
   * OPENING). With k (0..1) the camera is placed at that fraction and stays
   * there; with less movement it is a cut to the home view.
   */
  const opening = (k = null) => {
    if (director) setDirector(false);
    const home = viewOf({ kind: 'home' });
    if (!home) return;
    const from = openingStart(home, cam.w);
    if (k !== null) {
      flight = null;
      apply(openingAt(from, home, k));
      return;
    }
    if (app.reducedMotion()) {
      flight = null;
      apply(home);
      cam.moved = false;
      return;
    }
    apply(from);
    flight = { target: () => viewOf({ kind: 'home' }), follow: false, from, start: app.now(), dur: OPENING.ms, path: openingAt, home: true };
  };

  // ── Director ───────────────────────────────────────────────────────
  let director = false;
  let ready = false;
  let shotKey = null;
  let shotCache = { key: '', value: null };
  const shotNow = () => {
    const tick = Math.floor(store.pos);
    const key = `${store.index}|${tick}|${narrator.items.length}`;
    if (shotCache.key !== key) shotCache = { key, value: shotAt(narrator.items, store.index, tick) };
    return shotCache.value;
  };
  const directorStep = (instant) => {
    const shot = shotNow();
    if (shot.key === shotKey && flight) return;
    shotKey = shot.key;
    fly(() => viewOf(shotNow()), true, instant);
  };
  const setDirector = (on, instant = false) => {
    director = on;
    help.setDirector(on);
    document.documentElement.toggleAttribute('data-director', on);
    if (on) {
      shotKey = null;
      measureInsets(app.now());
      if (ready) directorStep(instant);
    } else if (flight?.follow) flight = null;
  };

  // The story mode: recordings only.
  const tour = store.live ? null : createTour(app, t, phraser);
  // The automatic camera inside the game (director.js autoCamera): on when a
  // game starts, since the engine writes text only for what the camera sees up
  // close; the player's «off» lasts the game (sessionStorage: across the
  // reloads of that game), and is forgotten when the next one is prepared.
  const playing = () => document.documentElement.dataset.game === 'play';
  const OFF_KEY = 'rumor-village.camera.off';
  const offStored = () => {
    try {
      return sessionStorage.getItem(OFF_KEY) === '1';
    } catch {
      return false;
    }
  };
  const storeOff = (off) => {
    try {
      if (off) sessionStorage.setItem(OFF_KEY, '1');
      else sessionStorage.removeItem(OFF_KEY);
    } catch {
      // No storage: the choice lasts until the next reload.
    }
  };
  let gamePhase = null;
  const onGamePhase = (phase) => {
    if (!playing() || !phase || phase === gamePhase) return;
    gamePhase = phase;
    const a = autoCamera(phase, offStored());
    if (a.forget) storeOff(false);
    if (a.on && !director) setDirector(true);
  };
  bus.on('game', ({ phase } = {}) => onGamePhase(phase));

  // The help follows the map in use: live or recorded, a race, a touch screen.
  const help = createHelp(app, t, {
    toggleDirector: () => {
      setDirector(!director);
      // Switched off by the player during a game: it stays off for that game.
      if (playing() && gamePhase === 'playing') storeOff(!director);
    },
    who: () => (phraser.model ? fill(t.helpWho.model, { model: phraser.model }) : fill(store.live ? t.helpWho.rulesLive : t.helpWho.rules, {})),
    tour: tour ? () => tour.open() : null,
    race: () => app.race?.map((fact) => store.events.find((e) => e.type === 'inject' && e.fact === fact)?.what ?? null) ?? null,
    touch: () => !!window.matchMedia?.('(pointer: coarse)').matches,
  });

  bus.on('camera-user', () => {
    flight = null;
    if (director) setDirector(false);
  });

  /** A chronicle line was clicked: select and fly there. */
  const goTo = (line) => {
    if (director) setDirector(false);
    const it = line.item;
    measureInsets(app.now());
    if (it.kind === 'arrive') {
      bus.emit('select', { neighbor: null });
      bus.emit('group', { key: it.d.group });
      fly(() => viewOf({ kind: 'place', place: it.d.place, zoom: 2.6 }), false);
      return;
    }
    if (it.kind === 'move') {
      bus.emit('select', { neighbor: line.members.length === 1 ? it.who : null });
      fly(() => viewOf({ kind: 'place', place: it.d.to, zoom: 1.7 }), false);
      return;
    }
    if (it.kind === 'end') {
      bus.emit('select', { neighbor: null });
      fly(() => viewOf({ kind: 'home' }), false);
      return;
    }
    bus.emit('select', { neighbor: it.who });
    const ids = it.kind === 'tell' ? [it.d.a, it.d.b] : [it.who];
    fly(() => viewOf({ kind: 'pair', ids, zoom: 4.6 }), false);
  };

  // The camera for other packages (the story mode, keys): see core/app.js.
  //   fly(target() → view, follow?, instant?)   flight to a view, recomputed every frame
  //   viewOf(shot)   camera view of a director shot (director.js Shot)
  //   goTo(line)     what a click on a chronicle line does
  //   setDirector(on, instant?) · director (getter)
  //   opening(k?)    the opening shot down to the home view; k (0..1) freezes it
  app.story = {
    fly(target, followAfter = false, instant = false) {
      measureInsets(app.now());
      fly(target, followAfter, instant);
    },
    viewOf,
    goTo,
    setDirector,
    get director() {
      return director;
    },
    opening(k = null) {
      measureInsets(app.now());
      opening(Number.isFinite(k) ? Math.min(1, Math.max(0, k)) : null);
    },
  };

  // ── Every frame ────────────────────────────────────────────────────
  app.onFrame((dt) => {
    narrator.ingest(store.events);
    const idx = store.index;
    const tick = Math.floor(store.pos);
    renderLines(idx, tick);
    renderNow(idx, tick);

    const nowMs = app.now();
    if (director && ready) {
      measureInsets(nowMs);
      directorStep(false);
    }
    if (!flight) return;
    const to = flight.target();
    if (!to) return;
    const k = (nowMs - flight.start) / flight.dur;
    if (k < 1) apply(flight.path ? flight.path(flight.from, to, k) : flightAt(flight.from, to, k, cam.w));
    else if (flight.follow) apply(follow(camView(), to, dt));
    else {
      apply(to);
      // Back home by itself: the home view follows the panels and the window again.
      if (flight.home) cam.moved = false;
      flight = null;
    }
  });

  // The director from the URL: placed at once, like any camera of the URL.
  // Then the story mode, which takes the camera if it opens.
  const start = () => {
    ready = true;
    if (app.params.director) setDirector(true, true);
    tour?.start();
    if (app.params.opening !== null && app.params.opening !== undefined) opening(app.params.opening);
    else if (!store.live && !tour?.active() && !app.reducedMotion() && opensWithShot(app.params)) opening();
  };
  if (store.live) {
    const off = store.subscribe((change) => {
      if (change.type !== 'append') return;
      off();
      narrator.ingest(store.events);
      start();
    });
  } else {
    bus.on('loaded', () => {
      narrator.ingest(store.events);
      start();
    });
  }
  help.setDirector(false);
  // The game may have said its phase before this package started.
  onGamePhase(document.documentElement.dataset.gamePhase ?? null);
}
