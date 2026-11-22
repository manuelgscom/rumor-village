// Version of a rumor that a neighbor holds. Exact port of `version_of` in
// engine/src/metrics/metrics.cpp (the reach of the results card): if the
// engine changes, this changes with it.

/** The four slots of a fact, in their fixed order. */
export const SLOTS = ['who', 'where', 'when', 'amount'];

/**
 * A slot "holds" a value when its state is sure or doubt.
 * @param {string|undefined} state
 * @returns {boolean}
 */
export function holds(state) {
  return state === 'sure' || state === 'doubt';
}

/**
 * Version of one neighbor's memory of a fact against the original.
 *   wrong       some held slot has a value other than the original
 *   incomplete  not wrong, but some slot the original has is not held
 *   correct     every slot the original has is held with its value
 * @param {Object<string, {state: string, value: (string|number|null)}>|undefined|null} memoryOfFact
 *   `neighbor.memory[factId]`: undefined when the neighbor does not know the fact
 * @param {{who?: any, where?: any, when?: any, amount?: any}} originalSlots `fact.slots` of the inject
 * @returns {'correct'|'incomplete'|'wrong'|null} null when the neighbor knows nothing of the fact
 */
export function versionOf(memoryOfFact, originalSlots) {
  if (!memoryOfFact) return null;
  let complete = true;
  for (const s of SLOTS) {
    const m = memoryOfFact[s];
    const original = originalSlots?.[s] ?? null;
    const held = !!m && holds(m.state) && m.value !== null && m.value !== undefined;
    if (held && m.value !== original) return 'wrong';
    if (original !== null && !held) complete = false;
  }
  return complete ? 'correct' : 'incomplete';
}

/**
 * Whether a neighbor knows a fact: from the moment an `inject` names it in
 * `to`, or it receives a not rejected `turn` with act `tell` (the definition of
 * engine/src/core/event.h). The reducer keeps it as the presence of
 * `memory[factId]`.
 * @param {{memory: object}|undefined} neighbor a neighbor of the state
 * @param {string} factId
 * @returns {boolean}
 */
export function informed(neighbor, factId) {
  return !!neighbor && neighbor.memory[factId] !== undefined;
}
