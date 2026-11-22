// Texts of the split screen, picked with core/lang.js `pick`. The recording
// label, «sin modelo: reglas» and the reasons of split-mismatch come from
// core/strings.js; the model's name from banner/index.js; the buttons from
// replay/strings.js.
export const STRINGS = {
  es: {
    // labels=base,ft: the title of each side; without it, its model.
    labels: { base: 'Sin afinar', ft: 'Afinado' },
    sides: { left: 'izquierda', right: 'derecha' },
    fails: 'fallos: {n}',
    failsTitle: 'dijo lo contrario de lo que sabía: {contradictions} · se lo inventó: {invented}',
    tick: 't',
    missing: 'La pantalla partida necesita dos grabaciones: left y right.',
    // Scoreboard (fails.js, SCORE_KEYS): short label and the hint of each bar.
    score: {
      decisions: 'decisiones',
      maxTurns: 'charlas sin fin',
      rejected: 'rechazadas',
      invented: 'inventado',
      contradictions: 'lo contrario',
      hardened: 'dudas por seguras',
    },
    scoreTitle: {
      decisions: 'Decisiones tomadas: frases y planes',
      maxTurns: 'Conversaciones cortadas por el tope de turnos: nadie se despedía',
      rejected: 'Acciones que el motor rechazó por no ser válidas',
      invented: 'Datos que se inventó',
      contradictions: 'Datos en los que dijo lo contrario de lo que sabía',
      hardened: 'Datos que tenía en duda y contó como seguros',
    },
  },
  en: {
    labels: { base: 'Not fine-tuned', ft: 'Fine-tuned' },
    sides: { left: 'left', right: 'right' },
    fails: 'failures: {n}',
    failsTitle: 'said the opposite of what they knew: {contradictions} · made it up: {invented}',
    tick: 't',
    missing: 'The split screen needs two recordings: left and right.',
    score: {
      decisions: 'decisions',
      maxTurns: 'endless chats',
      rejected: 'rejected',
      invented: 'made up',
      contradictions: 'the opposite',
      hardened: 'doubts as sure',
    },
    scoreTitle: {
      decisions: 'Decisions taken: lines and plans',
      maxTurns: 'Conversations cut by the turn limit: nobody said goodbye',
      rejected: 'Actions the engine rejected as not valid',
      invented: 'Details made up',
      contradictions: 'Details where they said the opposite of what they knew',
      hardened: 'Details they doubted and told as sure',
    },
  },
};
