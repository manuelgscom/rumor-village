// Texts of package D (figures panel and batch panel). Picked with
// pick(STRINGS, app.lang) from core/lang.js.
export const STRINGS = {
  es: {
    dockTitle: 'Cifras del modelo',
    neighbors: 'vecinos',
    informed: 'enterados',
    informedOf: 'enterados de: {what}',
    noFact: 'sin rumor todavía',
    decisions: 'decisiones/s',
    tokens: 'tokens/s',
    vram: 'MB de VRAM',
    batch: 'lote',
    sampleAt: 'muestra de las {time}',
    max: 'máx. {value}',
    baseline: 'Sin muestras de rendimiento: sin modelo, deciden las reglas.',
    noSamples: 'Sin muestras de rendimiento en el registro.',
    pending: 'Aún sin muestras de rendimiento.',
    local: 'todo ocurre en local',
    offline: 'sin conexión',
    lanesTitle: 'LOTE',
    lanes: '{n} carriles',
    lane1: '1 carril',
    running: '{n} generando',
    resting: 'en reposo · últimas de las {time}',
    moreLanes: '+{n} carriles · {k} generando',
    noGen: 'Sin generaciones: sin modelo, no hay lote que mostrar.',
    beforeGen: 'Aún no ha empezado ninguna generación.',
    tok: 'tok',
    planGo: 'irá:',
    planNone: 'decide no ir',
    rejected: 'rechazada: {reason}',
    rejects: {
      action_not_allowed: 'acción no permitida',
      bad_fields: 'campos erróneos',
      unknown_fact: 'rumor desconocido',
      malformed: 'mal formada',
      truncated: 'cortada',
    },
    acts: { greet: 'saluda', tell: 'cuenta', ask: 'pregunta', bye: 'se despide', none: 'no dice nada' },
    selectHint: 'Pulsa para seleccionar a {name}',
    seekHint: 'Pulsa para saltar a esa muestra',
  },
  en: {
    dockTitle: 'Model figures',
    neighbors: 'neighbors',
    informed: 'informed',
    informedOf: 'informed of: {what}',
    noFact: 'no rumor yet',
    decisions: 'decisions/s',
    tokens: 'tokens/s',
    vram: 'MB of VRAM',
    batch: 'batch',
    sampleAt: 'sample at {time}',
    max: 'max {value}',
    baseline: 'No performance samples: no model, the rules decide.',
    noSamples: 'No performance samples in the log.',
    pending: 'No performance samples yet.',
    local: 'everything runs locally',
    offline: 'offline',
    lanesTitle: 'BATCH',
    lanes: '{n} lanes',
    lane1: '1 lane',
    running: '{n} generating',
    resting: 'idle · last ones at {time}',
    moreLanes: '+{n} lanes · {k} generating',
    noGen: 'No generations: no model, no batch to show.',
    beforeGen: 'No generation has started yet.',
    tok: 'tok',
    planGo: 'will go:',
    planNone: 'decides not to go',
    rejected: 'rejected: {reason}',
    rejects: {
      action_not_allowed: 'action not allowed',
      bad_fields: 'bad fields',
      unknown_fact: 'unknown rumor',
      malformed: 'malformed',
      truncated: 'truncated',
    },
    acts: { greet: 'greets', tell: 'tells', ask: 'asks', bye: 'says goodbye', none: 'says nothing' },
    selectHint: 'Click to select {name}',
    seekHint: 'Click to jump to that sample',
  },
};

/**
 * Fills "{key}" placeholders.
 * @param {string} template
 * @param {Object<string, string|number>} values
 * @returns {string}
 */
export function fill(template, values) {
  return template.replace(/\{(\w+)\}/g, (m, k) => (k in values ? String(values[k]) : m));
}
