// Director mode: which shot the camera wants at a playback position. A pure
// function of the narrator's items with i < idx and of the tick; the flight
// to the shot (story/fly.js) is the only thing that uses the wall clock.
//
// The items are read in order as a cutter would: a new item takes the shot
// when the current one has lasted MIN_HOLD ticks and the new one is of the
// same class or higher (deformation > spread > arrival > conversation), or
// when nothing has refreshed the current one for STALE ticks. Items about the
// same subject (the same pair, neighbor or place) refresh the shot instead of
// cutting. After IDLE quiet ticks, or at the end, the camera goes home.
//
//   subject   what is framed                           zoom (× home scale)
//   pair      speaker and listener of a tell / chat    PAIR_ZOOM
//   neighbor  someone who forgets, doubts or is told   PAIR_ZOOM
//   place     where people go or arrive                MOVE_ZOOM / ARRIVE_ZOOM
//   home      the whole village                        1

import { countBefore } from './narrate.js';

/** Shortest shot, in ticks. */
export const MIN_HOLD = 20;
/** A shot not refreshed for this many ticks gives way to anything. */
export const STALE = 45;
/** Quiet ticks after which the camera goes home. */
export const IDLE = 90;

export const PAIR_ZOOM = 4.6;
export const MOVE_ZOOM = 1.7;
export const ARRIVE_ZOOM = 2.6;

/**
 * @typedef {object} Shot
 * @property {string} key identity of the subject: a new key is a new shot
 * @property {'pair'|'neighbor'|'place'|'home'} kind
 * @property {string[]} ids neighbors framed (pair, neighbor)
 * @property {string|null} place
 * @property {number} zoom
 * @property {number} cls
 * @property {number} since tick the shot started
 * @property {number} last tick of the latest item that refreshed it
 * @property {import('./narrate.js').Item|null} item
 */

const HOME = Object.freeze({ key: 'home', kind: 'home', ids: [], place: null, zoom: 1, cls: 0, since: 0, last: 0, item: null });

/**
 * Subject of an item.
 * @param {import('./narrate.js').Item} it
 * @returns {{key: string, kind: Shot['kind'], ids: string[], place: string|null, zoom: number}}
 */
export function subjectOf(it) {
  switch (it.kind) {
    case 'tell':
    case 'conv': {
      const ids = [it.d.a, it.d.b].sort();
      return { key: `pair|${ids.join('|')}`, kind: 'pair', ids, place: null, zoom: PAIR_ZOOM };
    }
    case 'inject':
    case 'forgot':
    case 'doubt':
      return { key: `n|${it.who}`, kind: 'neighbor', ids: [it.who], place: null, zoom: PAIR_ZOOM };
    case 'move':
      return { key: `place|${it.d.to}`, kind: 'place', ids: [], place: it.d.to, zoom: MOVE_ZOOM };
    case 'arrive':
      return { key: `place|${it.d.place}`, kind: 'place', ids: [], place: it.d.place, zoom: ARRIVE_ZOOM };
    default:
      return { key: 'home', kind: 'home', ids: [], place: null, zoom: 1 };
  }
}

/**
 * The shot at position idx and tick.
 * @param {import('./narrate.js').Item[]} items
 * @param {number} idx store.index
 * @param {number} tick floor of the playback position
 * @returns {Shot}
 */
export function shotAt(items, idx, tick) {
  const end = countBefore(items, idx);
  let shot = null;
  // Best item seen while the shot could not cut yet (highest class, latest).
  let cand = null;
  const make = (it, since) => ({ ...subjectOf(it), cls: it.cls, since, last: since, item: it });
  // The candidate takes the shot as soon as the shot may cut: after MIN_HOLD
  // if it is of the same class or higher, after STALE quiet ticks otherwise.
  const promote = (at) => {
    if (!cand) return;
    if (at - cand.tick > STALE) {
      cand = null;
      return;
    }
    const cut = Math.max(shot.since + MIN_HOLD, cand.cls >= shot.cls ? 0 : shot.last + STALE);
    if (at >= cut) {
      shot = make(cand, Math.max(cut, cand.tick));
      cand = null;
    }
  };
  for (let k = 0; k < end; k++) {
    const it = items[k];
    if (shot) promote(it.tick);
    const s = subjectOf(it);
    if (shot && s.key === shot.key) {
      shot.last = it.tick;
      shot.zoom = s.zoom;
      shot.cls = Math.max(shot.cls, it.cls);
      shot.item = it;
      continue;
    }
    const free = shot && it.tick - shot.since >= MIN_HOLD && (it.cls >= shot.cls || it.tick - shot.last >= STALE);
    if (!shot || free || it.kind === 'end') {
      shot = make(it, it.tick);
      cand = null;
      continue;
    }
    if (!cand || it.cls >= cand.cls) cand = it;
  }
  if (shot) promote(tick);
  if (!shot || shot.kind === 'home') return shot ? { ...HOME, since: shot.since, last: shot.last, item: shot.item } : { ...HOME };
  if (tick - shot.last > IDLE) return { ...HOME, since: shot.last + IDLE, last: shot.last + IDLE };
  return shot;
}

/**
 * The automatic camera inside the game (<html data-game="play">; phase 9-5):
 * the engine writes text only for the neighbors the camera sees up close
 * (TextMode::camera, POST /viewport), so it comes on by itself when a game
 * starts, unless the player switched it off during that game.
 * @param {string|null} phase the game phase (bus 'game')
 * @param {boolean} off the player switched it off in this game
 * @returns {{on: boolean, forget: boolean}} on: switch it on now; forget: a
 *   new game is being prepared, the player's choice no longer applies
 */
export function autoCamera(phase, off) {
  return { on: phase === 'playing' && !off, forget: phase === 'boot' || phase === 'menu' || phase === 'prepare' };
}
