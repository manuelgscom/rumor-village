// Small DOM helpers shared by the rumor panels (#rumor and #side).
//
// The panels are rebuilt from the model as fresh detached trees and put on
// screen with morph(), which patches the one already there: an element under
// the pointer survives the frequent re-renders of playback, so a click is
// never lost between mousedown and mouseup. Buttons carry their action in
// data attributes and one listener on the zone runs it.

/**
 * Creates an element.
 * @param {string} tag
 * @param {string|null} [cls]
 * @param {string} [text]
 * @returns {HTMLElement}
 */
export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/**
 * A button whose action is in its data attributes.
 * @param {string} cls
 * @param {string|undefined} text
 * @param {Object<string, string>} data
 * @returns {HTMLButtonElement}
 */
export function actBtn(cls, text, data) {
  const b = /** @type {HTMLButtonElement} */ (el('button', cls, text));
  b.type = 'button';
  for (const [k, v] of Object.entries(data)) b.dataset[k] = v;
  return b;
}

/**
 * Puts a freshly built tree in a zone, patching the one already there.
 * @param {HTMLElement} root
 * @param {HTMLElement} fresh
 */
export function put(root, fresh) {
  const old = root.firstElementChild;
  if (old && root.childNodes.length === 1) morph(old, fresh);
  else root.replaceChildren(fresh);
  // A kept <select> follows its value, not the attributes morph copied.
  for (const sel of root.querySelectorAll('select')) {
    const chosen = sel.querySelector('option[selected]');
    if (chosen && sel.value !== chosen.value) sel.value = chosen.value;
  }
}

/**
 * Makes `old` look like `fresh` touching only what differs: same-kind nodes
 * are kept (so the element under the pointer survives), text and attributes
 * are updated, and the rest is replaced. A canvas keeps its own attributes
 * (size, title, cursor), which its painter sets.
 * @param {Node} old in the document
 * @param {Node} fresh detached
 */
export function morph(old, fresh) {
  if (old.nodeType !== fresh.nodeType || old.nodeName !== fresh.nodeName) {
    old.replaceWith(fresh);
    return;
  }
  if (old.nodeType !== 1) {
    if (old.nodeValue !== fresh.nodeValue) old.nodeValue = fresh.nodeValue;
    return;
  }
  if (old.nodeName === 'CANVAS') {
    if (old.className !== fresh.className) old.className = fresh.className;
    return;
  }
  for (const a of [...old.attributes]) if (!fresh.hasAttribute(a.name)) old.removeAttribute(a.name);
  for (const a of fresh.attributes) if (old.getAttribute(a.name) !== a.value) old.setAttribute(a.name, a.value);
  const oc = [...old.childNodes];
  const fc = [...fresh.childNodes];
  for (let i = 0; i < fc.length; i++) {
    if (i < oc.length) morph(oc[i], fc[i]);
    else old.append(fc[i]);
  }
  for (let i = fc.length; i < oc.length; i++) oc[i].remove();
}

/**
 * Sizes a canvas to its CSS box and returns its 2D context in CSS pixels, or
 * null while the canvas has no width (hidden).
 * @param {HTMLCanvasElement} canvas
 * @param {number} height CSS pixels
 * @returns {{ctx: CanvasRenderingContext2D, w: number, h: number}|null}
 */
export function canvas2d(canvas, height) {
  const w = canvas.clientWidth;
  if (!w) return null;
  const dpr = globalThis.devicePixelRatio || 1;
  canvas.style.height = `${height}px`;
  const W = Math.round(w * dpr);
  const H = Math.round(height * dpr);
  if (canvas.width !== W) canvas.width = W;
  if (canvas.height !== H) canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, height);
  return { ctx, w, h: height };
}
