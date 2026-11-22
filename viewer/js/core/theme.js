// Colors shared by the canvas and the CSS. A flat infographic plan: muted
// ground, white roads, and the rumor in three versions plus grey.
//   correct     knows it right (same as the engine's reach)
//   incomplete  nothing wrong but something missing: amber, apart from both
//               green and red (phase 9-5: the faded green read as «correct»)
//   wrong       holds some value that differs from the original
//   unknown     has not heard of it

/** Color of each version; `unknown` for neighbors who do not know the fact. */
/** Shape of each version, besides its color (accessibility, phase 8-1). */
export const VERSION_GLYPHS = { correct: '✓', incomplete: '~', wrong: '✗' };

export const VERSION_COLORS = {
  correct: '#1f8a70',
  incomplete: '#e0a526',
  wrong: '#d1495b',
  unknown: '#9aa0a6',
};

/**
 * Color of a version (as returned by versionOf); null gives the grey.
 * @param {'correct'|'incomplete'|'wrong'|null} version
 * @returns {string}
 */
export function versionColor(version) {
  return VERSION_COLORS[version] ?? VERSION_COLORS.unknown;
}

/** Palette of the plan by day. */
export const DAY = {
  sky: '#eef1ea',
  ground: '#e4e8dc',
  road: '#ffffff',
  roadEdge: '#c9cfc0',
  place: '#ffffff',
  placeEdge: '#5f6b73',
  home: '#d8d2c4',
  homeEdge: '#8a8070',
  window: '#b9b2a2',
  water: '#a9cbe0',
  text: '#26313a',
  textMuted: '#66737d',
  neighbor: VERSION_COLORS.unknown,
};

/** Palette of the plan by night. */
export const NIGHT = {
  sky: '#141c2b',
  ground: '#1b2434',
  road: '#2c3850',
  roadEdge: '#232d40',
  place: '#26324a',
  placeEdge: '#8d9bb5',
  home: '#2b3343',
  homeEdge: '#55607a',
  window: '#f2c66d',
  water: '#22405e',
  text: '#e3e8f2',
  textMuted: '#9aa6bd',
  neighbor: '#7d8592',
};

function parseHex(c) {
  const h = c.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

/**
 * Mixes two "#rrggbb" colors.
 * @param {string} a
 * @param {string} b
 * @param {number} t 0 gives a, 1 gives b
 * @returns {string} "#rrggbb"
 */
export function mix(a, b, t) {
  const k = Math.min(1, Math.max(0, t));
  const pa = parseHex(a);
  const pb = parseHex(b);
  return (
    '#' +
    pa
      .map((v, i) => Math.round(v + (pb[i] - v) * k))
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('')
  );
}

/**
 * Palette for a daylight value (clock.daylight): 1 is DAY, 0 is NIGHT.
 * @param {number} light 0..1
 * @returns {typeof DAY}
 */
export function paletteAt(light) {
  const out = {};
  for (const key of Object.keys(DAY)) {
    // Text switches at dusk instead of fading, so it stays readable.
    out[key] = SWITCHED.has(key) ? (light >= 0.5 ? DAY[key] : NIGHT[key]) : mix(NIGHT[key], DAY[key], light);
  }
  return out;
}

const SWITCHED = new Set(['text', 'textMuted']);

/**
 * Writes the version colors as CSS variables (--c-correct, --c-incomplete,
 * --c-wrong, --c-unknown), so CSS and canvas share them.
 * @param {HTMLElement} root usually document.documentElement
 */
export function applyCssVars(root) {
  for (const [k, v] of Object.entries(VERSION_COLORS)) root.style.setProperty(`--c-${k}`, v);
}
