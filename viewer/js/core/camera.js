// Camera of the village: a perspective camera that looks down at the ground,
// described with the same numbers as the old flat plan so that everything
// that stores, mirrors or compares cameras (split screen, URL focus, input)
// keeps working:
//
//   (x, y)  world point of the ground (header coordinates) at the centre of
//           the canvas
//   scale   CSS pixels per world unit at that point
//
// The 3D frame is three.js style: X = world x, Y = height, Z = world y, so
// "north" (smaller y) is away from the viewer. The camera sits south of its
// target and looks north and down; the pitch depends only on the zoom factor
// (scale / base): steeper when far (a map), lower when near (a street view).
//
//            eye
//             ●╲  pitch
//             │  ╲
//    height   │    ╲ distance = h / (2·scale·tan(fov/2))
//             │      ╲
//   ──────────┴────────● target (x, 0, y) ─────── ground
//            south            north →
//
// Pure math, no DOM and no three.js: the scene copies view() into its own
// camera every frame.

/** Vertical field of view, degrees. Narrow, so the village looks like a model. */
export const FOV = 30;
/** Pitch (degrees below the horizon) when far and when near. */
export const PITCH = { far: 60, near: 34 };
/** Zoom factors between which the pitch goes from far to near. */
export const PITCH_ZOOM = [1.2, 6];

const DEG = Math.PI / 180;

/**
 * Pitch (radians) for a zoom factor.
 * @param {number} z scale / base
 * @returns {number}
 */
export function pitchAt(z) {
  const a = Math.log(PITCH_ZOOM[0]);
  const b = Math.log(PITCH_ZOOM[1]);
  const t = Math.min(1, Math.max(0, (Math.log(Math.max(1e-6, z)) - a) / (b - a)));
  const s = t * t * (3 - 2 * t);
  return (PITCH.far + (PITCH.near - PITCH.far) * s) * DEG;
}

/**
 * @typedef {object} CameraView
 * @property {{x: number, y: number, z: number}} eye
 * @property {{x: number, y: number, z: number}} target
 * @property {{x: number, y: number, z: number}} up
 * @property {number} fov vertical, degrees
 * @property {number} distance eye to target
 * @property {number} pitch radians
 */

/**
 * @typedef {object} Camera
 * @property {number} x
 * @property {number} y
 * @property {number} scale
 * @property {number} w canvas width in CSS pixels
 * @property {number} h canvas height in CSS pixels
 * @property {number} base scale of zoom factor 1 (the home view); set by the renderer, else by fit()
 * @property {boolean} moved whether anything other than fit() has set it
 * @property {(wx: number, wy: number, height?: number) => {x: number, y: number}} toScreen
 *   a point behind the camera gives a point far off screen
 * @property {(sx: number, sy: number) => {x: number, y: number}} toWorld ground point under a screen point
 * @property {(v: {x?: number, y?: number, scale?: number}) => void} set emits onChange
 * @property {(b: {minX: number, minY: number, maxX: number, maxY: number}, pad?: number) => void} fit
 * @property {(v: {x: number, y: number, scale: number}) => void} reset like set, without marking it moved (home view)
 * @property {(w: number, h: number) => void} resize
 * @property {() => CameraView} view
 * @property {() => number} zoom scale / base
 */

const OFF = { x: -1e9, y: -1e9 };

/**
 * Scale that fits a ground box in a canvas, seen from the far pitch (depth on
 * the ground looks shorter by sin(pitch)).
 * @param {{minX: number, minY: number, maxX: number, maxY: number}} b
 * @param {number} w
 * @param {number} h
 * @param {number} [pad] CSS px
 * @returns {number}
 */
export function fitScale(b, w, h, pad = 60) {
  const bw = Math.max(1, b.maxX - b.minX);
  const bh = Math.max(1, b.maxY - b.minY);
  const shrink = Math.sin(PITCH.far * DEG);
  return Math.max(0.01, Math.min((w - 2 * pad) / bw, (h - 2 * pad) / (bh * shrink)));
}

/**
 * Creates a camera.
 * @param {() => void} [onChange] called after every change (the app emits 'zoom')
 * @returns {Camera}
 */
export function createCamera(onChange = () => {}) {
  // Basis of the current view, rebuilt when x, y, scale, w or h change.
  let key = '';
  let basis = null;
  const frame = () => {
    const k = `${cam.x}|${cam.y}|${cam.scale}|${cam.w}|${cam.h}|${cam.base}`;
    if (k === key && basis) return basis;
    key = k;
    const pitch = pitchAt(cam.zoom());
    const tan = Math.tan((FOV * DEG) / 2);
    const distance = cam.h / (2 * cam.scale * tan);
    const s = Math.sin(pitch);
    const c = Math.cos(pitch);
    const eye = { x: cam.x, y: distance * s, z: cam.y + distance * c };
    basis = {
      eye,
      pitch,
      distance,
      f: { x: 0, y: -s, z: -c }, // forward
      r: { x: 1, y: 0, z: 0 }, // right
      u: { x: 0, y: c, z: -s }, // up
      k: cam.h / 2 / tan, // focal length in CSS px
    };
    return basis;
  };

  const cam = {
    x: 0,
    y: 0,
    scale: 1,
    w: 1,
    h: 1,
    base: 0,
    moved: false,
    zoom() {
      return cam.base > 0 ? cam.scale / cam.base : 1;
    },
    toScreen(wx, wy, height = 0) {
      const b = frame();
      const vx = wx - b.eye.x;
      const vy = height - b.eye.y;
      const vz = wy - b.eye.z;
      const zc = vx * b.f.x + vy * b.f.y + vz * b.f.z;
      if (!(zc > 1e-6)) return { ...OFF };
      const xc = vx * b.r.x + vy * b.r.y + vz * b.r.z;
      const yc = vx * b.u.x + vy * b.u.y + vz * b.u.z;
      return { x: cam.w / 2 + (xc / zc) * b.k, y: cam.h / 2 - (yc / zc) * b.k };
    },
    toWorld(sx, sy) {
      const b = frame();
      const a = (sx - cam.w / 2) / b.k;
      const v = -(sy - cam.h / 2) / b.k;
      const d = { x: b.f.x + b.r.x * a + b.u.x * v, y: b.f.y + b.r.y * a + b.u.y * v, z: b.f.z + b.r.z * a + b.u.z * v };
      // Rays at or above the horizon never meet the ground: clamp them.
      const dy = Math.min(d.y, -1e-3);
      const t = -b.eye.y / dy;
      return { x: b.eye.x + d.x * t, y: b.eye.z + d.z * t };
    },
    set({ x = cam.x, y = cam.y, scale = cam.scale }) {
      if (!(scale > 0) || !Number.isFinite(x) || !Number.isFinite(y)) return;
      cam.x = x;
      cam.y = y;
      cam.scale = scale;
      cam.moved = true;
      onChange();
    },
    fit(b, pad = 40) {
      cam.x = (b.minX + b.maxX) / 2;
      cam.y = (b.minY + b.maxY) / 2;
      cam.scale = fitScale(b, cam.w, cam.h, pad);
      onChange();
    },
    reset({ x, y, scale }) {
      if (!(scale > 0) || !Number.isFinite(x) || !Number.isFinite(y)) return;
      cam.x = x;
      cam.y = y;
      cam.scale = scale;
      onChange();
    },
    resize(w, h) {
      cam.w = Math.max(1, w);
      cam.h = Math.max(1, h);
    },
    view() {
      const b = frame();
      return {
        eye: { ...b.eye },
        target: { x: cam.x, y: 0, z: cam.y },
        up: { ...b.u },
        fov: FOV,
        distance: b.distance,
        pitch: b.pitch,
      };
    },
  };
  return cam;
}

/**
 * Bounding box of the places of a header.
 * @param {object} header
 * @returns {{minX: number, minY: number, maxX: number, maxY: number}}
 */
export function placeBounds(header) {
  const xs = (header.places ?? []).map((p) => p.x);
  const ys = (header.places ?? []).map((p) => p.y);
  if (!xs.length) return { minX: 0, minY: 0, maxX: 1000, maxY: 700 };
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}
