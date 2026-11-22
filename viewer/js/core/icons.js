// Small line icons (16×16, stroked with currentColor) for what used to be
// characters in the chronicle, the headline and the cards (phase 8-2, 2.14).
//
//   inject ★ · tell › · changed ✎ · forgot ? · doubt ≈ · move ➜ · right ✓ · wrong ✗ · end ■
//
// ICON_PATHS is pure data (tests read it); iconSvg() builds the element and
// needs a document. Styled by `.icon` in core.css (1em, currentColor).

/** SVG markup inside a 16×16 viewBox, by name. */
export const ICON_PATHS = {
  inject: '<path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z"/>',
  tell: '<path d="M5.5 2.5 11 8l-5.5 5.5"/>',
  changed: '<path d="M10.5 2.5l3 3-7.5 7.5H3v-3z M9 4l3 3"/>',
  forgot: '<path d="M5.5 6a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1 1-1.1 1.8v.5"/><circle cx="8" cy="13" r=".6"/>',
  doubt: '<path d="M2.5 6.2c1.8-1.6 3.6-1.6 5.5 0s3.7 1.6 5.5 0 M2.5 10.2c1.8-1.6 3.6-1.6 5.5 0s3.7 1.6 5.5 0"/>',
  move: '<path d="M2.5 8h10 M9 4.5 12.5 8 9 11.5"/>',
  right: '<path d="M3 8.5l3.2 3.2L13 4.8"/>',
  wrong: '<path d="M4 4l8 8 M12 4l-8 8"/>',
  end: '<rect x="4" y="4" width="8" height="8" rx="1"/>',
};

/** The character each icon replaces, for plain-text places (titles, copy). */
export const ICON_TEXT = {
  inject: '★',
  tell: '›',
  changed: '✎',
  forgot: '?',
  doubt: '≈',
  move: '➜',
  right: '✓',
  wrong: '✗',
  end: '■',
};

/**
 * An <svg class="icon icon-<name>"> element, hidden from screen readers.
 * @param {keyof typeof ICON_PATHS} name
 * @param {Document} [doc]
 * @returns {SVGSVGElement}
 */
export function iconSvg(name, doc = document) {
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', `icon icon-${name}`);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.6');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.innerHTML = ICON_PATHS[name] ?? '';
  return svg;
}
