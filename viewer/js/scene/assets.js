// Loading of the CC0 models (viewer/assets/, see its README). Each file is
// fetched once; callers clone what they need.

import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const BASE = new URL('../../assets/', import.meta.url);

/**
 * @param {{onProgress?: (loaded: number, total: number) => void}} [opts]
 *   called each time a file is asked for or finishes: files loaded and asked for
 * @returns {{town: (name: string) => Promise<object>, character: (file: string) => Promise<object>}}
 *   town: viewer/assets/town/<name>.glb · character: viewer/assets/characters/<file>.glb
 *   each resolves to the loaded glTF ({scene, animations})
 */
export function createAssets({ onProgress = () => {} } = {}) {
  const loader = new GLTFLoader();
  const cache = new Map();
  let done = 0;
  const load = (path) => {
    if (!cache.has(path)) {
      const p = loader.loadAsync(new URL(path, BASE).href);
      cache.set(path, p);
      p.then(() => {
        done++;
        onProgress(done, cache.size);
      }, () => {});
      onProgress(done, cache.size);
    }
    return cache.get(path);
  };
  return {
    town: (name) => load(`town/${name}.glb`),
    character: (file) => load(`characters/${file}.glb`),
  };
}
