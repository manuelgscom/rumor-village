// Texts of the banner (#banner) and its ⓘ menu. The mode («GRABACIÓN»,
// «DIRECTO») and «sin modelo: reglas» come from core/strings.js. `{x}` marks
// are filled by fill() of rumor/strings.js. Jargon (seed, scenario, file) only
// inside the menu.

export const STRINGS = {
  es: {
    title: 'Rumor Village',
    neighbors: '{n} vecinos',
    local: '{model}, en local',
    finetuned: '{name} afinado',
    base: '{name} sin afinar',
    info: 'Detalles de esta ejecución',
    scenario: 'Escenario',
    seed: 'Semilla',
    lang: 'Idioma',
    model: 'Modelo',
    file: 'Fichero',
    langs: { es: 'castellano', en: 'inglés' },
    copy: 'Copiar enlace',
    copied: 'Enlace copiado',
    copyFailed: 'No se pudo copiar',
    // Inside the game (phase 9-5): the town, the neighbors and the mode, and
    // the badge of a played game («Mis partidas → Ver»).
    town: 'Pueblo n.º {n}',
    townTitle: 'Es el código del pueblo, no su tamaño: otro número reparte de nuevo oficios, caracteres, casas y amistades',
    modeAi: 'Con IA',
    modeRules: 'Sin IA',
    played: 'Partida jugada',
  },
  en: {
    title: 'Rumor Village',
    neighbors: '{n} neighbors',
    local: '{model}, running locally',
    finetuned: '{name} fine-tuned',
    base: '{name} not fine-tuned',
    info: 'About this run',
    scenario: 'Scenario',
    seed: 'Seed',
    lang: 'Language',
    model: 'Model',
    file: 'File',
    langs: { es: 'Spanish', en: 'English' },
    copy: 'Copy link',
    copied: 'Link copied',
    copyFailed: 'Could not copy',
    town: 'Village no. {n}',
    townTitle: 'It is the code of the village, not its size: another number deals out jobs, characters, homes and friendships again',
    modeAi: 'With AI',
    modeRules: 'Without AI',
    played: 'Played game',
  },
};
