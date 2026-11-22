// «Preparar la partida» (docs/juego.md; phase 9-5, docs/fases/fase-9.md
// «9-5»): the goal of the game, the rumor as a sentence with gaps, whom to
// tell with the card of each neighbor, when, and «Empezar». The logic is in
// prepare.js (tested without DOM); this file only draws it and turns clicks
// into ctx.setDraft(next).
//
//   ┌ .gm-prepare (left of the village) ───────────────────────┐
//   │ Preparar la partida  [Con IA]                            │
//   │ Objetivo: … La partida va de las 07:00 a las 13:00.       │  head
//   │ Dura unos 3 minutos … · reto: Tú decides / El reto fija / │
//   │ ★ estrellas / el cura y su círculo                        │
//   │ TU RUMOR (editor)                                         │
//   │  Una [fiesta ▾] en [la plaza ▾], [hoy ▾] a las [12:00 ▾]. │  rumor-where · rumor-when
//   │  [+ de quién] [+ cuánta gente]                            │
//   │  ¿Qué ha pasado? 7 tipos: [🎉 fiesta] [💍 boda] …         │  rumor-what
//   │  ▸ ✎ ¿Prefieres escribirlo? [rumor-text][Rellenar la frase]│  Con IA only (POST extract)
//   │  ¿A quién se lo cuentas? [A vecinos | En un lugar]        │  rumor-to
//   │   orden · filtros · Elegidos 1 de 3 · fichas              │  neighbor-card (data-id)
//   │  ¿Cuándo se lo cuentas? [Nada más empezar | Más tarde…]   │
//   │  [Cancelar] [Guardar] [Guardar y preparar otro rumor]     │
//   │ ▸ Más opciones: varios rumores, apuestas y ajustes        │  customize
//   │ «Lo sabrá primero Ana nada más empezar. Una fiesta …»     │  live summary
//   │ why not yet …              [Menú] [Contárselo a Ana y …]  │  start: the one main button
//   └───────────────────────────────────────────────────────────┘
//
// A free game whose rumors are ready, with no editor open, shows «Rumor
// listo» instead (phase 9-4; prepare.js readyCard), with what the neighbor
// told is like.
//
// «Empezar» starts what is seen: the rumor open in the editor goes with the
// draft (prepare.js effectiveDraft), unless it is a new rumor still untouched
// (prepare.js isBlankRumor). Half done, it says what is missing next to the
// field, puts the focus there and offers «Descartar cambios». Con IA, text
// written and not read yet is read first (prepare.js textPending).
//
// ctx: {t, lang, api, header(), draft(), setDraft(next), challenge(), locks(),
//       aiAvailable, aiReason, checkRunning(), violations(), busy(),
//       friendLine(), notes(), errors(), starting(), start(), menu(),
//       effective(editing), edited(editing), initialEditor(), stashed(),
//       raceStashed(), lastTry(), timetable(), focusNeighbor(profile|null)}
// initialEditor() may carry focus: 'to' («Probar con otro vecino»): the row of
// the recipients is brought into view and focused once, at creation.

import { pick } from '../core/lang.js';
import { WHAT_A, WHO_JOIN, unitOf, whatName } from '../core/names.js';
import { neighborProfile, STRINGS as NEIGHBOR, TRAIT_ICON, TRAITS, peopleAt } from '../core/neighbors.js';
import { createFlow } from '../live/flow.js';
import { amountLabel, halfHours, parseWhen, whenText } from '../live/inject.js';
import { STRINGS as LIVE } from '../live/strings.js';
import { gendered } from '../rumor/person.js';
import { fill, STRINGS as RUMOR } from '../rumor/strings.js';
import { button, el, field, put, segmented, select } from './dom.js';
import {
  atHours,
  atOutside,
  attendOf,
  atWindow,
  blockerLines,
  canAddRumor,
  cardLines,
  challengeRumor,
  clockText,
  countText,
  dayWords,
  emptyRumor,
  exampleFact,
  exampleRumor,
  extractedFact,
  factSentence,
  defaultWhenTime,
  fixedPartText,
  lateWarning,
  goalLines,
  hardBlockers,
  indexAfterRemove,
  isBlankRumor,
  maxRumors,
  modeLabel,
  nameList,
  neighborsHint,
  neighborsOptions,
  pickRecipient,
  placeWithArticle,
  raceAvailable,
  readyCard,
  rumorIssues,
  rumorSummary,
  rumorTitle,
  startBlockers,
  startLabel,
  starsText,
  subjectText,
  subjectWarning,
  switchAt,
  switchTo,
  tellHour,
  textPending,
  toLimit,
  WHATS,
  windowText,
  yourPartText,
  sortCards,
  villageNote,
  sameVillage,
  randomTown,
} from './prepare.js';

const HOURS = halfHours();
/** The enabled controls of a row, the first of which gets the focus. */
const ENABLED = 'button:not(:disabled), select:not(:disabled), input:not(:disabled), textarea:not(:disabled)';
/** The icon of each of the seven kinds of news. */
const WHAT_ICON = { party: '🎉', lottery: '🎟️', wedding: '💍', concert: '🎵', works: '🚧', inheritance: '📜', fine: '🧾' };

const byName = (a, b) => a.label.localeCompare(b.label);
const neighborOptions = (h) => (h?.neighbors ?? []).map((n) => ({ value: n.id, label: n.name })).sort(byName);
const nameOf = (h, id) => (h?.neighbors ?? []).find((n) => n.id === id)?.name ?? id;
const placeNameOf = (h, key) => (h?.places ?? []).find((p) => p.key === key || p.id === key || p.name === key)?.name ?? key;
/** Lower case without accents, for the filter of names. */
const fold = (s) => String(s ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase();
const capital = (s) => String(s ?? '').charAt(0).toLocaleUpperCase() + String(s ?? '').slice(1);
const langOf = (lang) => (lang === 'es' ? 'es' : 'en');

/** «Una fiesta en la plaza, hoy a las 21:00 → a Ana, nada más empezar». */
export function rumorLine(rumor, header, lang, t) {
  const fact = factSentence(rumor.fact, { header, lang }) ?? '?';
  let to = t.toMissing;
  if (rumor.to?.place) to = placeWithArticle(header, rumor.to.place, lang);
  else if (rumor.to?.neighbors?.length) to = nameList(rumor.to.neighbors.map((id) => nameOf(header, id)), t);
  const at = rumor.at === 'start' ? t.summaryAtStart : fill(t.summaryAt, { time: rumor.at });
  return `${fact} → ${to}, ${at}`;
}

/**
 * Creates the screen.
 * @returns {{el: HTMLElement, update: () => void, openEditor: (i?: number|null) => void,
 *   editing: () => ({index: number|null, rumor: object, text: string}|null),
 *   reopen: (e: {index: number|null, rumor: object, text?: string}) => void}}
 */
export function createPrepare(ctx) {
  const { t, lang } = ctx;
  const L = langOf(lang);
  const liveText = pick(LIVE, lang);
  const rumorText = pick(RUMOR, lang);
  const timetable = () => ctx.timetable?.() ?? null;
  const root = el('section', { class: 'gm-screen gm-prepare card-in', 'data-screen': 'prepare' });
  const modeTag = el('span', { class: 'gm-prep-mode' });
  const head = el('div', { class: 'gm-head' });
  const readyBox = el('div', { class: 'gm-section gm-ready', gm: 'ready', 'aria-live': 'polite' });
  const editorBox = el('div', { class: 'gm-section gm-editor' });
  const summaryBox = el('p', { class: 'gm-summary', 'aria-live': 'polite' });
  const rumorsBox = el('div', { class: 'gm-section gm-rumors' });
  const betBox = el('div', { class: 'gm-section gm-bets', gm: 'bet' });
  const settingsBox = el('div', { class: 'gm-section gm-settings' });
  const footBox = el('div', { class: 'gm-foot gm-prepare-foot' });
  // «Más opciones»: the rumors, the race, the bets and the settings, folded.
  let customizeOpen = null; // null: not toggled yet
  const customize = el('details', { class: 'gm-customize', gm: 'customize' }, el('summary', { text: t.customizeGame }));
  customize.addEventListener('toggle', () => (customizeOpen = customize.open));
  const body = el('div', { class: 'gm-body' });
  root.append(
    el('h2', { class: 'gm-title' }, el('span', { text: t.prepareTitle }), modeTag),
    // The head scrolls with the body: a challenge says a lot before the rumor.
    body,
    // Beside «Empezar», outside the scroll: what it would start, at a glance.
    summaryBox,
    footBox,
  );

  /** The window of hours to tell a rumor at (prepare.js atWindow); null in Teléfono (always at the start). */
  const spreadWindow = () => {
    const d = ctx.draft();
    return d.settings.type === 'telephone' ? null : atWindow(ctx.header(), d.settings);
  };

  const keys = {};
  const changed = (name, key) => {
    if (keys[name] === key) return false;
    keys[name] = key;
    return true;
  };
  const patchSettings = (patch) => {
    const d = ctx.draft();
    ctx.setDraft({ ...d, settings: { ...d.settings, ...patch } });
  };

  // --- Head: the goal, the hours, the duration; a challenge, a friend --------------
  function renderHead() {
    const ch = ctx.challenge();
    const d = ctx.draft();
    const h = ctx.header();
    const friend = ctx.friendLine();
    const mode = d.settings.mode;
    const last = ctx.lastTry?.() ?? null;
    if (!changed('head', JSON.stringify([mode, ch?.id, friend, ctx.notes(), last, d.settings, h?.seed, h?.start_tick, h?.neighbors?.length]))) return;
    // The mode is always labelled (docs/juego.md, «Los dos modos»).
    modeTag.textContent = modeLabel(mode, t);
    modeTag.dataset.mode = mode;
    const g = goalLines(d, { challenge: ch, header: h, t });
    const title = ch ? (ch.title?.[lang] ?? ch.title?.en ?? ch.id) : '';
    // Whether the neighbors are those of the last game (phase 9-5); «Otro pueblo» when the town is the player's.
    const note = ch?.tutorial ? null : villageNote(d.settings, ctx.lastVillage?.() ?? null, t);
    const townFree = !ctx.locks().settings.has('town') && d.settings.type === 'village';
    put(
      head,
      ch ? el('p', { class: 'gm-ch-title', text: ch.tutorial ? fill(t.tutorialHead, { title: title.charAt(0).toLocaleLowerCase() + title.slice(1) }) : fill(t.challengeFixed, { title }) }) : null,
      note
        ? el(
            'p',
            { class: 'gm-village-note' },
            note,
            ' ',
            townFree ? button(t.townRandom, () => patchSettings({ town: randomTown() }), { class: 'gm-btn gm-icon', 'data-key': 'other-town' }) : null,
          )
        : null,
      // The intro of a challenge is in «Retos»; here its parts go one by one.
      el('p', { class: 'gm-goal-line' }, el('strong', { text: g.goal }), ' ', g.hours),
      el('p', { class: 'gm-hint', text: g.duration }),
      ch ? el('p', { class: 'gm-your-part', text: yourPartText(ch, t) }) : null,
      ch ? el('p', { class: 'gm-hint gm-fixed-part', text: fixedPartText(ch, { header: h, lang, t }) }) : null,
      ch ? el('p', { class: 'gm-star-goal', text: starsText(ch, mode, t) }) : null,
      ch ? el('p', { class: 'gm-subject', text: subjectText(ch, { header: h, timetable: timetable(), lang, t }) }) : null,
      friend ? el('p', { class: 'gm-friend', text: friend }) : null,
      last ? el('p', { class: 'gm-last-try', text: last }) : null,
      ...ctx.notes().map((n) => el('p', { class: 'gm-advice', text: n })),
    );
    for (const p of head.querySelectorAll('p')) if (!p.textContent) p.remove();
  }

  // --- «Rumor listo» (phase 9-4) ------------------------------------------------------
  /** The card of a free game ready to start, or null (an editor open, a challenge, a rumor half done). */
  const ready = () =>
    editor ? null : readyCard(ctx.draft(), { header: ctx.header(), lang, t, window: spreadWindow(), timetable: timetable(), proposal: ctx.proposal?.() ?? null });

  /**
   * Puts the boxes in the body. Under «Rumor listo» the list of rumors goes in
   * «Más opciones»; with the editor it stays outside (it says which one is open).
   */
  function layout(card) {
    if (!changed('layout', String(!!card))) return;
    if (card) {
      customize.append(rumorsBox, betBox, settingsBox);
      body.replaceChildren(head, readyBox, editorBox, customize);
    } else {
      customize.append(betBox, settingsBox);
      body.replaceChildren(head, editorBox, rumorsBox, customize);
    }
  }

  /** «Más opciones» opens by itself with several rumors or when a challenge leaves a setting to the player. */
  function renderCustomize() {
    const d = ctx.draft();
    const ch = ctx.challenge();
    const wants = d.rumors.length > 1 || !!d.race || ['type', 'neighbors', 'town', 'trait_mix', 'distortion'].some((k) => (ch?.open ?? []).includes(k));
    const open = customizeOpen ?? wants;
    if (customize.open !== open) customize.open = open;
  }

  function renderReady() {
    const card = ready();
    layout(card);
    const tel = ctx.draft().settings.type === 'telephone';
    if (!changed('ready', JSON.stringify([card, tel]))) return;
    if (!card) return readyBox.replaceChildren();
    put(
      readyBox,
      el('h3', { text: t.ready }),
      el('p', { class: 'gm-ready-news', text: card.news }),
      el('p', { class: 'gm-ready-tell', text: card.tell }),
      card.about ? el('p', { class: 'gm-ready-about', text: card.about }) : null,
      card.propose ? el('p', { class: 'gm-ready-propose' }, card.propose, ' ', button(t.changeTo, changeTo, { class: 'gm-btn gm-icon', 'data-key': 'propose-to' })) : null,
      el('p', { class: 'gm-hint', text: t.readyNeighbors }),
      card.count ? el('p', { class: 'gm-hint', text: card.count }) : null,
      el(
        'div',
        { class: 'gm-ready-actions' },
        // Teléfono has no choice of recipient: the first of the row hears it.
        tel ? null : button(t.changeTo, changeTo, { class: 'gm-btn', gm: 'ready-to' }),
        button(t.editNews, () => openEditor(0), { class: 'gm-btn', gm: 'ready-edit' }),
      ),
    );
  }

  /** «Cambiar a quién»: the editor of the first rumor, on whom to tell (the way of «Probar con otro vecino»). */
  function changeTo() {
    openEditor(0);
    focusTo();
  }

  // --- «Más opciones»: the settings in two groups -------------------------------------
  let groupSeq = 0;
  /** A group of rows under its heading and its hint. */
  function group(title, hint, kids, cls = '') {
    const id = `gm-group-${++groupSeq}`;
    return el(
      'div',
      { class: `gm-group ${cls}`.trim(), role: 'group', 'aria-labelledby': id },
      el('h4', { class: 'gm-group-title', id, text: title }),
      hint ? el('p', { class: 'gm-hint', text: hint }) : null,
      kids,
    );
  }

  function renderSettings() {
    const d = ctx.draft();
    const s = d.settings;
    const locks = ctx.locks().settings;
    const carry = s.type === 'village' && (d.rumors.length > 1 || !!d.race);
    const key = JSON.stringify([s, [...locks], ctx.aiAvailable, carry, ctx.stashed?.() ?? false]);
    if (!changed('settings', key)) return;
    // The tutorial shows what it fixes without «🔒 fijo en este reto» (the controls stay disabled).
    const lk = (k) => ({ locked: locks.has(k) && !ctx.challenge()?.tutorial, lockText: t.locked, lockTag: t.lockedTag });
    const town = el('input', { type: 'number', min: '0', step: '1', class: 'gm-town', value: String(s.town), disabled: locks.has('town'), 'aria-label': t.town });
    town.addEventListener('change', () => {
      const n = Number(town.value);
      if (Number.isInteger(n) && n >= 0) patchSettings({ town: n });
      else town.value = String(s.town);
    });
    const dice = button(t.townRandom, () => patchSettings({ town: randomTown() }), {
      class: 'gm-btn gm-icon',
      title: t.townRandom,
      disabled: locks.has('town'),
    });
    const levels = t.characterLevels;
    const range = el('input', { type: 'range', min: '-2', max: '2', step: '1', value: String(s.trait_mix), disabled: locks.has('trait_mix'), 'aria-label': t.character });
    const level = el('span', { class: 'gm-range-label', text: levels[s.trait_mix + 2] });
    range.addEventListener('input', () => (level.textContent = levels[Number(range.value) + 2]));
    range.addEventListener('change', () => patchSettings({ trait_mix: Number(range.value) }));
    const tel = s.type === 'telephone';
    // What each type lets you watch, and what a change of type does to the rumors, before and after.
    const typeHint = tel
      ? [t.typeTelephoneEffect, ctx.stashed?.() ? t.typeCarried : null].filter(Boolean).join(' ')
      : [t.typeVillageEffect, carry ? t.typeCarry : null].filter(Boolean).join(' ');
    // Con IA is the recommended mode (A2): Sin IA says what it loses, or why Con IA is not there.
    const modeHint = !ctx.aiAvailable ? fill(t.noAiReason, { reason: ctx.aiReason || t.teamNoAi }) : s.mode === 'rules' ? t.rulesLoses : null;
    const neighbors = group(t.groupNeighbors, t.groupNeighborsHint, [
      field(
        t.whoDecides,
        segmented(
          [
            { value: 'ai', label: t.modeAiRecommended, disabled: !ctx.aiAvailable, title: ctx.aiAvailable ? undefined : modeHint },
            { value: 'rules', label: t.modeRules },
          ],
          s.mode,
          (v) => {
            ctx.remember?.({ mode: v });
            patchSettings({ mode: v });
          },
          { disabled: locks.has('mode'), label: t.whoDecides },
        ),
        { ...lk('mode'), hint: modeHint },
      ),
      field(t.character, el('span', { class: 'gm-pair gm-range' }, range, level), { ...lk('trait_mix'), hint: t.characterHint }),
      field(
        t.distortion,
        segmented(
          ['low', 'normal', 'high'].map((k) => ({ value: k, label: t.distortionLevels[k] })),
          s.distortion,
          (v) => patchSettings({ distortion: v }),
          { disabled: locks.has('distortion'), label: t.distortion },
        ),
        { ...lk('distortion'), hint: [t.distortionHint, s.mode === 'ai' ? t.distortionAi : null].filter(Boolean).join(' ') },
      ),
      field(
        t.language,
        segmented(
          [
            { value: 'es', label: t.langEs },
            { value: 'en', label: t.langEn },
          ],
          s.lang,
          (v) => {
            ctx.remember?.({ lang: v });
            patchSettings({ lang: v });
          },
          { label: t.language },
        ),
        { hint: t.languageHint },
      ),
    ]);
    const game = group(t.groupGame, t.groupGameHint, [
      field(
        t.type,
        segmented(
          [
            { value: 'village', label: t.typeVillage, title: t.typeVillageHint },
            { value: 'telephone', label: t.typeTelephone, title: t.typeTelephoneHint },
          ],
          s.type,
          (v) => patchSettings({ type: v }),
          { disabled: locks.has('type'), label: t.type },
        ),
        { ...lk('type'), hint: typeHint },
      ),
      field(
        t.neighbors,
        tel
          ? el('span', { class: 'gm-hint', text: t.neighborsTelephone })
          : segmented(
              neighborsOptions(),
              s.neighbors,
              (v) => patchSettings({ neighbors: v }),
              { disabled: locks.has('neighbors'), label: t.neighbors },
            ),
        { ...lk('neighbors'), hint: neighborsHint(s, t) },
      ),
      // Said before it is changed: another number is another village (phase 9-5).
      field(t.town, el('span', { class: 'gm-pair' }, town, dice), { ...lk('town'), hint: t.townHint }),
    ]);
    settingsBox.replaceChildren(el('h3', { text: t.settings }), neighbors, game);
  }

  // --- Rumor list and race -------------------------------------------------------------
  function renderRumors() {
    const d = ctx.draft();
    const h = ctx.header();
    const win = spreadWindow();
    const eff = ctx.effective(editing());
    const raceOn = raceAvailable(eff) && raceAvailable(d);
    const aside = !raceOn && d.settings.type === 'village' && (ctx.raceStashed?.() || !!d.race);
    const key = JSON.stringify([d.rumors, eff.rumors, d.race, eff.race, raceOn, aside, d.settings, editor ? (editor.index ?? -1) : -2, h?.seed, h?.neighbors?.length, win]);
    if (!changed('rumors', key)) return;
    // The list says what would start, the rumor in the editor as it is now (phase 9-5).
    const items = eff.rumors.map((r, i) => {
      const issues = rumorIssues(r, d.settings, win);
      const saved = i < d.rumors.length;
      return el(
        'li',
        { class: `gm-rumor${issues.length ? ' gm-incomplete' : ''}${editor?.index === i ? ' on' : ''}` },
        el('span', { class: 'gm-rumor-n', text: fill(t.rumorN, { n: i + 1 }) }),
        el('span', { class: 'gm-rumor-line', text: rumorLine(r, h, lang, t) }),
        saved && editor?.index !== i
          ? el(
              'span',
              { class: 'gm-rumor-actions' },
              button(t.editRumor, () => openEditor(i)),
              button(t.removeRumor, () => removeRumor(i)),
            )
          : null,
      );
    });
    const tel = d.settings.type === 'telephone';
    const list = el('ol', { class: 'gm-rumor-list', gm: 'rumor-list' }, items);
    // A draft of a single rumor with the editor open, or nothing in the list yet: the editor says it all.
    if (editor && (!d.rumors.length || maxRumors(d) === 1)) return put(rumorsBox, list);
    put(
      rumorsBox,
      el('h3', { text: t.rumors }),
      el('p', { class: 'gm-hint', text: tel ? t.rumorsTelephone : fill(t.rumorsHint, { n: maxRumors(d) }) }),
      list,
      !editor && canAddRumor(d) ? button(t.addRumor, () => openEditor(null), { class: 'gm-btn', gm: 'rumor-new' }) : null,
      tel || maxRumors(d) < 2 ? null : raceBlock(d, eff, raceOn, aside),
    );
  }

  /** The race: what it is, and its hour and bet with two rumors. */
  function raceBlock(d, eff, raceOn, aside) {
    const lg = d.settings.lang;
    const rows = [el('h4', { text: t.race }), el('p', { class: 'gm-hint', text: t.raceIntro })];
    if (raceOn) {
      const race = eff.race;
      const on = el('input', { type: 'checkbox', checked: !!race });
      on.addEventListener('change', () => ctx.setDraft({ ...ctx.draft(), race: on.checked ? { at: whenText(lg, 'today', '14:00'), pick: 0 } : null }));
      rows.push(el('p', { class: 'gm-hint', text: t.raceCompete }), el('label', { class: 'gm-check' }, on, el('span', { text: t.raceOn })));
      if (race) {
        rows.push(
          field(t.raceAt, hourSelect(race.at, lg, (v) => ctx.setDraft({ ...ctx.draft(), race: { ...race, at: v } }), t.raceAt)),
          field(
            t.racePick,
            segmented(
              // «Rumor 1 · Fiesta»: the same names as the legend and the result.
              [0, 1].map((i) => ({ value: i, label: rumorTitle(t, lang, i, eff.rumors[i]) })),
              race.pick,
              (v) => ctx.setDraft({ ...ctx.draft(), race: { ...race, pick: v } }),
              { label: t.racePick },
            ),
          ),
        );
      }
    } else if (aside) rows.push(el('p', { class: 'gm-hint', text: t.raceNeedsTwo }));
    return el('div', { class: 'gm-race', gm: 'race' }, rows);
  }

  /**
   * A select of the hours inside the game (prepare.js atHours) for a `when`
   * of today: the hour of the race and of the bet «mitad». A value kept from
   * before outside the window stays in the list.
   */
  function hourSelect(value, lg, onChange, label) {
    const now = parseWhen(value)?.time ?? null;
    const hours = atHours(spreadWindow() ?? atWindow(ctx.header(), ctx.draft().settings));
    const list = now && !hours.includes(now) ? [now, ...hours] : hours;
    return select(
      list.map((x) => ({ value: x, label: x })),
      now,
      (v) => onChange(v ? whenText(lg, 'today', v) : null),
      { blank: '—', label },
    );
  }

  /** Removes the rumor i; the editor keeps the rumor it had open (its index moves). */
  function removeRumor(i) {
    const d = ctx.draft();
    if (editor) {
      const at = indexAfterRemove(editor.index, i);
      if (at === -1) {
        editor = null;
        flow.edit();
      } else editor.index = at;
    }
    ctx.setDraft({ ...d, rumors: d.rumors.filter((_, k) => k !== i) });
    renderEditor(true);
    renderRumors();
    notify();
  }

  // --- Rumor editor -------------------------------------------------------------
  /**
   * @type {null|{index: number|null, rumor: object, text: string, error: {field: string, text: string}|null,
   *   outside: string|null, filter: {q: string, trait: string, job: string}, sort: 'name'|'close',
   *   add: {who?: boolean, amount?: boolean}, filled: string[], write: boolean|null,
   *   memo: {neighbors?: string[], place?: string|null, hour?: string|null}}}
   * memo: the last choice of each option of «¿A quién…?» and «¿Cuándo…?» (prepare.js switchTo, switchAt);
   * add: the gaps «de quién» and «cuánto» shown while still empty; filled: the gaps
   * «Rellenar la frase» filled (marked until they are changed); write: «¿Prefieres escribirlo?» open
   */
  let editor = null;
  let autoOpened = false;
  const extractOn = () => ctx.draft().settings.mode === 'ai' && ctx.aiAvailable;
  // Reading the text repaints the editor and the footer (text being read waits, prepare.js textPending).
  const flow = createFlow({
    api: ctx.api,
    lang,
    text: liveText,
    extract: true,
    onChange: () => {
      renderEditor(true);
      renderFoot();
    },
  });
  const newEditor = (index, rumor, text) => ({
    index,
    rumor: structuredClone(rumor),
    text: text ?? '',
    error: null,
    outside: null,
    filter: { q: '', trait: '', job: '' },
    sort: 'name',
    add: {},
    filled: [],
    write: null,
    memo: {},
  });

  /** A new rumor still untouched, with others in the list: it does not stop «Empezar». */
  const pristine = () => !!editor && editor.index === null && ctx.draft().rumors.length > 0 && isBlankRumor(editor.rumor) && !editor.text.trim();

  /** The rumor open in the editor, as index.js and the guide see it (null when untouched). */
  const editing = () => (editor && !pristine() ? { index: editor.index, rumor: editor.rumor, text: editor.text } : null);

  /** Whether the free text is offered (Con IA, the extractor answers, the type is open). */
  const textOn = () => !!editor && extractOn() && flow.state.mode === 'extract' && !ctx.locks().slots.has('what');

  /** Con IA: 'pending' (written, not read), 'busy' (being read) or null (prepare.js textPending). */
  const pendingState = () => (textOn() ? textPending({ text: editor.text, read: editor.rumor.text, busy: flow.state.phase === 'busy' }) : null);

  /** After any change of the editor: «Rumor listo», the summary, the footer and the bus. */
  function notify() {
    renderReady();
    renderRumors();
    renderSummary();
    renderFoot();
    ctx.edited?.(editing());
  }

  function openEditor(index = null, rumor = null, text = null) {
    const d = ctx.draft();
    if (index === null && !canAddRumor(d)) return;
    const ch = ctx.challenge();
    const base = rumor ?? (index !== null ? d.rumors[index] : ch ? challengeRumor(ch) : emptyRumor());
    editor = newEditor(index, base, text ?? base.text ?? '');
    flow.edit();
    renderEditor(true);
    renderRumors();
    renderBets();
    notify();
  }
  function closeEditor() {
    editor = null;
    flow.edit();
    ctx.focusNeighbor?.(null);
    renderEditor(true);
    renderRumors();
    renderBets();
    notify();
  }

  const setFact = (patch) => {
    editor.rumor.fact = { ...editor.rumor.fact, ...patch };
    editor.filled = editor.filled.filter((k) => !(k in patch));
    editor.error = null;
    renderEditor(true);
    renderBets();
    renderRumors();
    notify();
  };

  /** Fills the fact with the example (the slots a challenge leaves open). */
  function useExample() {
    const ex = exampleFact(ctx.header(), ctx.draft().settings.lang, otherRumors());
    const locked = ctx.locks().slots;
    const fact = { ...editor.rumor.fact };
    for (const k of Object.keys(ex)) if (!locked.has(k)) fact[k] = ex[k];
    editor.outside = null;
    setFact(fact);
  }

  /** «Rellenar la frase»: POST extract; true when the sentence now holds what was read. */
  async function understand(sentence) {
    editor.text = sentence;
    editor.outside = null;
    if (editor.error?.field === 'text') editor.error = null;
    const mine = editor;
    const s = await flow.understand({ text: sentence });
    if (!editor || editor !== mine || s.phase !== 'understood' || !flow.pending) {
      if (editor) notify();
      return false;
    }
    const got = extractedFact(flow.pending.fact, ctx.header(), ctx.draft().settings.lang);
    const locked = ctx.locks().slots;
    const fact = { ...editor.rumor.fact };
    const filled = [];
    for (const k of Object.keys(got.fact)) {
      if (locked.has(k)) continue;
      fact[k] = got.fact[k];
      if (got.fact[k] !== null) filled.push(k);
    }
    editor.rumor.fact = fact;
    editor.rumor.text = sentence;
    editor.filled = filled;
    editor.outside = locked.has('what') ? null : got.outside;
    editor.error = null;
    renderEditor(true);
    renderBets();
    renderRumors();
    notify();
    return true;
  }

  /** The rumor of the editor as «Empezar» would send it (normalized: Teléfono, challenge). */
  function editedRumor() {
    const d = ctx.draft();
    const eff = ctx.effective(editing());
    return eff?.rumors?.[editor.index ?? d.rumors.length] ?? editor.rumor;
  }

  /** «cuánta gente», «cuántos euros» with a kind (its unit), «cuánto» without one: the same in the «+» and the gap. */
  const amountText = (what) => (what ? amountLabel(what, L, liveText).toLocaleLowerCase() : t.amountAny);

  /** The rumors of the draft other than the one open in the editor (the example avoids their kind). */
  const otherRumors = () => ctx.draft().rumors.filter((_, i) => i !== editor?.index);

  /** «Esta partida va de las 07:00 a las 00:00: elige una hora dentro.» */
  const outsideText = () => fill(t.atOutside, windowText(spreadWindow()));

  /** Shows an error on a row of the editor and puts the focus there. */
  function showError(name, text) {
    editor.error = { field: name, text };
    renderEditor(true);
    notify();
    const row = editorBox.querySelector(`[data-field="${name}"]`);
    row?.querySelector(ENABLED)?.focus();
  }

  /** Checks the editor: true when complete; else the error by its field, and the focus there. */
  function checkEditor() {
    const issues = rumorIssues(editedRumor(), ctx.draft().settings, spreadWindow());
    if (!issues.length) return true;
    const name = issues.includes('what') ? 'what' : issues.includes('to') ? 'to' : 'at';
    const outside = name === 'at' && atOutside(editedRumor().at, spreadWindow());
    showError(name, name === 'what' ? t.needWhat : name === 'to' ? t.needTo : outside ? outsideText() : t.blockers.incomplete);
    return false;
  }

  /**
   * Brings the row «¿A quién se lo cuentas?» into view and focuses it
   * («Probar con otro vecino», «Cambiar a quién»): the name filter first, the
   * fast way to pick one of 100 by keyboard; else its first enabled control.
   */
  function focusTo() {
    const row = editorBox.querySelector('[data-field="to"]');
    if (!row) return;
    row.scrollIntoView({ block: 'nearest' });
    (row.querySelector('[data-key="to-filter"]:not(:disabled)') ?? row.querySelector(ENABLED))?.focus();
  }

  /** Puts the editor's rumor in the draft; false (and the error shown) when half done. */
  function commit() {
    if (!checkEditor()) return false;
    const d = ctx.draft();
    const rumors = [...d.rumors];
    if (editor.index === null) rumors.push(editor.rumor);
    else rumors[editor.index] = editor.rumor;
    editor = null;
    flow.edit();
    ctx.focusNeighbor?.(null);
    ctx.setDraft({ ...d, rumors });
    renderEditor(true);
    renderRumors();
    renderBets();
    notify();
    return true;
  }

  /**
   * «Guardar» / «Guardar y preparar otro rumor»: with text not read yet (Con
   * IA), it is read first, as «Empezar» does; true when the rumor went to the list.
   */
  async function accept(another = false) {
    if (pristine()) {
      closeEditor();
      return true;
    }
    if (!(await settleText())) return false;
    if (!commit()) return false;
    if (another) openEditor(null);
    return true;
  }

  /**
   * Con IA, before the rumor is taken: text being read waits (an error on the
   * field), text not read yet is read now. true when nothing is pending.
   */
  async function settleText() {
    const p = pendingState();
    if (p === 'busy') {
      showError('text', t.pendingBusy);
      return false;
    }
    if (p === 'pending' && !(await understand(editor.text))) {
      if (editor) showError('text', t.pendingText);
      return false;
    }
    return true;
  }

  /** «Empezar»: what is seen starts; a rumor half done says what it lacks first. */
  async function startPressed() {
    if (ctx.starting()) return;
    // A new rumor never touched is not part of what starts.
    if (pristine()) closeEditor();
    if (editor) {
      if (!(await settleText())) return;
      if (!editor || !commit()) return;
    } else {
      const d = ctx.draft();
      const bad = d.rumors.findIndex((r) => rumorIssues(r, d.settings, spreadWindow()).length);
      if (!d.rumors.length || bad >= 0) {
        openEditor(bad >= 0 ? bad : null);
        if (editor) checkEditor();
        return;
      }
    }
    ctx.start();
  }

  /** A gap fixed by a challenge: its text and a lock. */
  const fixedGap = (text) => el('span', { class: 'gm-fixed', title: t.locked }, text, ' 🔒');

  /**
   * The rumor as a sentence with gaps (phase 9-5): «Una [fiesta ▾] de [Manuel ▾]
   * en [la plaza ▾], [hoy ▾] a las [12:00 ▾], [50] personas.». The same words as
   * prepare.js factSentence; «de quién» and «cuánto» appear with their «+».
   */
  function sentence(h, locks, f, lg) {
    const filled = (k) => (editor.filled.includes(k) ? ' gm-filled' : '');
    const gap = (k, node) => el('span', { class: `gm-gap${filled(k)}`, 'data-gap': k }, node);
    const parts = [];
    // What: «Una fiesta», with its article.
    if (locks.slots.has('what')) parts.push(f.what ? fixedGap(capital(WHAT_A[L][f.what])) : null);
    else {
      parts.push(
        gap(
          'what',
          select(
            WHATS.map((k) => ({ value: k, label: capital(WHAT_A[L][k]) })),
            f.what,
            (v) => {
              editor.outside = null;
              setFact({ what: v || null });
            },
            { blank: t.sentenceWhat, label: t.what, key: 'gap-what' },
          ),
        ),
      );
    }
    // Who: «de Manuel», «para Manuel».
    const join = WHO_JOIN[L][f.what] ?? WHO_JOIN[L].party;
    if (locks.slots.has('who')) {
      if (f.who) parts.push(` ${join} `, fixedGap(nameOf(h, f.who)));
    } else if (f.who || editor.add.who) {
      parts.push(
        ` ${join} `,
        gap(
          'who',
          select(neighborOptions(h), f.who, (v) => setFact({ who: v || null }), { blank: t.sentenceNobody, label: t.who, key: 'who' }),
        ),
        removeGap('who', () => {
          editor.add.who = false;
          setFact({ who: null });
        }),
      );
    }
    // Where: «en la plaza».
    if (locks.slots.has('where')) {
      if (f.where) parts.push(` ${t.sentenceIn} `, fixedGap(placeWithArticle(h, f.where, L)));
    } else {
      const places = (h?.places ?? []).filter((p) => p.kind === 'public').map((p) => ({ value: p.key ?? p.id, label: placeWithArticle(h, p.key ?? p.id, L) }));
      parts.push(
        ` ${t.sentenceIn} `,
        el('span', { class: `gm-gap${filled('where')}`, 'data-gap': 'where', gm: 'rumor-where' }, select(places, f.where, (v) => setFact({ where: v || null }), { blank: t.sentenceNowhere, label: t.where, key: 'where' })),
      );
    }
    // When: «, hoy a las 12:00» (the hour appears with the day).
    const w = parseWhen(f.when);
    if (locks.slots.has('when')) {
      if (w) parts.push(', ', fixedGap(`${dayWords(L)[w.day]} ${t.sentenceAt} ${w.time}`));
    } else {
      const day = select(
        [
          { value: 'today', label: dayWords(L).today },
          { value: 'tomorrow', label: dayWords(L).tomorrow },
        ],
        w?.day ?? '',
        // A day alone gets an hour inside the game (prepare.js defaultWhenTime).
        (v) => setFact({ when: v ? whenText(lg, v, w?.time ?? defaultWhenTime(atWindow(h, ctx.draft().settings))) : null }),
        { blank: t.sentenceNoTime, label: fill(t.dayOf, { label: t.when }), key: 'when-day' },
      );
      const hour = w
        ? [
            ` ${t.sentenceAt} `,
            select(
              HOURS.map((x) => ({ value: x, label: x })),
              w.time,
              (v) => setFact({ when: v ? whenText(lg, w.day, v) : null }),
              { label: fill(t.hourOf, { label: t.when }), key: 'when-hour' },
            ),
          ]
        : [];
      parts.push(', ', el('span', { class: `gm-gap${filled('when')}`, 'data-gap': 'when', gm: 'rumor-when' }, day, hour));
    }
    // How many: «, 50 personas».
    const unit = unitOf(f.what ?? '', L);
    if (locks.slots.has('amount')) {
      if (f.amount !== null && f.amount !== undefined) parts.push(', ', fixedGap([f.amount, unit].filter((x) => x !== '').join(' ')));
    } else if ((f.amount !== null && f.amount !== undefined) || editor.add.amount) {
      const label = amountText(f.what);
      const amount = el('input', { type: 'number', min: '0', step: '1', class: 'gm-amount', 'aria-label': label, 'data-key': 'amount' });
      amount.value = f.amount === null || f.amount === undefined ? '' : String(f.amount);
      amount.addEventListener('change', () => {
        const n = Number(amount.value);
        setFact({ amount: amount.value !== '' && Number.isInteger(n) && n >= 0 ? n : null });
      });
      parts.push(
        ', ',
        gap('amount', amount),
        unit ? ` ${unit}` : null,
        removeGap('amount', () => {
          editor.add.amount = false;
          setFact({ amount: null });
        }),
      );
    }
    parts.push('.');
    return el('p', { class: 'gm-sentence' }, parts);
  }

  /** The «×» that takes a gap out of the sentence. */
  function removeGap(k, onclick) {
    return button('×', onclick, { class: 'gm-btn gm-icon gm-gap-x', title: t.removeSlot, 'aria-label': t.removeSlot, 'data-key': `x-${k}` });
  }

  function renderEditor(force = false) {
    const d = ctx.draft();
    // With no rumor yet the editor is open: the first thing to do is a rumor.
    // A single rumor still half done (a challenge's) opens once too.
    if (!editor && !force) {
      if (!d.rumors.length && maxRumors(d) > 0) return openEditor(null);
      if (!autoOpened && d.rumors.length === 1 && rumorIssues(d.rumors[0], d.settings).length) {
        autoOpened = true;
        return openEditor(0);
      }
    }
    const win = spreadWindow();
    const h = ctx.header();
    const ctxKey = JSON.stringify([d.settings, h?.seed, h?.neighbors?.length, [...ctx.locks().slots], d.rumors.length, win, !!timetable()]);
    if (!changed('editorCtx', ctxKey) && !force) return;
    if (!editor) return editorBox.replaceChildren();
    // Keep the focus and the scroll of the neighbor list across the repaint.
    const active = document.activeElement;
    const focusKey = active && editorBox.contains(active) ? (active.dataset?.key ?? null) : null;
    const cardsScroll = editorBox.querySelector('.gm-cards')?.scrollTop ?? 0;

    const locks = ctx.locks();
    const r = editor.rumor;
    const f = r.fact;
    const lg = d.settings.lang;
    const tel = d.settings.type === 'telephone';
    const err = (name) => (editor.error?.field === name ? editor.error.text : null);
    const lockOf = (on) => ({ locked: on && !ctx.challenge()?.tutorial, lockText: t.locked, lockTag: t.lockedTag });
    const about = [sentence(h, locks, f, lg)];

    // «+ de quién» · «+ cuánta gente»: the optional gaps, added to the sentence.
    const adds = [];
    // The tutorial keeps to what it teaches: no optional gaps, no saving (start launches it).
    const tutorial = !!ctx.challenge()?.tutorial;
    if (!tutorial && !locks.slots.has('who') && !f.who && !editor.add.who) {
      adds.push(button(t.addWho, () => addGap('who'), { class: 'gm-btn gm-add', 'data-key': 'add-who' }));
    }
    if (!tutorial && !locks.slots.has('amount') && (f.amount === null || f.amount === undefined) && !editor.add.amount) {
      const label = amountText(f.what);
      adds.push(button(fill(t.addAmount, { label }), () => addGap('amount'), { class: 'gm-btn gm-add', 'data-key': 'add-amount' }));
    }
    if (adds.length) about.push(el('div', { class: 'gm-adds' }, adds));

    // The seven kinds, with their icon.
    if (!locks.slots.has('what')) {
      about.push(
        el(
          'div',
          { class: `gm-types${err('what') ? ' gm-invalid' : ''}`, 'data-field': 'what' },
          el('div', { class: 'gm-label' }, `${t.what} `, el('span', { class: 'gm-hint', text: t.typesHint })),
          segmented(
            WHATS.map((k) => ({ value: k, label: `${WHAT_ICON[k]} ${whatName(k, L)}` })),
            f.what,
            (v) => {
              editor.outside = null;
              setFact({ what: v });
            },
            { gm: 'rumor-what', key: 'what', label: t.what },
          ),
          err('what') ? el('div', { class: 'gm-error gm-field-error', role: 'alert', text: err('what') }) : null,
        ),
      );
    }

    // The example: shown while the type is still empty («Usar este ejemplo»).
    if (!locks.slots.has('what') && !f.what) {
      const line = factSentence(exampleFact(h, lg, otherRumors()), { header: h, lang });
      about.push(
        el(
          'div',
          { class: 'gm-example' },
          el('span', { class: 'gm-hint', text: fill(t.exampleLine, { fact: line }) }),
          button(t.useExample, useExample, { class: 'gm-btn', gm: 'rumor-example', 'data-key': 'example' }),
        ),
      );
    }

    if (textOn()) about.push(writeBox(f, err));

    // Where and when move people; tomorrow, nobody goes today.
    const placeTime = !locks.slots.has('where') || !locks.slots.has('when');
    if (placeTime && !(f.where && f.when)) about.push(el('p', { class: 'gm-hint gm-tip', text: t.whereWhenHint }));
    // An hour the game does not reach: a warning, not a ban (phase 9-5).
    const late = lateWarning(f, atWindow(h, d.settings), d.settings, t);
    if (late) about.push(el('p', { class: 'gm-advice', role: 'status', text: late }));
    else if (parseWhen(f.when)?.day === 'tomorrow') about.push(el('p', { class: 'gm-advice', text: t.tomorrowWarn }));

    const spread = [];
    if (tel) {
      spread.push(field(t.to, el('span', { class: 'gm-hint', text: fill(t.toFirst, { name: nameOf(h, firstOfRowOf(h)) }) }), { name: 'to', gm: 'rumor-to' }));
      spread.push(field(t.at, el('span', { class: 'gm-hint', text: fill(t.atStartAt, { time: clockText(h?.start_tick ?? 0) }) }), { name: 'at' }));
    } else {
      spread.push(el('div', { class: 'gm-stack' }, field(t.to, toControls(h, locks), { ...lockOf(locks.to), name: 'to', gm: 'rumor-to', error: err('to') })));
      spread.push(el('div', { class: 'gm-stack' }, atField(locks, win, err('at'), lockOf)));
    }

    // One main button, «Empezar» in the footer: these are secondary (phase 9-5).
    const canLeave = d.rumors.length > 0;
    const after = editor.index === null ? d.rumors.length + 1 : d.rumors.length;
    const busy = flow.state.phase === 'busy';
    const actions = tutorial
      ? null
      : el(
          'div',
          { class: 'gm-actions' },
          canLeave ? button(editor.error ? t.discard : t.cancel, closeEditor, { 'data-key': 'cancel' }) : null,
          button(t.saveRumor, () => accept(false), { gm: 'rumor-add', disabled: busy, 'data-key': 'accept' }),
          after < maxRumors(d) ? button(t.saveAnother, () => accept(true), { disabled: busy, 'data-key': 'another' }) : null,
        );
    const title = editor.index === null ? (d.rumors.length ? t.addRumor : t.yourRumor) : fill(t.rumorN, { n: editor.index + 1 });
    put(
      editorBox,
      el('h3', { text: title }),
      el('div', { class: 'gm-group gm-about' }, about),
      el('div', { class: 'gm-group gm-spread' }, spread),
      actions,
    );

    const cards = editorBox.querySelector('.gm-cards');
    if (cards) cards.scrollTop = cardsScroll;
    if (focusKey) for (const node of editorBox.querySelectorAll('[data-key]')) if (node.dataset.key === focusKey) node.focus({ preventScroll: true });
  }

  /** Shows an optional gap of the sentence and puts the focus in it. */
  function addGap(k) {
    editor.add[k] = true;
    renderEditor(true);
    editorBox.querySelector(`[data-key="${k}"]`)?.focus();
  }

  /**
   * «✎ ¿Prefieres escribirlo?» (Con IA): the text and «Rellenar la frase»,
   * which fills the sentence above and says so. Open while there is text, and
   * in the tutorial (the guide points at it).
   */
  function writeBox(f, err) {
    const area = el('textarea', { class: 'gm-free', rows: 2, placeholder: t.freeTextHint, gm: 'rumor-text', 'aria-label': t.freeText, 'data-key': 'text' });
    area.value = editor.text;
    let readLine = null;
    area.addEventListener('input', () => {
      editor.text = area.value;
      if (readLine) readLine.hidden = !!pendingState();
      notify();
    });
    const busy = flow.state.phase === 'busy';
    const ok = button(busy ? t.understanding : t.understand, () => understand(area.value), {
      class: 'gm-btn gm-primary',
      gm: 'understood',
      disabled: busy,
      'data-key': 'understood',
    });
    const s = flow.state;
    // «Lo he interpretado así ↑» once read, while the text is the one read.
    const fresh = s.phase === 'understood' && !pendingState() && !!f.what;
    readLine = fresh ? el('div', { class: 'gm-understood', text: t.filled }) : null;
    const open = editor.write ?? (!!editor.text.trim() || !!ctx.challenge()?.tutorial);
    const box = el(
      'details',
      { class: `gm-write gm-text${err('text') ? ' gm-invalid' : ''}`, 'data-field': 'text', open },
      el('summary', { text: t.freeText }),
      el('div', { class: 'gm-free-row' }, area, ok),
      readLine,
      ...s.notes.map((n) => el('div', { class: 'gm-hint', text: n })),
      s.error ? el('div', { class: 'gm-error', text: s.error }) : null,
      editor.outside ? el('div', { class: 'gm-error', text: fill(t.pickWhat, { what: editor.outside }) }) : null,
      err('text') ? el('div', { class: 'gm-error gm-field-error', role: 'alert', text: err('text') }) : null,
    );
    // «Empezar» can close the editor before the toggle fires: nothing to keep then.
    box.addEventListener('toggle', () => {
      if (editor) editor.write = box.open;
    });
    return box;
  }

  /** The first of the row in Teléfono (prepare.js firstOfRow, through the effective draft). */
  function firstOfRowOf(h) {
    return editedRumor()?.to?.neighbors?.[0] ?? h?.neighbors?.[0]?.id ?? null;
  }

  /**
   * The controls of «¿A quién se lo cuentas?»: the cards of the neighbors
   * (core/neighbors.js), sorted and filtered, or a place with who is usually
   * there at that hour.
   */
  function toControls(h, locks) {
    const r = editor.rumor;
    const byPlace = !Array.isArray(r.to?.neighbors);
    const max = toLimit(locks);
    // The subject of the challenge: told by you (the priest) or hearing it (the guest), no stars.
    const warn = subjectWarning(ctx.challenge(), h, t);
    const toModes = [
      { value: 'neighbors', label: t.toNeighbors },
      locks.toPlace ? { value: 'place', label: t.toPlace, title: t.toPlaceHint } : null,
    ].filter(Boolean);
    const controls = [
      segmented(
        toModes,
        byPlace && locks.toPlace ? 'place' : 'neighbors',
        (v) => {
          // The option already on keeps its choice; going back recovers the last one.
          const next = switchTo(editor.rumor.to, v, editor.memo, { header: h, max });
          editor.rumor.to = next.to;
          editor.memo = next.memo;
          editor.error = null;
          ctx.focusNeighbor?.(null);
          renderEditor(true);
          notify();
        },
        { disabled: locks.to, key: 'to-mode', label: t.to },
      ),
    ];
    const hour = tellHour(r, h);
    const time = `${String(hour).padStart(2, '0')}:${isHalf(r.at) ? '30' : '00'}`;
    if (byPlace && locks.toPlace) {
      // Each place says who is usually there at that hour (core/neighbors.js peopleAt).
      const tt = timetable();
      const names = (key) => peopleAt(h, tt, key, hour).map((id) => nameOf(h, id));
      const options = (h?.places ?? []).map((p) => {
        const k = p.key ?? p.id;
        const name = placeWithArticle(h, k, L);
        if (!tt) return { value: k, label: capital(name) };
        const who = names(k);
        return { value: k, label: who.length ? fill(t.placeWho, { place: capital(name), names: shortList(who) }) : fill(t.placeNobody, { place: capital(name) }) };
      });
      const chosen = r.to?.place ?? null;
      const here = chosen && tt ? names(chosen) : null;
      controls.push(
        select(
          options,
          chosen,
          (v) => {
            editor.rumor.to = { place: v || null };
            editor.error = null;
            renderEditor(true);
            notify();
          },
          { blank: '—', disabled: locks.to, label: t.toPlace, key: 'to-place' },
        ),
        here ? el('span', { class: 'gm-hint gm-wide', text: here.length ? fill(t.placeAt, { time, names: nameList(here, t) }) : fill(t.placeEmpty, { time }) }) : null,
        warn && here?.includes(nameOf(h, warn.id)) && ctx.challenge()?.zero_if === 'told_directly'
          ? el('span', { class: 'gm-advice gm-wide', role: 'alert', text: fill(t.warnPlace, { name: nameOf(h, warn.id) }) })
          : null,
        el('span', { class: 'gm-hint gm-wide', text: t.toPlaceHint }),
      );
      return controls;
    }
    const chosen = r.to?.neighbors ?? [];
    const full = max > 1 && chosen.length >= max;
    const warnChosen = warn && chosen.includes(warn.id) ? el('span', { class: 'gm-advice gm-wide', role: 'alert', text: `${nameOf(h, warn.id)}: ${warn.text.charAt(0).toLocaleLowerCase()}${warn.text.slice(1)}` }) : null;
    const tt = timetable();
    const profiles = sortCards(
      (h?.neighbors ?? []).map((n) => neighborProfile(h, tt, n.id, lang)).filter(Boolean),
      editor.sort,
    );
    const atHour = r.at !== 'start' && isHourText(r.at) ? r.at : null;
    const cards = profiles.map((p) => {
      const on = chosen.includes(p.id);
      const cb = el('input', { type: 'checkbox', checked: on, disabled: locks.to || (full && !on), 'data-key': `to:${p.id}` });
      cb.addEventListener('change', () => {
        editor.rumor.to = { neighbors: pickRecipient(editor.rumor.to?.neighbors ?? [], p.id, cb.checked, max) };
        editor.error = null;
        renderEditor(true);
        notify();
      });
      const lines = cardLines(p, { header: h, timetable: tt, at: atHour ?? 'start', lang, t });
      const card = el(
        'label',
        {
          class: `gm-card${on ? ' on' : ''}`,
          gm: 'neighbor-card',
          'data-id': p.id,
          'data-name': fold(p.name),
          'data-trait': p.trait ?? '',
          'data-job': p.jobKey ?? '',
        },
        cb,
        el(
          'span',
          { class: 'gm-card-body' },
          el('span', { class: 'gm-card-head' }, el('strong', { text: p.name }), ` · ${p.job}`),
          // Three short signs, always in the same place, to compare cards at a glance.
          el(
            'span',
            { class: 'gm-card-signs' },
            lines.signs.map((x, i) => el('span', { class: 'gm-sign', title: i === 1 ? t.signCloseTitle : undefined, text: x })),
          ),
          el('span', { class: 'gm-card-trait' }, `${p.traitIcon} `, lines.trait),
          el('small', { text: lines.ties }),
          el('small', { text: [lines.home, lines.usual].filter(Boolean).join(' · ') }),
          lines.now ? el('small', { class: 'gm-card-now', text: lines.now }) : null,
          warn?.id === p.id ? el('small', { class: 'gm-card-warn', text: warn.text }) : null,
        ),
      );
      // The map marks where the neighbor lives and spends the day (render/preview.js).
      const enter = () => ctx.focusNeighbor?.(p);
      const leave = () => ctx.focusNeighbor?.(null);
      card.addEventListener('mouseenter', enter);
      card.addEventListener('mouseleave', leave);
      card.addEventListener('focusin', enter);
      card.addEventListener('focusout', leave);
      return card;
    });
    const list = el('div', { class: 'gm-cards' }, cards);
    const search = el('input', { type: 'search', class: 'gm-filter', placeholder: t.searchName, 'aria-label': t.searchName, 'data-key': 'to-filter', disabled: locks.to });
    // A search that hides every card says so, with a way back.
    const none = el(
      'div',
      { class: 'gm-nomatch gm-wide', hidden: true, role: 'status' },
      el('span', { class: 'gm-hint', text: t.noMatch }),
      button(
        t.clearFilter,
        () => {
          editor.filter = { q: '', trait: '', job: '' };
          search.value = '';
          if (traitSel) traitSel.value = '';
          if (jobSel) jobSel.value = '';
          applyFilter();
          search.focus();
        },
        { 'data-key': 'to-clear' },
      ),
    );
    // The filters hide cards without repainting (the focus stays where it is).
    const applyFilter = () => {
      const q = fold(editor.filter.q);
      for (const c of cards) {
        c.hidden =
          (!!q && !c.dataset.name.includes(q)) ||
          (!!editor.filter.trait && c.dataset.trait !== editor.filter.trait) ||
          (!!editor.filter.job && c.dataset.job !== editor.filter.job);
      }
      none.hidden = cards.some((c) => !c.hidden);
    };
    search.value = editor.filter.q;
    search.addEventListener('input', () => {
      editor.filter.q = search.value;
      applyFilter();
    });
    // With 100 neighbors: by character and by job too.
    let traitSel = null;
    let jobSel = null;
    if ((h?.neighbors ?? []).length > 25) {
      traitSel = select(
        TRAITS.map((k) => ({ value: k, label: `${TRAIT_ICON[k]} ${gendered(rumorText.traits, k, 'm')}` })),
        editor.filter.trait,
        (v) => {
          editor.filter.trait = v;
          applyFilter();
        },
        { blank: t.anyTrait, label: t.filterTrait, key: 'to-trait' },
      );
      const jobs = new Map();
      for (const p of profiles) if (p.jobKey && !jobs.has(p.jobKey)) jobs.set(p.jobKey, gendered(rumorText.jobs, p.jobKey, 'm'));
      jobSel = select(
        [...jobs].map(([value, label]) => ({ value, label })).sort(byName),
        editor.filter.job,
        (v) => {
          editor.filter.job = v;
          applyFilter();
        },
        { blank: t.anyJob, label: t.filterJob, key: 'to-job' },
      );
    }
    applyFilter();
    const sort = segmented(
      [
        { value: 'name', label: t.sortName },
        { value: 'close', label: t.sortClose },
        { value: 'talk', label: t.sortTalk },
      ],
      editor.sort,
      (v) => {
        editor.sort = v;
        renderEditor(true);
      },
      { key: 'to-sort', label: t.sortBy },
    );
    controls.push(
      el('span', { class: 'gm-hint gm-wide', text: NEIGHBOR[L].relationsHint }),
      el('div', { class: 'gm-tools gm-wide' }, el('span', { class: 'gm-hint', text: `${t.sortBy}:` }), sort, traitSel, jobSel),
      search,
      el('span', { class: 'gm-chosen gm-wide', role: 'status', text: fill(t.chosenOf, { n: chosen.length, max }) }),
      warnChosen,
      // The limit is said, so a change from one game to another is not a surprise.
      el('span', { class: 'gm-hint gm-wide', text: max === 1 ? t.maxOne : fill(t.maxMany, { n: max }) }),
      none,
      list,
    );
    return controls;
  }

  /** «¿Cuándo se lo cuentas?»: «Nada más empezar (07:00)» or «Más tarde, a las…» inside the game (prepare.js atHours). */
  function atField(locks, win, error, lockOf) {
    const r = editor.rumor;
    // Fixed by the challenge: one line of text, no disabled controls.
    if (locks.at) {
      const text = r.at === 'start' || !r.at ? fill(t.atFixedStart, { time: clockText(ctx.header()?.start_tick ?? 0) }) : fill(t.atFixedHour, { time: r.at });
      return field(t.at, el('span', { class: 'gm-hint', text }), { ...lockOf(true), name: 'at' });
    }
    const atHour = r.at !== 'start';
    const hours = atHours(win);
    // A draft of before with an hour outside the game keeps showing it, said wrong.
    const outside = atHour && atOutside(r.at, win);
    const options = (outside && !hours.includes(r.at) ? [r.at, ...hours] : hours).map((x) => ({ value: x, label: x }));
    return field(
      t.at,
      [
        segmented(
          [
            { value: 'start', label: fill(t.atStartAt, { time: clockText(ctx.header()?.start_tick ?? 0) }) },
            { value: 'hour', label: t.atHour },
          ],
          atHour ? 'hour' : 'start',
          (v) => {
            const next = switchAt(editor.rumor.at, v, editor.memo, win);
            editor.rumor.at = next.at;
            editor.memo = next.memo;
            if (editor.error?.field === 'at') editor.error = null;
            renderEditor(true);
            notify();
          },
          { disabled: locks.at, key: 'at', label: t.at },
        ),
        atHour
          ? select(
              options,
              r.at,
              (v) => {
                editor.rumor.at = v || 'start';
                if (editor.error?.field === 'at') editor.error = null;
                renderEditor(true);
                notify();
              },
              { disabled: locks.at, label: t.atHour, key: 'at-hour' },
            )
          : null,
      ],
      { ...lockOf(locks.at), name: 'at', hint: t.atHint, error: error ?? (outside ? outsideText() : null) },
    );
  }

  // --- The live summary --------------------------------------------------------------
  // Under «Rumor listo» the card says it all; otherwise the rumor being edited
  // (or the only one), and how many rumors go in when there are more.
  function renderSummary() {
    const d = ctx.draft();
    const parts = [];
    if (!ready()) {
      const n = ctx.effective(editing())?.rumors?.length ?? 0;
      // A rumor that still lacks something says nothing here: the footer already
      // says what it lacks (blockerLines), and saying it twice was noise.
      const whole = (r) => !rumorIssues(r, d.settings).length;
      if (editing() && !isBlankRumor(editedRumor())) {
        if (whole(editedRumor())) parts.push(rumorSummary(editedRumor(), { header: ctx.header(), lang, t }));
      } else if (d.rumors.length === 1 && whole(d.rumors[0])) parts.push(rumorSummary(d.rumors[0], { header: ctx.header(), lang, t }));
      if (n > 1) parts.push(countText(t, n));
    }
    const text = parts.join(' ');
    if (summaryBox.textContent !== text) summaryBox.textContent = text;
    summaryBox.hidden = !text;
  }

  // --- Bets ---------------------------------------------------------------------------
  // They read the effective draft (what «Empezar» would start), and write the draft.
  function renderBets() {
    const d = ctx.draft();
    const eff = ctx.effective(editing());
    const h = ctx.header();
    const lg = d.settings.lang;
    // «¿Cuántos acudirán a la plaza a las 12:00?» needs a place and an hour, in the
    // draft (where it is kept) and in what would start.
    const att = attendOf(eff) && attendOf(d) ? attendOf(eff) : null;
    const key = [d.bets, eff.rumors.length, att, lg, h?.seed, h?.neighbors?.length, spreadWindow()];
    if (!changed('bets', JSON.stringify(key))) return;
    const bets = d.bets ?? { attend: null, half: null, last: null };
    const setBets = (patch) => ctx.setDraft({ ...ctx.draft(), bets: { ...bets, ...patch } });
    let attendRow;
    if (att) {
      const ask = fill(t.betAttendOf, { place: placeWithArticle(h, att.place, lang), time: parseWhen(att.when)?.time ?? att.when });
      const attend = el('input', { type: 'number', min: '0', step: '1', class: 'gm-amount', 'aria-label': ask });
      attend.value = bets.attend ?? '';
      attend.addEventListener('change', () => setBets({ attend: attend.value === '' ? null : Number(attend.value) }));
      attendRow = field(ask, attend);
    } else attendRow = el('p', { class: 'gm-hint', text: t.betAttendNeeds });
    put(
      betBox,
      el('h3', { text: t.bet }),
      el('p', { class: 'gm-hint', text: t.betHint }),
      eff.rumors.length > 1 ? el('p', { class: 'gm-hint', text: t.betFirst }) : null,
      attendRow,
      field(t.betHalf, hourSelect(bets.half, lg, (v) => setBets({ half: v }), t.betHalf)),
      field(t.betLast, select(neighborOptions(h), bets.last, (v) => setBets({ last: v || null }), { blank: '—', label: t.betLast })),
    );
  }

  // --- Footer -------------------------------------------------------------------
  // The one main button: «Empezar», saying what it does (prepare.js startLabel).
  function renderFoot() {
    const eff = ctx.effective(editing());
    const violations = ctx.violations();
    const win = spreadWindow();
    const pending = pendingState();
    const blockers = startBlockers(eff, { checkRunning: ctx.checkRunning(), aiAvailable: ctx.aiAvailable, violations, busy: ctx.busy(), window: win, pending });
    const hard = hardBlockers(blockers);
    const why = blockerLines(eff, blockers, { t, window: win, pending });
    const errors = ctx.errors();
    const label = ctx.starting() ? t.starting : startLabel(eff, { header: ctx.header(), lang, t });
    const key = JSON.stringify([why, hard, violations, errors, ctx.starting(), label]);
    if (!changed('foot', key)) return;
    put(
      footBox,
      el(
        'div',
        { class: 'gm-why' },
        why.map((w) => el('div', { class: 'gm-hint', text: w })),
        violations.map((v) => el('div', { class: 'gm-error', text: v })),
        errors.map((e) => el('div', { class: 'gm-error', role: 'alert', text: e })),
      ),
      el(
        'div',
        { class: 'gm-actions' },
        button(t.menu, () => ctx.menu()),
        // Only what the player cannot fix here disables it: a half-done rumor is explained on press.
        button(label, startPressed, {
          class: 'gm-btn gm-primary gm-start',
          gm: 'start',
          disabled: hard.length > 0 || ctx.starting(),
        }),
      ),
    );
  }

  function update() {
    renderHead();
    renderEditor();
    renderReady();
    renderCustomize();
    renderSummary();
    renderRumors();
    renderBets();
    renderSettings();
    renderFoot();
    ctx.edited?.(editing());
  }

  /** Opens again an editor kept across a reload or a change of type. */
  function reopen(e) {
    if (!e?.rumor) return;
    openEditor(e.index ?? null, e.rumor, e.text ?? '');
  }

  // The editor of the first paint: one kept across a reload (or the menu), or
  // the example of a new free game, which goes to the list ready to start
  // («Rumor listo»; a challenge and the guide open the editor as before).
  const first = ctx.initialEditor?.() ?? null;
  if (first?.example) {
    const d = ctx.draft();
    // Told to the neighbor proposed (the one the end card advised, or the one with most reasons).
    if (!d.rumors.length && !d.challenge) ctx.setDraft({ ...d, rumors: [exampleRumor(ctx.header(), d.settings.lang, ctx.newProposal?.(ctx.header())?.id ?? null)] });
  } else if (first?.rumor) {
    editor = newEditor(first.index ?? null, first.rumor, first.text ?? '');
    autoOpened = true;
  }
  update();
  // A free game in a village new to the player: the neighbors' cards open at once (phase 9-5).
  let toFirst = first?.focus === 'to' && !!editor;
  if (!first?.rumor && ready() && sameVillage(ctx.draft().settings, ctx.lastVillage?.() ?? null) === false) {
    openEditor(0);
    toFirst = true;
  }
  // Once, at creation: the screen is put in the page right after, so wait a frame.
  if (toFirst) requestAnimationFrame(() => root.isConnected && editor && focusTo());
  return { el: root, update, openEditor, editing, reopen };
}

const isHourText = (v) => typeof v === 'string' && /^([01]\d|2[0-3]):[03]0$/.test(v);
const isHalf = (v) => isHourText(v) && v.endsWith(':30');
/** «Carmen, Luis…»: two names at most in an option of a select. */
const shortList = (names) => (names.length > 2 ? `${names.slice(0, 2).join(', ')}…` : names.join(', '));
