// Speech bubbles (pure, no DOM): what each bubble says, line breaking and
// placement without overlaps. The HTML bubbles are scene/overlay/bubbles.js.
//
// One bubble per active conversation: its last turn.
//   text       the turn's `text` (a model run)                  plain bubble
//   narration  With AI, no text (the engine writes sentences only for what the
//              camera sees near): a narrator says the claim in plain words,
//              «Le cuenta lo de la fiesta en la plaza, hoy a las 12:00»   italic, grey
//   claim      Without AI, no text: the claim, summarised       dashed, other font
//   act        no claim: a label («saluda»); With AI, greetings and
//              goodbyes without text show nothing (null)      small pill
//
//          ┌──────────────────────┐
//          │ ¿Sabes que hay fiesta│
//          │ en la plaza?         │
//          └────┬─────────────────┘
//               ▼ tail to the speaker
//              (CA)      (LU)

import { slotTick, slotTime } from '../core/clock.js';
import { claimSummary, neighborName, unitOf, whatName, WHO_JOIN } from '../core/names.js';
import { langOf } from '../core/lang.js';
import { STRINGS as STORY } from '../story/strings.js';

/** Sizes of the bubbles in CSS pixels, by kind. */
export const BUBBLE = {
  maxWidth: { text: 250, narration: 250, claim: 240, act: 190 },
  maxLines: { text: 6, narration: 4, claim: 3, act: 2 },
  padX: 12,
  padY: 7,
  lineHeight: { text: 19, narration: 18, claim: 18, act: 17 },
  /** Height of the "who → to whom" line on top of text and claim bubbles. */
  head: 17,
  tail: 12,
  gap: 6,
};

/** Fonts of each kind of bubble (CSS shorthand; css/render.css must match). */
export const BUBBLE_FONT = {
  text: '600 14px Nunito, system-ui, sans-serif',
  narration: 'italic 600 13px Nunito, system-ui, sans-serif',
  claim: '700 13px Nunito, system-ui, sans-serif',
  act: 'italic 600 13px Nunito, system-ui, sans-serif',
};


const ELLIPSIS = '…';

/**
 * Breaks a text into lines no wider than maxWidth. Words longer than a line
 * are cut; beyond maxLines the last line ends with an ellipsis.
 * @param {string} text
 * @param {number} maxWidth
 * @param {(s: string) => number} measure width of a string
 * @param {number} [maxLines]
 * @returns {string[]}
 */
export function wrapLines(text, maxWidth, measure, maxLines = Infinity) {
  const words = String(text ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const lines = [];
  let cur = '';
  for (const word of words) {
    const cand = cur ? `${cur} ${word}` : word;
    if (measure(cand) <= maxWidth) {
      cur = cand;
      continue;
    }
    if (cur) lines.push(cur);
    cur = '';
    // A word wider than a line is cut into pieces.
    let rest = word;
    while (measure(rest) > maxWidth) {
      const chars = [...rest];
      let n = 1;
      while (n < chars.length && measure(chars.slice(0, n + 1).join('')) <= maxWidth) n++;
      lines.push(chars.slice(0, n).join(''));
      rest = chars.slice(n).join('');
    }
    cur = rest;
  }
  if (cur) lines.push(cur);
  if (lines.length <= maxLines) return lines;

  const out = lines.slice(0, maxLines);
  let last = out[maxLines - 1];
  while (last && measure(last + ELLIPSIS) > maxWidth) last = [...last].slice(0, -1).join('');
  out[maxLines - 1] = last.replace(/[\s,.;:]+$/, '') + ELLIPSIS;
  return out;
}

/**
 * A claim told by a narrator, in plain words (With AI, a turn without text):
 * «Le cuenta lo de la fiesta de Manuel en la plaza, hoy a las 12:00, 50
 * personas»; the guessed details after «cree que»: «Le cuenta lo de la fiesta
 * en la plaza; cree que hoy a las 12:00». The day of the hour is the one of
 * the turn («hoy») or the next («mañana»). Articles as factSentence of
 * game/prepare.js (story/strings.js `the`, `placeThe`; core/names.js WHO_JOIN).
 * @param {object} claim {who, where, when, amount, guess?}
 * @param {string|undefined} what
 * @param {number} tick of the turn
 * @param {object} header
 * @param {'es'|'en'} lang of the interface
 * @param {object} strings texts of package A (strings.js, picked)
 * @returns {string}
 */
export function narration(claim, what, tick, header, lang, strings) {
  const L = lang === 'es' ? 'es' : 'en';
  const t = strings.narration;
  const story = STORY[L];
  const fill = (tpl, v) => tpl.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ''));
  const guess = new Set(claim?.guess ?? []);
  const has = (k) => claim?.[k] !== null && claim?.[k] !== undefined;
  const sure = [];
  const guessed = [];
  const put = (k, text) => (guess.has(k) ? guessed : sure).push({ k, text });
  if (has('who')) put('who', `${(what && WHO_JOIN[L][what]) || (L === 'es' ? 'de' : 'for')} ${neighborName(header, claim.who)}`);
  if (has('where')) {
    const p = (header?.places ?? []).find((x) => x.id === claim.where || x.key === claim.where);
    const art = (p?.key && story.placeThe?.[p.key]) || story.placeDefault;
    put('where', `${t.at} ${art} ${p?.name ?? claim.where}`);
  }
  if (has('when')) {
    const days = Math.floor(slotTick(claim.when) / 1440) - Math.floor((tick ?? 0) / 1440);
    const day = days === 0 ? t.today : days === 1 ? t.tomorrow : '';
    put('when', [day, fill(t.time, { time: slotTime(claim.when) })].filter(Boolean).join(' '));
  }
  if (has('amount')) put('amount', [claim.amount, what ? unitOf(what, L) : ''].filter((x) => x !== '').join(' '));
  // «de Manuel en la plaza» run on; the hour and the amount after a comma.
  const join = (list) => list.reduce((acc, x) => (acc ? `${acc}${x.k === 'when' || x.k === 'amount' ? ',' : ''} ${x.text}` : x.text), '');
  let s = fill(t.tell, { what: (what && story.the?.[what]) || strings.something });
  const main = join(sure);
  if (main) s += sure[0].k === 'when' || sure[0].k === 'amount' ? `, ${main}` : ` ${main}`;
  if (guessed.length) s += `; ${fill(t.guess, { parts: join(guessed) })}`;
  // «lo de el concierto» → «lo del concierto».
  return L === 'es' ? s.replace(/\bde el\b/g, 'del') : s;
}

/**
 * What a turn's bubble says; null when nothing is shown (With AI, a greeting
 * or goodbye without text).
 * @param {object} turn a `turn` event
 * @param {import('../core/reduce.js').State} state
 * @param {object} header
 * @param {object} strings texts of package A (strings.js, picked)
 * @param {'es'|'en'} [lang] of the interface (the narration), default the run's
 * @returns {{kind: 'text'|'narration'|'claim'|'act', text: string}|null}
 */
export function bubbleContent(turn, state, header, strings, lang = langOf(header)) {
  if (typeof turn.text === 'string' && turn.text.trim()) return { kind: 'text', text: turn.text.trim() };
  if (turn.reject) return { kind: 'act', text: strings.rejected };
  const what = turn.fact ? state.facts.get(turn.fact)?.what : undefined;
  const ai = header?.policy === 'model';
  if (turn.claim && ai) return { kind: 'narration', text: narration(turn.claim, what, turn.tick, header, lang, strings) };
  if (turn.claim) return { kind: 'claim', text: claimSummary(turn.claim, header, what) };
  if (ai && (turn.act === 'greet' || turn.act === 'bye')) return null;
  const whatText = what ? whatName(what, langOf(header)) : strings.something;
  switch (turn.act) {
    case 'greet':
      return { kind: 'act', text: strings.greet };
    case 'bye':
      return { kind: 'act', text: strings.bye };
    case 'ask':
      return { kind: 'act', text: what ? strings.ask.replace('{what}', whatText) : strings.askAny };
    case 'tell':
      return { kind: 'act', text: strings.tell.replace('{what}', whatText) };
    default:
      return { kind: 'act', text: strings.none };
  }
}

function convNumber(id) {
  const n = parseInt(String(id).replace(/\D+/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Last turn of every active conversation, in conversation order.
 * @param {import('../core/reduce.js').State} state
 * @returns {{conv: object, turn: object}[]}
 */
export function lastTurns(state) {
  const out = [];
  for (const conv of state.convs.values()) {
    const turn = conv.turns[conv.turns.length - 1];
    if (turn) out.push({ conv, turn });
  }
  return out.sort((a, b) => convNumber(a.conv.id) - convNumber(b.conv.id));
}

/**
 * Last turns of the conversations that ended at `tick` (their bubble stays
 * for the rest of that tick, or a closing turn would never be seen).
 * @param {object[]} events store.events
 * @param {number} index store.index (events applied)
 * @param {number} tick the current tick, floor(pos)
 * @returns {{conv: {id: string}, turn: object}[]}
 */
export function endedTurns(events, index, tick) {
  const ended = new Set();
  const last = new Map();
  for (let i = Math.min(index, events.length) - 1; i >= 0; i--) {
    const e = events[i];
    if (e.tick < tick - 1) break;
    if (e.type === 'conv_end' && e.tick === tick) ended.add(e.conv);
    else if (e.type === 'turn' && ended.has(e.conv) && !last.has(e.conv)) last.set(e.conv, e);
  }
  return [...last.entries()]
    .map(([id, turn]) => ({ conv: { id }, turn }))
    .sort((a, b) => convNumber(a.conv.id) - convNumber(b.conv.id));
}

/**
 * Size of a bubble from its lines.
 * @param {string[]} lines
 * @param {'text'|'claim'|'act'} kind
 * @param {(s: string) => number} measure
 * @returns {{w: number, h: number}}
 */
export function bubbleSize(lines, kind, measure) {
  const widest = lines.reduce((m, l) => Math.max(m, measure(l)), 0);
  return {
    w: Math.ceil(widest + 2 * BUBBLE.padX),
    h: Math.ceil(lines.length * BUBBLE.lineHeight[kind] + 2 * BUBBLE.padY),
  };
}

function overlaps(a, b, gap) {
  return a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;
}

function hitsDot(rect, d) {
  const cx = Math.min(Math.max(d.x, rect.x), rect.x + rect.w);
  const cy = Math.min(Math.max(d.y, rect.y), rect.y + rect.h);
  return (d.x - cx) ** 2 + (d.y - cy) ** 2 < (d.r + 2) ** 2;
}

/** Cost weights of a bubble position: overlaps first, then distance. */
const COST = { bubble: 1000, dot: 40, step: 4, side: 3, below: 25 };
const STEP = 18;
const SIDES = [0, -0.45, 0.45, -0.9, 0.9];

/**
 * Places bubbles above (or else below) their speakers, inside the view,
 * avoiding other bubbles first and dots second; greedy in the given order.
 * Each bubble takes the candidate position of least cost.
 * @param {{ax: number, top: number, bottom: number, w: number, h: number}[]} items
 *   ax: speaker x; top/bottom: y of the top and bottom of the speaker's dot
 * @param {{w: number, h: number}} view
 * @param {{x: number, y: number, r: number}[]} [dots] screen dots to keep visible
 * @returns {{x: number, y: number, w: number, h: number, above: boolean}[]}
 */
export function placeBubbles(items, view, dots = []) {
  const placed = [];
  for (const it of items) {
    let best = null;
    let bestCost = Infinity;
    const consider = (s, side, above) => {
      const x = it.ax - it.w / 2 + side * it.w;
      const y = above ? it.top - BUBBLE.tail - it.h - s * STEP : it.bottom + BUBBLE.tail + s * STEP;
      const r = {
        x: Math.min(Math.max(4, x), Math.max(4, view.w - it.w - 4)),
        y: Math.min(Math.max(4, y), Math.max(4, view.h - it.h - 4)),
        w: it.w,
        h: it.h,
        above,
      };
      let cost = s * COST.step + Math.abs(side) * 10 * COST.side + (above ? 0 : COST.below);
      if (cost >= bestCost) return;
      for (const p of placed) if (overlaps(p, r, BUBBLE.gap)) cost += COST.bubble;
      if (cost >= bestCost) return;
      for (const d of dots) {
        if (hitsDot(r, d)) {
          cost += COST.dot;
          if (cost >= bestCost) return;
        }
      }
      best = r;
      bestCost = cost;
    };
    for (let s = 0; s < 10; s++) for (const side of SIDES) consider(s, side, true);
    for (let s = 0; s < 4; s++) for (const side of SIDES) consider(s, side, false);
    placed.push(best);
  }
  return placed;
}

/**
 * Characters of real `text` that are new on screen at a tick: bubbles whose
 * turn is of that tick (a bubble still on screen from an earlier tick counts
 * 0, so package B pauses to read each text only once). Narrations, claims
 * and act labels never count (inside the game they stay on screen a while
 * instead, keepBubbles; the pace of the village is the same).
 * @param {{turn: object, content: {kind: string, text: string}}[]} bubbles the bubbles drawn
 * @param {number} tick Math.floor(store.pos)
 * @returns {number}
 */
export function newTextChars(bubbles, tick) {
  let n = 0;
  for (const b of bubbles) if (b.content.kind === 'text' && b.turn.tick === tick) n += b.content.text.length;
  return n;
}

/**
 * The tail of a placed bubble: from the edge that faces the speaker to the
 * speaker, as a wedge. null when the bubble covers the speaker.
 * @param {{x: number, y: number, w: number, h: number}} rect
 * @param {{ax: number, top: number, bottom: number}} it speaker x, top and bottom
 * @returns {{bx: number, baseY: number, tipX: number, tipY: number}|null}
 */
export function tailOf(rect, it) {
  let baseY;
  let tipY;
  if (rect.y + rect.h <= it.top + 1) [baseY, tipY] = [rect.y + rect.h, it.top];
  else if (rect.y >= it.bottom - 1) [baseY, tipY] = [rect.y, it.bottom];
  else return null;
  const r = 14;
  const bx = Math.min(rect.x + rect.w - r, Math.max(rect.x + r, it.ax));
  return { bx, baseY, tipX: it.ax, tipY };
}

/**
 * Inside the game (phase 9-5) a bubble stays on screen at least what it takes
 * to read it, in real time, without holding the village: 60 ms a character,
 * from 2.5 s to 6 s; the last `fade` ms it fades out. Not at «rápida».
 */
export const LINGER = { perChar: 60, min: 2500, max: 6000, fade: 400 };

/**
 * How long a bubble stays at least, in ms (0: it goes with its turn).
 * @param {string} text
 * @param {boolean} fast «rápida»
 * @returns {number}
 */
export function lingerMs(text, fast = false) {
  if (fast) return 0;
  return Math.min(LINGER.max, Math.max(LINGER.min, String(text ?? '').length * LINGER.perChar));
}

/**
 * @typedef {object} Shown
 * @property {object} item a bubble of view.speech ({conv, turn, screen, content})
 * @property {number} until wall time (ms) until which it stays
 * @property {boolean} current its turn is still the one view.speech gives
 */

/**
 * The bubbles on screen this frame, one per speaker: the ones view.speech
 * gives now, and those whose turn has passed while their time to be read is
 * not over (`linger`). A new bubble of the same neighbor replaces the old one;
 * a jump in the timeline (`reset`) clears what lingers.
 * @param {Map<string, Shown>} shown last frame's, by speaker id
 * @param {object[]} items view.speech now
 * @param {number} now wall time in ms
 * @param {{linger: boolean, fast?: boolean, reset?: boolean}} o
 * @returns {Map<string, Shown>}
 */
export function keepBubbles(shown, items, now, { linger, fast = false, reset = false }) {
  const out = new Map();
  for (const item of items) {
    const who = item.turn.who;
    const before = reset ? null : shown.get(who);
    const until = before && before.item.turn.id === item.turn.id ? before.until : now + (linger ? lingerMs(item.content.text, fast) : 0);
    out.set(who, { item, until, current: true });
  }
  if (!linger || reset || fast) return out;
  for (const [who, s] of shown) {
    if (out.has(who) || now >= s.until) continue;
    out.set(who, { ...s, current: false });
  }
  return out;
}

/**
 * Opacity of a bubble: whole while its turn is on, then fading out over the
 * last LINGER.fade ms of its time.
 * @param {Shown} s
 * @param {number} now
 * @returns {number} 0..1
 */
export function bubbleFade(s, now) {
  if (s.current) return 1;
  return Math.max(0, Math.min(1, (s.until - now) / LINGER.fade));
}
