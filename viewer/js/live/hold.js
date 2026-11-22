// Reading pauses in a live run (phase 9). A recording stops at the end of a
// tick while the new text on screen is read (replay/playback.js); live, the
// viewer follows the engine's edge instead, so it asks the engine to hold the
// next tick for the same time (POST /control {"hold_ms": N}). Only pacing:
// the run is the same. Pure, so it is tested without a DOM.

import { SPEEDS } from '../replay/constants.js';
import { readingPause } from '../replay/playback.js';

/** Ticks behind the live edge that still count as watching it. */
export const HOLD_LAG = 2;

/**
 * How long to ask the engine to hold, in ms, for the text new on screen now;
 * 0 when nothing should be asked.
 * @param {object} o
 * @param {number} o.pos the viewer's position (store.pos)
 * @param {number} o.edge the live edge (store.lastTick)
 * @param {number} o.chars characters of text new on screen at floor(pos) (app.hooks.readingChars())
 * @param {number|null} o.held the tick of the last hold asked for
 * @param {{paused: boolean, speed: number|'max'|null, ended: boolean}|null} o.engine engineState()
 * @returns {number}
 */
export function holdFor({ pos, edge, chars, held, engine }) {
  if (!engine || engine.paused || engine.ended) return 0;
  // As in a recording, only at x1 and x4: «rápida» and max never stop to read.
  if (!(Number.isFinite(engine.speed) && engine.speed <= SPEEDS.x4)) return 0;
  if (!(chars > 0) || edge - pos > HOLD_LAG) return 0;
  if (held === Math.floor(pos)) return 0;
  return readingPause(chars);
}
