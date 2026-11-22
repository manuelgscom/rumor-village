// The single clock of the split screen: one playback position in ticks that
// moves both sides. Pure: no DOM and no wall clock; the page passes the time
// of each frame. Every change of `pos` calls seek(pos) on every side with the
// same pos. Reading pauses and speeds are those of package B (replay/playback.js).

import { parseSpeed, step as stepPlay } from '../replay/playback.js';

/**
 * @typedef {object} SplitClock
 * @property {number} pos
 * @property {boolean} paused
 * @property {import('../replay/playback.js').Speed} speed
 * @property {(dtMs: number, chars: number) => number} frame one frame of playback; returns pos
 * @property {(pos: number) => void} seek kept inside [start, end]; resets the reading pause
 * @property {(speed: import('../replay/playback.js').Speed) => void} setSpeed
 * @property {() => void} togglePause play at the end starts again
 * @property {() => void} toStart
 * @property {() => void} toEnd
 * @property {(delta: number) => void} step whole ticks from the current one
 */

/**
 * Creates the clock.
 * @param {object} o
 * @param {number} o.start first position (lowest start of the two sides)
 * @param {number} o.end last position (highest end of the two sides)
 * @param {import('../replay/playback.js').Speed} [o.speed] default: parseSpeed(null)
 * @param {boolean} [o.paused]
 * @param {number} [o.pos] default: start
 * @param {{seek: (pos: number) => void}[]} o.sides
 * @returns {SplitClock}
 */
export function createSplitClock({ start, end, speed = parseSpeed(null), paused = false, pos, sides }) {
  let p = clamp(pos ?? start);
  let waitMs = 0;
  let waitedTick = null;
  let isPaused = paused || p >= end;

  function clamp(v) {
    return Math.max(start, Math.min(end, v));
  }

  const seekAll = () => {
    for (const s of sides) s.seek(p);
  };

  const clock = {
    get pos() {
      return p;
    },
    get paused() {
      return isPaused;
    },
    get speed() {
      return speed;
    },

    frame(dtMs, chars) {
      if (isPaused) return p;
      const r = stepPlay({ pos: p, waitMs, waitedTick }, dtMs, {
        tps: speed.tps,
        fast: speed.fast,
        chars: Number(chars) || 0,
        end,
      });
      waitMs = r.waitMs;
      waitedTick = r.waitedTick;
      if (r.atEnd) isPaused = true;
      if (r.pos !== p) {
        p = r.pos;
        seekAll();
      }
      return p;
    },

    seek(v) {
      if (!Number.isFinite(v)) return;
      p = clamp(v);
      waitMs = 0;
      waitedTick = null;
      seekAll();
    },

    setSpeed(s) {
      speed = s;
      waitMs = 0;
    },

    togglePause() {
      if (!isPaused) {
        isPaused = true;
        return;
      }
      if (p >= end) clock.seek(start);
      isPaused = false;
    },

    toStart() {
      clock.seek(start);
    },

    toEnd() {
      clock.seek(end);
    },

    step(delta) {
      clock.seek(Math.floor(p) + Math.trunc(delta));
    },
  };
  return clock;
}
