// Where each neighbor is drawn, in world coordinates (pure, no DOM).
//
// At a place, neighbors stand on a grid centred on the place, one cell each;
// the two members of a conversation take two cells side by side. Units (a
// pair or a single) go in id order, row by row, each row centred:
//
//        ·  ·  ·  ·  ·          · = one neighbor
//      ·  [·──·]  ·  ·  ·       [·──·] = a pair that is talking
//        ·  ·  ·
//
// The same set of people (and pairs) gives the same grid, so nobody moves
// while nothing changes. While travelling, a neighbor follows the route of its
// `move` (header.routes[].path, backwards when from > to) by time until its
// arrival tick. The telephone scenario puts everybody in one row by id.
//
// When the grid of a place changes (someone arrives, leaves or starts a
// conversation) nobody jumps: during the first SETTLE_TICKS of the tick each
// neighbor glides from its spot in the layout of the previous tick to its spot
// in the new one. Both layouts are functions of the state, so the glide is a
// function of (state, pos) and the events, never of the frames drawn:
//
//   tick t-1          tick t            pos
//   ──────────────────┼──────────────────────►
//   spot in L(t-1)    │◄ SETTLE ►│ spot in L(t)
//                     glide (smoothstep)

import { placeOfNeighbor, placePoint } from '../core/position.js';

/** Grid spacing (world units) of a place with few people. */
export const SPACING = 12;
/** Smallest spacing, for crowded places. */
export const MIN_SPACING = 8;
/** People that fit at full spacing; more than that and the grid tightens. */
export const COMFORT = 36;
/** Gap (world units) between neighbors in the telephone row. */
export const ROW_GAP = 60;
/** Room (world units) above the row for speech bubbles, and below it for names. */
export const ROW_ABOVE = 170;
export const ROW_BELOW = 50;
/** Margin (world units) added around the places for the home view. */
export const VILLAGE_MARGIN = 55;

/**
 * Grid spacing for a number of people at one place.
 * @param {number} n
 * @returns {number}
 */
export function spacingFor(n) {
  return n <= COMFORT ? SPACING : Math.max(MIN_SPACING, SPACING * Math.sqrt(COMFORT / n));
}

/**
 * Lays out units (each one or two people) on a centred grid.
 * @param {number[]} sizes size of each unit, 1 or 2
 * @param {number} spacing
 * @returns {{cells: {x: number, y: number}[][], halfW: number, halfH: number}}
 *   cells[i] are the offsets of the members of unit i from the centre
 */
export function gridLayout(sizes, spacing) {
  const total = sizes.reduce((a, b) => a + b, 0);
  const cols = Math.max(2, Math.ceil(Math.sqrt(total * 1.4)));
  const rows = [];
  let row = { units: [], used: 0 };
  sizes.forEach((size, i) => {
    if (row.used + size > cols && row.used > 0) {
      rows.push(row);
      row = { units: [], used: 0 };
    }
    row.units.push(i);
    row.used += size;
  });
  if (row.used) rows.push(row);

  const cells = sizes.map(() => []);
  let widest = 0;
  rows.forEach((r, ri) => {
    widest = Math.max(widest, r.used);
    const y = (ri - (rows.length - 1) / 2) * spacing;
    let col = 0;
    for (const u of r.units) {
      for (let k = 0; k < sizes[u]; k++) {
        cells[u].push({ x: (col - (r.used - 1) / 2) * spacing, y });
        col++;
      }
    }
  });
  return {
    cells,
    halfW: (Math.max(1, widest) - 1) * spacing * 0.5,
    halfH: (Math.max(1, rows.length) - 1) * spacing * 0.5,
  };
}

/**
 * @typedef {object} Block
 * @property {number} x centre (the place)
 * @property {number} y
 * @property {number} halfW half the width of the grid (centre to outer dot)
 * @property {number} halfH
 * @property {number} count people there
 */

/**
 * Positions of the neighbors that are at a place (not travelling).
 * @param {object} header
 * @param {import('../core/reduce.js').State} state
 * @param {(id: string) => string|undefined} firstPlace store.firstPlace
 * @returns {{pos: Map<string, {x: number, y: number}>, blocks: Map<string, Block>, placeOf: Map<string, string>}}
 */
export function placeLayout(header, state, firstPlace) {
  const byPlace = new Map();
  const placeOf = new Map();
  const ids = (header.neighbors ?? []).map((n) => n.id).sort();
  for (const id of ids) {
    if (state.neighbors.get(id)?.trip) continue;
    const p = placeOfNeighbor(header, firstPlace, id, state);
    if (!p) continue;
    placeOf.set(id, p);
    if (!byPlace.has(p)) byPlace.set(p, []);
    byPlace.get(p).push(id);
  }

  const pos = new Map();
  const blocks = new Map();
  for (const [placeId, people] of byPlace) {
    const centre = placePoint(header, placeId);
    if (!centre) continue;
    const here = new Set(people);
    const seen = new Set();
    const units = [];
    for (const id of people) {
      if (seen.has(id)) continue;
      seen.add(id);
      const convId = state.neighbors.get(id)?.conv;
      const conv = convId ? state.convs.get(convId) : null;
      const partner = conv ? (conv.a === id ? conv.b : conv.a) : null;
      if (partner && here.has(partner) && !seen.has(partner)) {
        seen.add(partner);
        units.push([id, partner]);
      } else {
        units.push([id]);
      }
    }
    const spacing = spacingFor(people.length);
    const grid = gridLayout(
      units.map((u) => u.length),
      spacing,
    );
    units.forEach((u, i) => {
      u.forEach((id, k) => pos.set(id, { x: centre.x + grid.cells[i][k].x, y: centre.y + grid.cells[i][k].y }));
    });
    blocks.set(placeId, { x: centre.x, y: centre.y, halfW: grid.halfW, halfH: grid.halfH, count: people.length });
  }
  return { pos, blocks, placeOf };
}

/** Ticks a neighbor takes to glide to its new spot when its place's grid changes. */
export const SETTLE_TICKS = 0.75;

/**
 * Weight of the new layout at a playback position: 0 at the start of a tick,
 * 1 once SETTLE_TICKS of it have passed (smoothstep in between).
 * @param {number} pos
 * @returns {number}
 */
export function settleWeight(pos) {
  const f = pos - Math.floor(pos);
  if (!(f < SETTLE_TICKS)) return 1;
  const k = f / SETTLE_TICKS;
  return k * k * (3 - 2 * k);
}

/**
 * Spot of a neighbor in the layout of a state, at a moment: on its trip, or
 * its cell of the grid (moved by `shift` for the place), or null when the
 * layout has no cell for it.
 * @param {object} header
 * @param {Map<string, number[][]>} routes from routeIndex
 * @param {import('../core/reduce.js').State} state
 * @param {ReturnType<typeof placeLayout>} lay placeLayout of that state
 * @param {string} id
 * @param {number} at playback position (for the trip)
 * @param {(lay: object, placeId: string|undefined) => number} [shift] extra y of a place's crowd
 * @returns {{x: number, y: number, trip: object|null}|null}
 */
export function spotOf(header, routes, state, lay, id, at, shift = () => 0) {
  const n = state.neighbors.get(id);
  if (n?.trip) {
    const p = tripPoint(header, routes, n.trip, at);
    return { x: p.x, y: p.y, trip: n.trip };
  }
  const p = lay.pos.get(id);
  if (!p) return null;
  return { x: p.x, y: p.y + shift(lay, lay.placeOf.get(id)), trip: null };
}

/**
 * Where a neighbor is drawn at pos: its spot now (`after`, in the layout of
 * the state at floor(pos)), gliding from its spot one tick before (`before`,
 * taken at the start of the tick) while settleWeight(pos) < 1. Somebody on the
 * same trip in both is not slowed down.
 * @param {{x: number, y: number, trip?: object|null}|null} before
 * @param {{x: number, y: number, trip?: object|null}} after
 * @param {number} pos
 * @returns {{x: number, y: number}}
 */
export function glide(before, after, pos) {
  const k = settleWeight(pos);
  if (!before || k >= 1) return { x: after.x, y: after.y };
  const a = before.trip;
  const b = after.trip;
  if (a && b && a.start === b.start && a.from === b.from && a.to === b.to) return { x: after.x, y: after.y };
  return { x: before.x + (after.x - before.x) * k, y: before.y + (after.y - before.y) * k };
}

/**
 * Index of the route paths in both directions: "from|to" → [[x, y], ...].
 * @param {object} header
 * @returns {Map<string, number[][]>}
 */
export function routeIndex(header) {
  const index = new Map();
  for (const r of header.routes ?? []) {
    if (!r.path?.length) continue;
    index.set(`${r.from}|${r.to}`, r.path);
    if (!index.has(`${r.to}|${r.from}`)) index.set(`${r.to}|${r.from}`, [...r.path].reverse());
  }
  return index;
}

/**
 * Path from one place to another: the route of the header (reversed when
 * needed), or a straight line if the header has none.
 * @param {object} header
 * @param {Map<string, number[][]>} index from routeIndex
 * @param {string} from
 * @param {string} to
 * @returns {number[][]} at least one point; empty if the places are unknown
 */
export function tripPath(header, index, from, to) {
  const path = index.get(`${from}|${to}`);
  if (path) return path;
  const a = placePoint(header, from);
  const b = placePoint(header, to);
  if (a && b) return [
    [a.x, a.y],
    [b.x, b.y],
  ];
  const one = a ?? b;
  return one ? [[one.x, one.y]] : [];
}

/**
 * Point at a fraction of the length of a polyline.
 * @param {number[][]} path
 * @param {number} k 0..1 (clamped)
 * @returns {{x: number, y: number}}
 */
export function pointAlong(path, k) {
  if (!path.length) return { x: 0, y: 0 };
  const t = Math.min(1, Math.max(0, k));
  let total = 0;
  for (let i = 1; i < path.length; i++) total += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  if (total === 0) return { x: path[0][0], y: path[0][1] };
  let left = t * total;
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1];
    const [bx, by] = path[i];
    const len = Math.hypot(bx - ax, by - ay);
    if (left <= len || i === path.length - 1) {
      const f = len > 0 ? Math.min(1, left / len) : 1;
      return { x: ax + (bx - ax) * f, y: ay + (by - ay) * f };
    }
    left -= len;
  }
  const last = path[path.length - 1];
  return { x: last[0], y: last[1] };
}

/**
 * Position of a travelling neighbor at a playback position.
 * @param {object} header
 * @param {Map<string, number[][]>} index
 * @param {{from: string, to: string, start: number, arrive: number}} trip
 * @param {number} pos ticks with decimals
 * @returns {{x: number, y: number}}
 */
export function tripPoint(header, index, trip, pos) {
  const span = Math.max(1, trip.arrive - trip.start);
  return pointAlong(tripPath(header, index, trip.from, trip.to), (pos - trip.start) / span);
}

/**
 * Whether a header is a telephone run (drawn as a row).
 * @param {object} header
 * @returns {boolean}
 */
export function isRow(header) {
  return String(header?.scenario ?? '').startsWith('telephone');
}

/**
 * Positions of the telephone row: everybody in id order on y = 0.
 * @param {object} header
 * @returns {Map<string, {x: number, y: number}>}
 */
export function rowLayout(header) {
  const ids = (header.neighbors ?? []).map((n) => n.id).sort();
  return new Map(ids.map((id, i) => [id, { x: i * ROW_GAP, y: 0 }]));
}

/**
 * Box of the home view: the telephone row with room for bubbles and names,
 * or the places with a margin for houses and labels.
 * @param {object} header
 * @returns {{minX: number, minY: number, maxX: number, maxY: number}}
 */
export function homeBounds(header) {
  if (isRow(header)) {
    const n = Math.max(1, header.neighbors?.length ?? 1);
    return { minX: -ROW_GAP / 2, maxX: (n - 1) * ROW_GAP + ROW_GAP / 2, minY: -ROW_ABOVE, maxY: ROW_BELOW };
  }
  const places = header.places ?? [];
  if (!places.length) return { minX: 0, minY: 0, maxX: 1000, maxY: 700 };
  const xs = places.map((p) => p.x);
  const ys = places.map((p) => p.y);
  const m = VILLAGE_MARGIN;
  return { minX: Math.min(...xs) - m, minY: Math.min(...ys) - m, maxX: Math.max(...xs) + m, maxY: Math.max(...ys) + m };
}

/**
 * The point nearest to (sx, sy) within a radius.
 * @param {{id: string, x: number, y: number}[]} points screen points
 * @param {number} sx
 * @param {number} sy
 * @param {number} radius
 * @returns {string|null}
 */
export function nearestHit(points, sx, sy, radius) {
  let best = null;
  let bestD = radius * radius;
  for (const p of points) {
    const d = (p.x - sx) ** 2 + (p.y - sy) ** 2;
    if (d <= bestD) {
      bestD = d;
      best = p.id;
    }
  }
  return best;
}

/**
 * What the `focus` URL parameter names: a neighbor (id or name) or a place
 * (id, key or name), case-insensitive. null if nothing matches.
 * @param {object} header
 * @param {string|null|undefined} focus
 * @returns {{kind: 'neighbor'|'place', id: string}|null}
 */
export function focusTarget(header, focus) {
  if (focus === null || focus === undefined || focus === '') return null;
  const f = String(focus).trim().toLowerCase();
  const n = (header.neighbors ?? []).find((x) => x.id.toLowerCase() === f || String(x.name).toLowerCase() === f);
  if (n) return { kind: 'neighbor', id: n.id };
  const p = (header.places ?? []).find(
    (x) => x.id.toLowerCase() === f || String(x.key).toLowerCase() === f || String(x.name).toLowerCase() === f,
  );
  return p ? { kind: 'place', id: p.id } : null;
}

/**
 * Place with the most active conversations (ties: the earliest one), or null.
 * @param {import('../core/reduce.js').State} state
 * @returns {string|null}
 */
export function busiestPlace(state) {
  const count = new Map();
  for (const c of state.convs.values()) count.set(c.place, (count.get(c.place) ?? 0) + 1);
  let best = null;
  let most = 0;
  for (const [place, n] of count) {
    if (n > most) {
      most = n;
      best = place;
    }
  }
  return best;
}
