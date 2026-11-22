// The player's progress (runs/play/profile.json, docs/arquitectura.md,
// «Formatos»): stars per challenge and mode, the marks of each game and
// whether the guided first game was seen or chosen. No DOM. The viewer writes
// it whole with POST profile, so every update keeps what it does not touch,
// and a write starts from a fresh GET profile (read-modify-write).
//
//   tutorial_seen    the guided game was finished, skipped or declined («Ahora no»)
//   tutorial_guided  the guided game was chosen and is under way (phase 9-2):
//                    it comes back after every reload until it ends
//   mode, lang       the player's choice of «Con IA»/«Sin IA» and of language
//                    (optional), from the menu or from «Más opciones»: new
//                    drafts and every start of the game use them

/** A profile with every key, from whatever GET profile gave. */
export function normalizeProfile(p) {
  const src = p && typeof p === 'object' && !Array.isArray(p) ? p : {};
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  return { ...src, format: 1, tutorial_seen: src.tutorial_seen === true, stars: { ...obj(src.stars) }, games: { ...obj(src.games) } };
}

const MODES = ['ai', 'rules'];
const LANGS = ['es', 'en'];

/** The player's preferences, each null when not chosen (or not valid). */
export function prefsOf(profile) {
  const p = normalizeProfile(profile);
  return { mode: MODES.includes(p.mode) ? p.mode : null, lang: LANGS.includes(p.lang) ? p.lang : null };
}

/** The profile with some preferences ({mode?, lang?}) changed; invalid values are left out. */
export function withPrefs(profile, patch = {}) {
  const out = normalizeProfile(profile);
  if (MODES.includes(patch.mode)) out.mode = patch.mode;
  if (LANGS.includes(patch.lang)) out.lang = patch.lang;
  return out;
}

const starsIn = (v) => (Number.isInteger(v) ? Math.max(0, Math.min(3, v)) : 0);

/**
 * The profile after a game: the stars of its challenge and mode keep the
 * maximum ever reached; the game gets its mark and stars.
 * @param {object} profile as read
 * @param {{id: string, challenge?: string|null, mode: 'ai'|'rules', score?: any, stars?: number|null}} game
 * @returns {object} a new profile
 */
export function updateProfile(profile, { id, challenge = null, mode, score = null, stars = null }) {
  const out = normalizeProfile(profile);
  // A challenge without stars (the tutorial: stars null) leaves the stars alone.
  if (challenge && (mode === 'ai' || mode === 'rules') && Number.isInteger(stars)) {
    const old = out.stars[challenge] ?? {};
    out.stars[challenge] = { ai: starsIn(old.ai), rules: starsIn(old.rules) };
    out.stars[challenge][mode] = Math.max(out.stars[challenge][mode], starsIn(stars));
  }
  if (id) out.games[id] = { score: score ?? null, stars: Number.isInteger(stars) ? starsIn(stars) : null };
  return out;
}

/** The profile with the guided first game marked as seen (and no longer under way). */
export function markTutorial(profile) {
  const out = { ...normalizeProfile(profile), tutorial_seen: true };
  delete out.tutorial_guided;
  return out;
}

/** The profile with the guided first game chosen: it is under way. */
export function markGuided(profile) {
  return { ...normalizeProfile(profile), tutorial_guided: true };
}

/** Whether a page with the tutorial draft starts the guide: chosen, or never seen. */
export function wantsTutorial(profile) {
  const p = normalizeProfile(profile);
  return p.tutorial_guided === true || !p.tutorial_seen;
}

/**
 * Stars reached in a challenge, per mode.
 * @returns {{ai: number, rules: number}}
 */
export function starsOf(profile, challengeId) {
  const s = normalizeProfile(profile).stars[challengeId] ?? {};
  return { ai: starsIn(s.ai), rules: starsIn(s.rules) };
}

/** Whether to offer the guided first game: never seen and no game played. */
export function offerTutorial(profile, games) {
  return !normalizeProfile(profile).tutorial_seen && !(Array.isArray(games) && games.length);
}

/** "★★☆" for 0–3 stars. */
export function starText(n) {
  const k = starsIn(n);
  return '★'.repeat(k) + '☆'.repeat(3 - k);
}
