// Ranking of gossips, as of a log position. Pure: no DOM. See README.md.
//
//   h.tellsBefore(fact) ── by speaker ──► tells    (times they told it)
//   h.informed(who).from ── by speaker ──► firsts   (neighbors who learned it from them)
//   summary.changes ───── by speaker ──► changes  (slots they changed, by turn)
//                                        affected (neighbors who hold one of them)

/**
 * @typedef {object} Teller
 * @property {string} who
 * @property {number} tells valid `tell` turns about the fact
 * @property {number} firsts neighbors who first heard the fact from them
 */

/**
 * @typedef {object} Distorter
 * @property {string} who
 * @property {number} changes changes (turn, slot) they introduced that someone still holds
 * @property {number} affected distinct neighbors who hold one of those changes
 */

/**
 * @typedef {object} Ranking
 * @property {Teller[]} tellers most tells first, then most firsts, then id
 * @property {Distorter[]} distorters most affected first, then most changes, then id
 */

const byId = (a, b) => (a.who < b.who ? -1 : a.who > b.who ? 1 : 0);

/**
 * Ranking as of position idx.
 * @param {ReturnType<typeof import('../rumor/history.js').createHistory>} h
 * @param {object} header
 * @param {number} idx number of events that count (events[0..idx))
 * @param {{fact: string|null, changes: import('./build.js').Change[]}} summary
 * @returns {Ranking}
 */
export function rankingAt(h, header, idx, summary) {
  const out = { tellers: [], distorters: [] };
  const fact = summary.fact;
  if (fact === null || fact === undefined) return out;

  const tellers = new Map();
  const teller = (who) => {
    let t = tellers.get(who);
    if (!t) tellers.set(who, (t = { who, tells: 0, firsts: 0 }));
    return t;
  };
  for (const { e } of h.tellsBefore(fact, idx)) teller(e.who).tells++;
  for (const n of header.neighbors ?? []) {
    const from = h.informed(n.id, fact, idx)?.from;
    if (from) teller(from).firsts++;
  }
  out.tellers = [...tellers.values()].sort((a, b) => b.tells - a.tells || b.firsts - a.firsts || byId(a, b));

  const distorters = new Map();
  for (const c of summary.changes) {
    let d = distorters.get(c.who);
    if (!d) distorters.set(c.who, (d = { who: c.who, changes: 0, people: new Set() }));
    d.changes++;
    for (const who of c.affected) d.people.add(who);
  }
  out.distorters = [...distorters.values()]
    .map((d) => ({ who: d.who, changes: d.changes, affected: d.people.size }))
    .sort((a, b) => b.affected - a.affected || b.changes - a.changes || byId(a, b));
  return out;
}
