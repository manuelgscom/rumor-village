// The shareable link (phase 8-1, package A): the state of the viewer as a
// query string that parseParams (core/params.js) reads back. Pure: no DOM.
//
//   linkOf(state) → '?log=…&lang=…&t=…&select=…&group=…&cam=x,y,zoom&ui=…'
//   state = {log, left, right, labels, lang, t, select, group,
//            cam: {x, y, zoom}|null, director, ui}
//
// What opens the page (log, left/right, labels, lang) is kept as it came; the
// rest is the moment: t to 0.1 tick, the camera to 0.1 world unit and its zoom
// to 0.01. With the director on, the camera is its own: director=1, no cam.
// Never `paused` nor `tour`: a shared link plays from its instant.

/**
 * A value for a query string, with "/", ":" and "," left readable.
 * @param {string|number} v
 * @returns {string}
 */
export function enc(v) {
  return encodeURIComponent(String(v)).replace(/%2F/gi, '/').replace(/%3A/gi, ':').replace(/%2C/gi, ',');
}

/**
 * A query string from [key, value] pairs; empty values are left out.
 * @param {[string, unknown][]} pairs
 * @returns {string} '?a=1&b=2', or '' when nothing is left
 */
export function queryOf(pairs) {
  const parts = [];
  for (const [k, v] of pairs) if (v !== null && v !== undefined && v !== '' && v !== false) parts.push(`${k}=${enc(/** @type {any} */ (v))}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

/** A number rounded to `digits` decimals, without trailing zeros (and no "-0"). */
function fixed(v, digits) {
  const n = Number(v.toFixed(digits));
  return String(n === 0 ? 0 : n);
}

/**
 * @param {{log?: string|null, left?: string|null, right?: string|null, labels?: string[]|null,
 *   lang?: string|null, t?: number|null, select?: string|null, group?: string|null,
 *   cam?: {x: number, y: number, zoom: number}|null, director?: boolean, ui?: string|null}} state
 * @returns {string}
 */
export function linkOf(state) {
  const s = state ?? {};
  const camOk = s.cam && !s.director && [s.cam.x, s.cam.y, s.cam.zoom].every(Number.isFinite) && s.cam.zoom > 0;
  const cam = camOk ? `${fixed(s.cam.x, 1)},${fixed(s.cam.y, 1)},${fixed(Math.max(0.01, s.cam.zoom), 2)}` : null;
  return queryOf([
    ['log', s.log],
    ['left', s.left],
    ['right', s.right],
    ['labels', Array.isArray(s.labels) ? s.labels.join(',') : null],
    ['lang', s.lang],
    ['t', Number.isFinite(s.t) ? fixed(/** @type {number} */ (s.t), 1) : null],
    ['select', s.select],
    ['group', s.group],
    ['cam', cam],
    ['director', s.director ? 1 : null],
    ['ui', s.ui],
  ]);
}
