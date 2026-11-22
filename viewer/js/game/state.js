// The game state from the engine: GET state of `rumor play` through the client
// of live/api.js. No DOM. The shape of the body is in docs/arquitectura.md
// («Formatos», GET /state).

/** States of the engine in the game mode. */
export const ENGINE_STATES = ['waiting', 'playing', 'ended'];

/**
 * @typedef {object} GameState
 * @property {boolean} ok the engine answered with a known state
 * @property {any} state the body of GET state, or null
 * @property {string|null} error why there is no state
 */

/**
 * Reads the engine state. Never rejects.
 * @param {{state: () => Promise<import('../live/api.js').Reply>}} api
 * @returns {Promise<GameState>}
 */
export async function loadState(api) {
  let reply;
  try {
    reply = await api.state();
  } catch (err) {
    return { ok: false, state: null, error: err?.message ?? String(err) };
  }
  if (!reply?.ok) return { ok: false, state: null, error: reply?.error ?? 'no answer' };
  const body = reply.body;
  if (!body || !ENGINE_STATES.includes(body.state)) return { ok: false, state: null, error: 'unknown state' };
  return { ok: true, state: body, error: null };
}

/** Screens of the game that ?screen= and the resume hash can open (core/params.js GAME_SCREENS). */
export const SCREENS = ['boot', 'menu', 'prepare', 'challenges', 'friend', 'games', 'tutorial'];

/**
 * The screen to show for an engine state. Playing and ended go by the engine;
 * while waiting: ?screen= first, then the screen the page asked to come back
 * to before reloading (#prepare, #menu), then «Preparar la partida» when the
 * draft has something, else the menu (phase 9-5: opening the game goes
 * straight to the menu; `boot` is «Con IA y Sin IA», reached from its foot).
 * @param {any} state body of GET state, or null
 * @param {{screen?: string|null, resume?: string|null, emptyDraft?: boolean}} o
 * @returns {string} a SCREENS entry, 'playing' or 'ended'
 */
export function screenOf(state, { screen = null, resume = null, emptyDraft = true } = {}) {
  if (state?.state === 'playing') return 'playing';
  if (state?.state === 'ended') return 'ended';
  if (SCREENS.includes(screen)) return screen;
  if (SCREENS.includes(resume)) return resume;
  return emptyDraft ? 'menu' : 'prepare';
}

/**
 * The phase of the bus event 'game' for a screen: boot | menu | prepare | playing | ended.
 * @param {string} screen
 */
export function phaseOf(screen) {
  if (screen === 'boot') return 'boot';
  if (['menu', 'challenges', 'friend', 'games'].includes(screen)) return 'menu';
  if (screen === 'playing' || screen === 'ended') return screen;
  return 'prepare';
}
