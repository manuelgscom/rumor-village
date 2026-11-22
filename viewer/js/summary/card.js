// What the full-screen card at the end of the day says (phase 8-2, 2.10), as
// plain data: the same object feeds the DOM (final.js) and the image of
// 1200×630 (image.js). Pure: no DOM.
//
//   Summary (build.js) ──► cardOf ──► {kicker, what, fact, figs[3], bar, tellers, distorters}

import { clockOf, slotTick, slotTime } from '../core/clock.js';
import { pick } from '../core/lang.js';
import { neighborInitials, neighborName, neighborOf, slotValueText, whatName } from '../core/names.js';
import { VERSION_COLORS } from '../core/theme.js';
import { SLOTS } from '../core/version.js';
import { GROUP_COLORS } from '../rumor/overlay.js';
import { fill } from '../rumor/strings.js';
import { STRINGS } from './strings.js';

/** The accent of core.css (--accent), for the image too. */
export const ACCENT = '#3a6fd8';

/** Gossips shown on the card: tellers and distorters. */
export const CARD_TELLERS = 3;
export const CARD_DISTORTERS = 2;

/**
 * @typedef {object} CardFig
 * @property {'told'|'right'|'changed'} key
 * @property {number} n the big figure
 * @property {string} label
 * @property {string} sub
 * @property {string} color
 */

/**
 * @typedef {object} CardPerson
 * @property {string} who
 * @property {string} name
 * @property {string} initials
 * @property {string} line
 * @property {string} sub
 * @property {string} color version color of the neighbor
 */

/**
 * The card of a summary. Inside the game (`game`) the kicker says «Fin de la
 * partida» (it may end at any hour). The figure of who came to the place and
 * hour is left out when the rumor says no place or no hour (nobody can go);
 * when its hour falls after the end of the game and nobody came, it says so
 * instead of a 0 («la fiesta era a las 21:00, después del final de la
 * partida», n null).
 * @param {import('./build.js').Summary} s
 * @param {object} header
 * @param {'es'|'en'} lang
 * @param {{game?: boolean}} [o]
 * @returns {{has: boolean, kicker: string, what: string, fact: string, figs: CardFig[], bar: {key: string, n: number, color: string}[], total: number, tellers: CardPerson[], distorters: CardPerson[]}}
 */
export function cardOf(s, header, lang, { game = false } = {}) {
  const t = pick(STRINGS, lang);
  const time = clockOf(s.tick, header.start_weekday ?? 0, lang).time;
  const kicker = s.ended ? (game ? t.kickerGame : t.kicker) : fill(t.kickerUntil, { time });
  const out = { has: s.fact !== null, kicker, what: '', fact: '', figs: [], bar: [], total: s.total, tellers: [], distorters: [] };
  if (!out.has) {
    out.fact = t.noFact;
    return out;
  }
  const what = s.what ? whatName(s.what, lang) : '';
  out.what = what.charAt(0).toUpperCase() + what.slice(1);
  out.fact = SLOTS.map((k) => s.original?.[k])
    .map((v, i) => (v === null || v === undefined ? '' : slotValueText(SLOTS[i], v, header)))
    .filter(Boolean)
    .join(' · ');

  const a = s.attendance;
  out.figs = [
    { key: 'told', n: s.told, label: fill(s.told === 1 ? t.figToldOne : t.figTold, { total: s.total }), sub: '', color: ACCENT },
    {
      key: 'right',
      n: a.right,
      label: a.right === 1 ? t.figRightOne : t.figRight,
      sub: a.arrived ? fill(t.figRightSub, a) : t.figRightNone,
      color: GROUP_COLORS.right,
    },
    { key: 'changed', n: s.changed, label: t.figChanged, sub: fill(t.figChangedSub, { told: s.told }), color: VERSION_COLORS.wrong },
  ];
  const goable = s.original?.where !== null && s.original?.where !== undefined && s.original?.when !== null && s.original?.when !== undefined;
  if (!goable) out.figs = out.figs.filter((f) => f.key !== 'right');
  // The end: the last event once the game ended (sooner with «Terminar ya»),
  // else the planned one; the same rule as game/endview.js lateHourText.
  const planned = header?.params?.end_tick;
  const endTick = s.ended ? s.tick : planned;
  if (goable && a.right === 0 && Number.isFinite(endTick) && slotTick(s.original.when) > endTick) {
    const fig = out.figs.find((f) => f.key === 'right');
    const the = t.whatThe?.[s.what] ?? what;
    const cut = s.ended && Number.isFinite(planned) && endTick < planned;
    const vars = { what: the, time: slotTime(s.original.when), end: clockOf(endTick, header.start_weekday ?? 0, lang).time };
    const label = fill(cut ? t.figLateStopped : t.figLate, vars).replace(/\bde el\b/g, 'del');
    Object.assign(fig, { n: null, label: label.charAt(0).toUpperCase() + label.slice(1), sub: '' });
  }
  const unknown = Math.max(0, s.total - s.told);
  out.bar = [
    { key: 'correct', n: s.correct, color: VERSION_COLORS.correct },
    { key: 'incomplete', n: s.incomplete, color: VERSION_COLORS.incomplete },
    { key: 'wrong', n: s.wrong, color: VERSION_COLORS.wrong },
    { key: 'unknown', n: unknown, color: VERSION_COLORS.unknown },
  ];

  const person = (who, line, sub) => ({
    who,
    name: neighborName(header, who),
    initials: neighborInitials(header, who),
    line,
    sub,
    color: VERSION_COLORS[s.versionOf?.[who]] ?? VERSION_COLORS.unknown,
  });
  out.tellers = s.ranking.tellers
    .slice(0, CARD_TELLERS)
    .map((x) =>
      person(
        x.who,
        x.tells === 1 ? t.tellerLineOne : fill(t.tellerLine, { a: x.tells }),
        x.firsts === 0 ? '' : fill(x.firsts === 1 ? t.firstsLineOne : t.firstsLine, { b: x.firsts, him: t.him[neighborOf(header, x.who)?.gender === 'f' ? 0 : 1] }),
      ),
    );
  out.distorters = s.ranking.distorters
    .slice(0, CARD_DISTORTERS)
    .map((x) => person(x.who, fill(x.affected === 1 ? t.distorterLineOne : t.distorterLine, { a: x.affected }), ''));
  return out;
}
