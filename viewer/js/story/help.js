// Floating buttons in #help: the view switch (simple / full / tech, app.ui),
// the director («Cámara automática» inside the game) and «?»; and the help card, a reference to look things up:
// who decides (model or rules, header.policy; a live game or a recording),
// the colors (the versions, or the two rumors of a race) and the controls
// (mouse and keys, or the gestures on a touch screen).
//
//   [Sencilla|Completa|Técnica]
//              [🎥 Director]  [?]
//
// The card never opens by itself (the story mode greets first-time visitors);
// it opens with «?» or the bus event 'help' (the ? key, package replay), and
// closes with ×, Escape, a click outside or 'help' again.
//
// Inside the game (<html data-game>, phase 9-5) the card is the help of the
// game instead (gameHelp): Con IA or Sin IA, the goal, the counter, «Terminar
// ya» (only while playing), one line per control of the bar (x1 · x4, rápida,
// ‹ ›, Cámara automática, Resumen del día), «¿Qué pensó?», the icons over the heads, the colors and the controls without the keys of
// the recording viewer (D, H, P, N); no «Ver la historia».

import { UI_MODES } from '../core/params.js';
import { VERSION_GLYPHS } from '../core/theme.js';
import { raceColor } from '../rumor/race.js';

const CAMERA_SVG =
  '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M4 7.5A2.5 2.5 0 0 1 6.5 5h7A2.5 2.5 0 0 1 16 7.5v.9l3.6-2.1A1 1 0 0 1 21 7.2v9.6a1 1 0 0 1-1.4.9L16 15.6v.9a2.5 2.5 0 0 1-2.5 2.5h-7A2.5 2.5 0 0 1 4 16.5z"/></svg>';

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Appends segments (phrase.js) to an element, strong ones in <b>. */
function segs(parent, list) {
  for (const s of list) parent.append(s.strong ? el('b', '', s.text) : document.createTextNode(s.text));
  return parent;
}

/** A list of the four version colors, each with its shape too (also used by the story mode). */
export function legendList(t) {
  const ul = el('ul', 'st-legend');
  for (const [v, label] of t.legend) {
    const li = el('li');
    const dot = el('span', `st-swatch v-${v}`, VERSION_GLYPHS[v] ?? '');
    dot.setAttribute('aria-hidden', 'true');
    li.append(dot, el('span', '', label));
    ul.append(li);
  }
  return ul;
}

/**
 * What the help of the game says (phase 9-5): pure, the card draws it.
 * @param {object} t strings of story/strings.js
 * @param {{mode: 'ai'|'rules', play: boolean, touch?: boolean}} o play: a game
 *   being played (<html data-game="play">), not one played before
 * @returns {{title: string, who: string, items: [string, string][], controls: [string, string][]}}
 */
export function gameHelp(t, { mode, play, touch = false }) {
  const g = t.helpGame;
  const m = mode === 'rules' ? 'rules' : 'ai';
  const items = [g.goal, g.counter, ...(play ? [g.stop] : []), g.speeds, g.fast, g.back, g.camera, g.summary, g.think[m], g.icons];
  return { title: g.title, who: g.who[m], items, controls: touch ? t.controlsTouch : g.controls };
}

/**
 * The legend of a race: the colour of each rumor, by the one heard first, and grey.
 * @param {object} t
 * @param {(string|null)[]} whats the kind of each rumor of the race (null: unknown)
 */
function raceList(t, whats) {
  const ul = el('ul', 'st-legend');
  const items = whats.map((what, i) => {
    const label = t.the[what] ? t.legendRaceFirstWhat.replace('{what}', t.the[what]) : t.legendRaceFirst;
    return [raceColor(i), label.replace('{n}', i + 1)];
  });
  items.push([raceColor(undefined), t.legendRaceNone]);
  for (const [color, label] of items) {
    const li = el('li');
    const dot = el('span', 'st-swatch');
    dot.style.background = color;
    dot.setAttribute('aria-hidden', 'true');
    li.append(dot, el('span', '', label));
    ul.append(li);
  }
  return ul;
}

/**
 * Builds the buttons and the help card.
 * @param {object} app
 * @param {object} t strings of story/strings.js
 * @param {{toggleDirector: () => void, who: () => import('./phrase.js').Seg[], tour: (() => void)|null,
 *   race?: () => (string|null)[]|null, touch?: () => boolean}} act
 *   who: the paragraph of who decides (it knows live from recorded); tour:
 *   opens the story mode (null: none); race: the kinds of the two rumors of a
 *   race, null without one; touch: a touch screen (gestures instead of mouse and keys)
 * @returns {{setDirector: (on: boolean) => void, open: () => void, close: () => void}}
 */
export function createHelp(app, t, act) {
  const zone = app.zones.help;
  zone.replaceChildren();

  const fab = el('div', 'st-fab');

  // View switch.
  const views = el('div', 'st-views');
  views.setAttribute('role', 'group');
  views.setAttribute('aria-label', t.views);
  const viewButtons = {};
  for (const mode of UI_MODES) {
    const b = el('button', 'st-view', t.view[mode]);
    b.type = 'button';
    b.title = t.viewTitle[mode];
    b.addEventListener('click', () => {
      app.ui.set(mode);
      b.blur();
    });
    viewButtons[mode] = b;
    views.append(b);
  }
  const showView = (mode) => {
    for (const [m, b] of Object.entries(viewButtons)) {
      b.classList.toggle('on', m === mode);
      b.setAttribute('aria-pressed', m === mode ? 'true' : 'false');
    }
  };
  showView(app.ui.mode);
  app.bus.on('ui', ({ mode } = {}) => showView(mode));

  const dir = el('button', 'st-dir');
  dir.type = 'button';
  dir.innerHTML = CAMERA_SVG;
  const dirLabel = el('span', 'st-dir-label', t.director);
  dir.append(dirLabel);
  // Inside the game the director is «Cámara automática» (<html data-game> may come later).
  let dirOn = false;
  const showDir = () => {
    const game = !!document.documentElement.dataset.game;
    dirLabel.textContent = game ? t.camera : t.director;
    dir.title = game ? (dirOn ? t.cameraOn : t.cameraOff) : dirOn ? t.directorOn : t.directorOff;
  };
  app.bus.on('game', showDir);
  dir.addEventListener('click', () => act.toggleDirector());
  const q = el('button', 'st-q', '?');
  q.type = 'button';
  q.title = t.help;
  q.setAttribute('aria-label', t.help);
  const row = el('div', 'st-fab-row');
  row.append(dir, q);
  fab.append(views, row);

  // The card.
  const veil = el('div', 'st-veil');
  veil.hidden = true;
  const card = el('div', 'st-guide');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-label', t.helpTitle);
  veil.append(card);
  zone.append(fab, veil);

  const close = () => {
    veil.hidden = true;
  };
  /** A list of [bold, text] rows. */
  const howtoList = (rows) => {
    const ul = el('ul', 'st-howto');
    for (const [k, v] of rows) {
      const li = el('li');
      li.append(el('b', '', k), el('span', '', ` ${v}`));
      ul.append(li);
    }
    return ul;
  };
  /** The colours of the map in use: a race paints the rumor heard first (rumor/race.js). */
  const legend = () => {
    const race = act.race?.() ?? null;
    if (race) return [el('h3', 'st-gsub', t.legendTitle), el('p', 'st-gbody', t.legendRaceBody), raceList(t, race)];
    return [el('h3', 'st-gsub', t.legendTitle), el('p', 'st-gbody', t.legendBody), legendList(t)];
  };
  const render = () => {
    card.replaceChildren();
    const x = el('button', 'st-x', '×');
    x.type = 'button';
    x.title = t.close;
    x.setAttribute('aria-label', t.close);
    x.addEventListener('click', close);
    const game = document.documentElement.dataset.game;
    const nav = el('div', 'st-gnav');
    if (game) {
      // The help of the game: no keys of the recording viewer, no story mode.
      const h = gameHelp(t, { mode: app.header?.policy === 'baseline' ? 'rules' : 'ai', play: game === 'play', touch: !!act.touch?.() });
      card.setAttribute('aria-label', h.title);
      card.append(x, el('h2', 'st-gtitle', h.title), el('p', 'st-gbody', h.who));
      card.append(el('h3', 'st-gsub', t.helpGame.playTitle), howtoList(h.items));
      card.append(...legend(), el('h3', 'st-gsub', t.controlsTitle), howtoList(h.controls));
    } else {
      card.setAttribute('aria-label', t.helpTitle);
      card.append(x, el('h2', 'st-gtitle', t.helpTitle));
      card.append(segs(el('p', 'st-gbody'), act.who()));
      card.append(...legend(), el('h3', 'st-gsub', t.controlsTitle), howtoList(act.touch?.() ? t.controlsTouch : t.controls));
      if (act.tour) {
        const again = el('button', 'st-gbtn ghost', t.tourAgain);
        again.type = 'button';
        again.addEventListener('click', () => {
          close();
          act.tour();
        });
        nav.append(again);
      }
    }
    const done = el('button', 'st-gbtn', t.done);
    done.type = 'button';
    done.addEventListener('click', close);
    nav.append(done);
    card.append(nav);
  };
  const open = () => {
    render();
    veil.hidden = false;
  };
  q.addEventListener('click', () => {
    open();
    q.blur();
  });
  veil.addEventListener('click', (e) => {
    if (e.target === veil) close();
  });
  document.addEventListener('keydown', (e) => {
    if (!veil.hidden && e.key === 'Escape') {
      e.preventDefault(); // the story mode stays open
      close();
    }
  });
  app.bus.on('help', () => (veil.hidden ? open() : close()));

  return {
    setDirector(on) {
      dirOn = !!on;
      dir.classList.toggle('on', dirOn);
      dir.setAttribute('aria-pressed', dirOn ? 'true' : 'false');
      showDir();
    },
    open,
    close,
  };
}
