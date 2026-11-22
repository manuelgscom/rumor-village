// Portraits of the neighbors (phase 8-2, 2.9): each one drawn once, with its
// own model, outfit and accessories, head and shoulders on a small
// transparent canvas, and kept as a PNG data URL for the cards (app.hooks.portrait).
//
//   portrait(id) ──► cached URL ──────────────────────────► URL
//                └─► not yet: queued, null (the card shows initials)
//   step() once per frame: draws the first queued one, at most one per frame
//
// Lazy: nothing is drawn until somebody asks. A small renderer of its own
// (its own WebGL context, created on the first portrait) keeps the scene's
// renderer and its settings untouched. Any failure only leaves initials: the
// id is marked and never tried again.

import * as THREE from 'three';

/** Side of a portrait, in px. */
export const PORTRAIT_PX = 128;

/**
 * @param {{figure: (id: string) => {root: THREE.Object3D, pose: () => void}|null, onReady?: (id: string) => void, size?: number}} opts
 *   figure builds a fresh copy of a neighbor in model units (feet at 0, facing +Z), posed
 * @returns {{get: (id: string) => string|null, step: () => void, pending: () => number}}
 */
export function createPortraits({ figure, onReady = () => {}, size = PORTRAIT_PX }) {
  const urls = new Map();
  const failed = new Set();
  const queue = [];
  let kit = null; // {renderer, scene, camera}
  let broken = false;

  const setUp = () => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(size, size, false);
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = THREE.NeutralToneMapping;
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight('#fff8ee', '#7d7466', 2.4));
    const key = new THREE.DirectionalLight('#fff1dc', 2.2);
    key.position.set(1.2, 2, 2.5);
    scene.add(key);
    const camera = new THREE.PerspectiveCamera(24, 1, 0.05, 20);
    return { renderer, scene, camera };
  };

  const box = new THREE.Box3();
  const draw = (id) => {
    kit ??= setUp();
    const fig = figure(id);
    if (!fig) throw new Error(`no figure for ${id}`);
    const { renderer, scene, camera } = kit;
    fig.root.rotation.y = 0.32; // a three-quarter view
    scene.add(fig.root);
    fig.pose();
    fig.root.updateMatrixWorld(true);
    box.setFromObject(fig.root);
    const h = Math.max(1e-3, box.max.y - box.min.y);
    // Head and shoulders (the head is half of these figures), with room above for hats.
    const top = box.max.y + h * 0.07;
    const bottom = box.max.y - h * 0.8;
    const mid = (top + bottom) / 2;
    const dist = (top - bottom) / 2 / Math.tan((camera.fov * Math.PI) / 360);
    camera.position.set(0, mid + h * 0.06, dist);
    camera.lookAt(0, mid, 0);
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    const url = renderer.domElement.toDataURL('image/png');
    scene.remove(fig.root);
    return url;
  };

  return {
    get(id) {
      if (urls.has(id)) return urls.get(id);
      if (!broken && !failed.has(id) && !queue.includes(id)) queue.push(id);
      return null;
    },
    step() {
      const id = queue.shift();
      if (id === undefined) return;
      try {
        urls.set(id, draw(id));
        onReady(id);
      } catch (err) {
        failed.add(id);
        if (!kit) {
          // No renderer at all (no WebGL left): initials for everybody.
          broken = true;
          queue.length = 0;
        }
        console.warn(`viewer: portrait of ${id} failed`, err?.message ?? err);
      }
    },
    pending: () => queue.length,
  };
}
