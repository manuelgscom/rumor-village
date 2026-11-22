// Package D of phase 9: scoring of the game (docs/juego.md, «Medidas comunes»,
// «Retos», «Apuesta», «¿Quién fue?», «Carrera de rumores», «Desafía a un
// amigo»). Pure functions over a recording {header, events}: no DOM, no
// engine, no wall clock; the same in node tests and in the browser.
//
//   measures.js    the common measures (informed, half, attendance, telephone, subject),
//                  and who moved the rumor and where it stopped (the end card)
//   challenges.js  challenge files, stars, draft skeleton and draft check
//   bets.js        points of the bet
//   culprit.js     «¿Quién fue?»: the culprit, or nobody («Nadie lo cambió»)
//   race.js        winner of the race of two rumors
//   code.js        the challenge code "RV1-…"

import { scoreChallenge } from './challenges.js';
import { informedEnd, modeOf } from './measures.js';

export {
  arrivalOrder,
  attendOk,
  endTick,
  factsOf,
  halfTick,
  informedAt,
  informedEnd,
  injectOf,
  keptQuiet,
  lastOfRow,
  lastWhenShift,
  modeOf,
  neighborId,
  noGoodHour,
  priestOf,
  subjectTick,
  telephonePoints,
  tickOfTime,
  toldDirectly,
  topTellers,
} from './measures.js';
export {
  CHALLENGE_FORMAT,
  checkChallenge,
  challengeDraft,
  checkDraft,
  MEASURES,
  measureValue,
  nextStar,
  OPEN_FIELDS,
  scoreChallenge,
  starsOf,
  subjectOf,
} from './challenges.js';
export { scoreBets } from './bets.js';
export { guessResult, whoDidIt } from './culprit.js';
export { raceFactsByDraft, raceResult } from './race.js';
export { CODE_PREFIX, CodeError, comparable, decodeCode, encodeCode, GAME_VERSION } from './code.js';

/**
 * The player's «marca» of a game. With a challenge: its measure and its stars
 * in the game's mode. In free play: the neighbors who know some rumor at the
 * end, without stars.
 * @param {{settings?: {mode?: 'ai'|'rules'}}|null} game the game data (or the draft); its
 *   settings.mode wins over the recording's policy
 * @param {import('./measures.js').Log} log
 * @param {object|null} [challenge] the challenge file, if the game was one
 * @returns {{value: number|null, stars: 0|1|2|3|null, label: string, zero?: string|null,
 *   next?: {stars: 1|2|3, gap: number}|null}}
 *   label is the measure key ('informed_end', 'attend_ok'…), for the strings of the game;
 *   stars null in free play and in a challenge without stars (the tutorial);
 *   next: what is missing for the next star
 */
export function gameScore(game, log, challenge = null) {
  if (challenge) {
    const mode = game?.settings?.mode ?? modeOf(log.header);
    const s = scoreChallenge(challenge, log, mode);
    return { value: s.value, stars: s.stars, label: s.measure, zero: s.zero, next: s.next };
  }
  return { value: informedEnd(log).size, stars: null, label: 'informed_end' };
}
