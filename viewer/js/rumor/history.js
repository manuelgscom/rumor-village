// Index of the log by event position, for package C. Built incrementally as
// events are appended (only appended, never changed), and queried "as of" a
// position `idx`: only events with position < idx count, so every answer is a
// function of store.events[0..idx) and rewinding needs no rebuild.
//
//   const h = createHistory();
//   h.ingest(store.events);                 // takes the events not seen yet
//   h.slotAt('n002', 'f1', 'when', idx)      // memory entry in force before idx
//
// Positions are indexes in store.events. A `turn` at position iT acts on the
// memory of its listener through the `memory` events that follow it (i > iT).

/**
 * @typedef {object} MemEntry
 * @property {number} i position of the `memory` event
 * @property {number} tick
 * @property {string} who
 * @property {string} slot
 * @property {'sure'|'doubt'|'forgotten'} state
 * @property {string|number|null} value
 * @property {'told'|'forgot'|'doubt_dropped'|'inject'} cause
 * @property {number|null} turn
 */

/**
 * @typedef {object} Inform how a neighbor first came to know a fact
 * @property {number} i position of the `inject` or `turn`
 * @property {number} tick
 * @property {string|null} from speaker; null for an inject
 * @property {number|null} turn turn id; null for an inject
 */

const key2 = (who, fact) => `${who}|${fact}`;
const key3 = (who, fact, slot) => `${who}|${fact}|${slot}`;

/** Whether a turn makes its listener know its fact (docs/contrato.md, section 6). */
export function isTell(e) {
  return e.type === 'turn' && e.reject === null && e.action === 'say' && e.act === 'tell' && !!e.fact;
}

/** Last element of a list sorted by `i` whose i < idx; undefined if none. */
function lastBefore(list, idx) {
  if (!list) return undefined;
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].i < idx) lo = mid + 1;
    else hi = mid;
  }
  return lo ? list[lo - 1] : undefined;
}

/**
 * Creates an empty history.
 */
export function createHistory() {
  /** @type {Map<string, MemEntry[]>} */
  const mem = new Map();
  /** @type {Map<string, Inform>} */
  const informs = new Map();
  /** @type {Map<number, number>} turn/plan id → position */
  const positions = new Map();
  /** @type {Map<string, {i: number, e: object}[]>} */
  const plans = new Map();
  /** @type {Map<string, {i: number, e: object}>} first arrive by neighbor and fact */
  const arrives = new Map();
  /** @type {Map<string, {i: number, e: object}>} inject by fact */
  const injects = new Map();
  /** @type {Map<string, {i: number, e: object}[]>} tells by fact, in log order */
  const tells = new Map();
  const events = [];

  const push = (map, key, item) => {
    let list = map.get(key);
    if (!list) map.set(key, (list = []));
    list.push(item);
  };

  const add = (e, i) => {
    events[i] = e;
    switch (e.type) {
      case 'inject':
        if (!injects.has(e.fact)) injects.set(e.fact, { i, e });
        for (const who of e.to ?? []) {
          const k = key2(who, e.fact);
          if (!informs.has(k)) informs.set(k, { i, tick: e.tick, from: null, turn: null });
        }
        break;
      case 'turn':
        positions.set(e.id, i);
        if (isTell(e)) {
          push(tells, e.fact, { i, e });
          const k = key2(e.to, e.fact);
          if (!informs.has(k)) informs.set(k, { i, tick: e.tick, from: e.who, turn: e.id });
        }
        break;
      case 'plan':
        positions.set(e.id, i);
        if (e.fact) push(plans, key2(e.who, e.fact), { i, e });
        break;
      case 'memory':
        push(mem, key3(e.who, e.fact, e.slot), {
          i,
          tick: e.tick,
          who: e.who,
          slot: e.slot,
          state: e.state,
          value: e.value,
          cause: e.cause,
          turn: e.turn,
        });
        break;
      case 'arrive': {
        const k = key2(e.who, e.fact);
        if (!arrives.has(k)) arrives.set(k, { i, e });
        break;
      }
      default:
        break;
    }
  };

  const h = {
    /** Number of events taken so far. */
    get size() {
      return events.length;
    },

    /**
     * Takes the events of `all` not seen yet (all[size..]).
     * @param {object[]} all store.events
     */
    ingest(all) {
      for (let i = events.length; i < all.length; i++) add(all[i], i);
    },

    /** Event at a position. */
    event: (i) => events[i],

    /** Position of a turn or plan by id. */
    position: (id) => positions.get(id),

    /** The inject of a fact if it is before idx. */
    inject(fact, idx) {
      const x = injects.get(fact);
      return x && x.i < idx ? x : undefined;
    },

    /**
     * Every memory entry of a slot before idx, in order.
     * @returns {MemEntry[]}
     */
    slotEntries(who, fact, slot, idx) {
      const list = mem.get(key3(who, fact, slot)) ?? [];
      const last = lastBefore(list, idx);
      return last ? list.slice(0, list.indexOf(last) + 1) : [];
    },

    /**
     * Memory entry of a slot in force just before idx.
     * @returns {MemEntry|undefined}
     */
    slotAt(who, fact, slot, idx) {
      return lastBefore(mem.get(key3(who, fact, slot)), idx);
    },

    /**
     * Last reception of a slot before idx: the last entry caused by `told` or
     * `inject` that holds a value (the engine's "received"), and the local
     * entries after it (forgot, doubt_dropped) up to idx.
     * @returns {{entry: MemEntry, after: MemEntry[]}|undefined}
     */
    reception(who, fact, slot, idx) {
      const list = mem.get(key3(who, fact, slot));
      if (!list) return undefined;
      const last = lastBefore(list, idx);
      if (!last) return undefined;
      for (let k = list.indexOf(last); k >= 0; k--) {
        const m = list[k];
        if ((m.cause === 'told' || m.cause === 'inject') && (m.state === 'sure' || m.state === 'doubt') && m.value !== null) {
          return { entry: m, after: list.slice(k + 1, list.indexOf(last) + 1) };
        }
      }
      return undefined;
    },

    /**
     * The memory entry that a turn left in its listener for a slot.
     * @returns {MemEntry|undefined}
     */
    entryOfTurn(who, fact, slot, turnId) {
      return (mem.get(key3(who, fact, slot)) ?? []).find((m) => m.turn === turnId);
    },

    /**
     * How a neighbor first came to know a fact, if before idx.
     * @returns {Inform|undefined}
     */
    informed(who, fact, idx) {
      const x = informs.get(key2(who, fact));
      return x && x.i < idx ? x : undefined;
    },

    /** The last plan of a neighbor about a fact before idx. */
    planBefore(who, fact, idx) {
      return lastBefore(plans.get(key2(who, fact)), idx);
    },

    /** The first arrive of a neighbor for a fact, if before idx. */
    arrival(who, fact, idx) {
      const x = arrives.get(key2(who, fact));
      return x && x.i < idx ? x : undefined;
    },

    /** Tells of a fact before idx, in log order. */
    tellsBefore(fact, idx) {
      const list = tells.get(fact) ?? [];
      const last = lastBefore(list, idx);
      return last ? list.slice(0, list.indexOf(last) + 1) : [];
    },
  };
  return h;
}
