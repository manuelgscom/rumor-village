// Every tunable number of package B (rewind and timeline), in one place.

/** Ticks (simulated minutes) per second of each speed. */
export const SPEEDS = {
  x1: 2,
  x4: 8,
  fast: 60,
};

/** Speed when the URL does not say. */
export const DEFAULT_SPEED = 'x1';

/** Reading pause per character of text on screen, in ms (x1 and x4 only). */
export const READ_MS_PER_CHAR = 35;

/** Longest reading pause at the end of one tick, in ms. */
export const READ_MAX_MS = 4000;

/**
 * Events between two snapshots of the state. Measured on party-100
 * (6 652 events, `scripts/viewer-test.sh replay` prints it): reducing the
 * whole log takes about 0.45 ms and one clone of the final state about
 * 0.23 ms, the price of reducing some 3 000 events. Any interval from 25 to
 * 1 000 gives a mean random jump of about 0.15 ms (the clone dominates);
 * 1 000 builds in under 2 ms with 7 snapshots and still bounds the replay
 * after a clone when a live run grows to tens of thousands of events.
 */
export const SNAPSHOT_EVERY = 1000;

/** Longest frame step, in ms: a hidden tab does not jump ahead on return. */
export const MAX_FRAME_MS = 250;

/** Live: time constant of the chase of the live edge, in ms. */
export const LIVE_CHASE_MS = 400;

/** Live: farther than this many ticks behind the edge, jump instead of chasing. */
export const LIVE_JUMP_TICKS = 60;

/** Where a reading pause holds the position: this far before the end of the tick. */
export const TICK_EPSILON = 1e-3;

/** A recording opened without `t` starts this many ticks before its first inject. */
export const START_LEAD = 20;

/** Shift + arrow on the timeline moves this many ticks (an hour). */
export const BIG_STEP = 60;
