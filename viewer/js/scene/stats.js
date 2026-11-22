// Frame meter of the 3D scene (fase 8-2, 2.1), only with ?stats=1: a small
// panel in #stats and app.stats.snapshot(), which viewer/tools/shot.mjs
// --measure reads. Without stats=1 nothing is created and #stats stays empty.
//
//   ┌ 58 fps (p90 51) · 17.2 ms ───────┐
//   │ 412 calls · 1.21 M tris          │
//   │ high · dpr 1.5        [copy log] │
//   └──────────────────────────────────┘
//
// Frame times are the intervals between animation frames (app.onFrame); the
// calls and triangles are those of the last drawn frame (renderer.info, shadow
// pass and post-processing included).

import { pick } from '../core/lang.js';
import { percentile } from './quality.js';

const STRINGS = {
  es: { copy: 'copiar registro', copied: 'copiado', failed: 'no se pudo copiar', calls: 'llamadas', tris: 'triángulos' },
  en: { copy: 'copy log', copied: 'copied', failed: 'could not copy', calls: 'calls', tris: 'triangles' },
};

/** Frames kept for the median and the p90. */
const KEEP = 120;
/** How often the panel text is refreshed, ms. */
const REFRESH_MS = 500;

const round = (x, d = 1) => (Number.isFinite(x) ? +x.toFixed(d) : null);

/**
 * @param {object} app
 * @param {import('three').WebGLRenderer} renderer
 * @returns {{frame(dtMs: number): void, drawn(info: {calls: number, triangles: number}, dpr: number): void}|null}
 */
export function createStats(app, renderer) {
  const zone = app.zones.stats;
  if (!app.params.stats || !zone) return null;
  const s = pick(STRINGS, app.lang);

  const times = [];
  let calls = 0;
  let triangles = 0;
  let dpr = 1;
  let gpu = null;
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  } catch {
    gpu = null;
  }

  function snapshot() {
    const ms = percentile(times, 0.5);
    const msP90 = percentile(times, 0.9);
    return {
      frames: times.length,
      fps: round(1000 / ms),
      fpsP90: round(1000 / msP90),
      ms: round(ms),
      msP90: round(msP90),
      calls,
      triangles,
      tier: app.params.fx ? app.quality.tier : 'low',
      fx: !!app.params.fx,
      dpr: round(dpr, 2),
      gpu,
    };
  }
  app.stats = { snapshot };

  zone.textContent = '';
  const panel = document.createElement('div');
  panel.className = 'st-panel';
  const text = document.createElement('pre');
  text.className = 'st-text';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'st-copy';
  button.textContent = s.copy;
  panel.append(text, button);
  zone.append(panel);

  button.addEventListener('click', async () => {
    const line = `${location.search} ${innerWidth}x${innerHeight}: ${JSON.stringify(snapshot())}\n`;
    try {
      await navigator.clipboard.writeText(line);
      button.textContent = s.copied;
    } catch (err) {
      console.warn('viewer: stats copy failed', err);
      button.textContent = s.failed;
    }
    setTimeout(() => (button.textContent = s.copy), 1500);
  });

  let shown = 0;
  function refresh() {
    const n = snapshot();
    const tris = triangles >= 1e6 ? `${(triangles / 1e6).toFixed(2)} M` : `${Math.round(triangles / 1e3)} k`;
    text.textContent =
      `${n.fps ?? '–'} fps (p90 ${n.fpsP90 ?? '–'}) · ${n.ms ?? '–'} ms\n` +
      `${calls} ${s.calls} · ${tris} ${s.tris}\n` +
      `${n.tier}${n.fx ? '' : ' (fx=0)'} · dpr ${n.dpr}`;
  }

  return {
    frame(dtMs) {
      if (!(dtMs > 0)) return;
      times.push(dtMs);
      if (times.length > KEEP) times.shift();
      const now = performance.now();
      if (now - shown >= REFRESH_MS) {
        shown = now;
        refresh();
      }
    },
    drawn(info, ratio) {
      calls = info.calls;
      triangles = info.triangles;
      dpr = ratio;
    },
  };
}
