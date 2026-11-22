// Package E of phase 9: «¿Qué pensó?» (docs/juego.md). Clicking a neighbor
// shows its decisions in plain words: With AI, the card it read, the action
// and the verdict; Without AI, the rule and the dice. Live it asks GET card of
// `rumor play`; in «Mis partidas» (?game=<id>), the same route with the game
// id. When the engine has no card for it, only what the log keeps is said.
//
//   #inspect (right column, a card; empty = hidden by core.css)
//
//   closed:  [ ¿Qué pensó Elena?  › ]
//
//   open:    ┌ ¿QUÉ PENSÓ? · Elena ───── Con IA ✕ ┐
//            │ 21:30 Le contó a Luis: fiesta · …  ▸│  newest first,
//            │ 21:28 Saludó a Luis                ▾│  as of the position
//            │   LO QUE LEYÓ   ▸ Ver la ficha…     │
//            │   LO QUE DECIDIÓ …  «texto»         │
//            │   LO COMPROBÓ EL JUEGO dónde plaza ·│
//            │     lo contó tal cual               │
//            └─────────────────────────────────────┘
//
// Only in the game mode (?play=1 or ?game=). ?select=n001&open=inspect opens
// it on that neighbor with the newest decision unfolded (captures).
//
//   bus in: 'select' {neighbor}
//           'inspect' {neighbor, turn?}  open on that neighbor, the decision with
//           event id `turn` unfolded (the newest without it; phase 9-3, the guided game)
//
// The texts are inspect/plain.js (pure); this file is only the DOM.

import { clockOf } from '../core/clock.js';
import { pick } from '../core/lang.js';
import { neighborName } from '../core/names.js';
import { createApi } from '../live/api.js';
import { el } from '../rumor/dom.js';
import { fill } from '../rumor/strings.js';
import { decisionsOf, decisionLine, explain, isBad, splitDecisions } from './plain.js';
import { STRINGS } from './strings.js';

/** Decisions listed at most (the rest is counted). */
const MAX_ITEMS = 40;

/**
 * Starts the package. Called once, with the header known and before any event.
 * @param {object} app see viewer/js/core/app.js
 */
export function init(app) {
  if (!app.params.play && !app.params.game) return;
  const { store, header, bus } = app;
  const root = app.zones.inspect;
  if (!root) return;
  const t = pick(STRINGS, app.lang);
  const api = createApi();
  const game = app.params.game ?? null;
  const facts = new Map();
  const injectOf = (fact) => {
    if (!fact) return null;
    if (!facts.has(fact)) {
      const inj = store.events.find((x) => x.type === 'inject' && x.fact === fact);
      if (!inj) return null;
      facts.set(fact, inj);
    }
    return facts.get(fact);
  };
  const ctx = {
    header,
    lang: app.lang,
    t,
    whatOf: (fact) => injectOf(fact)?.what ?? null,
    slotsOf: (fact) => injectOf(fact)?.slots ?? null,
  };
  const time = (tick) => clockOf(tick, header.start_weekday ?? 0, app.lang).time;
  const ids = new Set((header.neighbors ?? []).map((n) => n.id));

  let who = null;
  let open = false;
  let unfoldNewest = false;
  /** The turn id to unfold once it is listed (bus 'inspect'), or null. */
  let unfoldTurn = null;
  let shownKey = '';
  /** Rows by event position, kept between renders (their state survives). */
  let rows = new Map();
  /** Answers of GET /card by "tick|who": a promise of the body or null. */
  const cards = new Map();

  const cardOf = (e) => {
    const k = `${e.tick}|${e.who}`;
    if (!cards.has(k)) {
      cards.set(
        k,
        api.card({ game, tick: e.tick, who: e.who }).then((r) => (r.ok ? r.body : null)),
      );
    }
    return cards.get(k);
  };

  const section = (title, ...body) => {
    const s = el('div', 'in-sec');
    s.append(el('div', 'in-h', title), ...body);
    return s;
  };

  /**
   * The body of an unfolded decision, from the event and the card answer.
   * What matters first (phase 9-5): Without AI the dice and the rule, then
   * what it decided; With AI what it decided and what the game checked, and
   * the card it read last.
   */
  const bodyOf = (e, card) => {
    const x = explain(e, card, ctx);
    const out = [];
    if (x.policy === 'baseline' && x.card && x.rule) {
      const dice = x.rolls.length ? el('ul', 'in-rolls') : el('div', 'in-note', t.noDice);
      for (const r of x.rolls) dice.append(el('li', null, r));
      out.push(section(t.dice, dice));
      out.push(section(t.rule, el('div', 'in-line', x.rule)));
    }
    const decided = [el('div', 'in-line', x.line)];
    if (x.said) decided.push(el('div', 'in-said', x.said));
    if (x.reject) decided.push(el('div', 'in-bad', x.reject));
    out.push(section(t.decided, ...decided));
    if (x.verdicts.length || x.conflicts) {
      const list = el('ul', 'in-verdicts');
      for (const v of x.verdicts) {
        const tone = v.bad ? ' in-v-bad' : v.verdict === 'omitted' ? ' in-v-muted' : v.verdict === 'hardened_doubt' ? ' in-v-warn' : '';
        const li = el('li', `in-v${tone}`);
        li.append(el('span', 'in-slot', v.label), el('span', 'in-val', v.value || '—'), el('span', 'in-vtext', v.text));
        list.append(li);
      }
      const extra = x.conflicts ? [el('div', 'in-note', x.conflicts)] : [];
      out.push(section(t.engine, ...(x.verdicts.length ? [list] : []), ...extra));
    }
    if (x.read) {
      const d = el('details', 'in-read');
      d.append(el('summary', null, t.readShow), el('pre', 'in-card', x.read));
      out.push(section(t.read, d));
    }
    if (!x.card) out.push(el('div', 'in-note', t.noCard));
    return out;
  };

  /** Brings an unfolded decision into view, its top first. */
  const reveal = (row) => row.item.scrollIntoView?.({ block: 'start', behavior: app.reducedMotion() ? 'auto' : 'smooth' });

  const fillBody = (row, show = false) => {
    if (row.filled) {
      if (show) reveal(row);
      return;
    }
    row.filled = true;
    row.body.replaceChildren(el('div', 'in-note', t.loading));
    const put = (card) => {
      row.body.replaceChildren(...bodyOf(row.e, card));
      if (show) reveal(row);
    };
    cardOf(row.e).then(put, () => put(null));
  };

  /** Unfolds or folds a row; `show` (asked by the guide or the URL) brings it into view. */
  const setOpen = (row, on, show = false) => {
    row.btn.setAttribute('aria-expanded', String(on));
    row.item.classList.toggle('in-open', on);
    row.chev.textContent = on ? '▾' : '▸';
    row.body.hidden = !on;
    if (on) fillBody(row, show);
  };
  /** The greetings and goodbyes, folded in one line until asked for. */
  let showSmall = false;

  const rowOf = ({ i, e }) => {
    let row = rows.get(i);
    if (row && row.e === e) return row;
    const item = el('li', isBad(e) ? 'in-item in-item-bad' : 'in-item');
    const btn = /** @type {HTMLButtonElement} */ (el('button', 'in-row'));
    btn.type = 'button';
    const chev = el('span', 'in-chev', '▸');
    btn.append(el('span', 'in-time', time(e.tick)), el('span', 'in-sum', decisionLine(e, ctx)), chev);
    const body = el('div', 'in-body');
    body.hidden = true;
    item.append(btn, body);
    row = { i, e, item, btn, body, chev, filled: false };
    btn.setAttribute('aria-expanded', 'false');
    btn.onclick = () => setOpen(row, body.hidden);
    return row;
  };

  const head = () => {
    const h = el('div', 'in-head');
    h.append(el('span', 'in-title', t.title), el('span', 'in-who', neighborName(header, who)));
    const ai = header.policy === 'model';
    h.append(el('span', ai ? 'in-mode in-mode-ai' : 'in-mode', ai ? t.modeAi : t.modeRules));
    const x = /** @type {HTMLButtonElement} */ (el('button', 'in-close', '✕'));
    x.type = 'button';
    x.title = t.close;
    x.setAttribute('aria-label', t.close);
    x.onclick = () => {
      open = false;
      render();
    };
    h.append(x);
    return h;
  };

  let list = null;

  const render = () => {
    shownKey = '';
    if (!who) {
      rows = new Map();
      list = null;
      root.replaceChildren();
      return;
    }
    if (!open) {
      list = null;
      const b = /** @type {HTMLButtonElement} */ (el('button', 'in-open-btn'));
      b.type = 'button';
      b.append(el('span', 'in-open-text', fill(t.open, { name: neighborName(header, who) })), el('span', 'in-chev', '›'));
      b.onclick = () => {
        open = true;
        render();
      };
      root.replaceChildren(b);
      return;
    }
    list = el('ul', 'in-list');
    root.replaceChildren(head(), list);
    refresh();
  };

  /** The list as of the position; rows are reused, so what is unfolded stays. */
  const refresh = () => {
    if (!list || !who) return;
    const key = `${store.index}|${who}`;
    if (key === shownKey) return;
    shownKey = key;
    const every = decisionsOf(store.events, store.index, who);
    const all = every.slice(0, MAX_ITEMS);
    const total = every.length;
    // What matters first; greetings and goodbyes folded in one line (phase 9-5).
    const { main, small } = splitDecisions(all);
    if (unfoldTurn !== null && small.some((x) => x.e.id === unfoldTurn)) showSmall = true;
    const shown = showSmall ? [...main, ...small] : main;
    const next = new Map();
    const items = [];
    for (const d of shown) {
      const row = rowOf(d);
      next.set(d.i, row);
      items.push(row.item);
    }
    rows = next;
    if (small.length && !showSmall) {
      const more = /** @type {HTMLButtonElement} */ (el('button', 'in-small', small.length === 1 ? t.smallTalkOne : fill(t.smallTalk, { n: small.length })));
      more.type = 'button';
      more.onclick = () => {
        showSmall = true;
        shownKey = '';
        refresh();
      };
      const li = el('li', 'in-note');
      li.append(more);
      items.push(li);
    }
    if (!total) items.push(el('li', 'in-note', t.empty));
    if (total > MAX_ITEMS) items.push(el('li', 'in-note', fill(t.more, { n: total - MAX_ITEMS })));
    list.replaceChildren(...items);
    if (unfoldTurn !== null && shown.length) {
      const d = shown.find((x) => x.e.id === unfoldTurn);
      unfoldTurn = null;
      if (d) setOpen(rows.get(d.i), true, true);
      else unfoldNewest = true;
    }
    if (unfoldNewest && shown.length) {
      unfoldNewest = false;
      setOpen(rows.get(shown[0].i), true, true);
    }
  };

  // ?select=…&open=inspect: open on that neighbor once, newest unfolded.
  const wanted = app.params.open === 'inspect' ? String(app.params.select ?? '').toLowerCase() : '';
  let fromUrl = !!wanted;
  const choose = (neighbor) => {
    const id = neighbor && ids.has(neighbor) ? neighbor : null;
    if (id === who) return;
    who = id;
    rows = new Map();
    showSmall = false;
    open = fromUrl && !!id && (id === wanted || neighborName(header, id).toLowerCase() === wanted);
    if (open) fromUrl = false;
    unfoldNewest = open;
    render();
  };
  bus.on('select', ({ neighbor } = {}) => choose(neighbor));
  bus.on('inspect', ({ neighbor, turn = null } = {}) => {
    const id = neighbor && ids.has(neighbor) ? neighbor : null;
    if (!id) return;
    if (id !== who) {
      who = id;
      rows = new Map();
      showSmall = false;
    }
    open = true;
    fromUrl = false;
    unfoldTurn = Number.isInteger(turn) ? turn : null;
    unfoldNewest = unfoldTurn === null;
    render();
  });
  // Live, package rumor emits the selection of the URL before this one starts.
  if (store.live && app.params.select) {
    const p = String(app.params.select).toLowerCase();
    choose((header.neighbors ?? []).find((n) => n.id === app.params.select || n.name.toLowerCase() === p)?.id ?? null);
  }

  app.onFrame(refresh);
}
