// «Cómo funciona» on screen (phase 9-5): part 1 of the tutorial, eight cards
// without interaction in the look of the story mode (tr-* of story.css), over
// the still village (app.ui.only(['banner']): the game screens step aside).
// The cards are pure (howto.js); this file only draws.
//
//   ┌ .ho-root ────────────────────────────────────────────┐
//   │ CÓMO FUNCIONA  Con IA  3 de 8                        │
//   │ Corre cuando se cruzan                               │
//   │ Un rumor solo pasa cuando dos vecinos coinciden…     │
//   │ ┌ .ho-art ─────────────────────────────────────────┐ │
//   │ │  plaza:  [Carmen] 💬 [Ana]                        │ │   a small drawing, HTML
//   │ └──────────────────────────────────────────────────┘ │
//   │ [Atrás] ● ● ● ○ ○ ○ ○ ○  [Saltar explicación] [Siguiente] │
//   └──────────────────────────────────────────────────────┘
//
// The last card's main button hands over: «Preparar mi rumor ▶» (intro
// 'first', part 2 follows) or «Volver al menú» (intro 'only').
//
// Reads: app.header (the neighbors, the places), app.timetable and bus
// 'timetable' (where the cast spends the day; the first card is drawn again
// when it arrives), core/showcase.js ASK and SHOWCASE (card 4).
// Writes: app.ui.only(['banner']) and <html data-tutorial="howto"> while open.

import { pick } from '../core/lang.js';
import { whatName } from '../core/names.js';
import { ASK, SHOWCASE } from '../core/showcase.js';
import { VERSION_GLYPHS } from '../core/theme.js';
import { placeWithArticle } from '../game/prepare.js';
import { legendList } from './help.js';
import { HOWTO_KEYS, howtoCast, howtoNav, howtoUntil } from './howto.js';
import { fill } from './phrase.js';
import { STRINGS } from './strings.js';

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function segs(parent, list) {
  for (const s of list) parent.append(s.strong ? el('b', '', s.text) : document.createTextNode(s.text));
  return parent;
}

/** Discs in the colours of the versions, with their shapes (as the legend). */
function discs(versions) {
  const box = el('span', 'ho-discs');
  box.setAttribute('aria-hidden', 'true');
  for (const v of versions) box.append(el('span', `st-swatch v-${v}`, VERSION_GLYPHS[v] ?? ''));
  return box;
}

const chip = (text, cls = '') => el('span', `ho-chip ${cls}`.trim(), text);
const arrow = () => {
  const a = el('span', 'ho-arrow', '→');
  a.setAttribute('aria-hidden', 'true');
  return a;
};
const row = (...items) => {
  const r = el('div', 'ho-row');
  r.append(...items);
  return r;
};

/**
 * Shows the eight cards of «Cómo funciona».
 * @param {object} app
 * @param {{intro: 'first'|'only', mode: 'ai'|'rules', draft?: object|null, onEnd: (how: 'done'|'skip') => void}} opts
 * @returns {{close: () => void, active: () => boolean}} close: away without onEnd
 */
export function showHowto(app, { intro, mode, draft = null, onEnd }) {
  const { header, bus } = app;
  const all = pick(STRINGS, app.lang);
  const t = all.howto;
  const lang = app.lang === 'es' ? 'es' : 'en';
  const root = document.documentElement;
  const total = HOWTO_KEYS.length;
  let k = 0;
  let active = true;
  const offs = [];

  const box = el('div', 'ho-root');
  const card = el('div', 'tr-card ho-card');
  card.setAttribute('role', 'region');
  card.setAttribute('aria-label', t.label);
  card.setAttribute('aria-live', 'polite');
  const top = el('div', 'tr-top');
  const stepTag = el('span', 'tu-step');
  const modeTag = el('span', 'tr-who');
  modeTag.append(el('b', '', all.tutorial.mode[mode]));
  top.append(el('span', 'tr-label', t.label), modeTag, stepTag);
  const title = el('h2', 'tr-title');
  title.tabIndex = -1;
  const body = el('div', 'tr-body');
  const art = el('div', 'ho-art');
  const nav = el('div', 'tr-nav');
  const bBack = el('button', 'tr-explore ho-back', t.back);
  bBack.type = 'button';
  const dots = el('div', 'tr-dots');
  dots.setAttribute('aria-hidden', 'true'); // «n de 8» says it in words
  const bSkip = el('button', 'tr-explore ho-skip', t.skip);
  bSkip.type = 'button';
  const bNext = el('button', 'tr-explore last ho-next', t.next);
  bNext.type = 'button';
  nav.append(bBack, dots, bSkip, bNext);
  card.append(top, title, body, art, nav);
  box.append(card);
  document.body.append(box);

  // ── The drawings ───────────────────────────────────────────────────
  const neighbors = header?.neighbors ?? [];
  const cast = () => howtoCast(header, app.timetable ?? null, lang);
  const placeName = (key) => (header?.places ?? []).find((p) => p.key === key)?.name ?? key;
  // Two of the cast for the drawings, else any two neighbors.
  const pair = () => {
    const c = cast();
    const names = c.length >= 2 ? c.map((p) => p.name) : neighbors.map((n) => n.name);
    return [names[0] ?? '', names[1] ?? ''];
  };

  const drawCast = () => {
    const ul = el('ul', 'ho-cast');
    for (const p of cast()) {
      const li = el('li');
      const icon = el('span', 'ho-icon', p.traitIcon);
      icon.setAttribute('aria-hidden', 'true');
      const text = el('span', 'ho-who');
      text.append(el('b', '', p.name), document.createTextNode(`, ${p.job} · `), el('b', '', p.traitName), document.createTextNode(`: ${p.traitPhrase}`));
      if (p.usual?.key) text.append(el('small', '', t.usual.replace('{place}', placeWithArticle(header, p.usual.key, lang))));
      else if (p.usual?.roaming) text.append(el('small', '', t.roaming));
      li.append(icon, text);
      ul.append(li);
    }
    const wrap = el('div');
    wrap.append(ul, el('p', 'ho-note ho-cast-note', t.castNote));
    return wrap;
  };

  const drawStart = () => {
    const [a] = pair();
    return row(chip(t.you, 'ho-you'), arrow(), chip(a), arrow(), discs(['correct', 'correct', 'unknown', 'unknown', 'unknown']), el('span', 'ho-label', t.village));
  };

  const drawMeet = () => {
    const [a, b] = pair();
    const bubble = el('span', 'ho-bubble', '💬');
    bubble.setAttribute('aria-hidden', 'true');
    return row(el('span', 'ho-place', `📍 ${placeName('square')}`), chip(a), bubble, chip(b));
  };

  // Card 4: a real moment only the AI has (core/showcase.js ASK: someone who
  // forgot a detail asks for it), against what Sin IA does; and, folded, the
  // «¿Qué pensó?» of another moment (SHOWCASE).
  const drawAi = () => {
    const ask = ASK[lang] ?? ASK.es;
    const s = SHOWCASE[lang] ?? SHOWCASE.es;
    const wrap = el('div', 'ho-show');
    const col = (tag, ...items) => {
      const c = el('div', 'ho-col');
      c.append(el('div', 'ho-tag', tag), ...items);
      return c;
    };
    const say = (who, text, cls = '') => {
      const p = el('p', `ho-say ${cls}`.trim());
      p.append(el('b', '', who), document.createTextNode(` ${text}`));
      return p;
    };
    // The question and its answer: the two lines after the greeting.
    const lines = ask.talk.slice(1, 3).map((l) => say(l.who, l.text));
    // Their people are not the ones of this village (Fernando is someone else here).
    wrap.append(el('p', 'ho-note ho-other', t.show.other));
    wrap.append(col(t.show.ai, el('p', 'ho-note', ask.forgot), ...lines));
    wrap.append(col(t.show.rules, el('p', 'ho-say ho-plain-text', ask.rules)));
    const think = el('details', 'ho-col ho-think ho-read');
    think.append(el('summary', '', t.show.think.replace('{name}', s.think.who)));
    const decided = el('p', 'ho-say');
    // «Decidió contárselo a Josefa…»: the decision goes on the label's sentence.
    const what = s.think.decided.charAt(0).toLowerCase() + s.think.decided.slice(1);
    decided.append(el('b', '', t.show.decided), document.createTextNode(` ${what}`));
    const read = el('details', 'ho-read');
    read.append(el('summary', '', t.show.read), el('pre', '', s.think.read));
    think.append(decided, el('p', 'ho-say ho-checked', s.think.checked), read);
    wrap.append(think);
    if (ask.translated || s.translated) wrap.append(el('p', 'ho-note', t.show.translated));
    return wrap;
  };

  const drawMove = () => row(discs(['correct', 'correct', 'correct']), el('span', 'ho-label', t.gather), arrow(), chip(`📍 ${placeName('square')} · 12:00`));

  const drawDistort = () => {
    const what = whatName('party', lang);
    const place = placeName('square');
    const step = (v, text, note) => {
      const c = el('span', 'ho-step');
      c.append(discs([v]), chip(text));
      if (note) c.append(el('small', '', note));
      return c;
    };
    return row(step('correct', `${what} · ${place} · 12:00`, t.intact), arrow(), step('incomplete', `${what} · ${place} · ?`, t.forgot), arrow(), step('wrong', `${what} · ${place} · 12:30`, `«${t.guess}»`));
  };

  const drawGoal = () => row(discs(['correct', 'correct', 'wrong', 'incomplete', 'unknown']), arrow(), chip(t.stars, 'ho-stars'));

  const drawRead = () => {
    const ul = el('ul', 'st-howto ho-more');
    for (const [k2, v] of t.readMore) {
      const li = el('li');
      li.append(el('b', '', k2), el('span', '', ` ${v}`));
      ul.append(li);
    }
    const wrap = el('div');
    wrap.append(legendList(all), ul);
    return wrap;
  };

  const DRAW = { village: drawCast, start: drawStart, meet: drawMeet, ai: drawAi, move: drawMove, distort: drawDistort, goal: drawGoal, read: drawRead };

  // ── The card ───────────────────────────────────────────────────────
  const render = () => {
    const key = HOWTO_KEYS[k];
    const n = howtoNav(k, total, intro);
    title.textContent = t.title[key];
    stepTag.textContent = t.step.replace('{n}', k + 1).replace('{total}', total);
    const paras = [...t.body[key]];
    if (key === 'goal') {
      const until = howtoUntil(intro, draft);
      paras.unshift(until ? fill(t.goalUntil, { time: until }) : t.goalAny);
    }
    body.replaceChildren(...paras.map((p) => segs(el('p', 'tr-text'), Array.isArray(p) ? p : fill(p, { n: neighbors.length }))));
    art.replaceChildren(DRAW[key]());
    dots.replaceChildren(...HOWTO_KEYS.map((other, i) => el('span', i === k ? 'tr-dot on' : i < k ? 'tr-dot done' : 'tr-dot')));
    bBack.disabled = !n.back;
    bSkip.hidden = !n.skip;
    bNext.textContent = n.next === 'game' ? t.toGame : n.next === 'menu' ? t.toMenu : t.next;
    box.dataset.card = key;
  };

  const end = (how) => {
    if (!active) return;
    active = false;
    for (const off of offs) off?.();
    box.remove();
    if (root.dataset.tutorial === 'howto') delete root.dataset.tutorial;
    if (how) onEnd?.(how);
  };

  bBack.addEventListener('click', () => {
    if (k === 0) return;
    k -= 1;
    render();
  });
  bNext.addEventListener('click', () => {
    if (howtoNav(k, total, intro).next !== 'next') return end('done');
    k += 1;
    render();
  });
  bSkip.addEventListener('click', () => end('skip'));
  // The timetable comes late: where the cast spends the day.
  const off = bus?.on?.('timetable', () => active && HOWTO_KEYS[k] === 'village' && render());
  offs.push(typeof off === 'function' ? off : null);

  root.dataset.tutorial = 'howto';
  app.ui?.only?.(['banner']);
  render();
  title.focus({ preventScroll: true });

  return { close: () => end(null), active: () => active };
}
