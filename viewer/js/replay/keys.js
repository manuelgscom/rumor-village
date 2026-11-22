// When the space bar is the pause key (replay/index.js). Pure: the DOM side
// only describes the focused element.
//
//   focus                                          space
//   the map, <body>, the track, a button of .rp    pauses (and does not press it)
//   any other button, link, summary, control       presses it, as usual

/** Tags that the space bar presses or types into. */
const ACTIVE_TAGS = /^(BUTTON|SUMMARY|INPUT|SELECT|TEXTAREA|OPTION)$/;

/** ARIA roles that the space bar activates. */
const ACTIVE_ROLES = new Set(['button', 'checkbox', 'radio', 'switch', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'link']);

/**
 * @typedef {object} Focus
 * @property {string} tag tagName
 * @property {string|null} [role]
 * @property {boolean} [href] an <a> with href
 * @property {boolean} [editable] contenteditable
 * @property {boolean} [inBar] inside the playback bar (.rp)
 */

/**
 * The focused element, as spacePauses reads it.
 * @param {Element|null} t
 * @returns {Focus|null}
 */
export function focusOf(t) {
  if (!t || typeof t.tagName !== 'string') return null;
  return {
    tag: t.tagName,
    role: t.getAttribute?.('role') ?? null,
    href: t.hasAttribute?.('href') ?? false,
    editable: !!(/** @type {any} */ (t).isContentEditable),
    inBar: !!t.closest?.('.rp'),
  };
}

/**
 * Does the space bar pause, with this element focused? Not on a control of
 * its own outside the bar: there it keeps its usual meaning.
 * @param {Focus|null} f
 */
export function spacePauses(f) {
  if (!f) return true;
  if (f.editable) return false;
  const tag = f.tag.toUpperCase();
  if (/^(INPUT|SELECT|TEXTAREA)$/.test(tag)) return false;
  if (f.inBar) return true;
  if (ACTIVE_TAGS.test(tag) || (tag === 'A' && f.href)) return false;
  return !(f.role && ACTIVE_ROLES.has(f.role));
}
