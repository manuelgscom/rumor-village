// Zoom levels of the plan (pure, no DOM). The zoom factor `z` is the camera
// scale divided by the "home" scale, the one that fits the whole village (or
// the telephone row) in the canvas. Three levels blend with smooth fades:
//
//   z:  0.6 ······ 1 ········ 1.6 ══ 2.2 ········ 3.0 ══ 3.8 ········ 14
//       far: dots and colour wave │ mid: initials,    │ near: speech bubbles
//                                 │ labels and links  │
//   (══ = fade window: the weight goes 0 → 1 with a smoothstep, no jumps)

/** Zoom factor of each named level (the `zoom` URL parameter). */
export const LEVELS = { far: 1, mid: 3, near: 6 };

/** Fade windows of the mid and near levels, in zoom factor. */
export const MID_FADE = [1.6, 2.2];
export const NEAR_FADE = [3.0, 3.8];

/** Limits of the zoom factor. */
export const ZOOM_MIN = 0.6;
export const ZOOM_MAX = 14;

/** Padding (CSS px) of the home view, the same as the core's fit. */
export const HOME_PAD = 60;

/**
 * Smoothstep from 0 at `a` to 1 at `b`.
 * @param {number} a
 * @param {number} b
 * @param {number} x
 * @returns {number}
 */
export function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * Weights of the three levels for a zoom factor. far + mid covers the dots
 * (far = 1 - mid); near is on top of mid (mid stays 1 when near is 1).
 * @param {number} z zoom factor
 * @returns {{far: number, mid: number, near: number}}
 */
export function levelWeights(z) {
  const mid = smoothstep(MID_FADE[0], MID_FADE[1], z);
  const near = smoothstep(NEAR_FADE[0], NEAR_FADE[1], z);
  return { far: 1 - mid, mid, near };
}

/**
 * Zoom factor of the `zoom` URL parameter: "far", "mid", "near" or a number
 * (a zoom factor, 1 = the whole village). null if absent or not understood.
 * @param {string|number|null|undefined} param
 * @returns {number|null}
 */
export function zoomFactor(param) {
  if (param === null || param === undefined) return null;
  if (typeof param === 'number') return Number.isFinite(param) && param > 0 ? clampZoom(param) : null;
  const key = String(param).trim().toLowerCase();
  return LEVELS[key] ?? null;
}

/**
 * Clamps a zoom factor to the limits.
 * @param {number} z
 * @returns {number}
 */
export function clampZoom(z) {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
}

/**
 * Scale (CSS px per world unit) that fits a box in a canvas, as camera.fit does.
 * @param {{minX: number, minY: number, maxX: number, maxY: number}} b
 * @param {number} w canvas width
 * @param {number} h canvas height
 * @param {number} [pad]
 * @returns {number}
 */
export function homeScale(b, w, h, pad = HOME_PAD) {
  const bw = Math.max(1, b.maxX - b.minX);
  const bh = Math.max(1, b.maxY - b.minY);
  return Math.max(0.01, Math.min((w - 2 * pad) / bw, (h - 2 * pad) / bh));
}

/**
 * Camera after zooming by `factor` around a screen point, which keeps the
 * world point under it in place. The scale is clamped to [minScale, maxScale].
 * @param {{x: number, y: number, scale: number, w: number, h: number}} cam
 * @param {number} factor > 1 zooms in
 * @param {number} sx
 * @param {number} sy
 * @param {number} minScale
 * @param {number} maxScale
 * @returns {{x: number, y: number, scale: number}}
 */
export function zoomAbout(cam, factor, sx, sy, minScale, maxScale) {
  const scale = Math.min(maxScale, Math.max(minScale, cam.scale * factor));
  const wx = (sx - cam.w / 2) / cam.scale + cam.x;
  const wy = (sy - cam.h / 2) / cam.scale + cam.y;
  return { x: wx - (sx - cam.w / 2) / scale, y: wy - (sy - cam.h / 2) / scale, scale };
}

/**
 * Camera centre kept inside a box (the home bounds), so that dragging or
 * zooming out around a corner can never leave the plan out of view.
 * @param {{x: number, y: number}} c
 * @param {{minX: number, minY: number, maxX: number, maxY: number}} b
 * @returns {{x: number, y: number}}
 */
export function clampCentre(c, b) {
  return { x: Math.min(b.maxX, Math.max(b.minX, c.x)), y: Math.min(b.maxY, Math.max(b.minY, c.y)) };
}
