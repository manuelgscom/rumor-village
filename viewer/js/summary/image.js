// The final card drawn by hand on a 1200×630 canvas, for «Guardar como
// imagen» (phase 8-2, 2.10). No libraries: only the 2D context, so a test can
// run it on a fake context.
//
//   ┌──────────────────────────────────────────────────────────────┐
//   │ RUMOR VILLAGE · FIN DEL DÍA                                  │
//   │ Fiesta                                                       │
//   │ Manuel · plaza · 21:00 · 50                                  │
//   │                                  ┌ QUIÉN SE LO CONTÓ A QUIÉN ┐│
//   │ 50  de 100 se enteraron          │   ◆                       ││
//   │ 33  llegaron al sitio y a la hora│  ●─●─●   (tree)           ││
//   │  8  con algún dato cambiado      │ LOS MÁS COTILLAS          ││
//   │ ███████▒▒▒░░░░░░                 │ (CA) Carmen  (LU) Luis …  ││
//   │                                  └───────────────────────────┘│
//   │ GRABACIÓN · Rumor Village · 100 vecinos · …       repo url    │
//   └──────────────────────────────────────────────────────────────┘

import { graphLayout, paintGraph } from '../rumor/graph.js';
import { VERSION_COLORS } from '../core/theme.js';
import { INK } from '../rumor/overlay.js';
import { ACCENT } from './card.js';

export const IMAGE_W = 1200;
export const IMAGE_H = 630;

const FONT = 'Nunito, "DejaVu Sans", system-ui, sans-serif';
const MUTED = '#5d6b78';
const LINE = 'rgba(30, 42, 54, 0.12)';

const font = (weight, size) => `${weight} ${size}px ${FONT}`;

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

/** Text cut with an ellipsis to fit `max` pixels. */
function fit(ctx, text, max) {
  if (ctx.measureText(text).width <= max) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > max) s = s.slice(0, -1);
  return `${s}…`;
}

/** A round face: the portrait if it is loaded, else the initials on the version color. */
function face(ctx, x, y, r, p, img) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.fillStyle = p.color;
  ctx.fill();
  if (img) {
    ctx.clip();
    ctx.fillStyle = '#eef2f8';
    ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
    ctx.drawImage(img, x - r, y - r, 2 * r, 2 * r);
  } else {
    // The light green of «incomplete» needs dark letters.
    ctx.fillStyle = p.color === VERSION_COLORS.incomplete ? '#1d4d40' : '#ffffff';
    ctx.font = font(900, Math.round(r * 0.8));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(p.initials, x, y + 1);
  }
  ctx.restore();
  ctx.strokeStyle = p.color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(x, y, r + 1.5, 0, Math.PI * 2);
  ctx.stroke();
}

/**
 * Draws the card.
 * @param {CanvasRenderingContext2D} ctx a 1200×630 context
 * @param {ReturnType<import('./card.js').cardOf>} card
 * @param {object} o
 * @param {ReturnType<import('../rumor/tree.js').treeAt>|null} o.tree
 * @param {(id: string) => string} o.nodeColor
 * @param {(who: string) => CanvasImageSource|null} o.portrait loaded portrait or null
 * @param {string} o.footer «GRABACIÓN · Rumor Village · 100 vecinos · …»
 * @param {string} o.url the repository, shown small at the bottom right
 * @param {{tree: string, gossips: string, brand: string}} o.titles
 */
export function drawCardImage(ctx, card, o) {
  const W = IMAGE_W;
  const H = IMAGE_H;
  // Background: a soft sky and a white sheet.
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#dfeaf8');
  bg.addColorStop(1, '#f6efe4');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.shadowColor = 'rgba(18, 28, 45, 0.18)';
  ctx.shadowBlur = 30;
  ctx.shadowOffsetY = 8;
  roundRect(ctx, 24, 24, W - 48, H - 48, 28);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.restore();

  const L = 64;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = ACCENT;
  ctx.font = font(900, 17);
  ctx.fillText(`${o.titles.brand} · ${card.kicker}`.toUpperCase(), L, 78);
  ctx.fillStyle = INK;
  ctx.font = font(900, 50);
  ctx.fillText(fit(ctx, card.what || card.fact, 520), L, 132);
  if (card.what) {
    ctx.fillStyle = MUTED;
    ctx.font = font(700, 22);
    ctx.fillText(fit(ctx, card.fact, 520), L, 168);
  }

  // Figures.
  let y = 250;
  for (const f of card.figs) {
    ctx.font = font(900, 64);
    ctx.fillStyle = f.color;
    ctx.textAlign = 'right';
    ctx.fillText(f.n === null ? '—' : String(f.n), L + 120, y);
    ctx.textAlign = 'left';
    ctx.fillStyle = INK;
    ctx.font = font(800, 22);
    ctx.fillText(fit(ctx, f.label, 380), L + 140, y - (f.sub ? 22 : 10));
    if (f.sub) {
      ctx.fillStyle = MUTED;
      ctx.font = font(600, 17);
      ctx.fillText(fit(ctx, f.sub, 380), L + 140, y + 2);
    }
    y += 92;
  }

  // Versions bar.
  const total = Math.max(1, card.bar.reduce((a, b) => a + b.n, 0));
  const barW = 500;
  let x = L;
  ctx.save();
  roundRect(ctx, L, 506, barW, 14, 7);
  ctx.clip();
  for (const b of card.bar) {
    const w = (barW * b.n) / total;
    ctx.fillStyle = b.color;
    ctx.fillRect(x, 506, w + 0.5, 14);
    x += w;
  }
  ctx.restore();

  // Right panel: the tree and the gossips.
  const PX = 620;
  const PY = 64;
  const PW = W - PX - 64;
  const PH = 476;
  roundRect(ctx, PX, PY, PW, PH, 20);
  ctx.fillStyle = '#f4f6fa';
  ctx.fill();
  ctx.fillStyle = ACCENT;
  ctx.font = font(900, 14);
  ctx.textAlign = 'left';
  ctx.fillText(o.titles.tree.toUpperCase(), PX + 24, PY + 36);
  if (o.tree && o.tree.nodes.length) {
    const layout = graphLayout(o.tree, PW - 32, { maxHeight: 250, step: 44 });
    ctx.save();
    ctx.translate(PX + 16, PY + 52 + Math.max(0, (250 - layout.height) / 2));
    paintGraph(ctx, o.tree, layout, {
      color: o.nodeColor,
      edges: new Set(),
      rings: new Map(),
      labels: new Map(),
      ink: INK,
      line: 'rgba(30, 42, 54, 0.25)',
      text: INK,
      halo: '#f4f6fa',
    });
    ctx.restore();
  }
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PX + 24, PY + 318);
  ctx.lineTo(PX + PW - 24, PY + 318);
  ctx.stroke();
  ctx.fillStyle = ACCENT;
  ctx.font = font(900, 14);
  ctx.fillText(o.titles.gossips.toUpperCase(), PX + 24, PY + 348);
  const people = [...card.tellers.slice(0, 3)];
  const slot = (PW - 48) / Math.max(1, people.length);
  people.forEach((p, k) => {
    const cx = PX + 24 + k * slot;
    face(ctx, cx + 22, PY + 400, 21, p, o.portrait(p.who));
    ctx.textAlign = 'left';
    ctx.fillStyle = INK;
    ctx.font = font(900, 18);
    ctx.fillText(fit(ctx, p.name, slot - 58), cx + 52, PY + 396);
    ctx.fillStyle = MUTED;
    ctx.font = font(700, 13);
    ctx.fillText(fit(ctx, p.line, slot - 58), cx + 52, PY + 415);
  });

  // Footer.
  ctx.textAlign = 'left';
  ctx.fillStyle = MUTED;
  ctx.font = font(700, 16);
  ctx.fillText(fit(ctx, o.footer, 640), L, H - 56);
  ctx.textAlign = 'right';
  ctx.font = font(700, 15);
  ctx.fillText(o.url.replace(/^https?:\/\//, ''), W - 64, H - 56);
}
