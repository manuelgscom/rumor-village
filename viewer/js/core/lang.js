// Language of the interface: the one of the run (header.lang). Each package
// keeps its texts in its own strings.js as {es: {...}, en: {...}} and picks
// them with `pick(strings, app.lang)`.

/** Languages of the viewer. */
export const LANGS = ['es', 'en'];

/**
 * Language of a header, "es" or "en" (English for anything else).
 * @param {{lang?: string}|null|undefined} header
 * @returns {'es'|'en'}
 */
export function langOf(header) {
  return header?.lang === 'es' ? 'es' : 'en';
}

/**
 * The texts of one language, with the English ones for missing keys.
 * @template T
 * @param {{es?: T, en: T}} strings
 * @param {string} lang
 * @returns {T}
 */
export function pick(strings, lang) {
  return { ...strings.en, ...(strings[lang] ?? {}) };
}
