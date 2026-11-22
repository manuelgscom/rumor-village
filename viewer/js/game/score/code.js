// The challenge code (docs/juego.md, «Desafía a un amigo»; docs/arquitectura.md,
// «Código de desafío»): "RV1-" + the compact JSON in base64url, UTF-8 safe
// («Muñoz»). Only TextEncoder, TextDecoder, btoa and atob: the same code runs
// in node and in the browser.
//
//   {v: 1, game_version, mode, settings, rumors, challenge, bets, race, score}
//        └─ JSON ─ UTF-8 ─ base64url ─► "RV1-eyJ2IjoxLC…"

export const CODE_PREFIX = 'RV1-';
export const CODE_VERSION = 1;

/** Version of the game rules: scores of different versions are not compared. */
export const GAME_VERSION = 1;

/**
 * An error of decodeCode, with `code`:
 *   empty      nothing to read
 *   prefix     it does not start with RV<n>-
 *   version    a code of another version (RV2-…, or v ≠ 1)
 *   malformed  bad base64url, bad UTF-8, bad JSON or not the payload shape
 */
export class CodeError extends Error {
  /** @param {'empty'|'prefix'|'version'|'malformed'} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.name = 'CodeError';
    this.code = code;
  }
}

function toBase64url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(text) {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) throw new CodeError('malformed', 'not base64url');
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * The code of a game.
 * @param {{game_version?: number, mode: 'ai'|'rules', settings: object, rumors: object[],
 *   challenge?: string|null, bets?: object|null, race?: object|null, score?: object|null}} payload
 *   game_version defaults to GAME_VERSION; v is always 1
 * @returns {string} "RV1-…"
 */
export function encodeCode(payload) {
  const p = {
    v: CODE_VERSION,
    game_version: payload.game_version ?? GAME_VERSION,
    mode: payload.mode,
    settings: payload.settings ?? {},
    rumors: payload.rumors ?? [],
    challenge: payload.challenge ?? null,
    bets: payload.bets ?? null,
    race: payload.race ?? null,
    score: payload.score ?? null,
  };
  return CODE_PREFIX + toBase64url(new TextEncoder().encode(JSON.stringify(p)));
}

/**
 * Reads a code. Takes the code alone or any text that holds it (the link
 * "?play=1&code=RV1-…").
 * @param {string} text
 * @returns {{v: 1, game_version: number, mode: 'ai'|'rules', settings: object, rumors: object[],
 *   challenge: string|null, bets: object|null, race: object|null, score: object|null}}
 * @throws {CodeError}
 */
export function decodeCode(text) {
  const s = String(text ?? '').trim();
  if (!s) throw new CodeError('empty', 'empty code');
  const m = /RV(\d+)-([A-Za-z0-9_-]*)/.exec(s);
  if (!m) throw new CodeError('prefix', 'not a challenge code');
  if (Number(m[1]) !== CODE_VERSION) throw new CodeError('version', `code version ${m[1]}`);
  let p;
  try {
    p = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(fromBase64url(m[2])));
  } catch (e) {
    if (e instanceof CodeError) throw e;
    throw new CodeError('malformed', 'unreadable code');
  }
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw new CodeError('malformed', 'not an object');
  if (p.v !== CODE_VERSION) throw new CodeError('version', `payload version ${p.v}`);
  if (!Number.isInteger(p.game_version)) throw new CodeError('malformed', 'no game_version');
  if (p.mode !== 'ai' && p.mode !== 'rules') throw new CodeError('malformed', 'bad mode');
  if (!p.settings || typeof p.settings !== 'object' || Array.isArray(p.settings)) {
    throw new CodeError('malformed', 'bad settings');
  }
  if (!Array.isArray(p.rumors)) throw new CodeError('malformed', 'bad rumors');
  for (const k of ['challenge', 'bets', 'race', 'score']) if (p[k] === undefined) p[k] = null;
  return p;
}

/**
 * Whether two scores can be compared: same mode and same game version. Takes
 * code payloads or game data (mode in `settings.mode`).
 * @param {{mode?: string, settings?: {mode?: string}, game_version?: number}} a
 * @param {{mode?: string, settings?: {mode?: string}, game_version?: number}} b
 * @returns {boolean}
 */
export function comparable(a, b) {
  const mode = (x) => x?.mode ?? x?.settings?.mode ?? null;
  return (
    !!a && !!b && mode(a) !== null && mode(a) === mode(b) && a.game_version !== undefined && a.game_version === b.game_version
  );
}
