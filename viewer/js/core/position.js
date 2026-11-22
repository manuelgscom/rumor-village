// Default position of a neighbor in world coordinates, before package A
// replaces it through app.hooks.position: the coordinates of its place; while
// travelling, a straight line from `from` to `to` by time; before its first
// event, the first place the log shows for it, or else its home.

import { neighborOf, placeOf } from './names.js';

/**
 * How much the viewer spreads the map of the header (distances × SPREAD
 * around the middle of the places), so that buildings and crowds have room.
 * Only the drawing changes: travel times stay those of the engine.
 */
export const SPREAD = 1.5;

/**
 * Copy of a header with places and route paths spread around their middle.
 * @param {object} header
 * @param {number} [k]
 * @returns {object}
 */
export function spreadHeader(header, k = SPREAD) {
  const places = header?.places ?? [];
  if (!places.length || k === 1) return header;
  const cx = places.reduce((a, p) => a + p.x, 0) / places.length;
  const cy = places.reduce((a, p) => a + p.y, 0) / places.length;
  const sx = (x) => cx + (x - cx) * k;
  const sy = (y) => cy + (y - cy) * k;
  return {
    ...header,
    places: places.map((p) => ({ ...p, x: sx(p.x), y: sy(p.y) })),
    routes: (header.routes ?? []).map((r) => ({ ...r, path: (r.path ?? []).map(([x, y]) => [sx(x), sy(y)]) })),
  };
}

/**
 * Coordinates of a place of the header.
 * @param {object} header
 * @param {string|undefined|null} placeId
 * @returns {{x: number, y: number}|null}
 */
export function placePoint(header, placeId) {
  const p = placeId ? placeOf(header, placeId) : undefined;
  return p ? { x: p.x, y: p.y } : null;
}

/**
 * Place of a neighbor in a state, as the viewer understands it: its place, the
 * destination of a finished trip, the first place seen, or its home.
 * @param {object} header
 * @param {(id: string) => string|undefined} firstPlace store.firstPlace
 * @param {string} id
 * @param {import('./reduce.js').State} state
 * @returns {string|undefined}
 */
export function placeOfNeighbor(header, firstPlace, id, state) {
  const n = state.neighbors.get(id);
  if (n?.place) return n.place;
  if (n?.trip) return state.tick >= n.trip.arrive ? n.trip.to : n.trip.from;
  return firstPlace(id) ?? neighborOf(header, id)?.home;
}

/**
 * Default position (world coordinates) of a neighbor at a playback position.
 * @param {object} header
 * @param {(id: string) => string|undefined} firstPlace store.firstPlace
 * @param {string} id
 * @param {import('./reduce.js').State} state
 * @param {number} pos
 * @returns {{x: number, y: number}}
 */
export function defaultPosition(header, firstPlace, id, state, pos) {
  const n = state.neighbors.get(id);
  if (n?.trip) {
    const a = placePoint(header, n.trip.from);
    const b = placePoint(header, n.trip.to);
    if (a && b) {
      const span = Math.max(1, n.trip.arrive - n.trip.start);
      const k = Math.min(1, Math.max(0, (pos - n.trip.start) / span));
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
    }
  }
  return placePoint(header, placeOfNeighbor(header, firstPlace, id, state)) ?? { x: 0, y: 0 };
}
