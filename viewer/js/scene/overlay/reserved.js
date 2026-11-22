// Screen boxes that the rumor overlay took this frame (speech bubbles, chain
// labels), per app. scene/index.js updates the overlay before the labels, so
// scene/labels.js hides the place and neighbor labels that would touch them.

const boxes = new WeakMap();

/**
 * @param {object} app
 * @param {{x: number, y: number, w: number, h: number}[]} list
 */
export function reserve(app, list) {
  boxes.set(app, list);
}

/**
 * @param {object} app
 * @returns {{x: number, y: number, w: number, h: number}[]}
 */
export function reservedBoxes(app) {
  return boxes.get(app) ?? [];
}
