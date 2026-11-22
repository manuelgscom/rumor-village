// Sentences of the chronicle and the headline (pure, no DOM). A sentence is a
// list of segments {text, strong}: names, places and hours are strong so the
// DOM can bold them. Everything comes from the items of narrate.js, that is,
// from structured events: the text of the bubbles is never read.

import { hhmm, slotTime } from '../core/clock.js';
import { neighborName, placeOf, unitOf, whatName } from '../core/names.js';
import { modelName } from '../banner/index.js';
import { ICON_TEXT } from '../core/icons.js';

/** The icon name of a glyph (core/icons.js ICON_TEXT, reversed). */
const ICON_OF = Object.fromEntries(Object.entries(ICON_TEXT).map(([name, glyph]) => [glyph, name]));

/**
 * @typedef {{text: string, strong?: boolean}} Seg
 * @typedef {object} Phrase
 * @property {string} time "HH:MM" of the line
 * @property {string} icon one glyph (plain-text places)
 * @property {string|null} iconName the SVG icon of core/icons.js (iconSvg) that replaces the glyph
 * @property {string} tone version key for the color: correct, incomplete, wrong, unknown, or accent
 * @property {Seg[]} main
 * @property {{segs: Seg[], tone: string}[]} details
 * @property {string|null} tag source of the deformation or kind of arrival
 * @property {Seg[]} head the headline version
 */

/**
 * Fills a template: "{a} tells {b}" with values; a value given as a string is
 * strong, one given as {text} or an array of segments keeps its own marks.
 * @param {string} template
 * @param {Object<string, string|number|Seg|Seg[]>} values
 * @returns {Seg[]}
 */
export function fill(template, values) {
  const out = [];
  const re = /\{(\w+)\}/g;
  let last = 0;
  let m;
  while ((m = re.exec(template))) {
    if (m.index > last) out.push({ text: template.slice(last, m.index) });
    const v = values[m[1]];
    if (Array.isArray(v)) out.push(...v);
    else if (v && typeof v === 'object') out.push(v);
    else out.push({ text: v === undefined || v === null ? '' : String(v), strong: true });
    last = re.lastIndex;
  }
  if (last < template.length) out.push({ text: template.slice(last) });
  return merge(out);
}

function merge(segs) {
  const out = [];
  for (const s of segs) {
    if (!s.text) continue;
    const prev = out[out.length - 1];
    if (prev && !!prev.strong === !!s.strong) prev.text += s.text;
    else out.push({ text: s.text, ...(s.strong ? { strong: true } : {}) });
  }
  return out;
}

/** Plain text of segments (tests, titles). */
export const plain = (segs) => segs.map((s) => s.text).join('');

/**
 * Creates the phrase maker of a run.
 * @param {object} header
 * @param {'es'|'en'} lang
 * @param {object} t the strings of story/strings.js for that language
 */
export function createPhraser(header, lang, t) {
  const name = (id) => neighborName(header, id);
  const art = (id) => {
    const p = placeOf(header, id);
    return p ? t.placeThe[p.key] ?? t.placeDefault : t.placeDefault;
  };
  const pname = (id) => placeOf(header, id)?.name ?? String(id);
  /** "la plaza" / "the square" (article plain, name strong). */
  const place = (id) => [{ text: `${art(id)} ` }, { text: pname(id), strong: true }];
  /** "a la plaza", "al bar" / "to the square". */
  const toPlace = (id) => [{ text: `${t.to(art(id))} ` }, { text: pname(id), strong: true }];
  const theWhat = (what) => ({ text: t.the[what] ?? whatName(what, lang) });
  /** "at the square" (en) / "a la plaza" (es): where someone arrives. */
  const atPlace = (id) => [{ text: `${t.at(art(id))} ` }, { text: pname(id), strong: true }];
  const value = (slot, v, what) => {
    if (v === null || v === undefined) return '?';
    if (slot === 'who') return name(v);
    if (slot === 'where') return pname(v);
    if (slot === 'when') return slotTime(v);
    const unit = unitOf(what, lang);
    return unit ? `${v} ${unit}` : String(v);
  };
  const names = (ids, max = 3) => {
    const shown = ids.slice(0, max).map(name);
    const more = ids.length - shown.length;
    const and = lang === 'es' ? ' y ' : ' and ';
    if (more > 0) return `${shown.join(', ')}${and}${more}${lang === 'es' ? ' más' : ' more'}`;
    return shown.length > 1 ? `${shown.slice(0, -1).join(', ')}${and}${shown[shown.length - 1]}` : shown[0] ?? '';
  };

  /** "fiesta de Manuel en la plaza a las 21:00". */
  const factText = (what, slots) => {
    const segs = [];
    if (slots.who) segs.push(...fill(t.fact, { what: { text: whatName(what, lang) }, who: name(slots.who) }));
    else segs.push({ text: whatName(what, lang) });
    if (slots.where) segs.push(...fill(t.factWhere, { where: place(slots.where) }));
    if (slots.when !== null && slots.when !== undefined) segs.push(...fill(t.factWhen, { when: slotTime(slots.when) }));
    return merge(segs);
  };

  const changeSegs = (c, what) => {
    const slot = { text: t.slot[c.slot] };
    const to = value(c.slot, c.to, what);
    if (c.verdict === 'hardened_doubt') return fill(t.harden, { slot, to });
    if (c.from !== null && c.from !== c.to) {
      const segs = fill(t.change, { slot, from: { text: value(c.slot, c.from, what) }, to });
      if (c.verdict !== 'contradiction') segs.push({ text: ` (${t.tag[c.verdict]})` });
      return segs;
    }
    return fill(c.verdict === 'invented' ? t.invent : t.guess, { slot, to });
  };

  const arrival = (line) => {
    const it = line.item;
    const n = line.members.length;
    const many = n > 1;
    const g = it.d.group;
    const tpl =
      g === 'right'
        ? many ? t.arriveManyRight : t.arriveRight
        : g === 'other_time'
          ? many ? t.arriveManyTime : t.arriveTime
          : many ? t.arriveManyPlace : t.arrivePlace;
    const main = fill(tpl, { a: name(it.who), n, toPlace: toPlace(it.d.place), atPlace: atPlace(it.d.place), when: slotTime(it.d.slot) });
    const details = [];
    let tag = null;
    if (g === 'other_place' && it.d.where) {
      details.push({ segs: fill(t.arrivePlaceDetail, { where: place(it.d.where) }), tone: 'wrong' });
      tag = t.tag.other_place;
    } else if (g === 'other_time') {
      if (it.d.when !== null) details.push({ segs: fill(t.arriveTimeDetail, { when: slotTime(it.d.when) }), tone: 'wrong' });
      tag = it.d.late ? t.tag.late : it.d.early ? t.tag.early : null;
    }
    if (many) details.push({ segs: [{ text: names(line.members, 4) }], tone: 'unknown' });
    return { main, details, tag, icon: g === 'right' ? '✓' : '✗', tone: g === 'right' ? 'correct' : 'wrong' };
  };

  /**
   * Phrase of a chronicle line (lines.js).
   * @param {import('./lines.js').Line} line
   * @returns {Phrase}
   */
  const phrase = (line) => {
    const it = line.item;
    const time = hhmm(it.tick);
    let p;
    switch (it.kind) {
      case 'inject': {
        const main = fill(t.inject, { fact: factText(it.d.what, it.d.slots) });
        const to = fill(t.injectTo, { to: names(it.d.to) });
        p = { main, details: [{ segs: to, tone: 'unknown' }], tag: null, icon: '★', tone: 'accent' };
        break;
      }
      case 'tell': {
        const d = it.d;
        const what = theWhat(d.what);
        const main = d.fresh
          ? fill(d.place ? t.tellAt : t.tell, { a: name(d.a), b: name(d.b), what, place: d.place ? place(d.place) : '' })
          : fill(t.retell, { a: name(d.a), b: name(d.b), what });
        const details = [];
        for (const c of d.changes) details.push({ segs: changeSegs(c, d.what), tone: c.off ? 'wrong' : 'incomplete' });
        if (d.wrong.length && d.fresh) {
          const values = d.wrong.map((w) => value(w.slot, w.value, d.what)).join(', ');
          details.push({ segs: fill(t.wrongVersion, { values }), tone: 'wrong' });
        }
        for (const c of d.conflicts) details.push({ segs: fill(t.conflict, { b: name(d.b), kept: value(c.slot, c.kept, d.what) }), tone: 'correct' });
        const bend = d.changes[0];
        let head = main;
        if (bend) {
          const change = fill(t.headTellShort[bend.verdict], { slot: { text: t.slot[bend.slot] } });
          head = fill(d.fresh ? t.headTell : t.headRetell, { a: name(d.a), b: name(d.b), what, change });
        }
        p = {
          main,
          details,
          tag: bend ? t.tag[bend.verdict] : null,
          icon: bend ? '✎' : '›',
          tone: bend?.off ? 'wrong' : it.version ?? 'unknown',
          head,
        };
        break;
      }
      case 'forgot':
        p = { main: fill(t.forget, { a: name(it.who), q: { text: t.forgot[it.d.slot] } }), details: [], tag: t.tag.forgot, icon: '?', tone: it.version ?? 'incomplete' };
        break;
      case 'doubt':
        p = {
          main: fill(t.doubtDropped, { a: name(it.who), of: { text: t.of[it.d.slot] }, value: value(it.d.slot, it.d.value, it.d.what) }),
          details: [],
          tag: t.tag.doubt_dropped,
          icon: '≈',
          tone: it.d.off ? 'wrong' : it.version ?? 'correct',
        };
        break;
      case 'move': {
        const n = line.members.length;
        const main = n > 1 ? fill(t.moveMany, { n, toPlace: toPlace(it.d.to) }) : fill(t.move, { a: name(it.who), toPlace: toPlace(it.d.to), what: theWhat(it.d.what) });
        const details = n > 1 ? [{ segs: [{ text: names(line.members, 4) }], tone: 'unknown' }] : [];
        p = { main, details, tag: null, icon: '➜', tone: it.version ?? 'unknown' };
        break;
      }
      case 'arrive':
        p = arrival(line);
        break;
      case 'end':
        p = { main: fill(t.end, { n: it.d.informed ?? '?', total: it.d.total }), details: [], tag: null, icon: '■', tone: 'accent' };
        break;
      default:
        p = { main: [{ text: it.kind }], details: [], tag: null, icon: '·', tone: 'unknown' };
    }
    return { time, head: p.head ?? p.main, iconName: ICON_OF[p.icon] ?? null, ...p };
  };

  /**
   * Summary for the headline when nothing is going on.
   * @param {{what: string}|null} fact the chosen fact, null before any inject
   * @param {number} knowers neighbors who know it
   * @param {number} total
   * @returns {Seg[]}
   */
  const calm = (fact, knowers, total) =>
    fact ? fill(t.calm, { n: knowers, total, what: theWhat(fact.what) }) : [{ text: t.calmBefore }];

  /** Who decides in this run, for the story mode: "decide Gemma 4 E4B" or "sin modelo: reglas". */
  const model = modelName(header, lang);
  const decider = () => (model ? fill(t.tour.decider.model, { model }) : [{ text: t.tour.decider.rules }]);

  /**
   * Title and paragraphs of a chapter of the story mode (tour.js line).
   * @param {{key: string} & Object<string, any>} line
   * @returns {{title: Seg[], body: Seg[][]}}
   */
  const chapter = (line) => {
    const tt = t.tour;
    const title = fill(tt.title[line.key] ?? line.key, { n: line.neighbors ?? '' });
    const body = [];
    switch (line.key) {
      case 'village':
        body.push(model ? fill(tt.village.model, { model }) : fill(tt.village.rules, {}));
        break;
      case 'inject':
        body.push(fill(tt.inject, { to: names(line.to), fact: factText(line.what, line.slots ?? {}) }));
        break;
      case 'spread':
        body.push(fill(tt.spread, { a: name(line.a), b: name(line.b) }));
        break;
      case 'distort': {
        const held = (line.state === 'sure' || line.state === 'doubt') && line.value !== null && line.value !== undefined;
        if (!held) body.push(fill(tt.distortLost, { who: name(line.who), q: { text: t.forgot[line.slot] } }));
        else if (line.value !== line.original) body.push(fill(tt.distortValue, { who: name(line.who), slot: { text: t.slot[line.slot] }, value: value(line.slot, line.value, line.what) }));
        else body.push(fill(tt.distortDoubt, { who: name(line.who), slot: { text: t.slot[line.slot] } }));
        body.push(fill(tt.distortCard, {}));
        break;
      }
      case 'consequences': {
        const when = line.when !== null && line.when !== undefined ? slotTime(line.when) : '?';
        body.push(line.where ? fill(tt.consequences, { where: place(line.where), when }) : fill(tt.consequencesWhen, { when }));
        if (line.wrong) body.push(fill(tt.consequencesWrong, {}));
        break;
      }
      case 'model':
        body.push(fill(tt.model, { n: line.decisions }));
        break;
      case 'day':
        body.push(line.informed !== null && line.informed !== undefined ? fill(tt.day, { n: line.informed, total: line.total }) : fill(tt.dayPlain, {}));
        break;
      default:
    }
    return { title, body };
  };

  return { phrase, calm, chapter, decider, model };
}
