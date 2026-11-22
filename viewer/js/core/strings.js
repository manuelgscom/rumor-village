// Texts of the core (banner, loading and error states), and the errors
// with a code: every failure the reader can meet has a plain message here, in
// both languages, chosen by `code`. `{detail}` is the technical part (a file,
// an HTTP status, a line), shown smaller.
//
//   code             when
//   no-webgl         the browser has no WebGL
//   log-not-found    the recording does not exist (404)
//   log-unreachable  it could not be downloaded
//   log-bad-line     a line of the recording cannot be understood
//   models-failed    the 3D models do not load
//   split-mismatch   the two recordings of the split screen do not match

export const STRINGS = {
  es: {
    recording: 'GRABACIÓN',
    live: 'DIRECTO',
    baseline: 'sin modelo: reglas',
    seed: 'semilla',
    loading: 'Cargando…',
    connecting: 'DIRECTO · conectando…',
    // Inside the game (phase 9-5): no «DIRECTO», no codes.
    connectingGame: 'Conectando con el juego…',
    lost: 'No se encuentra el juego. ¿Sigue abierta la ventana de play.sh?',
    retry: 'Reintentar',
    backToGame: 'Volver al juego',
    drawer: { left: 'El rumor', right: 'Detalles' },
    // Narrow screens: how many know the rumor, on the folded «El rumor».
    drawerCount: '{label} · {n}/{total}',
    drawerCountLabel: '{label}: se han enterado {n} de {total}',
    error: 'Error',
    errors: {
      'no-webgl': 'Este navegador no puede dibujar en 3D (no tiene WebGL). Prueba con otro navegador o activa la aceleración gráfica.',
      'log-not-found': 'No existe esa grabación.',
      'log-unreachable': 'No se pudo descargar la grabación. Comprueba la conexión y vuelve a intentarlo.',
      'log-bad-line': 'La grabación tiene una línea que no se entiende: puede estar cortada o ser de otra versión.',
      'models-failed': 'No se pudieron cargar los modelos 3D del pueblo.',
      'split-mismatch': 'Las dos grabaciones no se pueden comparar: no son del mismo día.',
      unknown: 'Algo ha fallado al abrir el pueblo.',
    },
    // The same failures opening a played game («Mis partidas → Ver»).
    gameErrors: {
      'log-not-found': 'No se encuentra esa partida.',
      'log-unreachable': 'No se pudo abrir la partida. Vuelve a intentarlo.',
      'log-bad-line': 'La partida guardada está dañada y no se puede abrir.',
      unknown: 'Algo ha fallado al abrir la partida.',
    },
    // Reasons of split-mismatch: «{key} differs».
    mismatch: {
      header: 'falta la cabecera',
      seed: 'la semilla es distinta',
      scenario: 'el escenario es distinto',
      lang: 'el idioma es distinto',
      other: 'cambia {key}',
    },
  },
  en: {
    recording: 'RECORDING',
    live: 'LIVE',
    baseline: 'no model: rules',
    seed: 'seed',
    loading: 'Loading…',
    connecting: 'LIVE · connecting…',
    connectingGame: 'Connecting to the game…',
    lost: 'The game cannot be found. Is the play.sh window still open?',
    retry: 'Try again',
    backToGame: 'Back to the game',
    drawer: { left: 'The rumor', right: 'Details' },
    drawerCount: '{label} · {n}/{total}',
    drawerCountLabel: '{label}: {n} of {total} have heard about it',
    error: 'Error',
    errors: {
      'no-webgl': 'This browser cannot draw in 3D (it has no WebGL). Try another browser or turn on graphics acceleration.',
      'log-not-found': 'That recording does not exist.',
      'log-unreachable': 'The recording could not be downloaded. Check the connection and try again.',
      'log-bad-line': 'The recording has a line that cannot be understood: it may be cut short or from another version.',
      'models-failed': 'The 3D models of the village could not be loaded.',
      'split-mismatch': 'The two recordings cannot be compared: they are not the same day.',
      unknown: 'Something went wrong while opening the village.',
    },
    gameErrors: {
      'log-not-found': 'That game cannot be found.',
      'log-unreachable': 'The game could not be opened. Try again.',
      'log-bad-line': 'The saved game is damaged and cannot be opened.',
      unknown: 'Something went wrong while opening the game.',
    },
    mismatch: {
      header: 'a header is missing',
      seed: 'the seed differs',
      scenario: 'the scenario differs',
      lang: 'the language differs',
      other: '{key} differs',
    },
  },
};

/** Codes of the errors (keys of STRINGS.<lang>.errors, besides "unknown"). */
export const ERROR_CODES = ['no-webgl', 'log-not-found', 'log-unreachable', 'log-bad-line', 'models-failed', 'split-mismatch'];

/**
 * An Error with a code of the table, so that the page can say it plainly.
 * @param {string} code
 * @param {string} [detail] technical detail (a path, a status, a line)
 * @returns {Error & {code: string, detail: string}}
 */
export function codedError(code, detail = '') {
  const err = /** @type {any} */ (new Error(detail ? `${code}: ${detail}` : code));
  err.code = code;
  err.detail = detail;
  return err;
}

/**
 * Plain message of an error code; inside the game, the words of the game
 * («partida», not «grabación») where they differ.
 * @param {string} code
 * @param {'es'|'en'} lang
 * @param {boolean} [game]
 * @returns {string}
 */
export function errorText(code, lang, game = false) {
  const t = STRINGS[lang] ?? STRINGS.en;
  if (game) return t.gameErrors[code] ?? t.errors[code] ?? t.gameErrors.unknown;
  return t.errors[code] ?? t.errors.unknown;
}

/**
 * Code and detail of anything thrown (an Error with or without a code).
 * @param {unknown} err
 * @returns {{code: string, detail: string}}
 */
export function errorOf(err) {
  const e = /** @type {any} */ (err);
  if (e && typeof e.code === 'string' && ERROR_CODES.includes(e.code)) return { code: e.code, detail: e.detail ?? '' };
  return { code: 'unknown', detail: e?.message ?? String(err) };
}
