// What the rumor overlay shows over the village: the chain of the selected
// neighbor, or the chains of a group up to their culprits, and the rings.
// overlaySpec is pure (model → segments, rings, labels); the scene draws it in
// 3D with HTML labels (scene/overlay/). drawSegments and drawRings, the old
// 2D layers, are no-ops kept until rumor/index.js stops registering them.

import { VERSION_COLORS } from '../core/theme.js';
import { neighborName, slotValueText } from '../core/names.js';

/** Colors of the consequence groups. */
export const GROUP_COLORS = { right: VERSION_COLORS.correct, other_time: '#e39b2d', other_place: VERSION_COLORS.wrong };

/** Ink of highlighted chains and rings. */
export const INK = '#1d2a35';

const FAINT = 'rgba(128, 140, 152, 0.6)';

function valueText(slot, v, header) {
  if (!v) return '—';
  return slotValueText(slot, v.value, header) + (v.state === 'doubt' ? '?' : '');
}

/**
 * Segments, rings and labels for a model.
 * @param {ReturnType<import('./model.js').buildModel>} m
 * @param {object} header
 * `focus` lists the neighbors of the chain or group being shown (phase 8-2):
 * the scene dims everyone else's token. Empty when nothing is shown.
 * @returns {{segments: {a: string, b: string, color: string, width: number, label?: string}[], rings: {id: string, color: string, width: number, r: number}[], labels: {id: string, text: string, color: string}[], focus: string[]}}
 */
export function overlaySpec(m, header) {
  const out = { segments: [], rings: [], labels: [], focus: [] };
  if (m.chain) {
    const c = m.chain;
    for (const st of c.steps) {
      const x = st.slots.find((s) => s.slot === c.lead);
      const changed = !!x?.changed;
      out.segments.push({
        a: st.from,
        b: st.to,
        color: changed ? VERSION_COLORS.wrong : INK,
        width: changed ? 4 : 2.5,
        label: changed ? `${valueText(c.lead, x.old, header)} → ${valueText(c.lead, x.got ?? x.heard, header)}` : undefined,
      });
      out.rings.push({ id: st.from, color: INK, width: 2, r: 9 });
    }
    if (c.origin) out.labels.push({ id: c.origin.who, text: `◆ ${neighborName(header, c.origin.who)}`, color: INK });
    out.rings.push({ id: c.target, color: INK, width: 3.5, r: 13 });
    // The origin selected itself: one label, the origin's.
    if (c.origin?.who !== c.target) out.labels.push({ id: c.target, text: neighborName(header, c.target), color: INK });
    out.focus = unique([c.origin?.who, ...c.steps.flatMap((st) => [st.from, st.to]), c.target]);
    return out;
  }
  if (m.select) {
    out.rings.push({ id: m.select, color: INK, width: 3.5, r: 13 });
    out.labels.push({ id: m.select, text: neighborName(header, m.select), color: INK });
  }
  if (m.group && m.groups) {
    const color = GROUP_COLORS[m.group];
    for (const member of m.groups[m.group]) out.rings.push({ id: member.who, color, width: 3, r: 10 });
    // Each member's chain: strong from its culprit's hop on, faint before.
    const segs = new Map();
    for (const { culprit, members } of m.culprits?.culprits ?? []) {
      for (const who of members) {
        const chain = m.culprits.chains.get(who);
        if (!chain) continue;
        const hop = culprit.kind === 'turn' ? chain.steps.findIndex((st) => st.turn.id === culprit.id) : -1;
        chain.steps.forEach((st, k) => {
          const strong = hop >= 0 && k >= hop;
          const key = `${st.from}>${st.to}`;
          if (strong || !segs.has(key)) {
            segs.set(key, { a: st.from, b: st.to, color: strong ? color : FAINT, width: strong ? 3.5 : 1.5 });
          }
        });
      }
    }
    out.segments.push(...segs.values());
    for (const { culprit } of m.culprits?.culprits ?? []) {
      out.rings.push({ id: culprit.who, color: INK, width: 4, r: 14 });
      out.labels.push({ id: culprit.who, text: `⚠ ${neighborName(header, culprit.who)}`, color: INK });
    }
    // Members, culprits and the people along the strong part of their chains.
    const strong = [...segs.values()].filter((sg) => sg.color === color).flatMap((sg) => [sg.a, sg.b]);
    out.focus = unique([...m.groups[m.group].map((x) => x.who), ...(m.culprits?.culprits ?? []).map((x) => x.culprit.who), ...strong]);
  }
  return out;
}

/** Ids without repeats nor blanks, in order of first appearance. */
function unique(ids) {
  return [...new Set(ids.filter(Boolean))];
}

const LABEL_H = 18;

/**
 * Places label boxes so they do not overlap: each one moves down until it
 * clears the ones already placed. Pure.
 * @param {{x: number, y: number, w: number}[]} boxes wanted top-left corners and widths
 * @param {number} [h] height of every box
 * @returns {{x: number, y: number, w: number}[]}
 */
export function spreadLabels(boxes, h = LABEL_H) {
  const placed = [];
  for (const b of boxes) {
    const p = { ...b };
    for (let guard = 0; guard < 50; guard++) {
      const hit = placed.find((q) => p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + h + 2 && q.y < p.y + h + 2);
      if (!hit) break;
      p.y = hit.y + h + 3;
    }
    placed.push(p);
  }
  return placed;
}

/**
 * Former 2D layer of the chain segments. No-op (phase 7): see scene/overlay/.
 * @param {CanvasRenderingContext2D} ctx
 * @param {ReturnType<typeof overlaySpec>} spec
 * @param {(id: string) => {x: number, y: number}} screenOf
 */
export function drawSegments(ctx, spec, screenOf) {
  void ctx;
  void spec;
  void screenOf;
}

/**
 * Former 2D layer of the rings and labels. No-op (phase 7): see scene/overlay/.
 * @param {CanvasRenderingContext2D} ctx
 * @param {ReturnType<typeof overlaySpec>} spec
 * @param {(id: string) => {x: number, y: number}} screenOf
 */
export function drawRings(ctx, spec, screenOf) {
  void ctx;
  void spec;
  void screenOf;
}
