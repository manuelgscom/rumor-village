// Texts of package A (plan, zoom, speech bubbles, the hover card and the map
// preview while preparing a game). `{what}` is replaced with the name of the
// fact ("fiesta" / "party").
export const STRINGS = {
  es: {
    greet: 'saluda',
    bye: 'se despide',
    ask: 'pregunta por {what}',
    askAny: 'pregunta qué hay de nuevo',
    tell: 'cuenta {what}',
    none: 'se calla',
    rejected: 'no sabe qué decir',
    something: 'algo',
    hover: {
      versions: { correct: 'correcta', incomplete: 'incompleta', wrong: 'deformada' },
      notHeard: 'no se ha enterado',
      noRumor: 'todavía no corre el rumor',
      believes: 'Cree',
      original: 'original',
      nothing: '—',
      slots: { who: 'quién', where: 'dónde', when: 'cuándo', amount: 'cuántos' },
    },
    // Map preview while preparing a game (render/preview.js). `placeOf` only
    // for the kinds of fact whose article fits (same keys in both languages);
    // the rest take `placeAny`.
    preview: {
      first: 'Lo sabe primero',
      drop: 'Aquí empieza a contarse',
      placeOf: { party: 'Lugar de la {what}', wedding: 'Lugar de la {what}', works: 'Lugar de la {what}', concert: 'Lugar del {what}' },
      placeAny: 'Lugar del rumor',
      // The card under the pointer in the list of whom to tell (bus 'prepare-focus', phase 9-5).
      livesHere: 'Vive aquí',
      usualHere: 'Pasa el día aquí',
    },
    // With AI, a turn the engine wrote no sentence for (far from the camera):
    // a narrator tells it in plain words (render/bubbles.js narration). The
    // guessed details go after «cree que».
    narration: {
      tell: 'Le cuenta lo de {what}',
      at: 'en',
      time: 'a las {time}',
      today: 'hoy',
      tomorrow: 'mañana',
      guess: 'cree que {parts}',
    },
    // Names always shown during the game (phase 9-5): whom the player told and
    // the subject of the challenge.
    play: {
      told: 'Se lo contaste',
      priest: 'El cura',
      who: 'Es su fiesta',
    },
  },
  en: {
    greet: 'says hello',
    bye: 'says goodbye',
    ask: 'asks about the {what}',
    askAny: 'asks for news',
    tell: 'tells about the {what}',
    none: 'keeps quiet',
    rejected: 'does not know what to say',
    something: 'something',
    hover: {
      versions: { correct: 'correct', incomplete: 'incomplete', wrong: 'distorted' },
      notHeard: 'has not heard',
      noRumor: 'the rumor is not spreading yet',
      believes: 'Believes',
      original: 'original',
      nothing: '—',
      slots: { who: 'who', where: 'where', when: 'when', amount: 'how many' },
    },
    preview: {
      first: 'Hears it first',
      drop: 'It starts being told here',
      placeOf: { party: 'Where the {what} is', wedding: 'Where the {what} is', works: 'Where the {what} are', concert: 'Where the {what} is' },
      placeAny: 'Where it happens',
      livesHere: 'Lives here',
      usualHere: 'Spends the day here',
    },
    narration: {
      tell: 'Tells them about {what}',
      at: 'at',
      time: 'at {time}',
      today: 'today',
      tomorrow: 'tomorrow',
      guess: 'thinks {parts}',
    },
    play: {
      told: 'You told them',
      priest: 'The priest',
      who: "It's their party",
    },
  },
};
