// How each neighbor looks and moves (pure, no three.js): which character model
// it wears, its accessories and height, which animation it plays, where it
// faces, how its version disc pulses when it hears the rumor, and the shape
// on the disc that tells the version without the color (✓ ~ ✗).
//
// Everything about a neighbor's look is a stable function of its id and job:
//
//   id ──hash──► model (gender, spread per quarter; workers wear the hard hat)
//      job ────► accessories (glasses, sunglasses, cane, suitcase)
//            └─► height (±5 %)
//
// Gestures (talking, nodding, idle variants) are decorative and run on the
// wall clock; the walk cycle, the contagion pulse, the icons over the heads
// and the reaction on arriving follow the playback position.

import { VERSION_COLORS } from '../../core/theme.js';
import { groupKey } from '../../rumor/groups.js';
import { hash } from '../world/plan.js';

/** Character models (viewer/assets/characters/character-<name>.glb), by gender. */
export const CHARACTERS = {
  f: ['female-a', 'female-b', 'female-c', 'female-d', 'female-e', 'female-f'],
  m: ['male-a', 'male-b', 'male-c', 'male-d', 'male-e', 'male-f', 'male-g'],
};

/** Model with the hard hat, for some trades (male only in the kit). */
export const WORKER = 'worker';

/**
 * Accessories (viewer/assets/characters/<file>.glb) and where they hang: a
 * bone of the character and an offset (model units, in the bone's frame;
 * the character is 0.78 tall and faces +Z).
 */
export const ACCESSORIES = {
  glasses: { file: 'aid-glasses', bone: 'head', at: [0, 0.155, 0.118], rot: [0, 0, 0] },
  sunglasses: { file: 'aid-sunglasses', bone: 'head', at: [0, 0.155, 0.118], rot: [0, 0, 0] },
  cane: { file: 'aid-cane', bone: 'arm-right', at: [-0.13, -0.2, 0.06], rot: [0, Math.PI, 0] },
  luggage: { file: 'item-luggage', bone: 'arm-left', at: [0.15, -0.26, 0], rot: [0, 0, 0] },
};

/** Files (viewer/assets/characters/<file>.glb) that scene/index.js loads for the actors. */
export const ACTOR_FILES = [
  ...[...CHARACTERS.f, ...CHARACTERS.m, WORKER].map((n) => `character-${n}`),
  ...Object.values(ACCESSORIES).map((a) => a.file),
];

/** Length (world units) of one walk cycle (two steps). */
export const STRIDE = 7;

/** Trades that may wear the hard hat (male neighbors), and how often (1 in k). */
const HARD_HAT = { carpenter: 1, miller: 1, farmer: 4 };

/**
 * Clothing variants of the shared palette texture: hue turns (degrees)
 * applied only to cool, saturated swatches (greens, blues, purples, pinks),
 * so skin, hair, yellows and oranges never change. Variant 0 is the original.
 */
export const OUTFITS = [0, 115, 200, 280];

/** Trades that read (glasses), and how often the others wear them (1 in k). */
const READERS = new Set(['clerk', 'teacher', 'pharmacist', 'seamstress', 'priest']);

/** Unit of a stable roll per neighbor and topic: 0 … 1. */
function roll(id, topic) {
  return (hash(`${id}:${topic}`) % 10007) / 10007;
}

/**
 * Model of each neighbor of a header, of its gender: a stable pick by id,
 * spread so that neighbors of the same quarter rarely share a model.
 * @param {object} header
 * @returns {Map<string, string>} id → model name (CHARACTERS)
 */
export function modelsOf(header) {
  const out = new Map();
  const used = new Map(); // home|model → count
  const people = [...(header.neighbors ?? [])].sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const n of people) {
    const pool = CHARACTERS[n.gender === 'f' ? 'f' : 'm'];
    const first = hash(n.id) % pool.length;
    // The least used model in the neighbor's home, starting from its own pick.
    let best = pool[first];
    let bestUse = Infinity;
    for (let k = 0; k < pool.length; k++) {
      const m = pool[(first + k) % pool.length];
      const use = used.get(`${n.home}|${m}`) ?? 0;
      if (use < bestUse) {
        best = m;
        bestUse = use;
      }
    }
    used.set(`${n.home}|${best}`, bestUse + 1);
    out.set(n.id, best);
  }
  return out;
}

/**
 * Accessories of a neighbor, from its job and a stable roll.
 * @param {{id: string, job?: string}} n
 * @returns {string[]} keys of ACCESSORIES
 */
export function accessoriesOf(n) {
  const out = [];
  const eyes = roll(n.id, 'eyes');
  if (READERS.has(n.job) || (n.job === 'retired' && eyes < 0.4) || eyes < 0.06) out.push('glasses');
  else if (['bartender', 'merchant', 'farmer'].includes(n.job) && eyes > 0.82) out.push('sunglasses');
  if (n.job === 'retired' && roll(n.id, 'cane') < 0.5) out.push('cane');
  else if (n.job === 'merchant') out.push('luggage');
  return out;
}

/**
 * Look of each neighbor: model, accessories and height factor.
 * @param {object} header
 * @returns {Map<string, {model: string, accessories: string[], scale: number}>}
 */
export function looksOf(header) {
  const models = modelsOf(header);
  const out = new Map();
  for (const n of header.neighbors ?? []) {
    const hat = n.gender !== 'f' && HARD_HAT[n.job] && hash(`${n.id}:hat`) % HARD_HAT[n.job] === 0;
    const scale = (n.job === 'retired' ? 0.96 : 1) * (0.95 + roll(n.id, 'height') * 0.1);
    const outfit = hash(`${n.id}:outfit`) % OUTFITS.length;
    out.set(n.id, { model: hat ? WORKER : models.get(n.id), accessories: accessoriesOf(n), scale, outfit });
  }
  return out;
}

/**
 * Color of a palette pixel in an outfit variant: cool saturated colors turn
 * their hue, everything else (skin, hair, greys, warm tones) stays.
 * @param {number} r 0 … 255
 * @param {number} g
 * @param {number} b
 * @param {number} turn degrees (OUTFITS)
 * @returns {[number, number, number]}
 */
export function recolor(r, g, b, turn) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (!turn || max === 0 || d / max < 0.2) return [r, g, b];
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  if (h < 85 || h > 335) return [r, g, b];
  // HSV with the hue turned; value and saturation kept.
  const s = d / max;
  const v = max;
  const hh = (((h + turn) % 360) + 360) % 360 / 60;
  const c = v * s;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  const m = v - c;
  const [rr, gg, bb] = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ][Math.floor(hh) % 6];
  return [Math.round(rr + m), Math.round(gg + m), Math.round(bb + m)];
}

/**
 * What a neighbor is doing, for its animation.
 * @param {import('../../core/reduce.js').State} state
 * @param {string} id
 * @returns {{action: 'walk'|'talk'|'listen'|'idle', partner: string|null}}
 */
export function activityOf(state, id) {
  const n = state.neighbors.get(id);
  if (n?.trip && state.tick < n.trip.arrive) return { action: 'walk', partner: null };
  const conv = n?.conv ? state.convs.get(n.conv) : null;
  if (conv) {
    const partner = conv.a === id ? conv.b : conv.a;
    const last = conv.turns?.[conv.turns.length - 1];
    return { action: last?.who === id ? 'talk' : 'listen', partner };
  }
  return { action: 'idle', partner: null };
}

/** Trades whose idle variant is bending to pick something up. */
const HANDS_ON = new Set(['farmer', 'baker', 'carpenter', 'miller']);

/**
 * Gesture sequence of each activity: clips in a loop, each played `loops`
 * times at `speed`. One entry is one segment.
 */
function sequenceOf(action, id, job) {
  if (action === 'talk') {
    const a = roll(id, 'hand') < 0.5 ? 'interact-right' : 'interact-left';
    const b = a === 'interact-right' ? 'interact-left' : 'interact-right';
    return [
      { clip: a, loops: 1, speed: 0.7 },
      { clip: b, loops: 1, speed: 0.7 },
      { clip: 'idle', loops: 1, speed: 1.2 },
      { clip: a, loops: 2, speed: 0.8 },
      { clip: 'emote-no', loops: 1, speed: 0.8 },
    ];
  }
  if (action === 'listen') {
    return [
      { clip: 'idle', loops: 1 + (hash(id) % 2), speed: 1 },
      { clip: 'emote-yes', loops: 1, speed: 0.8 },
    ];
  }
  const speed = 0.7 + roll(id, 'pace') * 0.35;
  return [
    { clip: 'idle', loops: 4 + (hash(id) % 4), speed },
    HANDS_ON.has(job) ? { clip: 'pick-up', loops: 1, speed: 0.35 } : { clip: 'emote-yes', loops: 1, speed: 0.6 },
  ];
}

/** Crossfade between two gesture segments, in seconds. */
export const GESTURE_FADE = 0.2;

/**
 * Gesture at a moment of the wall clock: which clip and where in it, plus the
 * previous segment while fading out of it. Pure in (action, id, job, t).
 * @param {'talk'|'listen'|'idle'} action
 * @param {string} id
 * @param {string|undefined} job
 * @param {number} t seconds (wall clock)
 * @param {Record<string, number>} durations clip name → seconds
 * @returns {{clip: string, time: number, prev: {clip: string, time: number}|null, blend: number}}
 *   blend: weight of `clip` (1 - weight of prev)
 */
export function gestureAt(action, id, job, t, durations) {
  const seq = sequenceOf(action, id, job).filter((s) => durations[s.clip] > 0);
  if (!seq.length) return { clip: 'idle', time: 0, prev: null, blend: 1 };
  const spans = seq.map((s) => (durations[s.clip] * s.loops) / s.speed);
  const total = spans.reduce((a, b) => a + b, 0);
  let u = (((t + roll(id, 'clock') * total) % total) + total) % total;
  let i = 0;
  while (u >= spans[i] && i < seq.length - 1) u -= spans[i++];
  const s = seq[i];
  const time = (u * s.speed) % durations[s.clip];
  if (seq.length < 2 || u >= GESTURE_FADE) return { clip: s.clip, time, prev: null, blend: 1 };
  const p = seq[(i + seq.length - 1) % seq.length];
  if (p.clip === s.clip) return { clip: s.clip, time, prev: null, blend: 1 };
  return { clip: s.clip, time, prev: { clip: p.clip, time: durations[p.clip] * 0.999 }, blend: u / GESTURE_FADE };
}

/**
 * Heading (radians about the vertical axis, 0 = facing +Z, the camera) to
 * look from a point towards another; null if they are the same point.
 * @param {{x: number, y: number}} from
 * @param {{x: number, y: number}} to
 * @returns {number|null}
 */
export function headingTo(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.hypot(dx, dy) < 1e-6) return null;
  return Math.atan2(dx, dy);
}

/**
 * Resting heading of a neighbor: towards the camera, a little turned, the
 * same every time.
 * @param {string} id
 * @returns {number}
 */
export function restHeading(id) {
  return (((hash(`${id}:face`) % 1000) / 1000) * 2 - 1) * 0.45;
}

/** Life of the contagion effect on a disc, in ticks. */
export const TELL_TICKS = 6;
/** Share of that life spent jumping. */
const HOP_AGE = 0.2;

/**
 * Contagion effect of a disc at an age (0 just told … 1 gone): the disc pops,
 * a ring of its new color spreads out, a white flash fades and sparks jump.
 * @param {number} age 0 … 1
 * @returns {{pop: number, ring: number, ringAlpha: number, flash: number, beam: number, hop: number}}
 *   pop: extra disc scale factor (≥ 1); ring: ring radius in disc radii;
 *   ringAlpha, flash, beam: 0 … 1; hop: progress of the listener's jump
 *   (0 none, 0 … 1 in the air)
 */
export function tellPulse(age) {
  const a = Math.min(1, Math.max(0, age));
  const bump = a < 0.25 ? Math.sin((a / 0.25) * Math.PI) : 0;
  const k = Math.min(1, a / 0.6);
  return {
    pop: 1 + 0.7 * bump,
    ring: 1 + 5 * (1 - (1 - k) * (1 - k)),
    ringAlpha: a < 0.6 ? 1 - k : 0,
    flash: Math.max(0, 1 - a * 3),
    beam: (1 - a) * (1 - a),
    hop: a > 0 && a < HOP_AGE ? a / HOP_AGE : 0,
  };
}

/**
 * Sparks of a contagion: position (in disc radii; y up) of spark i of n at
 * an age, a small fountain that rises and falls back.
 * @param {number} i
 * @param {number} n
 * @param {number} age 0 … 1
 * @param {string} seed listener id, so each burst differs
 * @returns {{x: number, y: number, z: number, size: number}}
 */
export function sparkAt(i, n, age, seed) {
  const a = Math.min(1, Math.max(0, age));
  const turn = ((i + roll(seed, 'spark')) / n) * Math.PI * 2;
  const reach = 1.2 + 1.4 * a;
  const lift = 2.2 + ((hash(`${seed}:${i}`) % 100) / 100) * 1.2;
  return {
    x: Math.sin(turn) * reach,
    y: lift * 4 * a * (1 - a) + 0.2,
    z: Math.cos(turn) * reach,
    size: (1 - a) * (0.8 + ((hash(`${seed}:${i}:s`) % 100) / 100) * 0.4),
  };
}

/**
 * Version a token color stands for (the colors of core/theme.js that the
 * hook neighborColor gives), or null for the grey and any other color.
 * @param {string} color CSS hex
 * @returns {'correct'|'incomplete'|'wrong'|null}
 */
export function versionOfColor(color) {
  const c = String(color).toLowerCase();
  for (const v of ['correct', 'incomplete', 'wrong']) if (VERSION_COLORS[v].toLowerCase() === c) return v;
  return null;
}

/**
 * Shape on the face of a token, besides its color: ✓ correct, ~ incomplete,
 * ✗ distorted. Strokes (polylines) in disc radii, x to the right and y down
 * the screen (the world z), all inside the face of the token (radius 0.78).
 */
export const GLYPH_STROKES = {
  correct: [
    [
      [-0.42, 0.02],
      [-0.13, 0.3],
      [0.44, -0.32],
    ],
  ],
  incomplete: [Array.from({ length: 13 }, (_, i) => [-0.45 + (0.9 * i) / 12, -0.15 * Math.sin((2 * Math.PI * i) / 12)])],
  wrong: [
    [
      [-0.33, -0.33],
      [0.33, 0.33],
    ],
    [
      [0.33, -0.33],
      [-0.33, 0.33],
    ],
  ],
};

/** Width of the strokes of the glyphs, in disc radii. */
export const GLYPH_WIDTH = 0.17;

/** Ink of each glyph: white on the dark colors, dark on the light one. */
export const GLYPH_INK = { correct: '#ffffff', incomplete: '#12352b', wrong: '#ffffff' };

/** Life of an icon over a head, in ticks. */
export const ICON_TICKS = 8;

/**
 * Icons over the heads, in the order of their cells in the atlas:
 * learned   ! it hears the rumor (a slot told, or the inject)
 * forgot    ? it forgets a slot
 * assumed   ≈ a doubt is now taken as sure (doubt_dropped)
 */
export const ICON_KINDS = ['learned', 'forgot', 'assumed'];

const ICON_OF_CAUSE = { told: 'learned', inject: 'learned', forgot: 'forgot', doubt_dropped: 'assumed' };
/** When one tick brings several: the rarer news wins. */
const ICON_RANK = { assumed: 3, forgot: 2, learned: 1 };

/**
 * Icon over each head at a position: the youngest `memory` event of each
 * neighbor with tick in (pos - ticks, pos], looking back from the last
 * applied event (like wave.js recentTells).
 * @param {object[]} events store.events
 * @param {number} index store.index
 * @param {number} pos
 * @param {string|null} [fact] only this fact's events (null: any)
 * @param {number} [ticks]
 * @returns {Map<string, {kind: string, tick: number, age: number}>} age 0 … 1
 */
export function iconsAt(events, index, pos, fact = null, ticks = ICON_TICKS) {
  const out = new Map();
  for (let i = Math.min(index, events.length) - 1; i >= 0; i--) {
    const e = events[i];
    if (e.tick <= pos - ticks) break;
    if (e.type !== 'memory' || (fact && e.fact !== fact)) continue;
    const kind = ICON_OF_CAUSE[e.cause];
    if (!kind) continue;
    const prev = out.get(e.who);
    if (prev && (prev.tick > e.tick || ICON_RANK[prev.kind] >= ICON_RANK[kind])) continue;
    out.set(e.who, { kind, tick: e.tick, age: Math.min(1, Math.max(0, (pos - e.tick) / ticks)) });
  }
  return out;
}

/**
 * Look of an icon at an age: it pops in, floats up a little and fades out.
 * @param {number} age 0 … 1
 * @returns {{scale: number, alpha: number, rise: number}} rise in icon sizes
 */
export function iconLook(age) {
  const a = Math.min(1, Math.max(0, age));
  const pop = a < 0.08 ? a / 0.08 : 1;
  const over = a < 0.08 ? Math.sin((a / 0.08) * Math.PI) * 0.25 : 0;
  return { scale: 0.5 + 0.5 * pop + over, alpha: a < 0.7 ? Math.min(1, pop * 1.5) : (1 - a) / 0.3, rise: 0.25 * a };
}

/** Ticks of the reaction of who arrives for the rumor. */
export const REACT_TICKS = 4;
/** Ticks of the jumps of a cheer before the nod. */
const CHEER_JUMP = 1.5;
/** Ticks over which a reaction fades back into the usual gesture. */
const REACT_FADE = 0.4;

/**
 * Reaction of a neighbor that arrived for the rumor, a function of pos: it
 * cheers at the original place and hour (group 'right' of rumor/groups.js),
 * else it stands puzzled. Only its first arrival for the fact counts.
 * @param {import('../../core/reduce.js').State} state
 * @param {string|null} fact
 * @param {string} id
 * @param {number} pos
 * @returns {{kind: 'cheer'|'puzzled', since: number}|null} since: ticks since the arrival
 */
export function reactionAt(state, fact, id, pos) {
  const f = fact ? state.facts.get(fact) : null;
  const a = f ? state.neighbors.get(id)?.arrived?.[fact] : null;
  if (!a) return null;
  const since = pos - a.tick;
  if (!(since >= 0 && since < REACT_TICKS)) return null;
  return { kind: groupKey(a.place, a.slot, f.slots) === 'right' ? 'cheer' : 'puzzled', since };
}

/**
 * Clips of a reaction: a cheer jumps and then nods; a puzzled one
 * shakes its head. `weight` is the share of the reaction (it fades back into
 * the usual gesture at the end) and `hop` the height of the jump, 0 … 1.
 * @param {'cheer'|'puzzled'} kind
 * @param {number} since ticks since the arrival
 * @param {Record<string, number>} durations clip name → seconds
 * @returns {{entries: {clip: string, time: number, weight: number}[], weight: number, hop: number}}
 */
export function reactionClips(kind, since, durations) {
  const s = Math.min(REACT_TICKS, Math.max(0, since));
  const weight = Math.min(1, (REACT_TICKS - s) / REACT_FADE);
  const frac = (x) => x - Math.floor(x);
  if (kind === 'cheer' && s < CHEER_JUMP) {
    const k = s / CHEER_JUMP;
    return { entries: [{ clip: 'jump', time: k * (durations.jump ?? 0.5), weight }], weight, hop: Math.sin(k * Math.PI) };
  }
  if (kind === 'cheer') {
    const k = (s - CHEER_JUMP) / (REACT_TICKS - CHEER_JUMP);
    return { entries: [{ clip: 'emote-yes', time: k * (durations['emote-yes'] ?? 1), weight }], weight, hop: 0 };
  }
  const k = frac((s / REACT_TICKS) * 2);
  return { entries: [{ clip: 'emote-no', time: k * (durations['emote-no'] ?? 1), weight }], weight, hop: 0 };
}
