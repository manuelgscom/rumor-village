// «¿Qué pensó?» in plain words (pure, no DOM): the decisions of a neighbor
// from the log, and what to say about one of them from its `turn` or `plan`
// event and the answer of GET /card (docs/arquitectura.md, «Modo juego»).
//
//   With AI (policy "model")         Without AI (policy "baseline")
//   ┌ Lo que leyó    the card     ┐  ┌ Lo que decidió  the event          ┐
//   │ Lo que decidió act · claim  │  │ La regla        the rule in words  │
//   └ Lo comprobó el juego  verdict ┘  └ El dado        each roll          ┘
//
// The card answer may be missing (a recording without the engine, a 404):
// then only what the log has is said, with a note.

import { neighborName, slotValueText, unitOf, whatName, claimSummary } from '../core/names.js';
import { gendered } from '../rumor/person.js';
import { fill, STRINGS as RUMOR } from '../rumor/strings.js';

/** Slots of a claim, in the order they are shown. */
const SLOTS = ['who', 'where', 'when', 'amount'];

/** Verdicts that are failures: the slot does not reach the listener. */
const BAD = new Set(['contradiction', 'invented']);

/**
 * @typedef {object} Ctx
 * @property {object} header
 * @property {'es'|'en'} lang
 * @property {object} t texts of inspect/strings.js, picked
 * @property {(fact: string|null) => string|null} whatOf the `what` key of a fact id
 * @property {(fact: string|null) => object|null} [slotsOf] the original slots of a
 *   fact (its inject): «se lo calló» is never said of a detail the rumor never had
 */

/** @type {WeakMap<object[], {n: number, by: Map<string, number[]>}>} */
const INDEXES = new WeakMap();

/**
 * The decisions (`turn` and `plan` events) of a neighbor before idx, newest
 * first. An index by neighbor is kept per events array (only appended).
 * @param {object[]} events store.events
 * @param {number} idx store.index
 * @param {string} who
 * @returns {{i: number, e: object}[]}
 */
export function decisionsOf(events, idx, who) {
  let ix = INDEXES.get(events);
  if (!ix || ix.n > events.length) INDEXES.set(events, (ix = { n: 0, by: new Map() }));
  for (; ix.n < events.length; ix.n++) {
    const e = events[ix.n];
    if (e.type !== 'turn' && e.type !== 'plan') continue;
    let list = ix.by.get(e.who);
    if (!list) ix.by.set(e.who, (list = []));
    list.push(ix.n);
  }
  const out = [];
  const list = ix.by.get(who) ?? [];
  for (let k = list.length - 1; k >= 0; k--) if (list[k] < idx) out.push({ i: list[k], e: events[list[k]] });
  return out;
}

/** Whether a decision is small talk: a greeting or a goodbye. */
export function isSmallTalk(e) {
  return e?.type === 'turn' && e.action === 'say' && !e.reject && (e.act === 'greet' || e.act === 'bye');
}

/**
 * The decisions as the list shows them (phase 9-5): the ones that matter
 * first (telling, asking, plans…), the greetings and goodbyes apart, to fold
 * in one line; each part keeps its order (newest first).
 * @param {{i: number, e: object}[]} list decisionsOf
 * @returns {{main: {i: number, e: object}[], small: {i: number, e: object}[]}}
 */
export function splitDecisions(list) {
  const main = [];
  const small = [];
  for (const d of list) (isSmallTalk(d.e) ? small : main).push(d);
  return { main, small };
}

/** Whether a decision failed: rejected, or a slot contradicted or invented. */
export function isBad(e) {
  return !!e.reject || Object.values(e.verdict ?? {}).some((v) => BAD.has(v));
}

/**
 * One line for the list: «Le contó a Luis: fiesta · plaza · 22:00?».
 * @param {object} e a `turn` or `plan` event
 * @param {Ctx} ctx
 * @returns {string}
 */
export function decisionLine(e, ctx) {
  const { header, lang, t } = ctx;
  const what = ctx.whatOf(e.fact);
  const label = what ? whatName(what, lang) : '';
  const to = e.to ? neighborName(header, e.to) : '';
  if (e.type === 'plan') {
    if (e.reject) return t.lines.planRejected;
    if (e.action === 'go') return fill(t.lines.go, { what: claimSummary(e.claim, header, what ?? undefined) || label });
    return fill(t.lines.stay, { what: label });
  }
  if (e.reject) return fill(t.lines.rejected, { to });
  if (e.action !== 'say') return fill(t.lines.none, { to });
  if (e.act === 'tell') return fill(t.lines.tell, { to, what: claimSummary(e.claim, header, what ?? undefined) || label });
  if (e.act === 'ask') return fill(t.lines.ask, { to, what: label });
  return fill(t.lines[e.act] ?? t.lines.none, { to });
}

/**
 * The verdict of each slot in words, with the value said.
 * @param {object} e
 * @param {Ctx} ctx
 * @returns {{slot: string, label: string, value: string, verdict: string, text: string, bad: boolean}[]}
 */
export function verdictRows(e, ctx) {
  const { header, lang, t } = ctx;
  if (!e.verdict) return [];
  const what = ctx.whatOf(e.fact);
  const unit = what ? unitOf(what, lang) : '';
  const guess = new Set(e.claim?.guess ?? []);
  const original = ctx.slotsOf?.(e.fact) ?? null;
  const out = [];
  for (const slot of SLOTS) {
    const v = e.verdict[slot];
    if (!v) continue;
    // Nothing to keep quiet: the rumor never had that detail.
    if (v === 'omitted' && original && (original[slot] === null || original[slot] === undefined)) continue;
    const raw = e.claim?.[slot];
    let value = raw === null || raw === undefined ? '' : slotValueText(slot, raw, header);
    if (value && slot === 'amount' && unit) value += ` ${unit}`;
    if (value && guess.has(slot)) value += '?';
    const bad = BAD.has(v);
    const text = (t.verdicts[v] ?? v) + (bad ? ` · ${t.stopped}` : '');
    out.push({ slot, label: t.slots[slot] ?? slot, value, verdict: v, text, bad });
  }
  return out;
}

/**
 * A percentage of a chance in parts per million: «60 %», «12,5 %».
 * @param {number} ppm
 * @param {Ctx} ctx
 */
export function percent(ppm, ctx) {
  const n = Math.round(Number(ppm) / 1000) / 10;
  const s = ctx.lang === 'es' ? String(n).replace('.', ',') : String(n);
  return fill(ctx.t.percent, { n: s });
}

/** A chance in parts per million as a plain number: «89,5». */
function chanceNumber(ppm, ctx) {
  const n = Math.round(Number(ppm) / 1000) / 10;
  return ctx.lang === 'es' ? String(n).replace('.', ',') : String(n);
}

/**
 * Why telling it was likely, from the header: the character of the speaker
 * and what the listener is to them: « (cotilla, y es su amiga)».
 * @param {object|null} e the decision (who, to)
 * @param {Ctx} ctx
 */
function tellWhy(e, ctx) {
  const { header, t } = ctx;
  const who = (header?.neighbors ?? []).find((n) => n.id === e?.who);
  if (!who) return '';
  const trait = gendered(RUMOR[ctx.lang === 'es' ? 'es' : 'en'].traits, who.trait, who.gender);
  const to = (header?.neighbors ?? []).find((n) => n.id === e?.to);
  const r = to ? (header?.relations ?? []).find((x) => (x.a === who.id && x.b === to.id) || (x.b === who.id && x.a === to.id)) : null;
  const rel = r ? gendered(t.rel, r.type, to.gender) : '';
  return rel && rel !== r.type ? fill(t.whyRel, { trait, rel }) : fill(t.why, { trait });
}

/**
 * One roll of the dice in words: «Probabilidad de contarlo: 60 % (cotilla, y
 * es su amiga). Salió 23: lo contó»; at 100 %, «Lo contaba seguro (cotilla, y
 * es su amiga)»; the pick of a rumor as «Qué contar: uno de 2, al azar». The
 * why (character and relationship) only for telling, with the decision `e`.
 * @param {{name: string, chance_ppm: number, roll_ppm: number, hit: boolean}} r
 * @param {Ctx} ctx
 * @param {object|null} [e] the decision the roll belongs to
 * @returns {string}
 */
export function rollText(r, ctx, e = null) {
  const { t } = ctx;
  if (r.name === 'pick_fact') {
    const name = t.rollNames[r.name] ?? r.name;
    const n = r.chance_ppm > 0 ? Math.round(1e6 / r.chance_ppm) : 1;
    return n <= 1 ? fill(t.pickOne, { name }) : fill(t.pick, { name, n });
  }
  const why = r.name === 'tell' && e ? tellWhy(e, ctx) : '';
  if (Number(r.chance_ppm) >= 1e6) return fill(t.rollSure, { sure: t.sure[r.name] ?? t.sure.other, why });
  const [yes, no] = t.results[r.name] ?? t.results.other;
  const name = t.chanceOf[r.name] ?? t.rollNames[r.name] ?? r.name;
  return fill(t.roll, { name, need: percent(r.chance_ppm, ctx), why, got: chanceNumber(r.roll_ppm, ctx), result: r.hit ? yes : no });
}

/**
 * The rule of a decision without AI in words.
 * @param {string} rule
 * @param {Ctx} ctx
 */
export function ruleText(rule, ctx) {
  return ctx.t.rules[rule] ?? fill(ctx.t.unknownRule, { rule });
}

/**
 * @typedef {object} Explained
 * @property {'model'|'baseline'} policy
 * @property {string} mode «Con IA» or «Sin IA»
 * @property {boolean} card the answer of GET /card is there (else only the log)
 * @property {string|null} read the card the AI read (with AI)
 * @property {string} line what it decided, in one line
 * @property {string|null} said the text of its bubble, quoted
 * @property {{slot: string, label: string, value: string, verdict: string, text: string, bad: boolean}[]} verdicts (with AI)
 * @property {string|null} reject why the engine rejected it
 * @property {string|null} conflicts the slots the listener kept
 * @property {string|null} rule (without AI)
 * @property {string[]} rolls (without AI)
 */

/**
 * Everything «¿Qué pensó?» says about one decision.
 * @param {object} e the `turn` or `plan` event
 * @param {object|null} card body of GET /card (null: not available)
 * @param {Ctx} ctx
 * @returns {Explained}
 */
export function explain(e, card, ctx) {
  const { header, t } = ctx;
  // An answer for another decision (same tick, other kind) does not count.
  const ok = !!card && card.kind === e.type && card.who === e.who;
  const policy = (ok ? card.policy : header.policy) === 'model' ? 'model' : 'baseline';
  const ai = policy === 'model';
  const rule = ok && !ai && card.rule ? card.rule : null;
  return {
    policy,
    mode: ai ? t.modeAi : t.modeRules,
    card: ok,
    read: ok && ai && typeof card.card === 'string' && card.card ? card.card : null,
    line: decisionLine(e, ctx),
    said: e.text ? fill(t.said, { text: e.text }) : null,
    verdicts: ai ? verdictRows(e, ctx) : [],
    reject: e.reject ? fill(t.rejected, { why: t.rejects[e.reject] ?? e.reject }) : null,
    conflicts: e.conflicts?.length ? fill(t.conflicts, { to: neighborName(header, e.to), slots: e.conflicts.map((s) => t.slots[s] ?? s).join(', ') }) : null,
    rule: rule ? ruleText(rule.rule, ctx) : null,
    rolls: rule ? (rule.rolls ?? []).map((r) => rollText(r, ctx, e)) : [],
  };
}
