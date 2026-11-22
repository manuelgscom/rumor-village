// What stands at each public place (pure). A recipe names the look of the
// landmark and the lots it may take, from the grandest to the smallest; the
// layout (lots.js) keeps the first one that fits. Sizes are in kit cells.
//
//   lot [w, d, a]:  main body w × d, plus an annex a cells wide on one side
//
//     ┌──annex──┬────main────┐
//     │ terrace │  building  │   the door of the main body faces south,
//     └─────────┴─────●──────┘   towards the crowd of the place
//
// build.js draws each recipe with the same numbers, so `topOf` (the highest
// point, for the labels) matches what is drawn.

import { CELL } from './measures.js';

/**
 * Recipe of each public place, by key.
 *   type        square | river | fountain | market | building | mill
 *   crowd       'front' | 'centre': where its people stand
 *   floors      floors of the main body
 *   walls       stone | wood; base: walls of the ground floor when different
 *   roof        red | green | blue | brown
 *   tower       floors of a bell tower on a front corner (church, chapel)
 *   annex       what fills the annex (terrace, graveyard, yard…)
 */
export const RECIPES = {
  square: { type: 'square', crowd: 'centre' },
  river: { type: 'river', crowd: 'centre' },
  fountain: { type: 'fountain', crowd: 'front', lots: [[4, 4, 0], [3, 3, 0], [2, 2, 0]] },
  market: { type: 'market', crowd: 'front', annex: 'carts', lots: [[7, 3, 2], [6, 3, 2], [6, 3, 0], [5, 2, 0], [4, 2, 0], [3, 1, 0]] },
  bar: { type: 'building', crowd: 'front', floors: 2, walls: 'wood', base: 'stone', roof: 'red', annex: 'terrace', lots: [[4, 2, 3], [3, 2, 3], [3, 2, 2], [3, 2, 0], [2, 2, 0]] },
  church: { type: 'building', crowd: 'front', floors: 2, walls: 'stone', roof: 'red', tower: 5, annex: 'graveyard', lots: [[3, 7, 2], [3, 6, 2], [3, 6, 0], [3, 5, 0], [3, 4, 0], [2, 3, 0]] },
  bakery: { type: 'building', crowd: 'front', floors: 2, walls: 'wood', base: 'stone', roof: 'green', chimney: true, annex: 'oven', lots: [[3, 2, 2], [2, 2, 2], [2, 2, 1], [2, 2, 0], [1, 1, 0]] },
  school: { type: 'building', crowd: 'front', floors: 2, walls: 'stone', roof: 'blue', bell: true, annex: 'yard', lots: [[5, 2, 3], [4, 2, 3], [4, 2, 2], [3, 2, 2], [3, 2, 0], [2, 2, 0]] },
  town_hall: { type: 'building', crowd: 'front', floors: 3, walls: 'stone', roof: 'red', banners: true, pavilion: true, annex: 'garden', lots: [[5, 3, 2], [5, 3, 0], [4, 3, 0], [5, 2, 0], [3, 2, 0]] },
  pharmacy: { type: 'building', crowd: 'front', floors: 2, walls: 'stone', roof: 'green', cross: true, annex: 'herbs', lots: [[3, 2, 2], [2, 2, 2], [2, 2, 1], [2, 2, 0], [1, 1, 0]] },
  mill: { type: 'mill', crowd: 'front', floors: 4, walls: 'stone', base: 'stone', upper: 'wood', roof: 'red', annex: 'barn', lots: [[3, 3, 2], [3, 3, 0], [2, 2, 2], [2, 2, 0]] },
  chapel: { type: 'building', crowd: 'front', floors: 1, walls: 'stone', roof: 'red', tower: 3, annex: 'cypress', lots: [[2, 4, 2], [2, 3, 2], [2, 3, 0], [1, 2, 0]] },
};

/** Recipe of a place that has no key of its own. */
const GENERIC = { type: 'building', crowd: 'front', floors: 1, walls: 'wood', roof: 'red', lots: [[2, 2, 0], [1, 1, 0]] };

/** Recipe of a place: public keys from RECIPES, homes are quarters. */
export function recipeOf(place) {
  if (place.kind === 'home') return { type: 'quarter', crowd: 'centre' };
  return RECIPES[place.key] ?? GENERIC;
}

/** Rise of a gable roof over a span (world units), as build.js draws it. */
export function roofRise(span) {
  return span * 0.55;
}

/** Spire of a tower: [width, height] in cells (roof-high-point piece). */
export const SPIRE = { church: [1.15, 1.9], chapel: [1.1, 1.4], town_hall: [1.15, 1.6] };
/** Windmill: sail radius (world units) and hub height (fraction of the tower). */
export const SAILS = { radius: 1.56 * CELL * 1.9, hub: 0.85 };

/**
 * Highest point (world units) of a landmark drawn on a lot.
 * @param {object} recipe
 * @param {string} key
 * @param {{w: number, d: number}} main main body in cells
 * @returns {number}
 */
export function topOf(recipe, key, main) {
  const floors = recipe.floors ?? 1;
  if (recipe.type === 'market') return 14;
  if (recipe.type === 'fountain') return 13;
  if (recipe.type === 'mill') return Math.max(floors * CELL + 1.6 * CELL, floors * CELL * SAILS.hub + SAILS.radius);
  let top = floors * CELL + roofRise(Math.min(main.w, main.d) * CELL) + 1;
  if (recipe.tower) top = Math.max(top, recipe.tower * CELL + (SPIRE[key] ?? [1, 1.4])[1] * CELL);
  if (recipe.pavilion) top = Math.max(top, (floors + 2) * CELL + SPIRE.town_hall[1] * CELL);
  if (recipe.bell) top += 9;
  if (recipe.chimney) top = Math.max(top, floors * CELL + 1.6 * CELL);
  return Math.round(top * 10) / 10;
}
