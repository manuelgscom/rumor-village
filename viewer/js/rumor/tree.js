// Who told whom: a tree from the inject, each informed neighbor under the
// speaker of the turn that first told it the fact (or under the inject), and
// its layout in two abstract axes: depth and order. Plus the count of each
// version. Pure functions.

import { versionOf } from '../core/version.js';

/**
 * @typedef {object} TreeNode
 * @property {string} id
 * @property {string|null} parent null under the inject
 * @property {number} i position of the event that informed it
 * @property {number} tick
 * @property {number|null} turn
 * @property {number} depth 1 for the inject recipients (the inject is depth 0)
 * @property {number} order position along the other axis (leaves 0, 1, 2…; parents in the middle)
 */

/**
 * Tree of a fact as of position idx.
 * @param {ReturnType<import('./history.js').createHistory>} h
 * @param {string} fact
 * @param {number} idx
 * @param {string[]} ids every neighbor id
 * @returns {{nodes: TreeNode[], byId: Map<string, TreeNode>, root: {order: number}, depth: number, leaves: number}|null}
 *   null before the inject
 */
export function treeAt(h, fact, idx, ids) {
  if (!h.inject(fact, idx)) return null;
  const byId = new Map();
  for (const id of ids) {
    const inf = h.informed(id, fact, idx);
    if (inf) byId.set(id, { id, parent: inf.from, i: inf.i, tick: inf.tick, turn: inf.turn, depth: 0, order: 0, children: [] });
  }
  const sorted = [...byId.values()].sort((a, b) => a.i - b.i);
  const roots = [];
  for (const n of sorted) {
    const p = n.parent ? byId.get(n.parent) : undefined;
    if (p && p.i < n.i) p.children.push(n);
    else {
      n.parent = null;
      roots.push(n);
    }
  }

  // Depth-first: leaves get consecutive orders, parents the middle of their children.
  let leaves = 0;
  let depth = 0;
  const stack = roots
    .slice()
    .reverse()
    .map((n) => ({ n, d: 1, done: false }));
  while (stack.length) {
    const top = stack.pop();
    const { n, d } = top;
    if (!top.done) {
      n.depth = d;
      depth = Math.max(depth, d);
      if (!n.children.length) {
        n.order = leaves++;
        continue;
      }
      stack.push({ n, d, done: true });
      for (let k = n.children.length - 1; k >= 0; k--) stack.push({ n: n.children[k], d: d + 1, done: false });
    } else {
      n.order = (n.children[0].order + n.children[n.children.length - 1].order) / 2;
    }
  }
  const root = { order: roots.length ? (roots[0].order + roots[roots.length - 1].order) / 2 : 0 };
  const nodes = sorted.map(({ children, ...rest }) => rest);
  return { nodes, byId: new Map(nodes.map((n) => [n.id, n])), root, depth, leaves: Math.max(1, leaves) };
}

/**
 * Version of every neighbor and how many in each, at a state.
 * @param {import('../core/reduce.js').State} state
 * @param {string|null} fact
 * @param {string[]} ids
 * @returns {{of: Map<string, 'correct'|'incomplete'|'wrong'|null>, counts: {correct: number, incomplete: number, wrong: number, unknown: number}}}
 */
export function versionsAt(state, fact, ids) {
  const original = fact ? state.facts.get(fact)?.slots : undefined;
  const of = new Map();
  const counts = { correct: 0, incomplete: 0, wrong: 0, unknown: 0 };
  for (const id of ids) {
    const v = original ? versionOf(state.neighbors.get(id)?.memory[fact], original) : null;
    of.set(id, v);
    counts[v ?? 'unknown']++;
  }
  return { of, counts };
}
