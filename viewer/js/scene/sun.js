// Sun and moon of the village by playback position (fase 8-2, 2.3). Pure: no
// three.js, no DOM. Coherent with clock.daylight: the sun rises at 06:00 and
// sets at 21:00, the middle of the dawn (05:30-06:30) and dusk (20:30-21:30)
// ramps, where daylight is exactly one half.
//
// World axes: +x east, +z south, +y up. The camera stands south of the village
// and looks north, so east is on the right of the screen.
//
//                 N (-z)  · · · camera looks this way
//                   │
//   sunset W (-x) ──┼── E (+x) sunrise
//                   │
//                 S (+z)  sun at noon, behind the camera
//
// The sun goes east → south → west on a tilted arc (highest at 13:30, PEAK
// degrees up). With the sun on the camera's side the fronts we see are lit
// all day (a clear, readable model), and at the golden hours it is low in the
// east or the west, so the long shadows run sideways across the streets,
// where the camera sees them; with the sun in the north the facades facing us
// would be in shadow all day. The moon takes the same kind of arc while the
// sun is down: it rises in the east at sunset and sets in the west at sunrise
// (a full moon), lower in the sky.
//
// lightAt(pos) is the one shadow-casting light: the sun by day, the moon by
// night, with its direction quantized (STEP) so that the static shadow map is
// redrawn only now and then, and never lower than MIN_ELEVATION (shadows of a
// sun on the horizon would be endless). Its strength fades to zero where it
// swaps from the setting sun to the rising moon, so the swap does not jump.

const DEG = Math.PI / 180;
const DAY = 1440;
/** Sunrise and sunset, minutes of the day (centres of the daylight ramps). */
export const SUNRISE = 6 * 60;
export const SUNSET = 21 * 60;
/** Highest elevation of the sun (at 13:30) and of the moon, degrees. */
export const PEAK = 62;
export const MOON_PEAK = 48;
/** Lowest elevation of the shadow-casting light, degrees. */
export const MIN_ELEVATION = 12;
/** Quantization of the light's path for the shadow map, degrees. */
export const STEP = 1.5;

/**
 * Angle of the sun along its circle, radians: 0 at sunrise, π at sunset,
 * 2π at the next sunrise (the day and the night are walked at their own pace).
 * @param {number} pos playback position (tick, may have decimals)
 */
export function sunAngle(pos) {
  const m = ((pos % DAY) + DAY) % DAY;
  if (m >= SUNRISE && m < SUNSET) return (Math.PI * (m - SUNRISE)) / (SUNSET - SUNRISE);
  const night = DAY - (SUNSET - SUNRISE);
  return Math.PI + (Math.PI * ((m - SUNSET + DAY) % DAY)) / night;
}

/** Unit vector of a body at angle a of a circle tilted `peak` degrees from the horizon (through east and west). */
function arc(a, peak) {
  const p = peak * DEG;
  return { x: Math.cos(a), y: Math.sin(a) * Math.sin(p), z: Math.sin(a) * Math.cos(p) };
}

const elevationOf = (v) => Math.asin(Math.max(-1, Math.min(1, v.y))) / DEG;

/**
 * Sun and moon at a playback position.
 * @param {number} pos
 * @returns {{sun: {x: number, y: number, z: number}, moon: {x: number, y: number, z: number}, sunUp: boolean, moonUp: boolean, elevation: number, moonElevation: number}}
 *   unit vectors towards each body; elevations in degrees (negative below the horizon)
 */
export function sunAt(pos) {
  const a = sunAngle(pos);
  const sun = arc(a, PEAK);
  const moon = arc(a - Math.PI, MOON_PEAK);
  const elevation = elevationOf(sun);
  const moonElevation = elevationOf(moon);
  // By the angle, not the sign of a sine: exact at sunrise and sunset.
  return { sun, moon, sunUp: a > 0 && a < Math.PI, moonUp: a > Math.PI, elevation, moonElevation };
}

function smooth(x) {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

/**
 * The shadow-casting light at a playback position.
 * @param {number} pos
 * @returns {{body: 'sun'|'moon', dir: {x: number, y: number, z: number}, k: number, key: string, elevation: number}}
 *   dir: unit vector towards the light (quantized, at least MIN_ELEVATION up);
 *   k: strength 0..1 (fades to 0 where sun and moon swap); key: changes only
 *   when dir changes; elevation: of the body itself, degrees
 */
export function lightAt(pos) {
  const a = sunAngle(pos);
  const sun = a < Math.PI;
  const along = sun ? a : a - Math.PI; // 0..π along the body's own arc
  const peak = sun ? PEAK : MOON_PEAK;
  const n = Math.round(along / (STEP * DEG));
  const q = arc(n * STEP * DEG, peak);
  const elevation = elevationOf(arc(along, peak));
  // At least MIN_ELEVATION up, keeping the heading.
  const min = MIN_ELEVATION * DEG;
  let dir = q;
  if (q.y < Math.sin(min)) {
    const h = Math.hypot(q.x, q.z);
    dir = { x: (q.x / h) * Math.cos(min), y: Math.sin(min), z: (q.z / h) * Math.cos(min) };
  }
  // Fade over the last (first) minutes above the horizon: the sun keeps its
  // strength until just before it sets (the golden hour), the moon rises slowly.
  const k = smooth(elevation / (sun ? 0.5 : 1.5));
  return { body: sun ? 'sun' : 'moon', dir, k, key: `${sun ? 's' : 'm'}${n}`, elevation };
}
