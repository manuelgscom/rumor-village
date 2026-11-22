// Labels over the scene without overlaps (pure, no DOM): place labels, names
// of neighbors and the labels of the rumor overlay share the screen. Each one
// has a priority; greedy in priority order, a label that would touch one
// already shown (or a reserved box, such as a speech bubble) is hidden.
//
//   priority   selected  >  in a hop of the rumor  >  place  >  talking  >  quarter  >  name
//
//   ┌──────┐┌─────┐            ┌──────┐
//   │ Ana  ││ Luis│    ──►     │ Ana  │   Luis hidden: lower priority
//   └──────┘└─────┘            └──────┘

import { pick } from '../core/lang.js';
import { neighborOf, slotValueText, unitOf, whatName } from '../core/names.js';
import { versionOf } from '../core/version.js';
import { beliefOf, gendered } from '../rumor/person.js';
import { STRINGS as RUMOR_STRINGS } from '../rumor/strings.js';
import { STRINGS } from './strings.js';

/** Priorities of the labels of scene/labels.js (higher wins). */
export const PRIORITY = { selected: 100, hop: 80, place: 60, talking: 50, quarter: 30, name: 10 };

/** Gap (CSS px) kept between two labels. */
export const TAG_GAP = 3;

/**
 * Whether two boxes touch (with a gap).
 * @param {{x: number, y: number, w: number, h: number}} a
 * @param {{x: number, y: number, w: number, h: number}} b
 * @param {number} [gap]
 */
export function touches(a, b, gap = TAG_GAP) {
  return a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;
}

/**
 * Which labels to show. Ties keep the input order, so the same input always
 * gives the same answer.
 * @param {{x: number, y: number, w: number, h: number, prio: number}[]} items boxes in CSS px
 * @param {{x: number, y: number, w: number, h: number}[]} [reserved] boxes that always win
 * @returns {boolean[]} shown, in input order
 */
export function declutter(items, reserved = []) {
  const order = items.map((_, i) => i).sort((a, b) => items[b].prio - items[a].prio || a - b);
  const shown = new Array(items.length).fill(false);
  const taken = [...reserved];
  for (const i of order) {
    const box = items[i];
    if (taken.some((t) => touches(box, t))) continue;
    shown[i] = true;
    taken.push(box);
  }
  return shown;
}

/**
 * Box of a label anchored by its bottom centre at a screen point.
 * @param {{x: number, y: number}} s anchor
 * @param {number} w
 * @param {number} h
 */
export function boxAbove(s, w, h) {
  return { x: s.x - w / 2, y: s.y - h, w, h };
}

/**
 * Counts of the people at each place, and of each color among them.
 * @param {Map<string, string>} placeOf neighbor id → place id (people not travelling)
 * @param {(id: string) => string} colorOf
 * @returns {Map<string, {n: number, colors: Map<string, number>}>}
 */
export function crowdCounts(placeOf, colorOf) {
  const out = new Map();
  for (const [id, place] of placeOf) {
    let c = out.get(place);
    if (!c) out.set(place, (c = { n: 0, colors: new Map() }));
    c.n++;
    const color = colorOf(id);
    c.colors.set(color, (c.colors.get(color) ?? 0) + 1);
  }
  return out;
}

/** Icon (a key of ICONS in scene/labels.js) and tint of each kind of place. */
export const PLACE_LOOK = {
  square: { icon: 'square', tint: '#e0a32e' },
  bar: { icon: 'cup', tint: '#c8553d' },
  church: { icon: 'bell', tint: '#7a6bb0' },
  chapel: { icon: 'bell', tint: '#7a6bb0' },
  market: { icon: 'stall', tint: '#e07a2e' },
  bakery: { icon: 'bread', tint: '#c98a3b' },
  school: { icon: 'book', tint: '#3a7bd5' },
  town_hall: { icon: 'flag', tint: '#2f6f9f' },
  pharmacy: { icon: 'cross', tint: '#2e9e6a' },
  fountain: { icon: 'drop', tint: '#2f9fd0' },
  river: { icon: 'wave', tint: '#2f8fc0' },
  mill: { icon: 'mill', tint: '#9a7448' },
  home: { icon: 'house', tint: '#8a96a2' },
};

/**
 * Look of a place label.
 * @param {{key?: string, kind?: string}} place
 * @returns {{icon: string, tint: string}}
 */
export function placeLook(place) {
  if (place.kind === 'home') return PLACE_LOOK.home;
  return PLACE_LOOK[place.key] ?? { icon: 'pin', tint: '#5d6b78' };
}

/** Shape of each version, besides its color (✓ correct, ~ incomplete, ✗ distorted). */
export { VERSION_GLYPHS } from '../core/theme.js';
import { VERSION_GLYPHS } from '../core/theme.js';

/**
 * What the card shown on hovering a neighbor says (pure, a function of the
 * state): who it is, and what it believes of the followed rumor slot by slot
 * against the original.
 *
 *   Ana                    [✓ correcta]
 *   costurera · sociable
 *   dónde    plaza
 *   cuándo   22:00         (original 21:00)
 *
 * @param {object} header
 * @param {import('../core/reduce.js').State} state
 * @param {string|null} factId the followed rumor (app.factId())
 * @param {string} id neighbor
 * @param {'es'|'en'} lang
 * @returns {null|{id: string, name: string, role: string, version: 'correct'|'incomplete'|'wrong'|null,
 *   glyph: string, status: string, rows: {slot: string, label: string, now: string, original: string|null, kind: string}[]}}
 *   null for an unknown neighbor; rows in slot order, `original` only when it differs
 */
export function hoverCard(header, state, factId, id, lang) {
  const n = neighborOf(header, id);
  if (!n) return null;
  const t = pick(STRINGS, lang).hover;
  const r = pick(RUMOR_STRINGS, lang);
  const role = [gendered(r.jobs, n.job, n.gender), gendered(r.traits, n.trait, n.gender)].filter(Boolean).join(' · ');
  const card = { id, name: n.name, role, version: null, glyph: '', status: t.noRumor, rows: [] };
  const fact = factId ? state.facts.get(factId) : null;
  if (!fact) return card;
  const memory = state.neighbors.get(id)?.memory[factId];
  card.version = versionOf(memory, fact.slots);
  card.glyph = VERSION_GLYPHS[card.version] ?? '';
  card.status = card.version ? t.versions[card.version] : t.notHeard;
  if (!memory) return card;
  const text = (slot, v) => {
    const s = slotValueText(slot, v, header);
    return slot === 'amount' && s ? `${s} ${unitOf(fact.what, lang)}`.trim() : s;
  };
  card.what = whatName(fact.what, lang);
  card.rows = beliefOf(memory, fact.slots).map((row) => ({
    slot: row.slot,
    label: t.slots[row.slot] ?? row.slot,
    now: row.now ? text(row.slot, row.now.value) + (row.now.state === 'doubt' ? '?' : '') : t.nothing,
    original: row.status === 'same' ? null : row.original === null ? t.nothing : text(row.slot, row.original),
    kind: row.status,
  }));
  return card;
}
