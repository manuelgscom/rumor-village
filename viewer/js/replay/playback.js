// Pure logic of playback: speeds, the step of one frame with its reading
// pauses, and the chase of the live edge. No DOM here.
//
// Reading pauses: at x1 and x4, when the frame would cross the end of a tick
// while text is on screen, the position holds just before that end for a time
// proportional to the characters (with a cap), then goes on. Fast speed has
// none. Only the pace changes: the state shown at each position is the same.

import {
  DEFAULT_SPEED,
  LIVE_CHASE_MS,
  LIVE_JUMP_TICKS,
  MAX_FRAME_MS,
  READ_MAX_MS,
  READ_MS_PER_CHAR,
  SPEEDS,
  TICK_EPSILON,
} from './constants.js';

/**
 * @typedef {{key: 'x1'|'x4'|'fast'|null, tps: number, fast: boolean}} Speed
 *   key null for a custom number of ticks per second
 */

/**
 * A named speed.
 * @param {'x1'|'x4'|'fast'} key
 * @returns {Speed}
 */
export function speedOf(key) {
  return { key, tps: SPEEDS[key], fast: key === 'fast' };
}

/**
 * Speed from the `speed` URL parameter: 1, 4, "fast" or a number of ticks
 * per second; anything else gives the default.
 * @param {string|number|null|undefined} v
 * @returns {Speed}
 */
export function parseSpeed(v) {
  if (v === 1 || v === '1' || v === 'x1') return speedOf('x1');
  if (v === 4 || v === '4' || v === 'x4') return speedOf('x4');
  if (typeof v === 'string' && v.toLowerCase() === 'fast') return speedOf('fast');
  const n = typeof v === 'number' ? v : Number.NaN;
  if (Number.isFinite(n) && n > 0) return { key: null, tps: n, fast: n >= SPEEDS.fast };
  return speedOf(DEFAULT_SPEED);
}

/**
 * Length of the reading pause for some characters on screen.
 * @param {number} chars
 * @returns {number} ms
 */
export function readingPause(chars) {
  return chars > 0 ? Math.min(READ_MAX_MS, chars * READ_MS_PER_CHAR) : 0;
}

/**
 * @typedef {object} Play
 * @property {number} pos playback position (ticks with decimals)
 * @property {number} waitMs reading pause still to wait
 * @property {number|null} waitedTick tick whose reading pause is already done
 */

/**
 * One frame of playback.
 * @param {Play} play
 * @param {number} dtMs time since the last frame
 * @param {{tps: number, fast: boolean, chars: number, end: number}} opts
 *   chars: characters of text on screen now (app.hooks.readingChars());
 *   end: last position (the playback stops there)
 * @returns {Play & {atEnd: boolean}}
 */
export function step(play, dtMs, { tps, fast, chars, end }) {
  let dt = Math.max(0, Math.min(dtMs, MAX_FRAME_MS));
  let { pos, waitMs, waitedTick } = play;
  if (fast) waitMs = 0;
  if (waitMs > 0) {
    if (dt < waitMs) return { pos, waitMs: waitMs - dt, waitedTick, atEnd: false };
    dt -= waitMs;
    waitMs = 0;
  }
  const tick = Math.floor(pos);
  const boundary = tick + 1;
  let target = pos + (dt * tps) / 1000;
  if (!fast) {
    if (chars > 0 && waitedTick !== tick && target >= boundary - TICK_EPSILON && boundary < end) {
      return {
        pos: Math.max(pos, boundary - TICK_EPSILON),
        waitMs: readingPause(chars),
        waitedTick: tick,
        atEnd: false,
      };
    }
    // At most one tick end per frame, so the text of every tick is seen.
    target = Math.min(target, boundary + 1 - TICK_EPSILON);
  }
  if (target >= end) return { pos: Math.max(pos, end), waitMs: 0, waitedTick, atEnd: true };
  return { pos: target, waitMs: 0, waitedTick, atEnd: false };
}

/**
 * Live: next position chasing the live edge smoothly, never past it.
 * @param {number} pos
 * @param {number} edge store.lastTick
 * @param {number} dtMs
 * @returns {number}
 */
export function chase(pos, edge, dtMs) {
  if (pos >= edge) return pos;
  if (edge - pos > LIVE_JUMP_TICKS) return edge;
  const dt = Math.max(0, Math.min(dtMs, MAX_FRAME_MS));
  const next = pos + (edge - pos) * (1 - Math.exp(-dt / LIVE_CHASE_MS));
  return edge - next < 0.01 ? edge : next;
}

/**
 * Live, following the edge, inside the game (phase 9-5): the next position.
 * A pause of the game (`frozen`: the village paused from the bar or by the
 * guide) stops the position where it is seen, though the engine sent more;
 * on resume it chases the edge again. The reading pauses stay the engine's
 * (live/hold.js), as outside the game.
 * @param {number} pos
 * @param {number} dtMs
 * @param {{edge: number, frozen: boolean}} o
 * @returns {number}
 */
export function liveStep(pos, dtMs, { edge, frozen }) {
  return frozen ? pos : chase(pos, edge, dtMs);
}

/**
 * Live: what the transport shows for the engine's own state (bus 'engine').
 * The engine speed is in ticks per second (or 'max', which is the fast
 * button); it marks a speed button only when it is one of SPEEDS. An ended
 * run shows as paused.
 * @param {{paused?: boolean, speed?: number|'max'|null, ended?: boolean}} engine
 * @returns {{paused: boolean, key: 'x1'|'x4'|'fast'|null}}
 */
export function engineView(engine) {
  const tps = engine?.speed;
  const key = tps === 'max' ? 'fast' : (Object.keys(SPEEDS).find((k) => typeof tps === 'number' && SPEEDS[k] === tps) ?? null);
  return { paused: !!engine?.paused || !!engine?.ended, key };
}

/** Phases of the game (bus 'game') before the clock runs: the village waits. */
const WAITING_PHASES = new Set(['boot', 'menu', 'prepare']);

/**
 * Live: what the pill says. 'preparing' while the game is not under way yet
 * (its clock is stopped), 'live' or 'ended' while following the edge, 'back'
 * (back to live) when looking at the past. Without a game phase (a live run
 * outside the game mode) it is never 'preparing'; the game phase 'ended' is
 * 'ended' even before the stream says so.
 * @param {{following: boolean, over: boolean, phase?: string|null}} s
 * @returns {'preparing'|'live'|'ended'|'back'}
 */
export function liveLabel({ following, over, phase }) {
  if (!following) return 'back';
  if (phase && WAITING_PHASES.has(phase)) return 'preparing';
  return over || phase === 'ended' ? 'ended' : 'live';
}

/**
 * Key of the title of the play button (replay/strings.js). In live it says
 * what it acts on: the village (the engine, while following the edge) or only
 * what is seen (the village goes on).
 * @param {{live: boolean, following: boolean, paused: boolean}} s
 * @returns {'play'|'pause'|'resumeVillage'|'pauseVillage'|'resumeView'|'pauseView'}
 */
export function playTitle({ live, following, paused }) {
  if (!live) return paused ? 'play' : 'pause';
  if (following) return paused ? 'resumeVillage' : 'pauseVillage';
  return paused ? 'resumeView' : 'pauseView';
}
