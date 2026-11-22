// During and after a game: the bar with the mode label, the goal, the wait of
// the first rumor and «Terminar ya», and the game card at the end. The card
// opens on the result and one main action («Probar con otro vecino»); bets,
// «¿Quién fue?», «Compartir» and the day summary fold under «Más detalles»
// (phase 9-4). «Ver el resumen del día» opens the 8-2 card of the end of the
// day (summary/final.js, through the ⤢ of the summary card) and folds this
// one into a pill. Phase 9-5 makes the card teach how to play better: the
// score with its unit and against the try before, who moved the rumor and
// where it stopped, and «¿Quién fue?» with each change as before → after.
// Scoring is package D's (score/index.js), read through a namespace so a
// missing function only leaves its part out.
//
//   ┌ .gm-bar (top centre) ─────────────────────────────────────────────┐
//   │ [Con IA] Partida libre                ●Rumor 1 ●Rumor 2 [Terminar ya]│  data-gm mode-label, stop
//   │          Objetivo: a cuántos vecinos llega hasta las 13:00          │  data-gm goal
//   │          Ana ya lo sabe. Aún no se lo ha contado a nadie.           │  data-gm bar-status
//   └────────────────────────────────────────────────────────────────────┘
//     «Terminar ya» asks first, in the bar itself (focus on «Seguir jugando», Escape cancels):
//     ¿Terminar ahora? Se puntúa lo que haya. (La carrera de las 14:00…) [Terminar] [Seguir jugando]
//                                   ┌ .gm-end (right) ──────────────┐
//                                   │ FIN DE LA PARTIDA [Con IA]    │  data-gm final
//                                   │ Una fiesta en la plaza, …     │
//                                   │ Resultado ★★☆                 │
//                                   │ Tu marca: 14 de 25 vecinos    │
//                                   │ Faltan 3 vecinos para ★★★     │
//                                   │ La otra vez, … Ahora, 2 más.  │
//                                   │ Carrera · Reto del amigo      │
//                                   │ Quién lo movió (top 3)        │  data-gm movers
//                                   │ Dónde se paró                 │  data-gm stopped
//                                   │ [Probar con otro vecino]      │  data-gm retry
//                                   │ [Repetir igual][Volver al menú]  data-gm again, new
//                                   │ ▸ Más detalles                │  data-gm end-more
//                                   │   [Ver el resumen del día]    │  data-gm day-summary
//                                   │   Apuestas (de 10)            │
//                                   │   ¿Quién fue? [pick][Ver]     │  data-gm whodidit
//                                   │   Compartir                   │  data-gm share
//                                   └───────────────────────────────┘

import { clockOf, MINUTES_PER_DAY, slotTick, slotTime } from '../core/clock.js';
import { PUBLIC_WEB_URL } from '../core/links.js';
import { claimSummary, slotValueText, whatName } from '../core/names.js';
import { neighborProfile, peopleAt } from '../core/neighbors.js';
import { isTell } from '../rumor/history.js';
import { RACE_COLORS } from '../rumor/race.js';
import { fill } from '../rumor/strings.js';
import { add, button, copyText, el } from './dom.js';
import { factSentence, modeLabel, placeWithArticle } from './prepare.js';
import { starText } from './profile.js';
import * as score from './score/index.js';

/** Calls a scoring function of package D; null when it is missing or throws. */
export function scoreCall(name, ...args) {
  const fn = score[name];
  if (typeof fn !== 'function') return null;
  try {
    return fn(...args);
  } catch (err) {
    console.error(`game: score.${name} failed`, err);
    return null;
  }
}

/** A challenge code read (score/ decodeCode), or null when it cannot be read. */
export function readCode(text) {
  try {
    const p = typeof score.decodeCode === 'function' ? score.decodeCode(text) : null;
    return p && typeof p === 'object' && p.settings ? p : null;
  } catch {
    return null;
  }
}

/**
 * The two facts of a race, in the order of the draft's rumors (rumor 1, rumor
 * 2): score/race.js raceFactsByDraft. With the draft's rumors it gives both
 * or none (a rumor still to enter leaves it empty); without them, the first
 * two facts injected, in inject order.
 * @param {object[]} events
 * @param {object[]|null} [rumors] the rumors of the draft or game
 * @returns {string[]}
 */
export function raceFacts(events, rumors = null) {
  if (Array.isArray(rumors) && rumors.length) {
    const byDraft = scoreCall('raceFactsByDraft', rumors, { header: null, events: events ?? [] });
    if (Array.isArray(byDraft)) {
      const two = byDraft.slice(0, 2);
      return two.length === 2 && two.every(Boolean) ? two : [];
    }
  }
  const out = [];
  for (const e of events ?? []) {
    if (e.type === 'inject' && e.fact && !out.includes(e.fact)) out.push(e.fact);
    if (out.length === 2) break;
  }
  return out;
}

/** The `what` of a fact, from its inject. */
const whatOf = (events, fact) => (fact ? ((events ?? []).find((e) => e.type === 'inject' && e.fact === fact)?.what ?? null) : null);

/** The type of a rumor for a label: «Fiesta». */
function whatLabel(what, lang) {
  const s = whatName(what, lang === 'es' ? 'es' : 'en');
  return s.charAt(0).toLocaleUpperCase() + s.slice(1);
}

/** «Rumor 1 · Fiesta» (k from 0), or «Rumor 1» without a type. */
function rumorName(t, lang, k, what) {
  return what ? fill(t.rumorWhat, { n: k + 1, what: whatLabel(what, lang) }) : fill(t.rumorN, { n: k + 1 });
}

/** The two colours of a race on the map, with each rumor's number and type. */
export function raceLegend({ t, lang, facts, events }) {
  return el(
    'span',
    { class: 'gm-race-legend' },
    ...facts.map((f, i) =>
      el(
        'span',
        { class: 'gm-race-chip' },
        el('i', { class: 'gm-race-dot', style: `background:${RACE_COLORS[i]}` }),
        el('span', { text: rumorName(t, lang, i, whatOf(events, f)) }),
      ),
    ),
  );
}

/** Whether the page is served by this computer (the link of «Compartir» would name it). */
export const isLocalHost = (host) => ['localhost', '127.0.0.1', '::1', '[::1]'].includes(host ?? '');

/**
 * The link of «Reto del amigo» for `code`: on the web, this very page (its
 * folder and file kept); on this computer, the public web version
 * (core/links.js), or null while there is none.
 */
export function friendLink(code, loc = globalThis.location, publicUrl = PUBLIC_WEB_URL) {
  const query = `?play=1&code=${encodeURIComponent(code)}`;
  if (!isLocalHost(loc?.hostname)) return `${loc.origin}${loc.pathname}${query}`;
  return publicUrl ? `${publicUrl}${query}` : null;
}

/** A tick as "HH:MM" of its day, without the header. */
function hhmm(tick) {
  const m = ((Math.floor(tick) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** «Ana», «Ana y Luis», «Ana, Luis y Eva», «Ana, Luis, Eva y 4 más». */
function namesText(t, header, ids) {
  const names = ids.map((id) => (header?.neighbors ?? []).find((n) => n.id === id)?.name ?? id);
  if (names.length > 3) return fill(t.namesMore, { names: names.slice(0, 3).join(', '), n: names.length - 3 });
  return names.length > 1 ? `${names.slice(0, -1).join(', ')}${t.and}${names[names.length - 1]}` : (names[0] ?? '');
}

/** «Objetivo: a cuántos vecinos llega hasta las 13:00»; free play measures informed_end (score/index.js gameScore). */
export function goalText(t, challenge, draft) {
  const measure = t.goalMeasures?.[challenge?.measure ?? 'informed_end'];
  if (!measure) return '';
  const goal = fill(t.goal, { measure });
  const until = draft?.settings?.until;
  return until ? `${goal} ${fill(t.goalUntil, { time: until })}` : goal;
}

/**
 * What the first rumor of the draft is waiting for, in the log as shown
 * (events[0..index)): before its inject, when it goes at an hour, «Se lo
 * contarás a Ana a las 10:00» (or «Se contará en la plaza…»); after it, until
 * somebody tells it to a neighbor who did not know it, «Ana ya lo sabe. Aún no
 * se lo ha contado a nadie.»; then nothing ('').
 * @param {object} t
 * @param {object|null} draft
 * @param {object} header
 * @param {object[]} events
 * @param {number} index
 * @param {string} [lang] for the article of a place
 * @returns {string}
 */
export function firstRumorStatus(t, draft, header, events, index, lang = 'es') {
  const rumor = draft?.rumors?.[0];
  if (!rumor) return '';
  const shown = (events ?? []).slice(0, index);
  const fact = scoreCall('raceFactsByDraft', draft.rumors, { header, events: shown })?.[0] ?? null;
  if (!fact) {
    if (typeof rumor.at !== 'string' || !/^\d{1,2}:\d{2}$/.test(rumor.at)) return '';
    if (rumor.to?.place) return fill(t.willDrop, { place: placeWithArticle(header, rumor.to.place, lang), time: rumor.at });
    const ids = rumor.to?.neighbors ?? [];
    return ids.length ? fill(t.willTell, { to: namesText(t, header, ids), time: rumor.at }) : '';
  }
  const inject = shown.find((e) => e.type === 'inject' && e.fact === fact);
  const knew = new Set(inject?.to ?? []);
  if (!knew.size) return '';
  if (shown.some((e) => isTell(e) && e.fact === fact && !knew.has(e.to))) return '';
  return fill(knew.size === 1 ? t.toldWaiting : t.toldWaitingMany, { to: namesText(t, header, [...knew]) });
}

/**
 * The bar shown while playing (and in the replay of a played game).
 * Beside the title, while playing: the goal («Objetivo: …») and what the
 * first rumor is waiting for (firstRumorStatus), redone when the shown log
 * moves (store.index).
 * «Terminar ya» asks before ending, in the bar: «Terminar» calls onStop, and
 * a false answer leaves a warning beside the button. With a race whose hour
 * has not come yet (the last event of `events()`), the question says it will
 * stay undecided. The question takes the focus on «Seguir jugando»; Escape
 * and «Seguir jugando» give it back to «Terminar ya».
 * @param {object} o
 * @param {() => Promise<boolean>|boolean} [o.onStop] null: no «Terminar ya» (replay, ended)
 * @param {{at: string|number}|null} [o.race] the draft's race
 * @param {() => object[]} [o.events] the events so far
 * @param {object|null} [o.challenge] the challenge file (null: free play)
 * @param {object|null} [o.draft] the draft played; without it, no goal nor status (replay)
 * @param {import('../core/store.js').Store|null} [o.store]
 * @param {object|null} [o.header]
 */
export function createBar({ t, mode, title, onStop = null, extra = [], race = null, events = null, challenge = null, draft = null, store = null, header = null, lang = 'es' }) {
  let stop = null;
  let ask = null;
  let warn = null;
  if (onStop) {
    const raceTick = race ? scoreCall('tickOfTime', race.at) : null;
    const pending = () => {
      if (!Number.isFinite(raceTick)) return false;
      const list = events?.() ?? [];
      const last = list.length ? list[list.length - 1].tick : -Infinity;
      return last < raceTick;
    };
    warn = el('span', { class: 'gm-error gm-bar-warn', role: 'alert' });
    warn.hidden = true;
    const raceLine = el('span', { class: 'gm-bar-race' });
    const yes = button(t.stopYes, async () => {
      yes.disabled = true;
      no.disabled = true;
      yes.textContent = t.stopping;
      let ok = false;
      try {
        ok = (await onStop()) === true;
      } catch {
        ok = false;
      }
      if (!ok) {
        show(false);
        warn.textContent = t.stopFailed;
        warn.hidden = false;
        stop.focus();
      }
    }, { class: 'gm-btn gm-stop-yes', gm: 'stop-yes' });
    const no = button(t.stopNo, () => {
      show(false);
      stop.focus();
    }, { class: 'gm-btn', gm: 'stop-no' });
    ask = el('span', { class: 'gm-bar-ask', role: 'group', 'aria-label': t.stop }, el('span', { text: t.stopAsk }), raceLine, yes, no);
    ask.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || yes.disabled) return; // not while it is stopping
      e.preventDefault();
      e.stopPropagation();
      show(false);
      stop.focus();
    });
    const show = (asking) => {
      ask.hidden = !asking;
      stop.hidden = asking;
      yes.disabled = false;
      no.disabled = false;
      yes.textContent = t.stopYes;
      if (!asking) return;
      warn.hidden = true;
      raceLine.textContent = pending() ? fill(t.stopRace, { at: hhmm(raceTick) }) : '';
      raceLine.hidden = !raceLine.textContent;
      no.focus(); // the safe answer first: Enter twice does not end the game
    };
    // `stop` stays a direct child of the bar: the race legend goes before it.
    stop = button(t.stop, () => show(true), { class: 'gm-btn gm-stop', gm: 'stop' });
    ask.hidden = true;
  }

  // The goal and the wait of the first rumor (phase 9-4), under the title.
  const titleEl = el('span', { class: 'gm-bar-title', text: title });
  let head = titleEl;
  let status = null;
  let off = null;
  if (draft) {
    const goal = goalText(t, challenge, draft);
    status = el('span', { class: 'gm-bar-status', 'aria-live': 'polite', gm: 'bar-status' });
    head = el('span', { class: 'gm-bar-head' }, titleEl, goal ? el('span', { class: 'gm-bar-goal', gm: 'goal', text: goal }) : null, status);
    if (store) {
      let seen = -1;
      const refresh = () => {
        if (store.index === seen) return;
        seen = store.index;
        const text = firstRumorStatus(t, draft, header ?? store.header, store.events, store.index, lang);
        if (status.textContent !== text) status.textContent = text;
        status.hidden = !text;
      };
      off = store.subscribe(refresh);
      refresh();
    } else status.hidden = true;
  }

  const bar = el(
    'div',
    { class: 'gm-bar card-in' },
    el('span', { class: `gm-mode gm-mode-${mode}`, gm: 'mode-label', text: modeLabel(mode, t) }),
    head,
    ...extra,
    stop,
    ask,
    warn,
  );
  return {
    el: bar,
    ended() {
      stop?.remove();
      ask?.remove();
      warn?.remove();
      off?.();
      status?.remove();
    },
  };
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** The template of a count, {one, many} (or a plain string), for n. */
const plural = (tpl, n) => (tpl && typeof tpl === 'object' ? (n === 1 ? tpl.one : tpl.many) : tpl);

/** A neighbor's name from the header, or its id. */
const nameOf = (header, id) => (header?.neighbors ?? []).find((n) => n.id === id)?.name ?? id ?? '?';

/** A value of a bet or a measure for people: a neighbor's name, a time, a number. */
function valueText(v, header, lang) {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string' && /^n\d+$/.test(v)) return (header.neighbors ?? []).find((n) => n.id === v)?.name ?? v;
  if (typeof v === 'object') return v.label ?? v.text ?? JSON.stringify(v);
  return String(v);
}

/** A tick as "14:30" in the village clock. */
function tickTime(tick, header, lang) {
  if (!isNum(tick)) return String(tick ?? '—');
  try {
    return clockOf(tick, header.start_weekday ?? 0, lang).time ?? String(tick);
  } catch {
    return String(tick);
  }
}

/** The value of a score ({value} of gameScore, or a number), or null. */
export const scoreValue = (s) => (isNum(s) ? s : isNum(s?.value) ? s.value : null);

/** A score as text: its value, or «—» when it does not score. */
export function scoreText(s) {
  const v = scoreValue(s);
  return v === null ? '—' : String(v);
}

/**
 * The score with the unit of its measure: «14 de 25 vecinos», «1 minuto antes
 * de las 14:00», «9 puntos».
 * @param {object} t
 * @param {string} label the measure key (gameScore label)
 * @param {number} value
 * @param {number} total neighbors of the village
 * @param {string} [deadline] "HH:MM", for the measures in minutes before it
 */
export function markText(t, label, value, total, deadline = '') {
  const tpl = plural(t.marks?.[label], value);
  return tpl ? fill(tpl, { n: value, total, deadline }) : String(value);
}

/** The stars won out of three, with the mode: «2 de 3 estrellas (Con IA)». */
export function starsOfMaxText(t, stars, mode) {
  return fill(t.starsOfMax, { n: stars, mode: modeLabel(mode, t) });
}

/**
 * What is missing for the next star: «Te faltan 15 minutos para la siguiente
 * estrella: ★★★», «Te falta 1 vecino para la siguiente estrella: ★★».
 */
export function nextStarText(t, label, next) {
  const unit = plural(t.gapUnits?.[label], next.gap) ?? '';
  return fill(plural(t.nextStar, next.gap), { gap: next.gap, unit, stars: '★'.repeat(next.stars) }).replace(/ {2,}/g, ' ');
}

/**
 * Who a challenge is about, as the subject of a clause: «el cura, Francisco,»,
 * «el homenajeado, Manuel,» (the `who` of a party), else the bare name.
 * @param {object} t
 * @param {import('./score/measures.js').Log} log
 * @param {'priest'|'who'} kind challenge.subject
 * @param {string} id neighbor id
 */
export function subjectText(t, log, kind, id) {
  const name = nameOf(log.header, id);
  if (kind === 'priest') return fill(t.subjectPriest, { name });
  const gender = (log.header?.neighbors ?? []).find((n) => n.id === id)?.gender === 'f' ? 'f' : 'm';
  if (kind === 'who' && scoreCall('injectOf', log)?.what === 'party') return fill(t.subjectGuest[gender], { name });
  return name;
}

/**
 * Why a challenge does not score: «No puntúa: el cura (Francisco) no se enteró
 * antes de las 14:00».
 * @param {object} t
 * @param {string} label the measure key
 * @param {{subject?: string|null, deadline?: string}} o subject: who the
 *   challenge is about, as text; deadline: "HH:MM"
 */
export function notScoredText(t, label, { subject = null, deadline = '' } = {}) {
  const tpl = t.notScoredBy?.[label];
  // A reason about somebody needs to know who (a village without priest has none).
  const ok = tpl && (subject || !tpl.includes('{name}'));
  return fill(t.notScored, { why: ok ? fill(tpl, { name: subject, deadline }) : t.notScoredWhy });
}

/**
 * The score of this game against the try before («Probar con otro vecino»,
 * prepare.js retryCarry `last`): with the measure of free play (informed_end)
 * the difference, else what happened then; null without a try before.
 * @param {object} t
 * @param {{name: string, n: number, total: number}|null} last
 * @param {string} label
 * @param {number|null} value
 * @returns {string|null}
 */
export function lastTryLine(t, last, label, value) {
  if (!last) return null;
  if (label !== 'informed_end' || !isNum(value)) return fill(t.lastTryOther, last);
  const diff = value - last.n;
  const tpl = diff > 0 ? t.lastTryVs.more : diff < 0 ? t.lastTryVs.less : t.lastTryVs.same;
  return fill(tpl, { ...last, diff: Math.abs(diff) });
}

/**
 * The rumor as the engine injected it, as a sentence: «Una fiesta de Manuel en
 * la plaza, hoy a las 22:00, 50 personas» (prepare.js factSentence); the short
 * form of the claim when its type is not one of the seven; null without inject.
 * @param {import('./score/measures.js').Log} log
 * @param {string|null} fact
 * @param {string} lang
 */
export function originalText(log, fact, lang) {
  const inj = scoreCall('injectOf', log, fact);
  if (!inj) return null;
  const s = inj.slots ?? {};
  const when = isNum(s.when) ? `${slotTick(s.when) >= MINUTES_PER_DAY ? 'tomorrow' : 'today'} ${slotTime(s.when)}` : null;
  const sentence = factSentence({ what: inj.what, who: s.who ?? null, where: s.where ?? null, when, amount: s.amount ?? null }, { header: log.header, lang });
  return sentence ?? claimSummary(s, log.header, inj.what);
}

/**
 * One change of a hop of «¿Quién fue?» (score/culprit.js HopChange) as words:
 * «cambió la hora: 21:00 → 22:00», «se le olvidó el sitio».
 * @param {object} t
 * @param {object} header
 * @param {{slot: string, from: any, to: any, cause: string|null}} d
 * @returns {{text: string, distorted: boolean}} distorted: a value other than
 *   the one the speaker had reached the listener (forgetting is not distorting)
 */
export function hopChangeText(t, header, d) {
  const slot = t.slotThe?.[d.slot] ?? t.slotNames?.[d.slot] ?? d.slot;
  const v = (x) => slotValueText(d.slot, x, header);
  if (d.to === null || d.to === undefined) {
    const forgot = d.cause === 'forgot' || d.cause === 'omission';
    return { text: fill(forgot ? t.hopForgot : t.hopLost, { slot }), distorted: false };
  }
  if (d.from === null || d.from === undefined) return { text: fill(t.hopAdded, { slot, to: v(d.to) }), distorted: true };
  if (d.from === d.to) return { text: fill(t.hopSure, { slot, to: v(d.to) }), distorted: false };
  return { text: fill(t.hopChanged, { slot, from: v(d.from), to: v(d.to) }), distorted: true };
}

/**
 * «Quién lo movió»: the three neighbors who told the rumor most
 * (score/measures.js topTellers), with their job and where they told it most.
 * @returns {string[]|null} one line each; [] when nobody told it; null when it cannot be worked out
 */
export function moverLines(t, log, fact, lang) {
  const top = scoreCall('topTellers', log, fact, 3);
  if (!Array.isArray(top)) return null;
  return top.map((m) => {
    const p = neighborProfile(log.header, null, m.who, lang);
    const who = [p?.name ?? m.who, p?.job].filter(Boolean).join(', ');
    const line = fill(plural(t.movedLine, m.tells), { who, n: m.tells });
    return m.place ? line + fill(t.movedWhere, { place: placeWithArticle(log.header, m.place, lang) }) : line;
  });
}

/** Neighbors shown in «Dónde se paró»; the rest go as «y 3 más». */
const MAX_STOPPED = 4;

/**
 * «Dónde se paró»: who knew the rumor and told nobody (score/measures.js
 * keptQuiet), each with their character and its phrase.
 * @returns {{n: number, lines: string[]}|null} n: how many; lines: the first ones
 */
export function stoppedLines(t, log, fact, lang) {
  const quiet = scoreCall('keptQuiet', log, fact);
  if (!Array.isArray(quiet)) return null;
  const end = scoreCall('endTick', log);
  const lines = quiet.slice(0, MAX_STOPPED).map((x) => {
    const p = neighborProfile(log.header, null, x.who, lang);
    const who = [p?.name ?? x.who, p?.traitName].filter(Boolean).join(', ');
    const line = p?.traitPhrase ? fill(t.stoppedLine, { who, phrase: p.traitPhrase }) : who;
    // When: one who heard it in the last hour had hardly any time to tell it.
    const late = isNum(end) && end - x.tick <= LATE_MINUTES;
    return `${line} · ${fill(late ? t.stoppedWhenLate : t.stoppedWhen, { time: tickTime(x.tick, log.header, lang) })}`;
  });
  return { n: quiet.length, lines };
}

/**
 * «Tu mejor marca en este pueblo»: the best score of the games played before
 * in the same town (number, kind of game and neighbors), with the same measure
 * and the same mode. All measures are «higher is better» (score/challenges.js).
 * @param {{games?: object[], marks?: object, challenges?: object[]}|null} past
 *   games: GET /games (each {id, settings, challenge}); marks: profile.games
 *   ({id: {score, stars}}); challenges: the challenge files (for their measure)
 * @param {{id: string|null, settings: object, measure: string, mode: 'ai'|'rules'}} now this game
 * @returns {number|null} null without such a game
 */
export function bestMark(past, now) {
  const measures = new Map((past?.challenges ?? []).map((c) => [c?.id, c?.measure]));
  const measureOf = (g) => (g.challenge ? (measures.get(g.challenge) ?? null) : 'informed_end');
  const s = now.settings ?? {};
  let best = null;
  for (const g of past?.games ?? []) {
    const gs = g?.settings ?? {};
    const score = past?.marks?.[g?.id]?.score;
    if (!g || g.id === now.id || !isNum(score)) continue;
    if (gs.town !== s.town || gs.type !== s.type || gs.neighbors !== s.neighbors) continue;
    if ((gs.mode === 'rules' ? 'rules' : 'ai') !== now.mode || measureOf(g) !== now.measure) continue;
    if (best === null || score > best) best = score;
  }
  return best;
}

/** «Casi al final»: heard it in the last hour of the game. */
const LATE_MINUTES = 60;

/** Characters that tell a lot (core/neighbors.js TALK above 1). */
const TALKATIVE = ['gossip', 'sociable', 'exaggerator'];

/** A place is busy when this many neighbors are usually there at the central hour of the day spent there. */
const BUSY_PEOPLE = 5;

/**
 * Why a neighbor would spread a rumor well, only with strong data
 * (neighborProfile): a talkative character, family and friends among the most
 * of the village (the top quarter, at least one), and a day spent where many
 * neighbors usually are (peopleAt at the central hour; needs the timetable).
 * @param {object} header
 * @param {object|null} timetable GET /timetable (null: the busy place is not used)
 * @param {string} id
 * @param {string} lang
 * @param {number} closeTop the fewest family and friends that count as «many»
 * @returns {{trait: string|null, close: number|null, busy: string|null}|null}
 *   each reason or null; null when none holds
 */
export function strongReasons(header, timetable, id, lang, closeTop) {
  const p = neighborProfile(header, timetable, id, lang);
  if (!p) return null;
  const trait = TALKATIVE.includes(p.trait) ? p.trait : null;
  const close = p.close > 0 && p.close >= closeTop ? p.close : null;
  let busy = null;
  const u = p.usual;
  if (timetable && u?.key && Number.isInteger(u.from) && Number.isInteger(u.to)) {
    const hour = Math.floor((u.from + u.to - 1) / 2);
    if (peopleAt(header, timetable, u.key, hour).length >= BUSY_PEOPLE) busy = u.key;
  }
  return trait || close || busy ? { trait, close, busy } : null;
}

/**
 * The neighbor to try next: one the player did not tell, with the most strong
 * reasons (strongReasons); ties go to more family and friends, then by name.
 * The end card gives its id to the game (createEndCard → recommended), so the
 * next game can offer it.
 * @param {import('./score/measures.js').Log} log
 * @param {string|null} fact
 * @param {object|null} timetable
 * @param {string} lang
 * @returns {{id: string, profile: object, reasons: {trait: string|null, close: number|null, busy: string|null}}|null}
 */
export function recommendNeighbor(log, fact, timetable, lang) {
  const header = log.header;
  const told = new Set(scoreCall('injectOf', log, fact)?.to ?? []);
  const all = (header?.neighbors ?? []).map((n) => neighborProfile(header, timetable, n.id, lang)).filter(Boolean);
  const closes = all.map((p) => p.close).sort((a, b) => b - a);
  const closeTop = closes.length ? closes[Math.floor((closes.length - 1) / 4)] : Infinity;
  let pick = null;
  for (const p of all) {
    if (told.has(p.id)) continue;
    const r = strongReasons(header, timetable, p.id, lang, closeTop);
    if (!r) continue;
    const n = [r.trait, r.close, r.busy].filter((x) => x !== null).length;
    const better = !pick || n > pick.n || (n === pick.n && (p.close > pick.p.close || (p.close === pick.p.close && p.name.localeCompare(pick.p.name) < 0)));
    if (better) pick = { p, r, n };
  }
  return pick ? { id: pick.p.id, profile: pick.p, reasons: pick.r } : null;
}

/**
 * How to reach more (free play and the tutorial, without a reference): the
 * neighbor to try next (recommendNeighbor) and why; without one, a hint with
 * no name.
 * @param {object} t
 * @param {import('./score/measures.js').Log} log
 * @param {string|null} fact
 * @param {object|null} timetable
 * @param {string} lang
 * @param {ReturnType<typeof recommendNeighbor>} [rec] already worked out
 * @returns {string}
 */
export function reachTip(t, log, fact, timetable, lang, rec = recommendNeighbor(log, fact, timetable, lang)) {
  if (!rec) return t.tipNone;
  const header = log.header;
  const { profile: p, reasons: r } = rec;
  const reasons = [
    r.trait ? fill(t.reasonTrait[r.trait], { trait: p.traitName }) : null,
    r.close ? fill(t.reasonClose, { n: r.close }) : null,
    r.busy ? fill(t.reasonBusy, { place: placeWithArticle(header, r.busy, lang) }) : null,
  ].filter(Boolean);
  const list = reasons.length > 1 ? `${reasons.slice(0, -1).join(', ')}${t.and}${reasons[reasons.length - 1]}` : reasons[0];
  return fill(t.tipNamed, { name: p.name, reasons: list });
}

/**
 * When the hour of the rumor came after the end of the game and nobody went:
 * «La fiesta era a las 21:00, después del final (13:00): nadie llegó a ir.»; in
 * a game cut short by «Terminar ya», «Terminaste la partida a las 11:56, antes
 * de la fiesta (12:00): nadie llegó a ir.»
 * Null otherwise (no place or hour, the hour within the game, or somebody came).
 * @param {object} t
 * @param {import('./score/measures.js').Log} log
 * @param {string|null} fact
 * @param {string} lang
 * @returns {string|null}
 */
export function lateHourText(t, log, fact, lang) {
  const inj = scoreCall('injectOf', log, fact);
  const when = inj?.slots?.when;
  const end = scoreCall('endTick', log);
  if (!isNum(when) || inj.slots.where === null || inj.slots.where === undefined || !isNum(end)) return null;
  if (slotTick(when) <= end || scoreCall('attendOk', log, inj.fact) !== 0) return null;
  const what = t.whatThe?.[inj.what] ?? whatName(inj.what, lang === 'es' ? 'es' : 'en');
  // Cut short by «Terminar ya»: the log ends before the planned end (header
  // params.end_tick, the engine's fit_end with `until`), and that is the reason.
  const planned = log.header?.params?.end_tick;
  const cut = isNum(planned) && end < planned;
  const text = fill(cut ? t.lateHourStopped : t.lateHour, { what, time: slotTime(when), end: tickTime(end, log.header, lang) }).replace(/\bde el\b/g, 'del');
  return text.charAt(0).toLocaleUpperCase() + text.slice(1);
}

/**
 * Free play with several rumors: who heard about some rumor and each rumor in
 * draft order («Rumor 1 · Fiesta: 21 de 25»), the figure of the 8-2 day card
 * for that rumor (summary/build.js counts one fact). With one rumor, what the
 * score counts.
 */
function reachLines(t, lang, log, game, value, total) {
  const facts = scoreCall('factsOf', log) ?? [];
  if (facts.length < 2) return [el('p', { class: 'gm-hint', text: t.measures.informed_end })];
  const byDraft = game.rumors?.length ? scoreCall('raceFactsByDraft', game.rumors, log) : null;
  const known = Array.isArray(byDraft) ? byDraft.filter(Boolean) : [];
  const rows =
    known.length === facts.length
      ? byDraft.map((f, k) => ({ f, name: rumorName(t, lang, k, whatOf(log.events, f)) })).filter((x) => x.f)
      : facts.map((f) => ({ f, name: whatLabel(whatOf(log.events, f) ?? f, lang) }));
  const lines = rows.map(({ f, name }) => {
    const n = scoreCall('informedEnd', log, [f])?.size ?? 0;
    return el('li', { text: fill(t.reachRumor, { name, n, total }) });
  });
  return [el('p', { class: 'gm-hint', text: fill(t.reachAny, { n: value, total }) }), el('ul', { class: 'gm-lines gm-reach' }, lines)];
}

/**
 * Opens the summary of the day: the 8-2 card, through the ⤢ button of the
 * summary card (summary/index.js). False when the summary is not on the page.
 * @param {Document} [doc]
 * @returns {boolean}
 */
export function openDaySummary(doc = globalThis.document) {
  const b = doc?.querySelector?.('#summary .sm-expand');
  if (!b) return false;
  b.click();
  return true;
}

/**
 * Creates the game card.
 * @param {object} o
 * @param {object} o.t strings
 * @param {string} o.lang
 * @param {{header: object, events: object[]}} o.log
 * @param {object} o.game {id, settings, rumors, challenge, bets, race}
 * @param {object|null} o.challenge the challenge file
 * @param {'ai'|'rules'} o.mode
 * @param {string|null} o.fact the rumor of «¿Quién fue?», «Quién lo movió» and «Dónde se paró» (app.factId())
 * @param {string|null} o.friendCode the code the game came from (?code=)
 * @param {{games: object[], marks: object, challenges: object[]}|null} [o.past] the games played
 *   before (GET /games), their scores (profile.games) and the challenge files: «Tu mejor
 *   marca en este pueblo» (bestMark)
 * @param {object|null} [o.timetable] app.timetable (GET /timetable): the tip says where a neighbor spends the day
 * @param {{name: string, n: number, total: number}|null} [o.lastTry] the try before, after
 *   «Probar con otro vecino» (prepare.js parseCarry `last`): the score is compared with it
 * @returns {{el: HTMLElement, pill: HTMLElement, recommended: string|null}} recommended: the id
 *   of the neighbor to try next (recommendNeighbor), or null
 * @param {{retry?: () => void, again?: () => void, newGame?: () => void, onScored?: (r: object) => void, back?: string}} o.actions
 *   retry: «Probar con otro vecino» (phase 9-3), only when the draft allows it (prepare.js retryCarry)
 */
export function createEndCard({ t, lang, log, game, challenge, mode, fact, friendCode, lastTry = null, past = null, timetable = null, actions = {}, download = null }) {
  const { header } = log;
  const root = el('section', { class: 'gm-end card-in', gm: 'final', role: 'dialog', 'aria-label': t.endTitle });
  const pill = button(t.yourGame, () => setFolded(false), { class: 'gm-btn gm-primary gm-end-pill' });
  pill.hidden = true;
  const setFolded = (v) => {
    root.hidden = v;
    pill.hidden = !v;
  };
  const total = (header.neighbors ?? []).length;
  const facts = scoreCall('factsOf', log) ?? [];
  // The neighbor to try next (returned for the next game, and said in the tip).
  const recommended = fact ? recommendNeighbor(log, fact, timetable, lang) : null;

  // The rumor a section is about, when there are several: «Rumor 2 · Boda».
  const rumorOfFact = () => {
    const byDraft = game.rumors?.length ? scoreCall('raceFactsByDraft', game.rumors, log) : null;
    const k = Array.isArray(byDraft) ? byDraft.indexOf(fact) : -1;
    const what = whatOf(log.events, fact);
    return k >= 0 ? rumorName(t, lang, k, what) : whatLabel(what ?? fact ?? '', lang);
  };
  const sectionTitle = (title) => (facts.length > 1 && fact ? fill(t.sectionOf, { title, rumor: rumorOfFact() }) : title);

  // --- Result -------------------------------------------------------------------
  // gameScore: {value, stars, label: measure key, zero, next}; stars null in free play.
  const result = el('div', { class: 'gm-section gm-result' }, el('h3', { text: t.result }));
  const mine = scoreCall('gameScore', game, log, challenge);
  const stars = mine && Number.isInteger(mine.stars) ? mine.stars : null;
  if (stars !== null) {
    result.append(el('div', { class: 'gm-stars gm-big', text: starText(stars) }));
    result.append(el('p', { class: 'gm-hint gm-stars-of', text: starsOfMaxText(t, stars, mode) }));
  }
  if (!mine) result.append(el('p', { class: 'gm-hint', text: t.scoreMissing }));
  else {
    const label = mine.label;
    const value = scoreValue(mine);
    // Who the challenge is about and its deadline (else the end of the game).
    const subjectId = challenge?.subject ? scoreCall('subjectOf', challenge, log) : null;
    const subject = subjectId ? subjectText(t, log, challenge.subject, subjectId) : null;
    const deadline = challenge?.deadline ?? tickTime(scoreCall('endTick', log), header, lang);
    if (value === null) result.append(el('p', { class: 'gm-score', text: notScoredText(t, label, { subject, deadline }) }));
    else {
      result.append(el('p', { class: 'gm-score gm-mark', text: fill(t.yourScore, { score: t.score, value: markText(t, label, value, total, deadline) }) }));
      if (!challenge && label === 'informed_end') result.append(...reachLines(t, lang, log, game, value, total));
      else if (t.measures[label] && (subject || !t.measures[label].includes('{name}'))) {
        result.append(el('p', { class: 'gm-hint', text: fill(t.measures[label], { deadline, name: subject }) }));
      }
    }
    if (mine.zero) {
      const place = mine.zero === 'told_directly' ? game.rumors?.[0]?.to?.place : null;
      const why =
        mine.zero === 'told_directly'
          ? place
            ? fill(t.zeroToldAtPlace, { name: subject ?? '?', place: placeWithArticle(header, place, lang) })
            : fill(t.zeroToldDirectly, { name: subject ?? '?' })
          : fill(t.zeroSubjectInformed, { name: subject ?? '?' });
      result.append(el('p', { class: 'gm-error', text: fill(t.zeroStars, { why }) }));
    }
    if (stars !== null && stars < 3 && !mine.zero && mine.next) {
      result.append(el('p', { class: 'gm-next', text: nextStarText(t, label, mine.next) }));
    }
    // Free play and the tutorial (the reach, no stars) have nothing to win: the
    // reference is the try before or the best score in this town; with neither,
    // how to reach more.
    const open = label === 'informed_end' && stars === null && isNum(value);
    if (open) result.append(el('p', { class: 'gm-hint gm-no-win', text: t.noWin }));
    const before = lastTryLine(t, lastTry, label, value);
    const town = game.settings?.town ?? header.seed ?? null;
    const best = bestMark(past, { id: game.id ?? null, settings: { ...game.settings, town }, measure: label, mode });
    const bestLine = best !== null ? fill(t.bestMark, { value: markText(t, label, best, total, deadline) }) : null;
    const tip = open && !before && bestLine === null ? reachTip(t, log, fact, timetable, lang, recommended) : null;
    for (const text of [before, bestLine, tip]) if (text) result.append(el('p', { class: 'gm-hint gm-last-try', text }));
    const late = lateHourText(t, log, fact, lang);
    if (late) result.append(el('p', { class: 'gm-hint gm-late', text: late }));
  }

  // --- Who moved it, where it stopped ---------------------------------------------------
  // Only once the rumor reached somebody: both read the followed rumor (`fact`).
  let movers = null;
  let stopped = null;
  if (fact && (scoreCall('arrivalOrder', log, fact)?.length ?? 0) > 0) {
    const lines = moverLines(t, log, fact, lang);
    if (lines) {
      movers = el(
        'div',
        { class: 'gm-section gm-movers', gm: 'movers' },
        el('h3', { text: sectionTitle(t.movedTitle) }),
        lines.length ? el('ol', { class: 'gm-lines' }, lines.map((text) => el('li', { text }))) : el('p', { class: 'gm-hint', text: t.movedNone }),
      );
    }
    const q = stoppedLines(t, log, fact, lang);
    if (q) {
      stopped = el('div', { class: 'gm-section gm-stopped', gm: 'stopped' }, el('h3', { text: sectionTitle(t.stoppedTitle) }));
      if (!q.n) stopped.append(el('p', { class: 'gm-hint', text: t.stoppedNone }));
      else {
        stopped.append(
          el('p', { class: 'gm-hint', text: fill(plural(t.stoppedHint, q.n), { n: q.n }) }),
          el('ul', { class: 'gm-lines' }, q.lines.map((text) => el('li', { text })), q.n > q.lines.length ? el('li', { class: 'gm-hint', text: fill(t.stoppedMore, { n: q.n - q.lines.length }) }) : null),
        );
      }
    }
  }

  // --- Bets -----------------------------------------------------------------------
  // Each part scores 0..10 (score/bets.js); the total is out of 10 per part scored.
  let bets = null;
  if (game.bets) {
    const b = scoreCall('scoreBets', game.bets, log);
    const lines = [];
    const asks = { attend: t.betAttend, half: t.betHalf, last: t.betLast };
    let parts = 0;
    for (const k of ['attend', 'half', 'last']) {
      const guess = game.bets[k];
      if (guess === null || guess === undefined) continue;
      const r = b?.[k];
      // A prediction of attendance without a place and a time is not scored (score/bets.js).
      if (k === 'attend' && b && r === null) continue;
      const actual = r && typeof r === 'object' ? (r.actual ?? r.value ?? null) : null;
      const points = isNum(r) ? r : isNum(r?.points) ? r.points : null;
      if (points !== null) parts++;
      const none = actual === null && r ? (k === 'half' ? t.betNoHalf : k === 'last' ? t.betNobody : null) : null;
      const actualText = k === 'half' && isNum(actual) ? tickTime(actual, header, lang) : valueText(actual, header, lang);
      const said = none ? fill(t.betGuessNone, { guess: valueText(guess, header, lang), actual: none }) : fill(t.betGuess, { guess: valueText(guess, header, lang), actual: actualText });
      lines.push(
        el(
          'li',
          {},
          el('strong', { text: asks[k] }),
          ' ',
          el('span', { text: said }),
          points !== null ? el('b', { class: 'gm-points', text: ` · ${fill(t.points, { n: points })}` }) : null,
        ),
      );
    }
    const sum = isNum(b?.total) ? b.total : null;
    bets = el(
      'div',
      { class: 'gm-section gm-bets-result' },
      el('h3', { text: t.bets }),
      el('ul', { class: 'gm-lines' }, lines),
      sum !== null && parts ? el('p', { class: 'gm-score', text: fill(t.totalPoints, { n: sum, max: 10 * parts }) }) : null,
    );
  }

  // --- Race -----------------------------------------------------------------------
  // raceResult: {at, facts, counts, winner, hit, interrupted, end}, rumor 1 = the draft's first.
  let race = null;
  if (game.race) {
    const r = scoreCall('raceResult', game.race, log, game.rumors);
    if (r) {
      const name = (k) => rumorName(t, lang, k, whatOf(log.events, r.facts?.[k]) ?? game.rumors?.[k]?.fact?.what ?? null);
      const at = isNum(r.at) ? tickTime(r.at, header, lang) : String(game.race.at ?? '');
      const counts = el('ul', { class: 'gm-lines' }, (r.counts ?? []).map((n, k) => el('li', { text: fill(t.raceCount, { name: name(k), n }) })));
      race = el('div', { class: 'gm-section gm-race-result' }, el('h3', { text: t.race }));
      if (r.interrupted) {
        race.append(
          el('p', { class: 'gm-race-cut', text: fill(t.raceInterrupted, { end: tickTime(r.end, header, lang) }) }),
          counts,
          el('p', { class: 'gm-hint', text: fill(t.raceUndecided, { at }) }),
        );
      } else {
        race.append(
          el('p', { text: fill(t.raceResult, { at }) }),
          counts,
          el('p', { text: Number.isInteger(r.winner) ? fill(t.raceWinner, { name: name(r.winner) }) : t.raceTie }),
          el('p', { class: r.hit ? 'gm-ok' : 'gm-error', text: r.hit ? t.raceHit : t.raceMiss }),
        );
      }
    }
  }

  // --- ¿Quién fue? ------------------------------------------------------------------
  // The original rumor in full, the pick (a neighbor or «Nadie lo cambió») and
  // then the chain, each change as before → after and the culprit's hop marked.
  let who = null;
  const answer = fact ? scoreCall('whoDidIt', log, fact) : null;
  if (answer?.honest) {
    // Nobody ended up with a changed detail: nothing to guess.
    const original = originalText(log, fact, lang);
    who = el(
      'div',
      { class: 'gm-section gm-whodidit', gm: 'whodidit' },
      el('h3', { text: sectionTitle(t.whoDidIt) }),
      original ? el('p', { class: 'gm-who-rumor', text: fill(t.whoOriginal, { rumor: original }) }) : null,
      el('p', { class: 'gm-ok', text: t.whoNoneDistorted }),
      el('p', { class: 'gm-hint', text: t.whoSeeItChange }),
    );
  } else if (answer) {
    const original = originalText(log, fact, lang);
    // With a culprit it is a game of its own, in the main view; else it stays folded.
    const guess = !!answer.culprit;
    who = el(
      'div',
      { class: `gm-section gm-whodidit${guess ? ' gm-guess' : ''}`, gm: 'whodidit' },
      el('h3', { text: sectionTitle(guess ? t.whoGuessTitle : t.whoDidIt) }),
      original ? el('p', { class: 'gm-who-rumor', text: fill(t.whoOriginal, { rumor: original }) }) : null,
      el('p', { class: 'gm-hint', text: guess ? t.whoGuessHint : t.whoDidItHint }),
    );
    const names = (header.neighbors ?? []).map((n) => ({ value: n.id, label: n.name })).sort((a, b) => a.label.localeCompare(b.label));
    const pick = el('select', { 'aria-label': t.whoPick });
    pick.append(el('option', { value: '', text: t.whoPick }), guess ? null : el('option', { value: '-', text: t.whoHonest }));
    for (const o of names) pick.append(el('option', { value: o.value, text: o.label }));
    const reveal = button(t.whoReveal, () => {
      const guess = pick.value === '-' ? null : pick.value;
      pick.disabled = true;
      reveal.remove();
      why.remove();
      who.append(chainOf(answer, guess));
    }, { class: 'gm-btn gm-primary', disabled: true });
    const why = el('span', { class: 'gm-hint gm-pick-first', text: t.whoPickFirst });
    pick.addEventListener('change', () => {
      reveal.disabled = !pick.value;
      why.hidden = !!pick.value;
    });
    who.append(el('div', { class: 'gm-pair' }, pick, reveal, why));
  }

  function chainOf(a, guess) {
    const name = (id) => nameOf(header, id);
    const g = scoreCall('guessResult', guess, a);
    const hit = typeof g === 'boolean' ? g : (a.culprit?.who ?? null) === guess;
    let verdict;
    let why = null;
    if (a.culprit) verdict = hit ? t.whoHit : fill(t.whoMiss, { name: name(a.culprit.who) });
    else if (a.honest) verdict = hit ? t.whoHonestHit : t.whoMissHonest;
    else {
      // Wrong values that no tell explains: the neighbors filled them in by themselves.
      verdict = hit ? t.whoNobodyHit : t.whoNobodyMiss;
      const ids = a.unexplained ?? [];
      if (ids.length) why = fill(plural(t.whoUnexplained, ids.length), { names: namesText(t, header, ids) });
    }
    // Hops of whoDidIt: {from, to, tick, turn, changed, details: [{slot, from, to, cause}], culprit}.
    const hops = (a.hops ?? []).map((h) => {
      const changes = (h.details ?? []).map((d) => hopChangeText(t, header, d));
      const distorted = changes.some((c) => c.distorted);
      return el(
        'li',
        { class: `gm-hop${distorted ? ' gm-changed' : changes.length ? ' gm-forgot' : ''}${h.culprit ? ' gm-culprit' : ''}` },
        el('span', { text: fill(t.hop, { from: h.from ? name(h.from) : '·', to: name(h.to) }) }),
        isNum(h.tick) ? el('span', { class: 'gm-hint', text: ` · ${tickTime(h.tick, header, lang)}` }) : null,
        h.culprit ? el('span', { class: 'gm-first', text: t.whoFirst }) : null,
        changes.length ? el('span', { class: 'gm-hop-change', text: changes.map((c) => c.text).join(' · ') }) : null,
      );
    });
    return el(
      'div',
      { class: 'gm-chain' },
      el('p', { class: hit ? 'gm-ok' : 'gm-error', text: verdict }),
      why ? el('p', { class: 'gm-hint', text: why }) : null,
      hops.length ? el('ol', { class: 'gm-hops' }, hops) : null,
    );
  }

  // --- Friend and share ----------------------------------------------------------------
  const payload = {
    v: 1,
    game_version: score.GAME_VERSION ?? 1,
    mode,
    settings: game.settings,
    rumors: game.rumors,
    challenge: game.challenge ?? null,
    bets: game.bets ?? null,
    race: game.race ?? null,
    score: mine ? { value: scoreValue(mine), stars, label: mine.label ?? null } : null,
  };
  let friend = null;
  if (friendCode) {
    const theirs = readCode(friendCode);
    if (theirs) {
      const ok = scoreCall('comparable', payload, theirs) === true;
      friend = el('div', { class: 'gm-section gm-friend-result' }, el('h3', { text: t.menuFriend }));
      if (ok) {
        const a = scoreValue(payload.score);
        const b = scoreValue(theirs.score);
        friend.append(el('p', { text: fill(t.friendCompare, { score: t.score, mine: scoreText(payload.score), theirs: scoreText(theirs.score) }) }));
        if (a !== null && b !== null) friend.append(el('p', { class: 'gm-score', text: a > b ? t.friendWin : a < b ? t.friendLose : t.friendTie }));
      } else {
        const why =
          theirs.mode !== payload.mode ? t.friendWhyMode : theirs.game_version !== payload.game_version ? t.friendWhyVersion : t.friendWhyOther;
        friend.append(el('p', { class: 'gm-hint', text: fill(t.friendNotComparable, { why }) }));
      }
      if (mode === 'ai') friend.append(el('p', { class: 'gm-hint', text: t.shareAi }));
    }
  }

  // In a local install the link names this computer and its port: the code goes
  // first («Reto del amigo» takes the code or the link). When the clipboard
  // fails, the field of what was asked for (the code, or the link) is selected.
  // Without a code (the scoring missing) there is nothing to share.
  let share = null;
  const code = scoreCall('encodeCode', payload);
  if (typeof code === 'string' && code) {
    share = el('div', { class: 'gm-section gm-share', gm: 'share' }, el('h3', { text: t.share }));
    const local = isLocalHost(globalThis.location?.hostname);
    const link = friendLink(code);
    const box = el('input', { class: 'gm-code', readOnly: true, value: code, 'aria-label': fill(t.codeWhat, { friend: t.menuFriend }) });
    const linkBox = el('input', { class: 'gm-code gm-share-link', readOnly: true, value: link ?? '', 'aria-label': t.copyLink });
    linkBox.hidden = true;
    const done = el('span', { class: 'gm-hint', 'aria-live': 'polite' });
    const copy = (text, field) => async () => {
      const ok = await copyText(text);
      done.textContent = ok ? t.copied : '';
      if (ok) return;
      field.hidden = false;
      field.focus();
      field.select();
    };
    const copyCode = button(t.copyCode, copy(code, box), { class: local ? 'gm-btn gm-primary' : 'gm-btn', gm: 'copy-code' });
    const copyLink = link ? button(t.copyLink, copy(link, linkBox), { class: 'gm-btn', gm: 'copy-link' }) : null;
    add(share,
      el('p', { class: 'gm-hint', text: t.shareHint }),
      local ? el('p', { class: 'gm-hint gm-share-local', text: t.shareLocal }) : null,
      box,
      el('p', { class: 'gm-hint gm-code-what', text: fill(t.codeWhat, { friend: t.menuFriend }) }),
      linkBox,
      el('div', { class: 'gm-actions' }, copyCode, copyLink, done),
      mode === 'ai' ? el('p', { class: 'gm-hint', text: t.shareAi }) : null,
    );
  }

  // --- Actions ----------------------------------------------------------------------
  // One main action: «Probar con otro vecino» (else «Volver al menú», or «Volver
  // al juego» in a replay); the rest stays at hand without competing with it.
  const status = el('p', { class: 'gm-hint gm-saved', 'aria-live': 'polite' });
  const retry = actions.retry
    ? el(
        'div',
        { class: 'gm-end-retry' },
        button(t.retry, actions.retry, { class: 'gm-btn gm-primary', gm: 'retry' }),
        el('p', { class: 'gm-hint gm-keeps', text: t.keepsTown }),
      )
    : null;
  const acts = el(
    'div',
    { class: 'gm-actions gm-end-actions' },
    actions.again ? button(t.again, actions.again, { class: 'gm-btn', gm: 'again', title: t.againHint }) : null,
    actions.newGame ? button(t.newGame, actions.newGame, { class: actions.retry ? 'gm-btn' : 'gm-btn gm-primary', gm: 'new' }) : null,
    actions.back ? el('a', { class: 'gm-btn gm-primary', href: actions.back, text: t.backToGame }) : null,
  );
  const againHint = actions.again ? el('p', { class: 'gm-hint gm-again-hint', text: t.againHint }) : null;

  // The rest, folded: the day summary, the bets, «¿Quién fue?» and its chain, «Compartir».
  const hasSummary = !!globalThis.document?.querySelector?.('#summary .sm-expand');
  const more = el(
    'details',
    { class: 'gm-end-more', gm: 'end-more' },
    el('summary', { text: t.moreDetails }),
    hasSummary
      ? el('div', { class: 'gm-actions gm-end-day' }, button(t.daySummary, () => {
          if (openDaySummary()) setFolded(true);
        }, { class: 'gm-btn', gm: 'day-summary' }))
      : null,
    bets,
    who?.classList.contains('gm-guess') ? null : who,
    share,
  );

  const chTitle = challenge ? (challenge.title?.[lang] ?? challenge.title?.en ?? challenge.id) : t.freeGame;
  const first = game.rumors?.[0]?.fact;
  const rumorLine = first ? (factSentence(first, { header, lang }) ?? (first.what ? whatName(first.what, lang === 'es' ? 'es' : 'en') : null)) : null;
  add(
    root,
    el(
      'header',
      { class: 'gm-end-head' },
      el('span', { class: 'gm-kicker', text: t.endTitle }),
      el('span', { class: `gm-mode gm-mode-${mode}`, text: modeLabel(mode, t) }),
    ),
    el('h2', { class: 'gm-title', text: chTitle }),
    rumorLine ? el('p', { class: 'gm-hint', text: rumorLine }) : null,
    result,
    race,
    friend,
    movers,
    stopped,
    who?.classList.contains('gm-guess') ? who : null,
    retry,
    acts.childElementCount ? acts : null,
    againHint,
    // The web version: Con IA is the downloaded game (screens.js aiHowTo).
    download ? el('div', { class: 'gm-section gm-end-download', gm: 'end-download' }, download) : null,
    status,
    more.childElementCount > 1 ? more : null,
  );
  actions.onScored?.({ score: mine ? scoreValue(mine) : null, stars, status });

  // A neighbor's card (<html data-picked>, core/app.js) goes over the right
  // column: the end card folds into its pill meanwhile and comes back when
  // the neighbor's card closes, unless the player folded it.
  const html = globalThis.document?.documentElement;
  if (html && typeof globalThis.MutationObserver === 'function') {
    let auto = false;
    const sync = () => {
      const picked = html.hasAttribute('data-picked');
      if (picked && !root.hidden) {
        auto = true;
        setFolded(true);
      } else if (!picked && auto) {
        auto = false;
        setFolded(false);
      }
    };
    new MutationObserver(sync).observe(html, { attributes: true, attributeFilter: ['data-picked'] });
  }
  return { el: root, pill, recommended: recommended?.id ?? null };
}
