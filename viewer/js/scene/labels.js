// HTML labels anchored to the scene, in #labels: every place (icon, name, how
// many people are there now and a thin bar with the versions of the rumor
// they hold) above its building, and the names of the neighbors from the mid
// zoom level on. HTML keeps the text sharp at any zoom; positions come from
// camera.toScreen every frame.
//
//      ┌───────────────────┐
//      │ (☕) bar      👤 12 │   place: above the highest point of the building
//      └▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀┘   versions of the people there
//         ┌─────┐
//         │ Ana │              name: above the head
//
// No two labels overlap: render/tags.js keeps the ones of higher priority
// (selected > in a hop of the rumor > place > talking > quarter > rest) and the boxes the rumor
// overlay reserved this frame (bubbles, chain labels), and hides the others.
// A name is clickable: it selects its neighbor.
//
// While preparing a game (bus 'game' in the phase 'prepare', phase 9-4) the
// map is a preview (render/preview.js): the neighbors who will know the rumor
// first show their name at any zoom, with the priority of the selected one
// and a small caption «Lo sabe primero»; the place of the fact says «Lugar de
// la fiesta» and the place where the rumor is dropped «Aquí empieza a
// contarse». Out of that phase (and in a recording) there are no captions.
//
// Phase 9-5: while preparing, the card under the pointer in the list of whom
// to tell (bus 'prepare-focus' {neighbor, home, usual}, package game) marks
// its quarter «Vive aquí» and its place of the day «Pasa el día aquí»; null
// takes them away. While preparing and during the game (?play=1 in the phases
// prepare, playing and ended, or a played game) the subject of the challenge
// (the priest, or the one the party is for) and, once it runs, whom the player
// told show their name at any zoom, with a caption (render/preview.js
// playNames). The bus 'game' gives the challenge as an id (or the draft
// does); the challenges themselves come from GET state, once.
//
// Labels fade in and out (css/render.css, phase 8-2), except in a capture,
// and dim when their point is behind a building: every few frames, the line
// from the eye to the point is tested against boxes of the buildings and
// houses of the plan (cheaper than a ray against the meshes, and the same
// answer for a label above a roof or in a street).

import { neighborOf } from '../core/names.js';
import { inGame, isCapture } from '../core/params.js';
import { createApi } from '../live/api.js';
import { RACE_TINT, raceTintAt, tintAt, tintBar } from '../render/heat.js';
import { raceSides } from '../rumor/race.js';
import { focusTags, panShift, playNames, previewTags } from '../render/preview.js';
import { recentTells } from '../render/wave.js';
import { boxAbove, declutter, placeLook, PRIORITY } from '../render/tags.js';
import { reservedBoxes } from './overlay/reserved.js';
import { CELL, HEAD } from './world/plan.js';

/** Small line icons (16×16, stroked with currentColor). */
const ICONS = {
  cup: '<path d="M3 5h8v5a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3z M11 6h1.5a1.5 1.5 0 0 1 0 3H11"/>',
  bell: '<path d="M8 2.5a4 4 0 0 1 4 4V10l1.2 1.8H2.8L4 10V6.5a4 4 0 0 1 4-4z M6.5 13.5a1.5 1.5 0 0 0 3 0"/>',
  stall: '<path d="M2 6l1.5-3h9L14 6z M3 6v7h10V6 M6 13v-4h4v4"/>',
  bread: '<path d="M3 7a5 3 0 0 1 10 0v5H3z M6 6v2 M8 5.5v2 M10 6v2"/>',
  book: '<path d="M2.5 3.5h4A1.5 1.5 0 0 1 8 5v8a1.5 1.5 0 0 0-1.5-1.5h-4z M13.5 3.5h-4A1.5 1.5 0 0 0 8 5v8a1.5 1.5 0 0 1 1.5-1.5h4z"/>',
  flag: '<path d="M4 14V2.5 M4 3h8l-1.8 3L12 9H4"/>',
  cross: '<path d="M6.3 2.5h3.4v3.8h3.8v3.4H9.7v3.8H6.3V9.7H2.5V6.3h3.8z"/>',
  drop: '<path d="M8 2.2C10 5 12.2 7.3 12.2 9.8a4.2 4.2 0 0 1-8.4 0C3.8 7.3 6 5 8 2.2z"/>',
  wave: '<path d="M1.5 6c1.6-1.4 3.2-1.4 4.4 0s2.8 1.4 4.2 0 3-1.4 4.4 0 M1.5 10.5c1.6-1.4 3.2-1.4 4.4 0s2.8 1.4 4.2 0 3-1.4 4.4 0"/>',
  mill: '<path d="M8 8L3.5 3.5 M8 8l4.5-4.5 M8 8l-4.5 4.5 M8 8l4.5 4.5"/><circle cx="8" cy="8" r="1.2"/>',
  square: '<circle cx="8" cy="8" r="5.5"/><circle cx="8" cy="8" r="1.6"/>',
  house: '<path d="M2.5 8L8 3l5.5 5 M4 7v6.5h8V7 M6.8 13.5V10h2.4v3.5"/>',
  pin: '<path d="M8 14s4.5-4.3 4.5-7.5a4.5 4.5 0 0 0-9 0C3.5 9.7 8 14 8 14z"/><circle cx="8" cy="6.5" r="1.5"/>',
};
const PERSON = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="5" r="2.6"/><path d="M3 14a5 5 0 0 1 10 0z"/></svg>';

/** Height (world units) of a place label when the plan gives no `top`. */
function labelHeight(plan, place) {
  const b = plan.buildings.find((x) => x.place === place.id);
  if (!b) return place.kind === 'home' ? CELL * 2.2 : 8;
  if (Number.isFinite(b.top)) return b.top + 2;
  const r = b.recipe;
  if (r.type === 'market') return CELL * 1.8;
  if (r.type === 'fountain') return CELL * 1.2;
  const floors = r.floors ?? 1;
  return (floors + (r.tower ? 2.6 : 1)) * CELL;
}

/** Frames between two occlusion tests of a label. */
const OCCLUDE_EVERY = 3;

/**
 * Boxes that hide what is behind them: the main body of the landmarks and
 * the houses, a little smaller than drawn so that a label at the edge of a
 * roof still shows. {x, y, c, s, hw, hd, top}: centre, cos and sin of the
 * rotation, half sizes on the ground and height (world units).
 * @param {import('./world/plan.js').TownPlan} plan
 */
function occluders(plan) {
  const out = [];
  const add = (x, y, rot, w, d, top, own = null) =>
    out.push({ x, y, c: Math.cos(rot), s: Math.sin(rot), hw: w * 0.42, hd: d * 0.42, top: top * 0.9, own });
  for (const b of plan.buildings ?? []) add(b.main?.x ?? b.x, b.y, 0, (b.main?.w ?? b.w / CELL) * CELL, b.d, b.top ?? CELL * 2, b.place);
  for (const h of plan.houses ?? []) add(h.x, h.y, h.rot ?? 0, h.w * CELL, h.d * CELL, (h.floors ?? 1) * CELL + CELL * 0.5);
  return out;
}

/**
 * Whether the segment from the eye to a point crosses a box (slab test in the
 * box's frame). Points in three.js style: x, height, world y.
 * @param {{x: number, y: number, z: number}} eye
 * @param {number} px
 * @param {number} py height
 * @param {number} pz
 * @param {ReturnType<typeof occluders>} boxes
 * @param {string|null} [own] the place of the label: its own building does not hide it
 */
function hidden(eye, px, py, pz, boxes, own = null) {
  for (const b of boxes) {
    if (own && b.own === own) continue;
    if (py > b.top && eye.y > b.top) continue;
    // Into the frame of the box: rotate by -rot around its centre.
    const ax = eye.x - b.x;
    const az = eye.z - b.y;
    const bx = px - b.x;
    const bz = pz - b.y;
    const o = [ax * b.c + az * b.s, eye.y, -ax * b.s + az * b.c];
    const e = [bx * b.c + bz * b.s, py, -bx * b.s + bz * b.c];
    const lo = [-b.hw, 0, -b.hd];
    const hi = [b.hw, b.top, b.hd];
    let t0 = 0;
    let t1 = 0.98;
    for (let k = 0; k < 3 && t0 <= t1; k++) {
      const d = e[k] - o[k];
      if (Math.abs(d) < 1e-9) {
        if (o[k] < lo[k] || o[k] > hi[k]) t0 = 2;
        continue;
      }
      let ta = (lo[k] - o[k]) / d;
      let tb = (hi[k] - o[k]) / d;
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta);
      t1 = Math.min(t1, tb);
    }
    if (t0 <= t1) return true;
  }
  return false;
}

/**
 * @param {object} app
 * @param {ReturnType<import('../render/view.js').createView>} view
 */
export function createLabels(app, view) {
  const root = app.zones.labels;
  const { header } = app;
  if (!root) return { update() {} };
  root.replaceChildren();
  // A capture shows every label at once: no fade.
  const still = isCapture(app.params);
  root.classList.toggle('still', still);
  const map = app.zones.map;
  const boxes = view.row ? [] : occluders(view.plan);
  let frames = 0;

  const show = (l, on) => {
    if (on !== l.on) {
      l.el.classList.toggle('off', !on);
      l.on = on;
    }
  };
  // Dimmed behind a building; tested every OCCLUDE_EVERY frames (and the
  // first time a label shows).
  const dim = (l, behind) => {
    if (behind !== l.behind) {
      l.el.classList.toggle('behind', behind);
      l.behind = behind;
    }
  };
  const occlude = (l, eye, px, py, pz, own) => {
    // In a capture every frame, so the picture does not depend on frame timing.
    if (l.behind !== undefined && !still && frames % OCCLUDE_EVERY !== 0) return;
    dim(l, hidden(eye, px, py, pz, boxes, own));
  };
  const size = (l) => {
    if (!l.size) l.size = { w: l.el.offsetWidth, h: l.el.offsetHeight };
    return l.size;
  };
  // Sizes depend on the font: measure again once it is in.
  document.fonts?.ready.then(() => {
    for (const l of [...places, ...people]) l.size = null;
    app.requestDraw();
  });

  const places = view.row
    ? []
    : (header.places ?? []).map((p) => {
        const look = placeLook(p);
        const el = document.createElement('div');
        el.className = `lbl-place lbl-${p.kind} off`;
        el.style.setProperty('--tint', look.tint);
        el.innerHTML = `<span class="lbl-icon"><svg viewBox="0 0 16 16" aria-hidden="true">${ICONS[look.icon] ?? ICONS.pin}</svg></span><span class="lbl-text"></span><span class="lbl-count">${PERSON}<b></b></span><i class="lbl-bar"></i>`;
        el.querySelector('.lbl-text').textContent = p.name;
        root.append(el);
        const b = view.plan.buildings.find((x) => x.place === p.id);
        return {
          id: p.id,
          place: true,
          hint: null,
          hintEl: null,
          el,
          count: el.querySelector('.lbl-count'),
          countN: el.querySelector('.lbl-count b'),
          bar: el.querySelector('.lbl-bar'),
          home: p.kind === 'home',
          x: p.x,
          y: b ? b.y : p.y,
          h: labelHeight(view.plan, p),
          on: false,
          size: null,
          key: '',
        };
      });

  const people = (header.neighbors ?? []).map((n) => {
    const el = document.createElement('div');
    el.className = 'lbl-name off';
    el.textContent = neighborOf(header, n.id)?.name ?? n.id;
    el.addEventListener('click', () => app.bus.emit('select', { neighbor: n.id }));
    // The name sits over the scene: the wheel still zooms it.
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      map?.dispatchEvent(new WheelEvent('wheel', e));
    }, { passive: false });
    root.append(el);
    return { id: n.id, el, on: false, size: null, cls: '', hint: null, hintEl: null };
  });

  // Captions of the preview while preparing (null otherwise). The caption goes
  // before the content of a place label (a first line) and under a name.
  const caption = (l, text = null) => {
    if (text === l.hint) return;
    l.hint = text;
    if (text && !l.hintEl) {
      l.hintEl = document.createElement('small');
      l.hintEl.className = 'lbl-hint';
      if (l.place) l.el.prepend(l.hintEl);
      else l.el.append(l.hintEl);
    }
    if (l.hintEl) {
      l.hintEl.textContent = text ?? '';
      l.hintEl.hidden = !text;
    }
    l.el.classList.toggle('preview', !!text);
    l.size = null;
  };
  const inside = inGame(app.params);
  let preview = null; // previewTags of the last 'game'
  let focus = null; // focusTags of the last 'prepare-focus'
  // The phase may have been told before the scene was up (models load later).
  let phase = document.documentElement.dataset.gamePhase ?? null;
  let names = null; // playNames while preparing and during the game
  // ref: the challenge as the bus 'game' gives it (its id, or the object);
  // list: the challenges of GET state, to find it by id.
  const play = { ref: undefined, list: [], draft: null, asked: false, injects: [], seen: 0, key: '' };
  const challengeNow = () => {
    const ref = play.ref !== undefined ? play.ref : (play.draft?.challenge ?? null);
    if (ref && typeof ref === 'object') return ref;
    return ref ? (play.list.find((c) => c?.id === ref) ?? null) : null;
  };
  // While preparing, a new caption may sit under the panel of the game: the
  // next frame moves the map just enough (panShift).
  let reframe = false;
  const applyCaptions = () => {
    reframe = phase === 'prepare' && !!(focus?.size || preview);
    for (const p of places) caption(p, focus?.get(p.id) ?? preview?.places.get(p.id) ?? null);
    for (const p of people) caption(p, preview?.names.get(p.id) ?? names?.get(p.id) ?? null);
    app.requestDraw();
  };
  /** The challenges (and the draft, if none came yet) from GET state, once. */
  const askState = () => {
    if (play.asked || !app.params.play) return;
    play.asked = true;
    createApi()
      .state()
      .then((reply) => {
        if (!reply.ok || !reply.body) return;
        play.list = Array.isArray(reply.body.challenges) ? reply.body.challenges : [];
        play.draft ??= reply.body.draft ?? null;
        play.key = '';
        app.requestDraw();
      })
      .catch(() => {});
  };
  /** Names of the game: refreshed when a rumor starts or the challenge changes. */
  const playFrame = () => {
    const on = app.params.play ? ['prepare', 'playing', 'ended'].includes(phase) : inside;
    if (!on) {
      if (names) {
        names = null;
        applyCaptions();
      }
      return;
    }
    const events = app.store.events;
    for (; play.seen < events.length; play.seen++) if (events[play.seen].type === 'inject') play.injects.push(events[play.seen]);
    const challenge = challengeNow();
    // While preparing, «Lo sabe primero» (previewTags) tells the recipients: only the subject here.
    const injects = phase === 'prepare' ? [] : play.injects;
    const draft = play.draft;
    const who = draft?.rumors?.[0]?.fact?.who ?? '';
    const key = `${phase}|${injects.length}|${challenge?.id ?? ''}|${challenge?.subject ?? ''}|${who}`;
    if (key === play.key) return;
    play.key = key;
    names = playNames({ header, events: injects, challenge, draft }, app.lang);
    applyCaptions();
  };
  app.bus.on('game', (game) => {
    phase = game?.phase ?? null;
    preview = previewTags(game, header, app.lang);
    if (phase !== 'prepare') focus = null;
    if (game?.draft) play.draft = game.draft;
    if (game?.challenge !== undefined) play.ref = game.challenge;
    else if (game?.draft) play.ref = undefined; // the draft says which challenge
    if (['prepare', 'playing', 'ended'].includes(phase)) askState();
    play.key = '';
    applyCaptions();
  });
  if (inside) askState();
  app.bus.on('prepare-focus', (f) => {
    focus = phase === 'prepare' ? focusTags(f, header, app.lang) : null;
    applyCaptions();
  });

  let selected = null;
  app.bus.on('select', ({ neighbor } = {}) => {
    selected = people.some((p) => p.id === neighbor) ? neighbor : null;
  });

  // People and versions at each place, per state (render/heat.js, the same
  // tint the scene draws on the ground).
  let crowdKey = '';
  let crowds = new Map();
  // In a race (app.race, phase 9) the bar goes by rumor instead of by version.
  const crowdsOf = (state) => {
    const race = app.race ?? null;
    const key = `${state.tick}|${app.store.index}|${app.factId?.() ?? ''}|${state === app.store.state}|${race ?? ''}`;
    if (key !== crowdKey) {
      crowdKey = key;
      const placeOf = view.layoutOf(state).placeOf;
      const ids = (app.header.neighbors ?? []).map((n) => n.id);
      crowds = race ? raceTintAt(raceSides(app.store.events, app.store.index, race, ids), placeOf) : tintAt(state, app.factId?.() ?? null, placeOf);
    }
    return crowds;
  };

  function update(frame) {
    if (inside) playFrame();
    const { camera: cam, state, pos } = frame;
    const w = view.weights(cam);
    const eye = cam.view().eye;
    frames++;
    const items = [];
    const owners = [];

    // Places.
    const counts = view.row ? null : crowdsOf(state);
    for (const p of places) {
      const s = cam.toScreen(p.x, p.y, p.h);
      if (!view.onScreen(cam, s, 60)) {
        show(p, false);
        continue;
      }
      const c = counts.get(p.id);
      const n = c?.n ?? 0;
      const bar = app.race ? tintBar(c, RACE_TINT) : tintBar(c);
      const key = `${n}|${bar}`;
      if (key !== p.key) {
        p.key = key;
        p.countN.textContent = String(n);
        p.count.hidden = n === 0;
        p.bar.style.background = bar;
        p.bar.hidden = !bar;
        p.size = null;
      }
      const sz = size(p);
      items.push({ ...boxAbove(s, sz.w, sz.h), prio: p.hint ? PRIORITY.selected : p.home ? PRIORITY.quarter : PRIORITY.place, s });
      owners.push(p);
      // A place of the preview never dims.
      if (p.hint) dim(p, false);
      else occlude(p, eye, p.x, p.h, p.y, p.id);
    }

    // Names: everyone from the mid level on (if not too crowded), people
    // talking from the mid level, the selected one and those of the preview
    // always.
    const all = view.positionsAt(state, pos);
    const hop = new Set();
    for (const t of recentTells(app.store.events, app.store.index, pos)) hop.add(t.speaker).add(t.listener);
    const roomy = cam.scale * 9 > 40;
    for (const p of people) {
      const wp = all.get(p.id);
      const inHop = hop.has(p.id);
      const talking = inHop || !!state.neighbors.get(p.id)?.conv;
      const sel = p.id === selected;
      const first = !!p.hint;
      const want = !!wp && (sel || first || view.row || (w.mid > 0.4 && (talking || roomy)));
      const s = want ? cam.toScreen(wp.x, wp.y, HEAD + 2) : null;
      if (!s || !view.onScreen(cam, s, 20)) {
        show(p, false);
        continue;
      }
      const cls = sel ? 'selected' : talking ? 'talking' : '';
      if (cls !== p.cls) {
        if (p.cls) p.el.classList.remove(p.cls);
        if (cls) p.el.classList.add(cls);
        p.cls = cls;
        p.size = null;
      }
      const sz = size(p);
      items.push({ ...boxAbove(s, sz.w, sz.h), prio: sel || first ? PRIORITY.selected : inHop ? PRIORITY.hop : talking ? PRIORITY.talking : PRIORITY.name, s });
      owners.push(p);
      // The selected one (and the preview) never dims.
      if (sel || first || view.row) dim(p, false);
      else occlude(p, eye, wp.x, HEAD + 2, wp.y, null);
    }

    if (reframe) {
      reframe = false;
      const panel = document.querySelector('#game .gm-prepare')?.getBoundingClientRect();
      const stageLeft = map?.getBoundingClientRect().left ?? 0;
      const boxes = items.filter((_, i) => owners[i].hint);
      const dx = panel?.width ? panShift(boxes, panel.right - stageLeft, cam.w) : 0;
      if (dx > 0 && cam.scale > 0) cam.set({ x: cam.x - dx / cam.scale });
    }
    const shown = declutter(items, reservedBoxes(app));
    owners.forEach((l, i) => {
      show(l, shown[i]);
      if (shown[i]) {
        const b = items[i];
        l.el.style.transform = `translate(${Math.round(b.x)}px, ${Math.round(b.y)}px)`;
      }
    });
    root.classList.toggle('far', w.mid < 0.5);
  }

  return { update };
}
