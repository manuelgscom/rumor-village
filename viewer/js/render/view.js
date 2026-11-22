// Shared state of package A for the drawing layers and the input: positions
// (with a cache per state), zoom weights, dot size and what the bubbles show.
// No DOM here, only `app`.
//
// Positions glide when a place's grid changes (layout.js glide): the layout
// of the tick before comes from a private copy of the state one tick back
// (replay/snapshots.js), so it is the same whether the position was reached
// playing or jumping.

import { pick } from '../core/lang.js';
import { defaultPosition, placePoint } from '../core/position.js';
import { bubbleContent, endedTurns, lastTurns } from './bubbles.js';
import { glide, homeBounds, isRow, placeLayout, routeIndex, rowLayout, SETTLE_TICKS, spotOf } from './layout.js';
import { createStateAt } from '../replay/snapshots.js';
import { STRINGS } from './strings.js';
import { levelWeights } from './zoom.js';
import { createCamera, fitScale, PITCH } from '../core/camera.js';
import { CROWD_GAP, HEAD, townPlan } from '../scene/world/plan.js';

/** Dot radius in world units (village, row) and its limits in CSS px. */
const DOT_WORLD = { village: 4, row: 16 };
const DOT_PX = [3.5, 14];

/** Margin (CSS px) outside the canvas inside which a point counts as on screen. */
export const ON_SCREEN_MARGIN = 12;

/**
 * Room (CSS px) the home view of the telephone row leaves under the row, over
 * the bar, for the strip «in → out» of the rumor panel (phase 8-2, 2.12).
 */
export const ROW_STRIP_PX = 230; // the strip (~120 px) and the floating buttons over it (~110 px)

/**
 * Creates the view of package A.
 * @param {object} app
 */
export function createView(app) {
  const { header, store } = app;
  const row = isRow(header);
  const routes = routeIndex(header);
  const rowPos = row ? rowLayout(header) : null;
  const bounds = homeBounds(header);
  const strings = pick(STRINGS, app.lang);
  const plan = townPlan(header);
  const segments = plan.roads;
  // People of a place with a building stand in front of it (plan.js).
  const crowdShift = (lay, placeId) => {
    if (plan.crowd.get(placeId) !== 'front') return 0;
    const block = lay.blocks.get(placeId);
    return block ? block.halfH + CROWD_GAP : 0;
  };

  let layoutCache = { state: null, key: '', value: null };
  const layoutOf = (state) => {
    const key = state === store.state ? `${store.index}|${state.tick}` : `x|${state.tick}`;
    if (layoutCache.state !== state || layoutCache.key !== key) {
      layoutCache = { state, key, value: placeLayout(header, state, store.firstPlace) };
    }
    return layoutCache.value;
  };

  // The state and layout one tick before the store's, for the glides: a
  // private copy (its own snapshots), cached per tick and events known.
  const stateBefore = row ? null : createStateAt(store);
  let beforeCache = { key: '', state: null, lay: null };
  const before = (tick) => {
    const key = `${tick}|${store.countUntil(tick - 1)}`;
    if (beforeCache.key !== key) {
      const s = stateBefore(tick - 1);
      beforeCache = { key, state: s, lay: placeLayout(header, s, store.firstPlace) };
    }
    return beforeCache;
  };

  const position = (id, state, pos) => {
    if (row) {
      const p = rowPos.get(id);
      return p ? { x: p.x, y: p.y } : { x: 0, y: 0 };
    }
    const now = spotOf(header, routes, state, layoutOf(state), id, pos, crowdShift);
    if (!now) return defaultPosition(header, store.firstPlace, id, state, pos);
    // Only the store's own state has a tick before to glide from.
    const tick = Math.floor(pos);
    if (state !== store.state || state.tick !== tick || pos - tick >= SETTLE_TICKS) return { x: now.x, y: now.y };
    const b = before(tick);
    return glide(spotOf(header, routes, b.state, b.lay, id, tick, crowdShift), now, pos);
  };

  let posCache = { state: null, key: '', value: null };
  /** Positions of every neighbor for a frame (cached per state and pos). */
  const positionsAt = (state, pos) => {
    const key = `${state === store.state ? store.index : 'x'}|${state.tick}|${pos}`;
    if (posCache.state !== state || posCache.key !== key) {
      const value = new Map();
      for (const n of header.neighbors ?? []) value.set(n.id, position(n.id, state, pos));
      posCache = { state, key, value };
    }
    return posCache.value;
  };

  // Home view: the whole model in the part of the canvas that the floating
  // panels leave free (insets in CSS px). The telephone row has a framing of
  // its own: the whole width of the canvas, resting on the strip that the
  // rumor panel puts over the bar (ROW_STRIP_PX):
  //
  //   ┌ banner ┐                                  t
  //     ☺    ☺    ☺    ☺    ☺    ☺    ☺    ☺       row (bubbles above, names below)
  //   ┌──────────── strip «in → out» ───────────┐  ROW_STRIP_PX
  //   └──────────────────── bar ─────────────────┘ b
  let insets = { l: 0, r: 0, t: 0, b: 0 };
  const homeBox = row ? bounds : plan.ground;
  const shrink = Math.sin((PITCH.far * Math.PI) / 180);
  const ROW_PAD = 12;
  // The row's near edge (names) is the widest on screen in perspective: a few
  // passes of an exact projection put its ends at the canvas edges and its
  // bottom on the strip.
  const probe = createCamera();
  const rowView = (cam) => {
    const bottom = cam.h - insets.b - ROW_STRIP_PX - ROW_PAD;
    const ceiling = insets.t + ROW_PAD;
    const x = (homeBox.minX + homeBox.maxX) / 2;
    let s = fitScale(homeBox, cam.w, Math.max(1, bottom - insets.t), ROW_PAD);
    let y = homeBox.maxY - (bottom - cam.h / 2) / (s * shrink);
    const at = () => {
      probe.base = s;
      probe.reset({ x, y, scale: s });
    };
    probe.resize(cam.w, cam.h);
    for (let i = 0; i < 4; i++) {
      at();
      const a = probe.toScreen(homeBox.minX, homeBox.maxY);
      const b = probe.toScreen(homeBox.maxX, homeBox.maxY);
      const high = bottom - probe.toScreen(x, homeBox.minY).y;
      // As wide as the canvas, unless the bubbles above would pass the banner.
      s *= Math.min((cam.w - 2 * ROW_PAD) / Math.max(1, b.x - a.x), Math.max(1, bottom - ceiling) / Math.max(1, high));
      at();
      y += (probe.toScreen(x, homeBox.maxY).y - bottom) / (s * shrink);
    }
    return { x, y, scale: s };
  };
  const homeView = (cam) => {
    if (row) return rowView(cam);
    const s = fitScale(homeBox, cam.w - insets.l - insets.r, cam.h - insets.t - insets.b, 20);
    return {
      x: (homeBox.minX + homeBox.maxX) / 2 + (insets.r - insets.l) / 2 / s,
      y: (homeBox.minY + homeBox.maxY) / 2 + (insets.b - insets.t) / 2 / (s * shrink),
      scale: s,
    };
  };
  const baseScale = (cam) => homeView(cam).scale;
  const zoomOf = (cam) => cam.scale / baseScale(cam);
  const weights = (cam) => (row ? { far: 0, mid: 1, near: 1 } : levelWeights(zoomOf(cam)));
  const dotRadius = (cam) => Math.min(DOT_PX[1], Math.max(DOT_PX[0], (row ? DOT_WORLD.row : DOT_WORLD.village) * cam.scale));
  const onScreen = (cam, s, margin = ON_SCREEN_MARGIN) =>
    s.x >= -margin && s.y >= -margin && s.x <= cam.w + margin && s.y <= cam.h + margin;
  const bubblesShown = (cam) => weights(cam).near >= 0.5;

  /** Bubbles of a state that the camera would show: speaker on screen. */
  const speech = (state, pos, cam) => {
    const all = positionsAt(state, pos);
    const out = [];
    const turns = lastTurns(state);
    if (state === store.state) turns.push(...endedTurns(store.events, store.index, state.tick));
    for (const { conv, turn } of turns) {
      const wp = all.get(turn.who);
      if (!wp) continue;
      const s = cam.toScreen(wp.x, wp.y, HEAD);
      if (!onScreen(cam, s, 0)) continue;
      const content = bubbleContent(turn, state, header, strings, app.lang);
      if (content) out.push({ conv, turn, screen: s, content });
    }
    return out;
  };

  return {
    header,
    row,
    plan,
    bounds,
    strings,
    segments,
    layoutOf,
    position,
    positionsAt,
    baseScale,
    homeView,
    setInsets(v) {
      insets = v;
    },
    /** Room (CSS px) the floating panels take on each side of the canvas. */
    insets: () => insets,
    zoomOf,
    weights,
    dotRadius,
    onScreen,
    bubblesShown,
    speech,
    neighborColor: (id, state) => app.hooks.neighborColor(id, state),
    placePoint: (id) => placePoint(header, id),
  };
}
