// The store: the events of the run (only appended), the playback position and
// the state at that position. Everything drawn is a pure function of
// (store.state, store.pos); `pos` is in ticks with decimals and the state is
// the result of every event with tick <= floor(pos).
//
// `seek` here is the simple one: forward it keeps reducing from where it is,
// backwards it starts again from the beginning. Package B replaces it with
// snapshots through `setStateAt`.

import { advance, initState, reduce } from './reduce.js';

/**
 * @typedef {{type: 'append', from: number, to: number} | {type: 'seek'}} Change
 *   append: events[from..to) are new; seek: pos (and maybe state) changed
 */

/**
 * @typedef {object} Store
 * @property {object} header
 * @property {object[]} events every event so far, in log order (only appended)
 * @property {boolean} live
 * @property {number} pos playback position in ticks, with decimals
 * @property {number} index number of events applied to `state` (events with tick <= floor(pos))
 * @property {import('./reduce.js').State} state
 * @property {number} lastTick tick of the most recent event (start_tick when there is none)
 * @property {string|null} firstFact id of the first injected fact, or null
 * @property {(events: object[]) => void} append
 * @property {(pos: number) => void} seek
 * @property {(fn: ((pos: number) => import('./reduce.js').State) | null) => void} setStateAt
 * @property {(fn: (change: Change) => void) => () => void} subscribe returns the unsubscribe function
 * @property {(id: number) => object|undefined} turn the turn or plan event with that id
 * @property {(neighborId: string) => string|undefined} firstPlace place of the first move.from or conv_start.place seen
 * @property {(tick: number) => number} countUntil number of events with tick <= tick
 */

/**
 * Creates a store for a run.
 * @param {object} header
 * @param {{live?: boolean, pos?: number}} [opts] pos defaults to header.start_tick
 * @returns {Store}
 */
export function createStore(header, { live = false, pos } = {}) {
  const subscribers = new Set();
  const turns = new Map();
  const firstPlaces = new Map();
  let stateAt = null;

  const notify = (change) => {
    for (const fn of subscribers) fn(change);
  };

  /** Number of events with tick <= tick (binary search; events are in tick order). */
  const countUntil = (tick) => {
    const ev = store.events;
    let lo = 0;
    let hi = ev.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (ev[mid].tick <= tick) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  /** Brings store.state to store.pos with the simple method. */
  const simpleUpdate = () => {
    const tick = Math.floor(store.pos);
    if (tick < store.state.tick || (store.index > 0 && store.events[store.index - 1].tick > tick)) {
      store.state = initState(header);
      store.index = 0;
    }
    const ev = store.events;
    while (store.index < ev.length && ev[store.index].tick <= tick) reduce(store.state, ev[store.index++]);
    advance(store.state, tick);
  };

  const update = () => {
    if (stateAt) {
      store.state = stateAt(store.pos);
      store.index = countUntil(Math.floor(store.pos));
    } else {
      simpleUpdate();
    }
  };

  const store = {
    header,
    events: [],
    live,
    pos: pos ?? header.start_tick ?? 0,
    index: 0,
    state: initState(header),
    lastTick: header.start_tick ?? 0,
    firstFact: null,

    append(events) {
      if (!events.length) return;
      const from = store.events.length;
      let last = from ? store.events[from - 1].tick : -Infinity;
      for (const e of events) {
        if (e.tick < last) throw new Error(`store: event at tick ${e.tick} after tick ${last}`);
        last = e.tick;
        store.events.push(e);
        if (e.type === 'turn' || e.type === 'plan') turns.set(e.id, e);
        else if (e.type === 'move') {
          if (!firstPlaces.has(e.who)) firstPlaces.set(e.who, e.from);
        } else if (e.type === 'conv_start') {
          if (!firstPlaces.has(e.a)) firstPlaces.set(e.a, e.place);
          if (!firstPlaces.has(e.b)) firstPlaces.set(e.b, e.place);
        } else if (e.type === 'inject' && store.firstFact === null) store.firstFact = e.fact;
      }
      store.lastTick = last;
      if (events[0].tick <= Math.floor(store.pos)) update();
      notify({ type: 'append', from, to: store.events.length });
    },

    seek(p) {
      if (!Number.isFinite(p)) return;
      store.pos = p;
      update();
      notify({ type: 'seek' });
    },

    setStateAt(fn) {
      stateAt = fn;
      update();
    },

    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },

    turn(id) {
      return turns.get(id);
    },

    firstPlace(neighborId) {
      return firstPlaces.get(neighborId);
    },

    countUntil,
  };
  return store;
}
