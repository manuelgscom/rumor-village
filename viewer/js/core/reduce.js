// The state of the village at a tick, built only from the log. `reduce`
// applies one event; `advance` moves the clock forward when no event does
// (trips end by timetable without an event). The state at a position `pos`
// is the result of every event with tick <= floor(pos), then advance(floor(pos)).
//
// The state holds plain data (Map, arrays, objects) and the event objects
// themselves, so structuredClone can copy it.

/**
 * @typedef {object} SlotMemory
 * @property {'sure'|'doubt'|'forgotten'} state
 * @property {string|number|null} value
 * @property {'told'|'forgot'|'doubt_dropped'|'inject'} cause
 * @property {number|null} turn id of the turn that caused it
 * @property {number} tick
 */

/**
 * @typedef {object} NeighborState
 * @property {string|null} place where it is; null while travelling and before its first event
 * @property {{from: string, to: string, start: number, arrive: number, fact: string|null}|null} trip
 * @property {string|null} conv active conversation id
 * @property {Object<string, Object<string, SlotMemory>>} memory by fact id, then slot;
 *   `memory[f]` exists (maybe empty) from the moment the neighbor knows fact f
 * @property {Object<string, object>} plan last `plan` event by fact id
 * @property {Object<string, object>} arrived first `arrive` event by fact id
 */

/**
 * @typedef {object} State
 * @property {number} tick
 * @property {Map<string, NeighborState>} neighbors
 * @property {Map<string, {id: string, a: string, b: string, place: string, start: number, turns: object[]}>} convs
 *   active conversations only
 * @property {Map<string, {id: string, what: string, text: string|null, slots: object, to: string[], tick: number}>} facts
 *   facts as injected (the original version)
 * @property {{who: string, place: string, fact: string, slot: number, tick: number}[]} arrivals
 * @property {object|null} perf last `perf` event
 * @property {object|null} ended the `end` event
 */

function newNeighbor() {
  return { place: null, trip: null, conv: null, memory: {}, plan: {}, arrived: {} };
}

/**
 * Empty state of a run, before any event.
 * @param {object} header
 * @returns {State}
 */
export function initState(header) {
  const neighbors = new Map();
  for (const n of header.neighbors ?? []) neighbors.set(n.id, newNeighbor());
  return {
    tick: header.start_tick ?? 0,
    neighbors,
    convs: new Map(),
    facts: new Map(),
    arrivals: [],
    perf: null,
    ended: null,
  };
}

function neighbor(state, id) {
  let n = state.neighbors.get(id);
  if (!n) {
    n = newNeighbor();
    state.neighbors.set(id, n);
  }
  return n;
}

function know(state, id, fact) {
  const n = neighbor(state, id);
  if (!n.memory[fact]) n.memory[fact] = {};
}

/**
 * Sets the clock and ends the trips that have arrived by then.
 * @param {State} state
 * @param {number} tick integer tick
 * @returns {State}
 */
export function advance(state, tick) {
  if (tick === state.tick) return state;
  state.tick = tick;
  for (const n of state.neighbors.values()) {
    if (n.trip && tick >= n.trip.arrive) {
      n.place = n.trip.to;
      n.trip = null;
    }
  }
  return state;
}

/**
 * Applies one event (mutates the state).
 * @param {State} state
 * @param {object} e an event of format 1
 * @returns {State} the same state
 */
export function reduce(state, e) {
  advance(state, e.tick);
  switch (e.type) {
    case 'move': {
      const n = neighbor(state, e.who);
      n.trip = { from: e.from, to: e.to, start: e.tick, arrive: e.arrive, fact: e.fact };
      n.place = null;
      if (e.tick >= e.arrive) {
        n.place = e.to;
        n.trip = null;
      }
      break;
    }
    case 'inject':
      state.facts.set(e.fact, { id: e.fact, what: e.what, text: e.text, slots: e.slots, to: e.to, tick: e.tick });
      for (const id of e.to) know(state, id, e.fact);
      break;
    case 'conv_start':
      state.convs.set(e.conv, { id: e.conv, a: e.a, b: e.b, place: e.place, start: e.tick, turns: [] });
      for (const id of [e.a, e.b]) {
        const n = neighbor(state, id);
        n.conv = e.conv;
        if (!n.trip) n.place = e.place;
      }
      break;
    case 'turn': {
      state.convs.get(e.conv)?.turns.push(e);
      if (e.reject === null && e.action === 'say' && e.act === 'tell' && e.fact) know(state, e.to, e.fact);
      break;
    }
    case 'conv_end': {
      const c = state.convs.get(e.conv);
      if (c) {
        for (const id of [c.a, c.b]) {
          const n = neighbor(state, id);
          if (n.conv === e.conv) n.conv = null;
        }
        state.convs.delete(e.conv);
      }
      break;
    }
    case 'memory': {
      const n = neighbor(state, e.who);
      if (!n.memory[e.fact]) n.memory[e.fact] = {};
      n.memory[e.fact][e.slot] = { state: e.state, value: e.value, cause: e.cause, turn: e.turn, tick: e.tick };
      break;
    }
    case 'plan':
      if (e.fact) neighbor(state, e.who).plan[e.fact] = e;
      break;
    case 'arrive': {
      const a = { who: e.who, place: e.place, fact: e.fact, slot: e.slot, tick: e.tick };
      state.arrivals.push(a);
      const n = neighbor(state, e.who);
      if (!n.arrived[e.fact]) n.arrived[e.fact] = a;
      n.place = e.place;
      n.trip = null;
      break;
    }
    case 'perf':
      state.perf = e;
      break;
    case 'end':
      state.ended = e;
      break;
    default:
      break;
  }
  return state;
}
