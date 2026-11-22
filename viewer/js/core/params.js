// Parameters of the viewer URL.
//
//   log     path or URL of a recording (.jsonl)
//   live    1 = follow the engine's live stream instead of a file
//   t       playback position in ticks (decimals allowed)
//   zoom    camera level: "far", "mid", "near" or a number (package A decides)
//   focus   place or neighbor to centre on ("p01", "n003")
//   select  selected neighbor ("n003")
//   group   selected consequence group (package C decides the keys)
//   speed   playback speed: a number or a word such as "fast" (package B)
//   paused  1/true or 0/false
//   draft   text already typed in the live input (package E)
//   left    split screen: recording on the left (with `right`; viewer/js/split/)
//   right   split screen: recording on the right
//   embed   1 = only the plan: no banner, column, bar or summary (one side of the split)
//   summary 1 = open the summary card of the day (viewer/js/summary/);
//           "ranking" = open it on the gossips tab (read by that package)
//   fx      0 = no post-processing (tilt-shift, bloom) in the 3D scene
//   director 1 = the camera follows what matters on its own (package F)
//   ui      view to open with: "simple", "full" or "tech" (default: the one
//           remembered, else "simple"; core/app.js app.ui)
//   tour    1 = open the story mode, 0 = never open it by itself (story/tour.js)
//   chapter chapter of the story mode to open at, 1-7 (captures; with tour=1)
//   lang    "es" or "en": language of the start screen and of the messages shown
//           before the header; once a recording is open, header.lang rules
//   labels  "base,ft": split screen titled «Sin afinar» / «Afinado»; without it
//           each side is titled with its model
//   manifest path of the manifest of recordings of the start screen
//   hold    1 = keep the loading screen (the start never happens; captures)
//   cam     free camera "x,y,zoom": world point at the centre and zoom factor over
//           the home view (written by the shareable link; beats zoom and focus)
//   open    a menu to show open, for captures: "info" (the ⓘ of the banner)
//   hover   neighbor whose hover card is shown as if the pointer were on it (captures)
//   q       quality of the 3D scene: "auto" (default), "high", "mid" or "low"
//           (core/quality.js; auto starts high and steps down when frames are slow)
//   stats   1 = frame meter in #stats (scene/stats.js)
//   clock   decorative time fixed at this many ms (app.now()): two captures of the
//           same URL give the same image
//   trail   0 = no trail of the rumor on the ground (scene/overlay/)
//   photo   1 = photo mode: only the scene, no interface (data-photo on <html>)
//   opening fraction 0-1: play the opening shot even in a capture and freeze it there
//   play    1 = game mode (phase 9, viewer/js/game/): the page served by `rumor play`;
//           it implies a live source (parseParams sets `live` too)
//   game    id of a played game (runs/play/<id>.jsonl), with `log`: «Mis partidas»
//   code    a challenge code "RV1-…" (game/score/; the friend's challenge)
//   screen  game screen to open at, for captures: boot, menu, prepare, challenges,
//           friend, games or tutorial (counts as a capture: nothing opens by itself)

/**
 * @typedef {object} Params
 * @property {string|null} log
 * @property {boolean} live
 * @property {number|null} t
 * @property {string|number|null} zoom
 * @property {string|null} focus
 * @property {string|null} select
 * @property {string|null} group
 * @property {string|number|null} speed
 * @property {boolean|null} paused  null when not given
 * @property {string|null} draft
 * @property {string|null} left
 * @property {string|null} right
 * @property {boolean} embed
 * @property {boolean} summary
 * @property {boolean} fx  true unless fx=0
 * @property {boolean} director
 * @property {'simple'|'full'|'tech'|null} ui
 * @property {boolean|null} tour  null when not given
 * @property {number|null} chapter
 * @property {'es'|'en'|null} lang
 * @property {string[]|null} labels  [left, right], e.g. ['base', 'ft']
 * @property {string|null} manifest
 * @property {boolean} hold
 * @property {string|null} hover
 * @property {string|null} open
 * @property {{x: number, y: number, zoom: number}|null} cam
 * @property {'auto'|'high'|'mid'|'low'} q
 * @property {boolean} stats
 * @property {number|null} clock  ms
 * @property {boolean} trail  true unless trail=0
 * @property {boolean} photo
 * @property {number|null} opening  0-1
 * @property {boolean} play  game mode; `live` is true with it
 * @property {string|null} game  id of a played game (with `log`)
 * @property {string|null} code  challenge code "RV1-…"
 * @property {'boot'|'menu'|'prepare'|'challenges'|'friend'|'games'|'tutorial'|null} screen
 * @property {boolean} [bg]  only set by core/app.js: the recording behind the start screen
 */

function text(q, key) {
  const v = q.get(key);
  return v === null || v === '' ? null : v;
}

function numberOrText(v) {
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : v;
}

function flag(v) {
  if (v === null) return null;
  return !['0', 'false', 'no', 'off'].includes(v.toLowerCase());
}

/** Views of the interface (core/app.js app.ui). */
export const UI_MODES = ['simple', 'full', 'tech'];

function oneOf(v, list) {
  return v !== null && list.includes(v.toLowerCase()) ? v.toLowerCase() : null;
}

function positiveInt(v) {
  const n = Number(v);
  return v !== null && Number.isInteger(n) && n > 0 ? n : null;
}

function pair(v) {
  if (v === null) return null;
  const parts = v.split(',').map((x) => x.trim());
  return parts.length === 2 && parts.every(Boolean) ? parts : null;
}

/** Quality levels of the 3D scene (core/quality.js). */
export const QUALITY_MODES = ['auto', 'high', 'mid', 'low'];

/** Screens of the game mode that ?screen= opens directly (viewer/js/game/). */
export const GAME_SCREENS = ['boot', 'menu', 'prepare', 'challenges', 'friend', 'games', 'tutorial'];

function numberOrNull(v) {
  const n = v === null ? NaN : Number(v);
  return Number.isFinite(n) ? n : null;
}

function fraction(v) {
  const n = numberOrNull(v);
  return n === null ? null : Math.min(1, Math.max(0, n));
}

function camOf(v) {
  if (v === null) return null;
  const n = v.split(',').map(Number);
  return n.length === 3 && n.every(Number.isFinite) && n[2] > 0 ? { x: n[0], y: n[1], zoom: n[2] } : null;
}

/**
 * Parses a query string ("?log=...&t=1320").
 * @param {string} search location.search or any query string
 * @returns {Params}
 */
export function parseParams(search = '') {
  const q = new URLSearchParams(search);
  const t = text(q, 't');
  const tNum = t === null ? null : Number(t);
  const play = q.has('play') ? flag(q.get('play') || '1') : false;
  return {
    log: text(q, 'log'),
    live: play || (q.has('live') ? flag(q.get('live') || '1') : false),
    t: Number.isFinite(tNum) ? tNum : null,
    zoom: numberOrText(text(q, 'zoom')),
    focus: text(q, 'focus'),
    select: text(q, 'select'),
    group: text(q, 'group'),
    speed: numberOrText(text(q, 'speed')),
    paused: q.has('paused') ? flag(q.get('paused') || '1') : null,
    draft: q.has('draft') ? q.get('draft') : null,
    left: text(q, 'left'),
    right: text(q, 'right'),
    embed: q.has('embed') ? flag(q.get('embed') || '1') : false,
    summary: q.has('summary') ? flag(q.get('summary') || '1') : false,
    fx: q.has('fx') ? flag(q.get('fx') || '1') : true,
    director: q.has('director') ? flag(q.get('director') || '1') : false,
    ui: oneOf(text(q, 'ui'), UI_MODES),
    tour: q.has('tour') ? flag(q.get('tour') || '1') : null,
    chapter: positiveInt(text(q, 'chapter')),
    lang: oneOf(text(q, 'lang'), ['es', 'en']),
    labels: pair(text(q, 'labels')),
    manifest: text(q, 'manifest'),
    hold: q.has('hold') ? flag(q.get('hold') || '1') : false,
    hover: text(q, 'hover'),
    open: text(q, 'open'),
    cam: camOf(text(q, 'cam')),
    q: oneOf(text(q, 'q'), QUALITY_MODES) ?? 'auto',
    stats: q.has('stats') ? flag(q.get('stats') || '1') : false,
    clock: numberOrNull(text(q, 'clock')),
    trail: q.has('trail') ? flag(q.get('trail') || '1') : true,
    photo: q.has('photo') ? flag(q.get('photo') || '1') : false,
    opening: fraction(text(q, 'opening')),
    play,
    game: text(q, 'game'),
    code: text(q, 'code'),
    screen: oneOf(text(q, 'screen'), GAME_SCREENS),
  };
}

/**
 * Whether the URL is one of an automatic capture: nothing opens by itself
 * (help, story mode, opening shot, sound) when it has t, paused, embed, summary,
 * draft, clock or screen. Also true
 * for the village behind the start screen (`bg`, set by core/app.js, never by the URL).
 * @param {Params} p
 * @returns {boolean}
 */
export function isCapture(p) {
  return p.t !== null || p.paused !== null || !!p.embed || !!p.summary || p.draft !== null || (p.clock ?? null) !== null || !!p.screen || !!p.bg;
}

/**
 * Whether the page is inside the game (phase 9-5): ?play=1, or the replay of a
 * played game (?game=). The packages read it at init, before package game sets
 * <html data-game>.
 * @param {{play?: boolean, game?: string|null}} p
 * @returns {boolean}
 */
export function inGame(p) {
  return !!p?.play || !!p?.game;
}
