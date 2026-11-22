// stateAt(pos) with snapshots: a private copy of the state is reduced over
// the events as they come (live too), and every `every` events a clone of it
// is kept. The state at `pos` is the nearest snapshot at or before
// countUntil(floor(pos)), cloned, plus the remaining events, then
// advance(floor(pos)): exactly what reducing from the beginning gives.
//
// Forward moves (normal playback) reuse the state handed out last instead of
// cloning: it is reduced in place, like the simple seek of the core. That is
// only exact when no pending event is older than the tick the state was
// advanced to (advance ends trips, and a late event of an earlier tick must
// see them still on their way), so that case falls back to a snapshot.
//
// No DOM here.

import { advance, initState, reduce } from '../core/reduce.js';
import { SNAPSHOT_EVERY } from './constants.js';

/**
 * Creates the snapshot-based stateAt for a store.
 * @param {{header: object, events: object[], countUntil: (tick: number) => number}} store
 * @param {{every?: number, clone?: (s: object) => object}} [opts]
 * @returns {((pos: number) => import('../core/reduce.js').State) & {stats: () => object}}
 */
export function createStateAt(store, { every = SNAPSHOT_EVERY, clone = structuredClone } = {}) {
  if (!(every >= 1)) throw new Error('createStateAt: every must be >= 1');
  const builder = initState(store.header);
  let built = 0; // events reduced into builder
  const snaps = [clone(builder)]; // snaps[k] = state after k*every events
  let cur = null; // the state handed out last
  let curCount = 0; // events reduced into cur
  const stats = { clones: 1, reduced: 0, reused: 0, restored: 0 };

  /** Reduces the builder over every known event, keeping the snapshots. */
  const build = () => {
    const ev = store.events;
    while (built < ev.length) {
      reduce(builder, ev[built++]);
      if (built % every === 0) {
        snaps.push(clone(builder));
        stats.clones++;
      }
    }
  };

  const stateAt = (pos) => {
    build();
    const tick = Math.floor(pos);
    const count = store.countUntil(tick);
    const ev = store.events;
    const reusable =
      cur !== null && tick >= cur.tick && curCount <= count && (curCount === count || ev[curCount].tick >= cur.tick);
    if (reusable) {
      stats.reused++;
    } else {
      const k = Math.min(Math.floor(count / every), snaps.length - 1);
      cur = clone(snaps[k]);
      curCount = k * every;
      stats.clones++;
      stats.restored++;
    }
    stats.reduced += count - curCount;
    while (curCount < count) reduce(cur, ev[curCount++]);
    return advance(cur, tick);
  };
  stateAt.stats = () => ({ ...stats, snapshots: snaps.length, built });
  return stateAt;
}
