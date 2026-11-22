// Mouse and touch on the scene: wheel (and trackpad pinch) zooms towards the
// ground point under the pointer, dragging pans the ground with the pointer, a
// two-finger pinch zooms and pans, and a click without dragging selects the
// nearest neighbor (or nobody) through the bus. Works with the perspective
// camera through camera.toWorld, so the ground point under the pointer stays
// under it. Keys + and - zoom on the centre of the view.
//
// Inertia: letting go of a drag while moving keeps the village sliding at the
// release speed (the pointer moves of the last INERTIA.windowMs), slowing down
// with INERTIA.tauMs, on the frame clock. A new press, the wheel, the keys, a
// selection or any other 'camera-user' stops it; none with less movement.
//
// Hovering a neighbor with a mouse (never on touch screens) shows its card:
// name, trade, character and what it believes against the original
// (tags.js hoverCard, a function of the state). `hover=<id>` in the URL
// pins the card to that neighbor, as if the pointer were on it.
//
//        ☺ ┌──────────────────────┐
//          │ Ana        [✗ deformada] │
//          │ costurera · sociable │
//          │ cuándo 23:00? 22:00  │
//          └──────────────────────┘

import { focusTarget, nearestHit } from './layout.js';
import { hoverCard } from './tags.js';
import { clampCentre, ZOOM_MAX, ZOOM_MIN } from './zoom.js';
import { pick } from '../core/lang.js';
import { versionColor } from '../core/theme.js';
import { HEAD } from '../scene/world/plan.js';
import { STRINGS } from './strings.js';

/** Zoom factor of one press of + or -. */
const KEY_ZOOM = 1.25;

/** Movement (CSS px) after which a press is a drag and not a click. */
const CLICK_SLOP = 5;
/** Smallest hit radius (CSS px) around a neighbor. */
const MIN_HIT = 18;

/**
 * Inertia after a drag: pointer moves (ms) that count for the release speed,
 * a release later than `staleMs` after the last move gives none, decay time
 * constant (ms), and speeds (CSS px per ms) under which it stops and over
 * which it is capped.
 */
export const INERTIA = { windowMs: 100, staleMs: 60, tauMs: 260, minSpeed: 0.02, maxSpeed: 4 };

/**
 * Speed of the pointer when it is let go, from its last moves.
 * @param {{t: number, x: number, y: number}[]} samples moves in time order (t in ms)
 * @param {number} now ms of the release
 * @returns {{vx: number, vy: number}|null} CSS px per ms, or null if it was still
 */
export function releaseVelocity(samples, now) {
  if (samples.length < 2) return null;
  const last = samples[samples.length - 1];
  if (now - last.t > INERTIA.staleMs) return null;
  let first = last;
  for (let i = samples.length - 1; i >= 0 && last.t - samples[i].t <= INERTIA.windowMs; i--) first = samples[i];
  const dt = last.t - first.t;
  if (dt < 8) return null;
  let vx = (last.x - first.x) / dt;
  let vy = (last.y - first.y) / dt;
  const speed = Math.hypot(vx, vy);
  if (speed < INERTIA.minSpeed * 2) return null;
  if (speed > INERTIA.maxSpeed) {
    vx *= INERTIA.maxSpeed / speed;
    vy *= INERTIA.maxSpeed / speed;
  }
  return { vx, vy };
}

/**
 * One frame of inertia: how far the ground slides (CSS px) and the speed left.
 * @param {{vx: number, vy: number}} v
 * @param {number} dtMs
 * @returns {{dx: number, dy: number, v: {vx: number, vy: number}|null}} v null once it stops
 */
export function coastStep(v, dtMs) {
  const dt = Math.min(50, Math.max(0, dtMs));
  // Distance of the exponential decay over dt, exactly.
  const a = Math.exp(-dt / INERTIA.tauMs);
  const d = INERTIA.tauMs * (1 - a);
  const next = { vx: v.vx * a, vy: v.vy * a };
  return { dx: v.vx * d, dy: v.vy * d, v: Math.hypot(next.vx, next.vy) < INERTIA.minSpeed ? null : next };
}

/**
 * Hooks the input to the scene canvas.
 * @param {object} app
 * @param {ReturnType<import('./view.js').createView>} view
 */
export function attachInput(app, view) {
  const canvas = app.zones.map;
  const cam = app.camera;
  if (!canvas) return;
  canvas.classList.add('render-map');

  const local = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  // Every camera change from the input keeps the centre over the village.
  const setCam = (v) => {
    cam.set({ ...v, ...clampCentre({ x: v.x ?? cam.x, y: v.y ?? cam.y }, view.bounds) });
    app.bus.emit('camera-user');
  };

  // Moves the camera so that the ground point `w` is under the screen point `s`.
  const pinGround = (w, s, scale = cam.scale) => {
    let x = cam.x;
    let y = cam.y;
    cam.set({ x, y, scale });
    // The pitch depends on the scale only, so a pan is an exact translation;
    // two passes are enough after a zoom.
    for (let i = 0; i < 2; i++) {
      const now = cam.toWorld(s.x, s.y);
      x += w.x - now.x;
      y += w.y - now.y;
      cam.set({ x, y, scale });
    }
    setCam({ x, y, scale });
  };

  const zoomBy = (factor, sx, sy) => {
    const base = view.baseScale(cam);
    const scale = Math.min(base * ZOOM_MAX, Math.max(base * ZOOM_MIN, cam.scale * factor));
    pinGround(cam.toWorld(sx, sy), { x: sx, y: sy }, scale);
  };

  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      const speed = e.ctrlKey ? 0.01 : 0.0015; // ctrlKey: trackpad pinch
      const p = local(e);
      zoomBy(Math.exp(-e.deltaY * unit * speed), p.x, p.y);
    },
    { passive: false },
  );

  const pointers = new Map();
  let drag = null; // {x, y, ground, moved}
  let pinch = null; // {dist, mid}
  let samples = []; // last pointer moves of a one-finger drag, for the inertia
  let coast = null; // {vx, vy} CSS px per ms while sliding after a drag
  let coasting = false; // the inertia itself is moving the camera

  const stopCoast = () => {
    coast = null;
  };
  app.bus.on('camera-user', () => {
    if (!coasting) stopCoast();
  });
  app.bus.on('select', stopCoast);
  app.bus.on('group', stopCoast);
  app.onFrame((dt) => {
    if (!coast) return;
    if (app.reducedMotion()) return stopCoast();
    const step = coastStep(coast, dt);
    const c = { x: cam.w / 2, y: cam.h / 2 };
    const was = { x: cam.x, y: cam.y };
    coasting = true;
    try {
      pinGround(cam.toWorld(c.x, c.y), { x: c.x + step.dx, y: c.y + step.dy });
    } finally {
      coasting = false;
    }
    // Stopped by the edge of the village, or slow enough.
    const still = Math.abs(cam.x - was.x) * cam.scale < 0.01 && Math.abs(cam.y - was.y) * cam.scale < 0.01;
    coast = still && dt > 0 ? null : step.v;
  });

  const pinchState = () => {
    const [a, b] = [...pointers.values()];
    return { dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  };

  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    canvas.setPointerCapture?.(e.pointerId);
    stopCoast();
    samples = [];
    pointers.set(e.pointerId, local(e));
    if (pointers.size === 1) {
      const p = local(e);
      drag = { x: p.x, y: p.y, ground: cam.toWorld(p.x, p.y), moved: false };
    } else if (pointers.size === 2) {
      pinch = pinchState();
      if (drag) drag.moved = true;
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, local(e));
    if (pointers.size >= 2 && pinch) {
      const now = pinchState();
      const ground = cam.toWorld(pinch.mid.x, pinch.mid.y);
      const base = view.baseScale(cam);
      const scale = Math.min(base * ZOOM_MAX, Math.max(base * ZOOM_MIN, (cam.scale * now.dist) / pinch.dist));
      pinGround(ground, now.mid, scale);
      pinch = now;
      return;
    }
    if (!drag) return;
    const p = local(e);
    if (!drag.moved && Math.hypot(p.x - drag.x, p.y - drag.y) > CLICK_SLOP) {
      drag.moved = true;
      canvas.classList.add('dragging');
    }
    if (drag.moved) {
      pinGround(drag.ground, p);
      samples.push({ t: e.timeStamp, x: p.x, y: p.y });
      if (samples.length > 12) samples.shift();
    }
  });

  const end = (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size === 1) {
      // Pinch over: keep panning with the finger that is left.
      const p = [...pointers.values()][0];
      pinch = null;
      samples = [];
      drag = { x: p.x, y: p.y, ground: cam.toWorld(p.x, p.y), moved: true };
      return;
    }
    if (pointers.size === 0) {
      if (e.type === 'pointerup' && drag && !drag.moved) select(local(e));
      if (e.type === 'pointerup' && drag?.moved && !app.reducedMotion()) coast = releaseVelocity(samples, e.timeStamp);
      samples = [];
      drag = null;
      pinch = null;
      canvas.classList.remove('dragging');
    }
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  function select(p) {
    app.bus.emit('select', { neighbor: neighborAt(app, view, p) });
  }

  // Keys + and - zoom on the centre of the view; not while typing, not behind the start screen.
  if (app.params.bg) return;
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
    const dir = e.key === '+' || e.key === '=' ? 1 : e.key === '-' || e.key === '_' ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    zoomBy(dir > 0 ? KEY_ZOOM : 1 / KEY_ZOOM, cam.w / 2, cam.h / 2);
  });
}

/** Whether the keyboard is writing in a field (no shortcut then). */
function typing(t) {
  return t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
}

/**
 * The neighbor under a screen point of the scene (its chest), or null.
 * @param {object} app
 * @param {ReturnType<import('./view.js').createView>} view
 * @param {{x: number, y: number}} p CSS px over the scene canvas
 */
function neighborAt(app, view, p) {
  const { state, pos } = app.store;
  const cam = app.camera;
  const points = [];
  let size = 0;
  for (const [id, wp] of view.positionsAt(state, pos)) {
    const feet = cam.toScreen(wp.x, wp.y);
    const chest = cam.toScreen(wp.x, wp.y, HEAD * 0.55);
    size = Math.max(size, feet.y - chest.y);
    points.push({ id, x: chest.x, y: chest.y });
  }
  return nearestHit(points, p.x, p.y, Math.max(MIN_HIT, size * 1.2));
}

/**
 * The card of the hovered neighbor (or of `hover=<id>`), over the scene.
 * @param {object} app
 * @param {ReturnType<import('./view.js').createView>} view
 */
export function attachHover(app, view) {
  const canvas = app.zones.map;
  const stage = canvas?.parentElement;
  const fixed = focusTarget(app.header, app.params.hover);
  const pinned = fixed?.kind === 'neighbor' ? fixed.id : null;
  const mouse = !!window.matchMedia?.('(hover: hover)').matches;
  if (!stage || app.params.bg || (!mouse && !pinned)) return;
  const t = pick(STRINGS, app.lang).hover;

  const card = document.createElement('div');
  card.className = 'hover-card';
  card.hidden = true;
  card.setAttribute('role', 'tooltip');
  stage.append(card);

  let pointer = null; // CSS px over the canvas while a mouse is over the scene
  let shownKey = '';
  if (mouse && !pinned) {
    const over = (e) => e.target === canvas || app.zones.labels?.contains(e.target);
    stage.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      const r = canvas.getBoundingClientRect();
      // Not while dragging the camera, nor over the cards on top of the scene.
      pointer = e.buttons === 0 && over(e) ? { x: e.clientX - r.left, y: e.clientY - r.top } : null;
      app.requestDraw();
    });
    stage.addEventListener('pointerleave', () => {
      pointer = null;
      app.requestDraw();
    });
  }

  const fill = (c) => {
    const el = (tag, cls, text) => {
      const e = document.createElement(tag);
      e.className = cls;
      if (text !== undefined) e.textContent = text;
      return e;
    };
    const head = el('div', 'hc-head');
    head.append(el('b', 'hc-name', c.name));
    const pill = el('span', `hc-pill hc-${c.version ?? 'none'}`);
    if (c.glyph) pill.append(el('i', 'hc-glyph', c.glyph));
    pill.append(document.createTextNode(c.status));
    pill.style.setProperty('--v', versionColor(c.version));
    head.append(pill);
    const parts = [head, el('div', 'hc-role', c.role)];
    if (c.rows.length) {
      parts.push(el('div', 'hc-caption', `${t.believes} · ${c.what}`));
      const rows = el('div', 'hc-rows');
      for (const r of c.rows) {
        const row = el('div', `hc-row hc-${r.kind}`);
        row.append(el('span', 'hc-slot', r.label), el('span', 'hc-now', r.now));
        row.append(el('span', 'hc-orig', r.original === null ? '' : `${t.original} ${r.original}`));
        rows.append(row);
      }
      parts.push(rows);
    }
    card.replaceChildren(...parts);
  };

  app.onDraw(({ state, pos, camera: cam, w, h }) => {
    const id = pinned ?? (pointer ? neighborAt(app, view, pointer) : null);
    const wp = id ? view.positionsAt(state, pos).get(id) : null;
    if (!wp) {
      card.hidden = true;
      shownKey = '';
      return;
    }
    const fact = app.factId();
    const key = `${id}|${app.store.index}|${fact}`;
    if (key !== shownKey) {
      const c = hoverCard(app.header, state, fact, id, app.lang);
      if (!c) {
        card.hidden = true;
        return;
      }
      shownKey = key;
      fill(c);
    }
    card.hidden = false;
    // Beside the neighbor's chest (right, else left), kept in the room the
    // floating panels leave: under the banner and the «now» line, over the bar.
    const s = cam.toScreen(wp.x, wp.y, HEAD * 0.55);
    const cw = card.offsetWidth;
    const ch = card.offsetHeight;
    const room = view.insets();
    const nowEl = app.zones.now?.getBoundingClientRect();
    const top = Math.max(room.t, nowEl?.height ? nowEl.bottom - stage.getBoundingClientRect().top : 0) + 8;
    const left = room.l + 8;
    const right = w - room.r - 8;
    let x = s.x + 22;
    if (x + cw > right) x = s.x - 22 - cw;
    x = Math.max(left, Math.min(right - cw, x));
    const y = Math.max(top, Math.min(h - room.b - ch - 8, s.y - ch / 2));
    card.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  });
}
