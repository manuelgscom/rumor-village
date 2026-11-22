// The "who told whom" tree drawn on a canvas inside #side. The layout is pure
// (graphLayout); drawGraph paints it. The depth axis goes across when the tree
// is deeper than wide (a telephone line), down otherwise (a party).

const PAD = 12;
const LABEL_ROOM = 12; // room above the top row for labels, in the across layout

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Screen layout of a tree in a box `width` wide.
 * @param {ReturnType<import('./tree.js').treeAt>} tree
 * @param {number} width CSS pixels
 * @param {{maxHeight?: number, step?: number}} [o] tallest box (default 200) and
 *   room per level or leaf across the depth (default 26 down, 16 across)
 * @returns {{width: number, height: number, r: number, root: {x: number, y: number}, pos: Map<string, {x: number, y: number}>}}
 */
export function graphLayout(tree, width, { maxHeight = 200, step = 0 } = {}) {
  const levels = tree.depth + 1;
  const leaves = tree.leaves;
  const horizontal = levels > leaves;
  const along = Math.max(10, width - 2 * PAD);
  let height;
  let depthStep;
  let orderStep;
  if (horizontal) {
    height = clamp(leaves * (step || 16) + 2 * PAD, 48, maxHeight);
    depthStep = along / Math.max(1, levels - 1);
    orderStep = leaves > 1 ? (height - 2 * PAD) / (leaves - 1) : 0;
  } else {
    height = clamp(levels * (step || 26) + 2 * PAD, 60, maxHeight);
    depthStep = (height - 2 * PAD) / Math.max(1, levels - 1);
    orderStep = leaves > 1 ? along / (leaves - 1) : 0;
  }
  const spacing = Math.min(depthStep, orderStep || depthStep);
  const r = clamp(spacing / 2 - 1, 2.5, 6);
  const middle = (horizontal ? height - 2 * PAD : along) / 2;
  const place = (depth, order) => {
    const o = leaves > 1 ? order * orderStep : middle;
    return horizontal ? { x: PAD + depth * depthStep, y: PAD + LABEL_ROOM + o } : { x: PAD + o, y: PAD + depth * depthStep };
  };
  if (horizontal) height += LABEL_ROOM;
  const pos = new Map();
  for (const n of tree.nodes) pos.set(n.id, place(n.depth, n.order));
  return { width, height, r, horizontal, root: place(0, tree.root.order), pos };
}

/**
 * Nearest node to a point, within a few pixels.
 * @returns {string|null}
 */
export function pickNode(layout, x, y) {
  let best = null;
  let bestD = Math.max(8, layout.r + 4) ** 2;
  for (const [id, p] of layout.pos) {
    const d = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d <= bestD) {
      bestD = d;
      best = id;
    }
  }
  return best;
}

/**
 * Paints the tree.
 * @param {HTMLCanvasElement} canvas
 * @param {ReturnType<import('./tree.js').treeAt>} tree
 * @param {ReturnType<typeof graphLayout>} layout
 * @param {object} o
 * @param {(id: string) => string} o.color fill of a node
 * @param {Set<string>} o.edges highlighted edges "from>to" ("" is the inject)
 * @param {Map<string, string>} o.rings ring color by node
 * @param {Map<string, string>} o.labels label by node
 * @param {string} o.ink color of highlighted edges
 * @param {string} o.line color of the other edges
 * @param {string} o.text
 * @param {boolean} [o.dim] fade the nodes that are not highlighted
 */
export function drawGraph(canvas, tree, layout, o) {
  const dpr = globalThis.devicePixelRatio || 1;
  const { width, height } = layout;
  canvas.style.height = `${height}px`;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  paintGraph(ctx, tree, layout, o);
}

/**
 * Paints the tree on a 2D context, in its current transform (drawGraph, and
 * the image of the final card, summary/image.js).
 * @param {CanvasRenderingContext2D} ctx
 * @param {ReturnType<import('./tree.js').treeAt>} tree
 * @param {ReturnType<typeof graphLayout>} layout
 * @param {object} o as drawGraph; o.halo is the color behind the labels (default white)
 */
export function paintGraph(ctx, tree, layout, o) {
  const { width, height, r, root, pos } = layout;
  ctx.lineCap = 'round';

  const at = (id) => (id ? pos.get(id) : root);
  const line = (a, b) => {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  };

  // Tree edges.
  ctx.strokeStyle = o.line;
  ctx.lineWidth = 1;
  for (const n of tree.nodes) line(at(n.parent), pos.get(n.id));

  // Highlighted edges (they may join nodes that are not parent and child).
  ctx.strokeStyle = o.ink;
  ctx.lineWidth = 2.5;
  for (const e of o.edges) {
    const [a, b] = e.split('>');
    const pa = at(a);
    const pb = at(b);
    if (pa && pb) line(pa, pb);
  }

  // The inject.
  ctx.fillStyle = o.text;
  ctx.beginPath();
  ctx.moveTo(root.x, root.y - r - 2);
  ctx.lineTo(root.x + r + 2, root.y);
  ctx.lineTo(root.x, root.y + r + 2);
  ctx.lineTo(root.x - r - 2, root.y);
  ctx.closePath();
  ctx.fill();

  const lit = new Set(o.rings.keys());
  for (const e of o.edges) for (const id of e.split('>')) if (id) lit.add(id);
  for (const n of tree.nodes) {
    const p = pos.get(n.id);
    ctx.globalAlpha = o.dim && !lit.has(n.id) ? 0.35 : 1;
    ctx.fillStyle = o.color(n.id);
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    const ring = o.rings.get(n.id);
    if (ring) {
      ctx.strokeStyle = ring;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + 2.5, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;

  // Labels last, with a halo so they read over edges.
  ctx.font = '700 11px Nunito, "DejaVu Sans", system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  for (const [id, text] of o.labels) {
    const p = pos.get(id);
    if (!p) continue;
    const w = ctx.measureText(text).width;
    let x;
    let y;
    if (layout.horizontal) {
      // Above the node: the edges run across.
      ctx.textAlign = 'center';
      x = clamp(p.x, w / 2 + 1, width - w / 2 - 1);
      y = Math.max(7, p.y - r - 9);
    } else {
      const right = p.x + r + 5 + w <= width;
      ctx.textAlign = right ? 'left' : 'right';
      x = right ? p.x + r + 5 : p.x - r - 5;
      y = clamp(p.y, 7, height - 7);
    }
    ctx.lineWidth = 3;
    ctx.strokeStyle = o.halo ?? 'rgba(255,255,255,0.9)';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = o.text;
    ctx.fillText(text, x, y);
  }
}
