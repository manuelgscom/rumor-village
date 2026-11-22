// Package B of phase 6: summary card of the day. See viewer/js/summary/README.md.
//
//   #summary (top right of #stage)
//     [Resumen del día]            pill: opens and closes the card
//     ┌ card ───────────────── ✕ ┐
//     │ title                     │
//     │ [Resumen] [Quién lo contó] │  tabs: the summary or the ranking of gossips
//     │ fact · told               │
//     │ ███████▒▒▒░░  legend      │
//     │ Quién cambió qué          │  each change is a button:
//     │ · Luis cambió la hora …   │  'select' {neighbor: affected[0]} and fold
//     └───────────────────────────┘
//
//
//   «Quién lo contó» tab: two lists, each row a button ('select' of that neighbor and fold)
//     1 Carmen  ██████████  14 · 9     tells · firsts
//     1 Luis    ██████       6 · 2     affected · changes
//
// Opens with the pill and with ?summary=ranking (on 'loaded', or at once
// live), on the gossips tab. The full-screen card of the end of the day
// (final.js, phase 8-2) opens with ?summary=1, with the ⤢ button of this card
// and by itself the first time playback crosses the tick of the `end` event;
// during the story mode (<html data-only>) that crossing opens this card
// instead, as the story leaves room for it. In the game mode (<html
// data-game-phase>) neither opens by itself: the end card of the game comes first. Their content is the summary of
// the rumor followed (app.factId()) as of store.index, with its own history
// fed incrementally, and is recomputed only while a card is open. Figures
// count when they change (panel/count.js); gossips show their portrait
// (app.hooks.portrait) or their initials until it comes.
//
// Inside the game (?play=1 or ?game=, phase 9-5): the pill shows only once a
// rumor is spreading; until the game ends (the `end` event at the position)
// nothing tells who distorted it (no «Quién cambió qué», no «Quién lo deformó
// más»); the full-screen card has no «Otra grabación», «Comparar» nor
// «Repositorio» (final.js).
//
//   bus in: 'summary-open' (no payload)  opens the full-screen card of the day
//           (the «Ver el resumen del día» of the end card of the game)

import { pick } from '../core/lang.js';
import { neighborInitials, neighborName } from '../core/names.js';
import { inGame, isCapture } from '../core/params.js';
import { createCounters } from '../panel/count.js';
import { versionColor } from '../core/theme.js';
import { createHistory } from '../rumor/history.js';
import { fill } from '../rumor/strings.js';
import { changeLine, summaryAt } from './build.js';
import { createFinal } from './final.js';
import { STRINGS } from './strings.js';

const MAX_CHANGES = 5;
/** Longest wait of a capture for the portraits of an open card, in ms. */
const SETTLE_MS = 30000;
const MAX_RANK = 5;
const TABS = ['summary', 'ranking'];
const KEYS = ['correct', 'incomplete', 'wrong', 'unknown'];

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/**
 * Starts the package. Called once, with the header known and before any event.
 * @param {object} app see viewer/js/core/app.js
 */
export function init(app) {
  if (app.params.embed) return;
  const { store, header, bus } = app;
  const root = app.zones.summary;
  if (!root) return;
  const t = pick(STRINGS, app.lang);
  const h = createHistory();
  const game = inGame(app.params);
  /** Inside the game, until it ends: nothing that says who distorted the rumor. */
  const secret = () => game && !store.state?.ended;

  // DOM, built once; render() only patches it.
  root.replaceChildren();
  root.classList.add('sm-zone');
  const pill = el('button', 'sm-pill', t.pill);
  pill.type = 'button';
  const card = el('section', 'sm-card');
  card.hidden = true;
  const head = el('div', 'sm-head');
  const title = el('div', 'sm-title');
  const close = el('button', 'sm-x', '✕');
  close.type = 'button';
  close.title = t.close;
  close.setAttribute('aria-label', t.close);
  const expand = el('button', 'sm-x sm-expand', '⤢');
  expand.type = 'button';
  expand.title = t.expand;
  expand.setAttribute('aria-label', t.expand);
  head.append(title, expand, close);
  const tabs = el('div', 'sm-tabs');
  tabs.setAttribute('role', 'tablist');
  const tabButtons = {};
  for (const k of TABS) {
    const b = el('button', 'sm-tab', t.tabs[k]);
    b.type = 'button';
    b.dataset.tab = k;
    b.setAttribute('role', 'tab');
    tabs.append(b);
    tabButtons[k] = b;
  }
  const main = el('div', 'sm-view');
  const rank = el('div', 'sm-view sm-ranks');
  const fact = el('div', 'sm-fact');
  const told = el('div', 'sm-told');
  const bar = el('div', 'sm-bar');
  const legend = el('div', 'sm-legend');
  const segs = {};
  const counts = {};
  for (const k of KEYS) {
    const seg = el('i', `sm-seg sm-seg-${k}`);
    seg.style.background = versionColor(k === 'unknown' ? null : k);
    bar.append(seg);
    segs[k] = seg;
    const item = el('span', 'sm-key');
    const sw = el('i', 'sm-swatch');
    sw.style.background = versionColor(k === 'unknown' ? null : k);
    const n = el('b');
    item.append(sw, el('span', null, t.versions[k]), n);
    legend.append(item);
    counts[k] = n;
  }
  const changed = el('div', 'sm-changed');
  const list = el('div', 'sm-list');
  main.append(fact, told, bar, legend, changed, list);
  card.append(head, tabs, main, rank);
  root.append(pill, card);

  let open = false;
  let tab = 'summary';
  const counters = createCounters(app);
  // Neighbors shown with initials while their portrait is not in: who → faces.
  const faces = new Map();
  const portrait = (who) => {
    try {
      return app.hooks.portrait?.(who) ?? null;
    } catch {
      return null;
    }
  };
  const faceOf = (who) => {
    const f = el('span', 'sm-face');
    const url = portrait(who);
    if (url) {
      const img = el('img');
      img.alt = '';
      img.src = url;
      f.append(img);
    } else {
      f.append(el('span', 'sm-initials', neighborInitials(header, who)));
      faces.set(who, [...(faces.get(who) ?? []), f]);
    }
    return f;
  };
  let rankKey = null;
  try {
    if (new URLSearchParams(location.search).get('summary') === 'ranking') tab = 'ranking';
  } catch {
    // No location (tests): the default tab.
  }

  const setTab = (k) => {
    tab = k;
    for (const x of TABS) {
      tabButtons[x].classList.toggle('on', x === k);
      tabButtons[x].setAttribute('aria-selected', String(x === k));
    }
    main.hidden = k !== 'summary';
    rank.hidden = k !== 'ranking';
  };
  setTab(tab);

  // One list of the ranking: rows are buttons with a bar relative to the first.
  const rankList = (titleText, hint, rows, emptyText, color, titleTemplate) => {
    const box = el('div', 'sm-rank-box');
    box.append(el('div', 'sm-subhead', titleText));
    if (!rows.length) {
      box.append(el('div', 'sm-dim', emptyText));
      return box;
    }
    box.append(el('div', 'sm-dim sm-hint', hint));
    const max = Math.max(1, rows[0].a);
    const ol = el('ol', 'sm-rank-list');
    rows.slice(0, MAX_RANK).forEach((r, k) => {
      const name = neighborName(header, r.who);
      const li = el('li');
      const b = el('button', 'sm-rank');
      b.type = 'button';
      b.dataset.neighbor = r.who;
      b.title = `${fill(titleTemplate, { name, a: r.a, b: r.b })} · ${fill(t.showNeighbor, { name })}`;
      const track = el('span', 'sm-rank-track');
      const bar = el('i', 'sm-rank-bar');
      bar.style.width = `${(100 * r.a) / max}%`;
      bar.style.background = color;
      track.append(bar);
      b.append(el('span', 'sm-rank-pos', String(k + 1)), faceOf(r.who), el('span', 'sm-rank-name', name), track);
      b.append(el('span', 'sm-rank-n', `${r.a} · ${r.b}`));
      li.append(b);
      ol.append(li);
    });
    box.append(ol);
    if (rows.length > MAX_RANK) box.append(el('div', 'sm-dim sm-more', fill(t.more, { n: rows.length - MAX_RANK })));
    return box;
  };

  const renderRanking = (s) => {
    const has = s.fact !== null;
    const hide = secret();
    const tellers = s.ranking.tellers.map((x) => ({ who: x.who, a: x.tells, b: x.firsts }));
    const distorters = hide ? [] : s.ranking.distorters.map((x) => ({ who: x.who, a: x.affected, b: x.changes }));
    const key = `${has}|${hide}|${JSON.stringify([tellers, distorters])}`;
    if (key === rankKey) return;
    rankKey = key;
    faces.clear();
    rank.replaceChildren();
    if (!has) {
      rank.append(el('div', 'sm-dim', t.noFact));
      return;
    }
    rank.append(rankList(t.tellers, t.tellersHint, tellers, t.noTellers, 'var(--accent)', t.tellerTitle));
    if (!hide) rank.append(rankList(t.distorters, t.distortersHint, distorters, t.noDistorters, versionColor('wrong'), t.distorterTitle));
  };
  let shownKey = null;
  let summary = null;
  let summaryKey = '';
  let listKey = '';

  const current = () => {
    h.ingest(store.events);
    const fact = app.factId();
    const key = `${store.index}|${fact}`;
    if (key !== summaryKey || !summary) {
      summaryKey = key;
      summary = summaryAt(h, header, store.index, app.lang, fact);
    }
    return summary;
  };

  const render = (s) => {
    const [titleLine, factLine, toldLine] = s.lines;
    title.textContent = titleLine;
    renderRanking(s);
    const has = s.fact !== null;
    fact.textContent = has ? factLine : '';
    told.textContent = has ? toldLine : factLine;
    told.classList.toggle('sm-none', !has);
    for (const n of [fact, bar, legend, changed]) n.hidden = !has;
    if (has) {
      const v = { correct: s.correct, incomplete: s.incomplete, wrong: s.wrong, unknown: Math.max(0, s.total - s.told) };
      const total = Math.max(1, s.total);
      for (const k of KEYS) {
        segs[k].style.width = `${(100 * v[k]) / total}%`;
        counters.set(counts[k], v[k]);
      }
      changed.textContent = fill(t.changed, { changed: s.changed });
    }

    // The list is rebuilt only when its text changes, so a button under the
    // pointer survives playback.
    const hide = secret();
    const lines = has && !hide ? s.changes.map((c) => changeLine(c, header, t)) : [];
    const key = `${has}|${hide}|${lines.join('\n')}|${s.unexplained.map((u) => u.who).join(',')}`;
    if (key === listKey) return;
    listKey = key;
    list.replaceChildren();
    if (!has || hide) return;
    if (!s.changes.length) {
      list.append(el('div', 'sm-dim', t.noChanges));
    } else {
      list.append(el('div', 'sm-subhead', t.whoChanged));
      const ul = el('ul', 'sm-changes');
      s.changes.slice(0, MAX_CHANGES).forEach((c, k) => {
        const li = el('li');
        const b = el('button', 'sm-change', lines[k]);
        b.type = 'button';
        b.dataset.neighbor = c.affected[0];
        b.title = fill(t.showChain, { name: neighborName(header, c.affected[0]) });
        const sw = el('i', 'sm-swatch');
        sw.style.background = versionColor('wrong');
        b.prepend(sw);
        li.append(b);
        ul.append(li);
      });
      list.append(ul);
      if (s.changes.length > MAX_CHANGES) {
        list.append(el('div', 'sm-dim sm-more', fill(t.more, { n: s.changes.length - MAX_CHANGES })));
      }
    }
    if (s.unexplained.length) {
      const names = [...new Set(s.unexplained.map((u) => neighborName(header, u.who)))].join(', ');
      list.append(el('div', 'sm-dim', fill(t.unexplained, { names })));
    }
  };

  const setOpen = (v) => {
    open = v;
    card.hidden = !v;
    pill.classList.toggle('on', v);
    pill.setAttribute('aria-expanded', String(v));
    if (v) {
      shownKey = null;
      app.requestDraw();
    }
  };

  const final = createFinal(app, {
    summary: current,
    history: h,
    counters,
    select: (neighbor) => bus.emit('select', { neighbor }),
  });
  const openFinal = () => {
    setOpen(false);
    final.open();
  };

  pill.addEventListener('click', () => setOpen(!open));
  bus.on('summary-open', () => openFinal());
  expand.addEventListener('click', openFinal);
  close.addEventListener('click', () => setOpen(false));
  tabs.addEventListener('click', (ev) => {
    const b = ev.target.closest('.sm-tab');
    if (b) setTab(b.dataset.tab);
  });
  card.addEventListener('click', (ev) => {
    const b = ev.target.closest('.sm-change, .sm-rank');
    if (!b) return;
    bus.emit('select', { neighbor: b.dataset.neighbor });
    setOpen(false);
  });

  // Opens by itself the first time playback crosses the end.
  let endTick = null;
  let endSeen = 0;
  let autoDone = false;
  let lastPos = null;
  const findEnd = () => {
    for (; endTick === null && endSeen < store.events.length; endSeen++) {
      if (store.events[endSeen].type === 'end') endTick = store.events[endSeen].tick;
    }
  };

  let pillShown = null;
  app.onFrame(() => {
    // Inside the game the pill waits for the rumor (nothing to sum up before).
    const showPill = !game || (store.state?.facts?.size ?? 0) > 0;
    if (showPill !== pillShown) {
      pillShown = showPill;
      pill.hidden = !showPill;
      if (!showPill && open) setOpen(false);
    }
    findEnd();
    if (!autoDone && endTick !== null && lastPos !== null && lastPos < endTick && store.pos >= endTick) {
      autoDone = true;
      const root = document.documentElement;
      // In the game mode the end card of the game is the first view (phase 9-4):
      // the summary of the day stays one click away («Ver el resumen del día»),
      // also after a reload (the phase of the game may not be set yet then).
      if (!game && !root.dataset.gamePhase) {
        // The story mode keeps its own card on screen: this one fits beside it.
        if (root.hasAttribute('data-only')) {
          if (!open) setOpen(true);
        } else if (!final.isOpen) openFinal();
      }
    }
    lastPos = store.pos;
    final.frame();
    if (open) {
      const s = current();
      if (s !== shownKey) {
        shownKey = s;
        render(s);
      }
      for (const [who, list] of faces) {
        const url = portrait(who);
        if (!url) continue;
        for (const f of list) {
          const img = el('img');
          img.alt = '';
          img.src = url;
          f.replaceChildren(img);
        }
        faces.delete(who);
      }
    }
    counters.frame();
    if (settle && (!open || (shownKey !== null && faces.size === 0)) && final.settled && imagesIn()) settle();
  });

  // A capture that opens a card waits (data-ready) for its portraits, which
  // the scene draws one per frame; never more than SETTLE_MS.
  let settle = null;
  const imagesIn = () => [...document.querySelectorAll('.sm-zone img, .sm-final img')].every((i) => i.complete);
  const holdFaces = () => {
    if (!isCapture(app.params) || settle) return;
    app.holdReady(
      new Promise((resolve) => {
        const timer = setTimeout(() => resolve(), SETTLE_MS);
        settle = () => {
          clearTimeout(timer);
          settle = null;
          resolve();
        };
      }),
    );
  };

  if (app.params.summary) {
    const show = () => {
      if (tab === 'ranking') setOpen(true);
      else openFinal();
      holdFaces();
    };
    if (store.live) show();
    else bus.on('loaded', show);
  }
}
