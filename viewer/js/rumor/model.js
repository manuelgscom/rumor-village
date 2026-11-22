// What the rumor panels show at one playback position, in one object:
// versions, tree, groups, and the chain and card (person) of the selected
// neighbor or the culprits of the selected group. A pure function of the
// history up to `idx` and the state.

import { chainOf, chainPaths, leadSlot } from './chain.js';
import { culpritsOf, GROUP_KEYS, groupsAt } from './groups.js';
import { beliefOf, toldTo } from './person.js';
import { treeAt, versionsAt } from './tree.js';

/**
 * @param {object} o
 * @param {ReturnType<import('./history.js').createHistory>} o.h
 * @param {import('../core/reduce.js').State} o.state the state at idx
 * @param {number} o.idx store.index
 * @param {number} o.tick floor of the playback position
 * @param {string|null} o.fact
 * @param {string[]} o.ids every neighbor id
 * @param {string|null} [o.select] selected neighbor
 * @param {string|null} [o.group] selected group key
 * @param {string|null} [o.lead] slot asked for the chain (null: the default one)
 */
export function buildModel({ h, state, idx, tick, fact, ids, select = null, group = null, lead = null }) {
  const versions = versionsAt(state, fact, ids);
  const inj = fact ? h.inject(fact, idx) : undefined;
  const m = {
    fact: inj ? { id: fact, what: inj.e.what, slots: inj.e.slots, tick: inj.e.tick } : null,
    versions,
    select,
    chain: null,
    paths: [],
    groups: null,
    group: GROUP_KEYS.includes(group) ? group : null,
    culprits: null,
    tree: null,
    person: null,
  };
  if (!inj) return m;
  m.tree = treeAt(h, fact, idx, ids);
  m.groups = groupsAt(h, fact, idx, tick, ids);
  if (select) {
    m.person = {
      belief: beliefOf(state.neighbors.get(select)?.memory[fact], inj.e.slots),
      from: h.informed(select, fact, idx) ?? null,
      told: toldTo(h, select, fact, idx),
    };
  }
  if (select && h.informed(select, fact, idx)) {
    m.paths = chainPaths(h, select, fact, idx);
    const l = lead && m.paths.some((p) => p.slots.includes(lead)) ? lead : leadSlot(h, select, fact, inj.e.slots, idx);
    m.chain = chainOf(h, select, fact, idx, l);
  }
  if (m.group && m.group !== 'right') m.culprits = culpritsOf(h, fact, m.groups[m.group], m.group, idx);
  return m;
}
