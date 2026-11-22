// Drawing of the timeline track on its canvas: day and night band with its
// hours, marks, progress, live edge, cursor and hover line. Only draws what
// it is given (the split screen uses it too, without marks).
//
//   y  0 ┬ mark heads  ◆ inject  ▼ first change  ■ first forget  ✓● ✗● arrivals (right, wrong)
//     12 ┼ ╭──────────────────────────────────────────────╮
//        │ │ day ░░ 18:00 ░░ dusk ▒▒ 21:00 ▓▓ night ▓▓▓▓ │ ▐ cursor handle
//     30 ┼ ╰──────────────────────────────────────────────╯
//     35 ┴ progress ━━━━━━━━━┄┄┄┄┄┄┄┄┄┄  (faded past the live edge)

import { daylight, hhmm, minuteOfDay } from '../core/clock.js';
import { mix, VERSION_COLORS } from '../core/theme.js';
import { xOfTick } from './timeline.js';

export const TRACK_HEIGHT = 40;
const HEAD_Y = 6;
const BAND_TOP = 13;
const BAND_BOTTOM = 31;
const PROGRESS_Y = 36;

/** Colors of the marks (also used by the legend and the tooltip). */
export const MARK_COLORS = {
  inject: '#6d4fd8',
  change: VERSION_COLORS.wrong,
  forget: VERSION_COLORS.incomplete,
  arriveOk: VERSION_COLORS.correct,
  arriveOther: VERSION_COLORS.wrong,
};

/** Sky of the band: night, twilight and day. */
const SKY = { night: '#27325e', twilight: '#f59a62', day: '#ffe7a1' };

/** Color of the band for a daylight value (0 night … 1 day), through twilight. */
export function skyColor(light) {
  return light < 0.5 ? mix(SKY.night, SKY.twilight, light * 2) : mix(SKY.twilight, SKY.day, (light - 0.5) * 2);
}

/** Legend key of a mark: inject, change, forget, arriveOk or arriveOther. */
export function markKey(m) {
  if (m.kind === 'arrive') return m.ok ? 'arriveOk' : 'arriveOther';
  return m.kind;
}

/** Hours between two labels of the band, so that they stay `minPx` apart. */
export function hourStep(range, w, minPx = 76) {
  const pxPerHour = (60 / Math.max(1, range.end - range.start)) * w;
  for (const h of [1, 2, 3, 4, 6, 12, 24]) if (h * pxPerHour >= minPx) return h;
  return 48;
}

/**
 * Traces the shape of a mark head centered at (x, y), scaled by `k`.
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} kind inject, change, forget or arrive
 */
function headPath(ctx, kind, x, y, k) {
  ctx.beginPath();
  if (kind === 'inject') {
    ctx.moveTo(x, y - 5.5 * k);
    ctx.lineTo(x + 5 * k, y);
    ctx.lineTo(x, y + 5.5 * k);
    ctx.lineTo(x - 5 * k, y);
  } else if (kind === 'change') {
    ctx.moveTo(x - 5.5 * k, y - 4.5 * k);
    ctx.lineTo(x + 5.5 * k, y - 4.5 * k);
    ctx.lineTo(x, y + 5.5 * k);
  } else if (kind === 'forget') {
    ctx.rect(x - 4 * k, y - 4 * k, 8 * k, 8 * k);
  } else {
    ctx.arc(x, y, 4.5 * k, 0, Math.PI * 2);
  }
  ctx.closePath();
}

/**
 * Check (right) or cross (wrong) inside an arrival head: the two kinds differ
 * in shape too, not only in color.
 */
function arriveGlyph(ctx, ok, x, y, k) {
  ctx.beginPath();
  if (ok) {
    ctx.moveTo(x - 2.3 * k, y + 0.1 * k);
    ctx.lineTo(x - 0.6 * k, y + 1.8 * k);
    ctx.lineTo(x + 2.4 * k, y - 1.6 * k);
  } else {
    ctx.moveTo(x - 1.8 * k, y - 1.8 * k);
    ctx.lineTo(x + 1.8 * k, y + 1.8 * k);
    ctx.moveTo(x + 1.8 * k, y - 1.8 * k);
    ctx.lineTo(x - 1.8 * k, y + 1.8 * k);
  }
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.4 * k;
  ctx.lineCap = 'round';
  ctx.stroke();
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/**
 * Draws the track.
 * @param {CanvasRenderingContext2D} ctx in CSS pixels
 * @param {object} d
 * @param {number} d.w width
 * @param {{start: number, end: number}} d.range
 * @param {number} d.pos playback position
 * @param {number|null} d.edge live edge (store.lastTick) or null for a recording
 * @param {import('./timeline.js').Mark[]} d.marks
 * @param {number|null} d.hoverX
 * @param {{accent: string, line: string, text: string, live?: string}} d.colors
 * @param {import('./timeline.js').Mark[]} [d.hot] marks under the pointer, drawn larger
 * @param {(tick: number) => string} [d.dayName] label of a midnight (else "00:00")
 */
export function drawTrack(ctx, { w, range, pos, edge, marks, hoverX, colors, hot = [], dayName = null }) {
  ctx.clearRect(0, 0, w, TRACK_HEIGHT);
  const x = (t) => xOfTick(t, range, w);
  const edgeX = edge === null ? w : Math.max(0, Math.min(w, x(edge)));
  const bandH = BAND_BOTTOM - BAND_TOP;
  const span = range.end - range.start;
  const px = Math.max(0, Math.min(w, x(pos)));

  // Band: the sky of each moment, one column per pixel, faded past the live edge.
  ctx.save();
  roundRect(ctx, 0.5, BAND_TOP, w - 1, bandH, bandH / 2);
  ctx.clip();
  for (let px = 0; px < w; px++) {
    const t = range.start + ((px + 0.5) / w) * span;
    ctx.globalAlpha = px >= edgeX ? 0.35 : 1;
    ctx.fillStyle = skyColor(daylight(t));
    ctx.fillRect(px, BAND_TOP, 1, bandH);
  }
  ctx.globalAlpha = 1;

  // Hours: a notch and its label inside the band.
  const step = hourStep(range, w) * 60;
  ctx.font = '700 10px Nunito, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const cy = (BAND_TOP + BAND_BOTTOM) / 2;
  for (let t = Math.ceil(range.start / step) * step; t <= range.end; t += step) {
    const hx = x(t);
    if (hx < 18 || hx > w - 18 || Math.abs(hx - px) < 22) continue; // not under the cursor
    const dark = daylight(t) < 0.5;
    const label = minuteOfDay(t) === 0 && dayName ? dayName(t) : hhmm(t);
    ctx.globalAlpha = t > (edge ?? Infinity) ? 0.45 : 1;
    ctx.fillStyle = dark ? 'rgba(255, 255, 255, 0.85)' : 'rgba(30, 42, 54, 0.62)';
    ctx.fillText(label, hx, cy + 0.5);
    ctx.fillStyle = dark ? 'rgba(255, 255, 255, 0.4)' : 'rgba(30, 42, 54, 0.25)';
    ctx.fillRect(Math.round(hx) - 0.5, BAND_TOP, 1, 3);
    ctx.fillRect(Math.round(hx) - 0.5, BAND_BOTTOM - 3, 1, 3);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
  ctx.strokeStyle = 'rgba(30, 42, 54, 0.14)';
  ctx.lineWidth = 1;
  roundRect(ctx, 0.5, BAND_TOP + 0.5, w - 1, bandH - 1, (bandH - 1) / 2);
  ctx.stroke();

  // Progress: the played part under the band.
  ctx.lineCap = 'round';
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(30, 42, 54, 0.12)';
  ctx.beginPath();
  ctx.moveTo(2, PROGRESS_Y);
  ctx.lineTo(w - 2, PROGRESS_Y);
  ctx.stroke();
  ctx.strokeStyle = colors.accent;
  ctx.beginPath();
  ctx.moveTo(2, PROGRESS_Y);
  ctx.lineTo(Math.max(2, px), PROGRESS_Y);
  ctx.stroke();

  // Marks: a stem from the head down to the band (its labels stay readable). When one tick has
  // arrivals of both kinds, their heads part sideways.
  const both = new Set();
  const seen = new Set();
  for (const m of marks) {
    if (m.kind !== 'arrive') continue;
    if (seen.has(m.tick)) both.add(m.tick);
    seen.add(m.tick);
  }
  const hotSet = new Set(hot);
  const headX = (m) => Math.round(x(m.tick)) + 0.5 + (m.kind === 'arrive' && both.has(m.tick) ? (m.ok ? 4 : -4) : 0);
  for (const m of marks) {
    const mx = Math.round(x(m.tick)) + 0.5;
    ctx.lineCap = 'butt';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(mx, HEAD_Y + 4);
    ctx.lineTo(mx, BAND_TOP + 4);
    ctx.stroke();
    ctx.strokeStyle = MARK_COLORS[markKey(m)];
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(mx, HEAD_Y + 4);
    ctx.lineTo(mx, BAND_TOP + 4);
    ctx.stroke();
  }
  const drawHead = (m) => {
    const k = hotSet.has(m) ? 1.35 : 1;
    headPath(ctx, m.kind, headX(m), HEAD_Y, k);
    ctx.fillStyle = MARK_COLORS[markKey(m)];
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.fill();
    if (m.kind === 'arrive') arriveGlyph(ctx, m.ok, headX(m), HEAD_Y, k);
  };
  for (const m of marks) if (!hotSet.has(m)) drawHead(m);
  for (const m of marks) if (hotSet.has(m)) drawHead(m);

  // Live edge: a red line with a dot on top.
  if (edge !== null && edgeX < w - 1) {
    ctx.strokeStyle = colors.live ?? '#e0413a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(edgeX, BAND_TOP - 1);
    ctx.lineTo(edgeX, PROGRESS_Y + 2);
    ctx.stroke();
    ctx.fillStyle = colors.live ?? '#e0413a';
    ctx.beginPath();
    ctx.arc(edgeX, BAND_TOP - 3, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // Hover line.
  if (hoverX !== null) {
    ctx.strokeStyle = colors.text;
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(Math.round(hoverX) + 0.5, BAND_TOP - 2);
    ctx.lineTo(Math.round(hoverX) + 0.5, TRACK_HEIGHT);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  // Cursor: a thin line and a white handle over the band.
  const hx = Math.max(6, Math.min(w - 6, px));
  ctx.lineCap = 'round';
  ctx.strokeStyle = colors.text;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(hx, 2);
  ctx.lineTo(hx, PROGRESS_Y + 2);
  ctx.stroke();
  ctx.save();
  ctx.shadowColor = 'rgba(18, 28, 45, 0.35)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 1;
  roundRect(ctx, hx - 5.5, BAND_TOP - 3, 11, bandH + 6, 5.5);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.restore();
  roundRect(ctx, hx - 5.5, BAND_TOP - 3, 11, bandH + 6, 5.5);
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = colors.accent;
  ctx.stroke();
  ctx.fillStyle = colors.accent;
  ctx.fillRect(hx - 0.75, BAND_TOP + 3, 1.5, bandH - 6);
}
