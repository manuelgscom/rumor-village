// The pace of a game in the web version (phase 10, package F): when the next
// tick may be let through, as LiveRun::before_tick does it in `rumor play`
// (engine/src/server/live_run.cpp). Pure: the fake server (server.js) asks
// and keeps the state.
//
//   paused ───────────────────────────────► waits (no due time)
//   speed "max" (0) ──────────────────────► now
//   otherwise  max(released + 1000/pace, holdUntil)
//              pace = speed, or max(speed, quietSpeed) after a quiet tick
//
// Time is virtual: a tick let through late counts from when it was due, so a
// page whose timers were slowed (a tab in the background) catches up as the
// engine would have; after a pause the next tick goes at once and the clock
// starts again from it.

/** The pace of a new run: as `rumor play` starts one (cli/play.cpp). */
export const DEFAULT_CONTROL = Object.freeze({
  paused: false,
  speed: 2, // ticks per second; 0 = "max"
  quietSpeed: 10, // after a quiet tick; 0 = never faster
  quiet: false, // the last tick was quiet
  released: null, // virtual time (ms) the last tick went; null: none yet, or after a pause
  holdUntil: 0, // a reading pause (POST control hold_ms), in ms
});

/**
 * When the next tick may go, in ms of `now`'s clock; null while paused.
 * @param {typeof DEFAULT_CONTROL} c
 * @returns {number|null}
 */
export function dueAt(c) {
  if (c.paused) return null;
  if (c.speed === 0) return -Infinity;
  const pace = c.quiet ? Math.max(c.speed, c.quietSpeed) : c.speed;
  const after = c.released === null ? -Infinity : c.released + 1000 / pace;
  return Math.max(after, c.holdUntil);
}

/**
 * The control once a tick went at `now` (call it only when dueAt <= now).
 * @param {typeof DEFAULT_CONTROL} c
 * @param {number} now
 * @param {boolean} quiet whether that tick was quiet
 */
export function released(c, now, quiet) {
  const due = dueAt(c);
  const at = c.released === null || due === -Infinity || due === null ? now : due;
  return { ...c, released: Math.min(at, now), quiet: !!quiet };
}
