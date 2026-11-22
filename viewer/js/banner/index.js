// The banner (#banner): mode (recording or live) and, in plain words, what is
// running; the technical details go in a ⓘ menu (phase 8-1, package C).
//
//   ┌ #banner ────────────────────────────────────────────────────────────────┐
//   │ [GRABACIÓN] Rumor Village · 100 vecinos · Gemma 4 E4B afinado, en local ⓘ │
//   └──────────────────────────────────────────────────────┬───────────────────┘
//                                          ┌ .bn-menu ─────┴───────────┐
//                                          │ Escenario  party-100      │
//                                          │ Semilla    2              │
//                                          │ Idioma     castellano     │
//                                          │ Modelo     gemma-….gguf   │
//                                          │ Fichero    /runs/….jsonl  │
//                                          │ [Copiar enlace] copiado   │
//                                          └───────────────────────────┘
//
//   zones: #banner · reads app.header, app.kind, app.params.log, app.link()
//   params: open=info opens the menu (captures)
//
// modelName() and runText() are pure (also used by the split screen).
//
// Inside the game (?play=1 or ?game=, phase 9-5) the banner says only
// «Rumor Village · Pueblo n.º 4821 · 25 vecinos · Con IA» (gameBannerText):
// no ⓘ menu; live, no badge (the one state of the game is the pill of the
// timeline, replay/index.js); in a played game, the badge «Partida jugada».

import { pick } from '../core/lang.js';
import { inGame } from '../core/params.js';
import { STRINGS as CORE } from '../core/strings.js';
import { fill } from '../rumor/strings.js';
import { STRINGS } from './strings.js';

/** How long the «copied» note stays, in ms (decoration, not information). */
const NOTE_MS = 2000;

/**
 * Human name of the model of a run ("Gemma 4 E4B afinado"), or null without
 * a model (the rules decide). A model file it does not recognise is shown as is.
 * @param {{policy?: string, model?: string|null}} header
 * @param {'es'|'en'} lang
 * @returns {string|null}
 */
export function modelName(header, lang) {
  if (!header || header.policy === 'baseline' || !header.model) return null;
  const t = pick(STRINGS, lang);
  // gemma-4-E4B-it[-rumor][-qat…]-Q4_K_M.gguf; "-rumor" is our fine-tuning.
  const m = /^gemma-(\d+)-([a-z0-9]+)-it(-rumor)?(?=[-.]|$)/i.exec(header.model);
  if (!m) return header.model;
  return fill(m[3] ? t.finetuned : t.base, { name: `Gemma ${m[1]} ${m[2].toUpperCase()}` });
}

/**
 * Who decides, for the banner: "Gemma 4 E4B afinado, en local" or "sin modelo: reglas".
 * @param {object} header
 * @param {'es'|'en'} lang
 * @returns {string}
 */
export function runText(header, lang) {
  const model = modelName(header, lang);
  return model ? fill(pick(STRINGS, lang).local, { model }) : pick(CORE, lang).baseline;
}

/**
 * The text of the banner after the mode: "Rumor Village · 100 vecinos · …".
 * @param {object} header
 * @param {'es'|'en'} lang
 * @returns {string}
 */
export function bannerText(header, lang) {
  const t = pick(STRINGS, lang);
  return [t.title, fill(t.neighbors, { n: (header.neighbors ?? []).length }), runText(header, lang)].join(' · ');
}

/**
 * The parts of the banner inside the game: «Rumor Village · Pueblo n.º
 * 4821 · 25 vecinos · Con IA». The town is the seed of the header (left out
 * without one). Before a game is being prepared (the phases boot and menu, or
 * none yet, with `phase`) the village is only a stand-in: «Rumor Village ·
 * Con IA».
 * @param {object} header
 * @param {'es'|'en'} lang
 * @param {string|null|undefined} [phase] of the game; undefined: everything
 * @returns {{key: 'title'|'town'|'neighbors'|'mode', text: string}[]}
 */
export function gameBannerParts(header, lang, phase = undefined) {
  const t = pick(STRINGS, lang);
  const early = phase !== undefined && !['prepare', 'playing', 'ended'].includes(phase);
  const parts = [{ key: 'title', text: t.title }];
  if (!early && Number.isInteger(header?.seed)) parts.push({ key: 'town', text: fill(t.town, { n: header.seed }) });
  if (!early) parts.push({ key: 'neighbors', text: fill(t.neighbors, { n: (header?.neighbors ?? []).length }) });
  parts.push({ key: 'mode', text: header?.policy === 'baseline' ? t.modeRules : t.modeAi });
  return parts;
}

/**
 * The banner inside the game as one line (the image of the day card).
 * @param {object} header
 * @param {'es'|'en'} lang
 * @returns {string}
 */
export function gameBannerText(header, lang) {
  return gameBannerParts(header, lang).map((p) => p.text).join(' · ');
}

/**
 * Rows of the ⓘ menu: [label, value], the empty ones left out.
 * @param {object} header
 * @param {'es'|'en'} lang
 * @param {string|null} file the recording (params.log)
 * @returns {[string, string][]}
 */
export function infoRows(header, lang, file) {
  const t = pick(STRINGS, lang);
  const rows = [
    [t.scenario, header.scenario],
    [t.seed, header.seed],
    [t.lang, t.langs[header.lang] ?? header.lang],
    [t.model, header.policy === 'baseline' || !header.model ? pick(CORE, lang).baseline : header.model],
    [t.file, file],
  ];
  return rows.filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => [k, String(v)]);
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** The ⓘ as SVG: not every font has the character. */
function infoIcon() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('width', '20');
  svg.setAttribute('height', '20');
  svg.setAttribute('aria-hidden', 'true');
  const circle = document.createElementNS(ns, 'circle');
  circle.setAttribute('cx', '10');
  circle.setAttribute('cy', '10');
  circle.setAttribute('r', '8.25');
  circle.setAttribute('fill', 'none');
  circle.setAttribute('stroke', 'currentColor');
  circle.setAttribute('stroke-width', '1.6');
  const dot = document.createElementNS(ns, 'circle');
  dot.setAttribute('cx', '10');
  dot.setAttribute('cy', '6.2');
  dot.setAttribute('r', '1.2');
  dot.setAttribute('fill', 'currentColor');
  const bar = document.createElementNS(ns, 'path');
  bar.setAttribute('d', 'M10 9v5.5');
  bar.setAttribute('stroke', 'currentColor');
  bar.setAttribute('stroke-width', '1.9');
  bar.setAttribute('stroke-linecap', 'round');
  svg.append(circle, dot, bar);
  return svg;
}

/**
 * @param {object} app see viewer/js/core/app.js
 */
export function init(app) {
  const { header, kind, lang } = app;
  const core = pick(CORE, lang);
  const t = pick(STRINGS, lang);
  const banner = app.zones.banner;
  if (!banner) return;
  banner.replaceChildren();
  banner.classList.add('bn');

  if (inGame(app.params)) {
    // A played game keeps a badge; live, the state is the pill of the timeline.
    if (kind !== 'live') banner.append(el('span', 'banner-mode played', t.played));
    const run = el('span', 'banner-run');
    banner.append(run);
    // Live, the phase of the game says how much to tell (bus 'game').
    const draw = (phase) => {
      run.replaceChildren();
      gameBannerParts(header, lang, kind === 'live' ? (phase ?? null) : undefined).forEach((p, i) => {
        if (i) run.append(' · ');
        const span = el('span', `bn-part bn-${p.key}`, p.text);
        if (p.key === 'town') span.title = t.townTitle;
        run.append(span);
      });
    };
    draw(document.documentElement.dataset.gamePhase);
    app.bus?.on('game', ({ phase } = {}) => draw(phase));
    return;
  }

  const mode = el('span', `banner-mode ${kind}`, kind === 'live' ? core.live : core.recording);
  const run = el('span', 'banner-run', bannerText(header, lang));
  const button = el('button', 'bn-info');
  button.type = 'button';
  button.append(infoIcon());
  button.title = t.info;
  button.setAttribute('aria-label', t.info);
  button.setAttribute('aria-haspopup', 'true');

  const menu = el('div', 'bn-menu');
  menu.hidden = true;
  const list = el('dl', 'bn-rows');
  for (const [k, v] of infoRows(header, lang, app.params.log)) {
    const value = el('dd', null, v);
    value.title = v;
    list.append(el('dt', null, k), value);
  }
  const copy = el('button', 'bn-copy', t.copy);
  copy.type = 'button';
  const note = el('span', 'bn-note');
  note.setAttribute('aria-live', 'polite');
  const actions = el('div', 'bn-actions');
  actions.append(copy, note);
  menu.append(list, actions);
  banner.append(mode, run, button, menu);

  const setOpen = (v) => {
    menu.hidden = !v;
    button.classList.toggle('on', v);
    button.setAttribute('aria-expanded', String(v));
  };
  setOpen(app.params.open === 'info');
  button.addEventListener('click', () => setOpen(menu.hidden));
  document.addEventListener('pointerdown', (ev) => {
    if (!menu.hidden && !banner.contains(/** @type {Node} */ (ev.target))) setOpen(false);
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !menu.hidden) setOpen(false);
  });

  let noteTimer = null;
  copy.addEventListener('click', async () => {
    let ok = false;
    try {
      await navigator.clipboard.writeText(app.link());
      ok = true;
    } catch (err) {
      console.warn('banner: copy link failed', err);
    }
    note.textContent = ok ? t.copied : t.copyFailed;
    note.classList.toggle('bad', !ok);
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => (note.textContent = ''), NOTE_MS);
  });
}
