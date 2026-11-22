// A real exchange of a game With AI, to show what the AI does (phase 9-5):
// the screen «Con IA y Sin IA» and the tutorial card «Vecinos con IA».
// Copied as it is from runs/play/20261117-221700-ai-t417.jsonl (conversation
// c9, turn 30, tick 489) and its .cards.jsonl, with the fine-tuned model.
// English is a translation of the same exchange (`translated: true`): there
// is no English game With AI saved yet. «rules» is how the same telling looks
// Without AI (the bubble only shows the data).
//
// ASK is something only the AI does: Yolanda had forgotten where the party
// was («dónde: no lo recuerdas» in the card she read) and asks Ana, who tells
// her again. Without AI nobody asks. Same game, conversation c45, turns at
// ticks 647-650 (the ask is turn 126, tick 648).

export const SHOWCASE = {
  "format": 1,
  "source": {
    "game": "20261117-221700-ai-t417",
    "model": "gemma-4-E4B-it-rumor-Q4_K_M.gguf",
    "conv": "c9",
    "turn": 30,
    "tick": 489
  },
  "es": {
    "translated": false,
    "talk": [
      {
        "who": "Josefa",
        "text": "¡Buenas, qué tal te va!"
      },
      {
        "who": "Fernando",
        "text": "Josefa, ¿te has enterado? ¡Hoy a las 21:00 hay fiesta en la plaza!"
      },
      {
        "who": "Josefa",
        "text": "Pues a seguir, Fernando, que se me acumula el día."
      }
    ],
    "rules": {
      "who": "Fernando",
      "text": "fiesta · plaza · 21:00"
    },
    "think": {
      "who": "Fernando",
      "read": "Eres Fernando, agricultor y cotilla.\nEs martes, 08:09. Estás en el río.\nTienes delante a Josefa, vecina.\n\nLo que sabes:\n[1] fiesta · dónde: plaza · cuándo: hoy 21:00\n    Te lo contó Miguel. A Josefa aún no se lo has contado.\n\nEn esta conversación:\nJosefa te ha saludado.",
      "decided": "Contárselo a Josefa: fiesta en la plaza, hoy a las 21:00.",
      "checked": "El juego lo comprobó: lo contó tal cual."
    }
  },
  "en": {
    "translated": true,
    "talk": [
      {
        "who": "Josefa",
        "text": "Hi there, how's it going!"
      },
      {
        "who": "Fernando",
        "text": "Josefa, have you heard? There's a party in the square today at 21:00!"
      },
      {
        "who": "Josefa",
        "text": "Well, off I go, Fernando, my day is piling up."
      }
    ],
    "rules": {
      "who": "Fernando",
      "text": "party · square · 21:00"
    },
    "think": {
      "who": "Fernando",
      "read": "You are Fernando, farmer and gossip.\nIt is Tuesday, 08:09. You are at the river.\nIn front of you is Josefa, neighbor.\n\nWhat you know:\n[1] party · where: square · when: today 21:00\n    Miguel told you. You have not told Josefa yet.\n\nIn this conversation:\nJosefa has greeted you.",
      "decided": "Tell Josefa: a party in the square, today at 21:00.",
      "checked": "The game checked it: told as it was."
    }
  }
};

export const ASK = {
  source: { game: '20261117-221700-ai-t417', conv: 'c45', turn: 126, tick: 648 },
  es: {
    translated: false,
    forgot: 'Yolanda había olvidado dónde era la fiesta. La IA leyó en su ficha «dónde: no lo recuerdas» y decidió preguntar.',
    talk: [
      { who: 'Ana', text: '¡Yolanda, qué alegría verte! ¿Qué tal va todo?' },
      { who: 'Yolanda', text: 'Ana, perdona, ¿dónde era eso de la fiesta?' },
      { who: 'Ana', text: 'La fiesta es en la plaza hoy a las nueve de la noche. Me lo contó Elena.' },
    ],
    rules: 'Sin IA nadie pregunta: un vecino lo cuenta o no, según los dados.',
  },
  en: {
    translated: true,
    forgot: 'Yolanda had forgotten where the party was. The AI read «where: you do not remember» in her card and decided to ask.',
    talk: [
      { who: 'Ana', text: 'Yolanda, how nice to see you! How is everything?' },
      { who: 'Yolanda', text: 'Ana, sorry, where was that party?' },
      { who: 'Ana', text: 'The party is in the square today at nine in the evening. Elena told me.' },
    ],
    rules: 'Without AI nobody asks: a neighbor tells it or not, as the dice say.',
  },
};
