// The full-screen card at the end of the day (phase 8-2, 2.10). It covers the
// scene with the figures of the day, the tree of who told whom and the
// ones who told it most, plus four ways out: another recording, compare, the
// repository and «guardar como imagen» (image.js).
//
//   .sm-final (in .layout, over everything; photo mode hides it with the rest)
//   ┌ .smf-card ──────────────────────────────────────────── ✕ ┐
//   │ FIN DEL DÍA                                              │
//   │ Fiesta  Manuel · plaza · 21:00 · 50                      │
//   │  50 de 100 se enteraron │ 33 llegaron … │ 8 con algún …  │  figures count up (panel/count.js)
//   │ ████████▒▒▒░░░░░░░░                                      │
//   │ QUIÉN SE LO CONTÓ A QUIÉN        │ LOS MÁS COTILLAS       │
//   │   (tree, rumor/graph.js)         │ (face) Carmen …        │  a row selects that neighbor
//   │ [Otra grabación] [Comparar] [Repositorio]  [Guardar como imagen] │
//   └──────────────────────────────────────────────────────────┘
//
// It lives outside #summary because phones hide that zone (core.css) and the
// card must fit them too. Closed with ✕ or Esc.
//
// Inside the game (phase 9-5): only «Guardar como imagen»; the kicker and the
// image say the mode (Con IA / Sin IA) instead of the run; until the game
// ends, the gossips leave out who distorted it.

import { pick } from '../core/lang.js';
import { neighborName } from '../core/names.js';
import { inGame, isCapture } from '../core/params.js';
import { STRINGS as CORE } from '../core/strings.js';
import { versionColor, VERSION_COLORS } from '../core/theme.js';
import { bannerText, gameBannerText, runText } from '../banner/index.js';
import { drawGraph, graphLayout, pickNode } from '../rumor/graph.js';
import { INK } from '../rumor/overlay.js';
import { treeAt } from '../rumor/tree.js';
import { cardOf } from './card.js';
import { drawCardImage, IMAGE_H, IMAGE_W } from './image.js';
import { REPO_URL, STRINGS } from './strings.js';

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/**
 * The pair of a recording of the evaluation: …/base/<run>/seed-N.jsonl ⇄
 * …/ft/<run>/seed-N.jsonl, with the labels of each side; null if none.
 * @param {string|null} log
 * @returns {{left: string, right: string, labels: string}|null}
 */
export function pairOf(log) {
  if (!log) return null;
  const m = /^(.*\/)(base|ft)(\/[^/]+\/[^/]+\.jsonl)$/.exec(log);
  if (!m) return null;
  return { left: `${m[1]}base${m[3]}`, right: `${m[1]}ft${m[3]}`, labels: 'base,ft' };
}

/**
 * Creates the card (hidden).
 * @param {object} app
 * @param {object} o
 * @param {() => import('./build.js').Summary} o.summary the summary as of store.index
 * @param {ReturnType<import('../rumor/history.js').createHistory>} o.history fed by o.summary
 * @param {ReturnType<import('../panel/count.js').createCounters>} o.counters
 * @param {(id: string) => void} o.select
 * @returns {{open: () => void, close: () => void, readonly isOpen: boolean, frame: () => void}}
 */
export function createFinal(app, { summary, history, counters, select }) {
  const { header, store } = app;
  const t = pick(STRINGS, app.lang);
  const ids = (header.neighbors ?? []).map((n) => n.id);
  const layoutEl = document.querySelector('.layout') ?? document.body;
  const game = inGame(app.params);
  const secret = () => game && !store.state?.ended;

  const root = el('div', 'sm-final');
  root.hidden = true;
  const card = el('section', 'smf-card');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.tabIndex = -1;
  const head = el('header', 'smf-head');
  const kicker = el('div', 'smf-kicker');
  const kickerText = el('span', 'smf-ktext');
  // Honesty (phase 8): a recording says so, and who decides.
  const runLine = game
    ? (header.policy === 'baseline' ? t.modeRules : t.modeAi)
    : `${pick(CORE, app.lang)[store.live ? 'live' : 'recording']} · ${runText(header, app.lang)}`;
  const run = el('span', 'smf-run', runLine);
  kicker.append(kickerText, run);
  const titleBox = el('div', 'smf-titlebox');
  const what = el('h2', 'smf-what');
  what.id = 'smf-what';
  card.setAttribute('aria-labelledby', what.id);
  const fact = el('div', 'smf-fact');
  titleBox.append(what, fact);
  const close = el('button', 'smf-x', '✕');
  close.type = 'button';
  close.title = t.closeHint;
  close.setAttribute('aria-label', t.close);
  head.append(kicker, titleBox, close);

  const figs = el('div', 'smf-figs');
  const figEls = {};
  for (const key of ['told', 'right', 'changed']) {
    const box = el('div', `smf-fig smf-${key}`);
    const n = el('b', 'smf-n');
    const label = el('div', 'smf-label');
    const sub = el('div', 'smf-sub');
    box.append(n, label, sub);
    figs.append(box);
    figEls[key] = { box, n, label, sub };
  }
  const bar = el('div', 'smf-bar');
  const segs = {};
  for (const k of ['correct', 'incomplete', 'wrong', 'unknown']) {
    segs[k] = el('i', 'smf-seg');
    segs[k].style.background = versionColor(k === 'unknown' ? null : k);
    bar.append(segs[k]);
  }

  const body = el('div', 'smf-body');
  const treeSec = el('section', 'smf-sec smf-treesec');
  treeSec.append(el('h3', 'smf-h', t.tree), el('p', 'smf-hint', game ? t.treeHintGame : t.treeHint));
  const canvas = el('canvas', 'smf-tree');
  treeSec.append(canvas);
  const gossipSec = el('section', 'smf-sec smf-gossips');
  gossipSec.append(el('h3', 'smf-h', t.gossips));
  const people = el('ol', 'smf-people');
  gossipSec.append(people);
  body.append(treeSec, gossipSec);

  const actions = el('footer', 'smf-actions');
  const link = (cls, text, title) => {
    const a = el('a', `smf-btn ${cls}`, text);
    a.title = title;
    return a;
  };
  const another = link('smf-another', t.another, t.anotherTitle);
  const params = new URLSearchParams();
  if (app.lang) params.set('lang', app.lang);
  try {
    const manifest = new URLSearchParams(location.search).get('manifest');
    if (manifest) params.set('manifest', manifest);
    another.href = `${location.pathname}?${params}`;
  } catch {
    another.href = 'index.html';
  }
  const pair = pairOf(app.params.log);
  const compare = link('smf-compare', t.compare, pair ? t.comparePair : t.compareSame);
  const repo = link('smf-repo', t.repo, t.repoTitle);
  repo.href = REPO_URL;
  repo.target = '_blank';
  repo.rel = 'noopener';
  const save = el('button', 'smf-btn smf-save', t.save);
  save.type = 'button';
  save.title = t.saveTitle;
  if (!game) {
    actions.append(another);
    if (app.params.log) actions.append(compare);
    actions.append(repo);
  }
  actions.append(save);

  card.append(head, figs, bar, body, actions);
  root.append(card);
  layoutEl.append(root);

  /** Split screen at the current position: the pair if there is one, else the same recording twice. */
  const compareHref = () => {
    const q = new URLSearchParams();
    if (pair) {
      q.set('left', pair.left);
      q.set('right', pair.right);
      q.set('labels', pair.labels);
    } else {
      q.set('left', app.params.log);
      q.set('right', app.params.log);
    }
    q.set('t', String(Math.floor(store.pos)));
    return `${location.pathname}?${q}`;
  };
  compare.href = '#';
  compare.addEventListener('click', (ev) => {
    ev.preventDefault();
    location.href = compareHref();
  });

  let open = false;
  let shown = null;
  let shownCard = null;
  let tree = null;
  let peopleKey = '';
  const faces = new Map(); // who → faces still with initials (a neighbor may be in both lists)

  const portrait = (who) => {
    try {
      return app.hooks.portrait?.(who) ?? null;
    } catch {
      return null;
    }
  };

  const faceEl = (p) => {
    const f = el('span', `smf-face${p.color === VERSION_COLORS.incomplete ? ' light' : ''}`);
    f.style.setProperty('--v', p.color);
    const url = portrait(p.who);
    if (url) {
      const img = el('img');
      img.alt = '';
      img.src = url;
      f.append(img);
    } else {
      f.append(el('span', 'smf-initials', p.initials));
      faces.set(p.who, [...(faces.get(p.who) ?? []), f]);
    }
    return f;
  };

  const renderPeople = (c) => {
    const distorters = secret() ? [] : c.distorters;
    const key = JSON.stringify([c.tellers, distorters]);
    if (key === peopleKey) return;
    peopleKey = key;
    faces.clear();
    people.replaceChildren();
    const row = (p, cls) => {
      const li = el('li', cls);
      const b = el('button', 'smf-person');
      b.type = 'button';
      b.dataset.neighbor = p.who;
      const text = el('span', 'smf-ptext');
      text.append(el('span', 'smf-pname', p.name), el('span', 'smf-pline', p.line));
      if (p.sub) text.append(el('span', 'smf-psub', p.sub));
      b.append(faceEl(p), text);
      li.append(b);
      people.append(li);
    };
    for (const p of c.tellers) row(p, 'smf-teller');
    for (const p of distorters) row(p, 'smf-distorter');
    gossipSec.hidden = !c.tellers.length && !distorters.length;
  };

  let treeLayout = null;
  const paintTree = () => {
    if (!open || !shown) return;
    const width = canvas.clientWidth;
    if (!width || !tree || !tree.nodes.length) {
      treeSec.hidden = !tree || !tree.nodes.length;
      return;
    }
    const narrow = width < 420;
    treeLayout = graphLayout(tree, width, { maxHeight: narrow ? 150 : 230, step: narrow ? 22 : 36 });
    drawGraph(canvas, tree, treeLayout, {
      color: (id) => versionColor(shown.versionOf[id] ?? null),
      edges: new Set(),
      rings: new Map(),
      labels: new Map(),
      ink: INK,
      line: 'rgba(30, 42, 54, 0.22)',
      text: INK,
    });
  };

  const render = (s) => {
    shown = s;
    const c = cardOf(s, header, app.lang, { game });
    shownCard = c;
    kickerText.textContent = c.kicker;
    what.textContent = c.what || c.fact;
    fact.textContent = c.what ? c.fact : '';
    for (const n of [figs, bar, body]) n.hidden = !c.has;
    for (const x of Object.values(figEls)) x.box.hidden = true;
    for (const f of c.figs) {
      const x = figEls[f.key];
      x.box.hidden = false;
      x.box.style.setProperty('--c', f.color);
      // No figure (the hour of the rumor after the end): a dash, the label says why.
      if (f.n === null) {
        counters.reset(x.n);
        x.n.textContent = '—';
      } else counters.set(x.n, f.n, x.n.textContent === '' || x.n.textContent === '—' ? 0 : undefined);
      x.label.textContent = f.label;
      x.sub.textContent = f.sub;
      x.sub.hidden = !f.sub;
    }
    const total = Math.max(1, c.bar.reduce((a, b) => a + b.n, 0));
    for (const b of c.bar) segs[b.key].style.width = `${(100 * b.n) / total}%`;
    tree = c.has ? treeAt(history, s.fact, store.index, ids) : null;
    renderPeople(c);
    paintTree();
  };

  const setOpen = (v) => {
    if (v === open) return;
    open = v;
    root.hidden = !v;
    const still = isCapture(app.params) || app.reducedMotion();
    card.classList.toggle('card-in', v && !still);
    if (v) {
      shown = null;
      for (const f of Object.values(figEls)) {
        counters.reset(f.n);
        f.n.textContent = '';
      }
      peopleKey = '';
      if (!isCapture(app.params)) card.focus({ preventScroll: true });
      app.requestDraw();
    }
  };

  /** The card on a 1200×630 canvas, downloaded as PNG. */
  const saveImage = () => {
    if (!shown || !shownCard) return;
    const cv = document.createElement('canvas');
    cv.width = IMAGE_W;
    cv.height = IMAGE_H;
    const ctx = cv.getContext('2d');
    const loaded = (who) => {
      const img = card.querySelector(`.smf-person[data-neighbor="${who}"] img`);
      return img && img.complete && img.naturalWidth ? img : null;
    };
    const s = shown;
    drawCardImage(ctx, shownCard, {
      tree,
      nodeColor: (id) => versionColor(s.versionOf[id] ?? null),
      portrait: loaded,
      footer: game ? gameBannerText(header, app.lang) : `${pick(CORE, app.lang)[store.live ? 'live' : 'recording']} · ${bannerText(header, app.lang)}`,
      url: REPO_URL,
      titles: { tree: t.tree, gossips: t.gossips, brand: 'Rumor Village' },
    });
    cv.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `rumor-village-${header.scenario ?? 'run'}-${header.lang ?? app.lang}-s${header.seed ?? 0}.png`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }, 'image/png');
  };

  close.addEventListener('click', () => setOpen(false));
  save.addEventListener('click', saveImage);
  // A click on the dimmed scene around the card closes it too.
  root.addEventListener('click', (ev) => {
    if (ev.target === root) setOpen(false);
  });
  people.addEventListener('click', (ev) => {
    const b = ev.target instanceof Element ? ev.target.closest('.smf-person') : null;
    if (!b) return;
    select(b.dataset.neighbor);
    setOpen(false);
  });
  canvas.addEventListener('click', (ev) => {
    if (!treeLayout) return;
    const r = canvas.getBoundingClientRect();
    const id = pickNode(treeLayout, ev.clientX - r.left, ev.clientY - r.top);
    if (!id) return;
    select(id);
    setOpen(false);
  });
  canvas.addEventListener('mousemove', (ev) => {
    if (!treeLayout) return;
    const r = canvas.getBoundingClientRect();
    const id = pickNode(treeLayout, ev.clientX - r.left, ev.clientY - r.top);
    canvas.style.cursor = id ? 'pointer' : 'default';
    canvas.title = id ? neighborName(header, id) : ''; // the name on hover
  });
  document.addEventListener('keydown', (ev) => {
    if (open && ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      setOpen(false);
    }
  });
  new ResizeObserver(() => paintTree()).observe(card);

  return {
    open: () => setOpen(true),
    close: () => setOpen(false),
    get isOpen() {
      return open;
    },
    /** Drawn and with every portrait in (or not open): captures wait for it. */
    get settled() {
      return !open || (shown !== null && faces.size === 0);
    },
    /** Every frame: the content follows the position while open; late portraits come in. */
    frame() {
      if (!open) return;
      const s = summary();
      if (s !== shown) render(s);
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
    },
  };
}
