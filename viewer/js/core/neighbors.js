// What a player needs to know about a neighbor to choose whom to tell (phase
// 9-5, docs/juego.md «Los vecinos»): the character with what it means, the
// people close to them (family and friends) and the rivals, where they live
// and where they spend the day. Pure: no DOM.
//
// Sources: the header of the run (neighbors, places, relations; contract §6)
// and the timetable of the jobs (GET /timetable, data/world/timetable.json):
// {jobs: {<job>: [24 place keys or "home"]}}. Without the timetable (the
// recording viewer has no such route) `usual` is null and the rest still works.
//
//   neighborProfile(header, timetable, 'n006', 'es') →
//   { id, name, gender, job: 'tabernero', trait: 'exaggerator', traitName: 'exagerado',
//     traitPhrase: 'lo cuenta a menudo, y a veces exagera', talk: 1.1,
//     family: ['Carmen'], friends: ['Elena', 'Luis'], coworkers: [], rivals: ['Pedro'],
//     close: 3, home: {id: 'p16', key: 'lower_quarter', name: 'barrio bajo'},
//     usual: {key: 'bar', name: 'bar', from: 11, to: 22} | {roaming: ['plaza', 'ermita', …]} | null }

import { gendered } from '../rumor/person.js';
import { STRINGS as RUMOR } from '../rumor/strings.js';

/** Hours of the game day used to find where a job spends it (07:00 to 24:00). */
export const DAY_HOURS = { from: 7, to: 24 };

/**
 * How much each character tells, as the rules use it (engine/src/policy/
 * baseline.cpp kTellTraitFactor). Only to sort and to draw a gauge: the
 * numbers are not shown.
 */
export const TALK = { gossip: 1.3, sociable: 1.15, exaggerator: 1.1, prudent: 0.7, shy: 0.6, discreet: 0.5 };

/** Order of the characters, from the most talkative to the least. */
export const TRAITS = ['gossip', 'sociable', 'exaggerator', 'prudent', 'shy', 'discreet'];

/** What each character means, in one phrase, and its icon. */
export const STRINGS = {
  es: {
    phrase: {
      gossip: 'lo cuenta casi siempre',
      sociable: 'lo cuenta a menudo',
      exaggerator: 'lo cuenta a menudo, y a veces exagera',
      prudent: 'se lo piensa antes de contarlo',
      shy: 'le cuesta contarlo',
      discreet: 'casi nunca lo cuenta',
    },
    relationsHint: 'Se cuenta sobre todo a la familia y a los amigos; a un rival, casi nunca.',
  },
  en: {
    phrase: {
      gossip: 'nearly always tells it',
      sociable: 'often tells it',
      exaggerator: 'often tells it, and sometimes exaggerates',
      prudent: 'thinks twice before telling it',
      shy: 'finds it hard to tell it',
      discreet: 'hardly ever tells it',
    },
    relationsHint: 'Rumors go mostly to family and friends; to a rival, hardly ever.',
  },
};

export const TRAIT_ICON = { gossip: '🗣', sociable: '😊', exaggerator: '📢', prudent: '🤔', shy: '😳', discreet: '🤐' };

const langKey = (lang) => (lang === 'es' ? 'es' : 'en');

/**
 * Where a job spends the day: the public place it is at most hours between
 * 07:00 and 24:00, with the first and last hour; or, for a job without one
 * place (fewer than 4 hours in the most frequent), the places it goes to,
 * most frequent first.
 * @param {{jobs?: Object<string, string[]>}|null} timetable
 * @param {string} job
 * @returns {{key: string, from: number, to: number}|{roaming: string[]}|null}
 */
export function usualPlace(timetable, job) {
  const hours = timetable?.jobs?.[job];
  if (!Array.isArray(hours) || hours.length !== 24) return null;
  const count = new Map();
  for (let h = DAY_HOURS.from; h < DAY_HOURS.to; h += 1) {
    const k = hours[h];
    if (k && k !== 'home') count.set(k, (count.get(k) ?? 0) + 1);
  }
  const ranked = [...count.entries()].sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return null;
  if (ranked[0][1] < 4) return { roaming: ranked.slice(0, 3).map(([k]) => k) };
  const key = ranked[0][0];
  let from = null;
  let to = null;
  for (let h = DAY_HOURS.from; h < DAY_HOURS.to; h += 1) {
    if (hours[h] !== key) continue;
    if (from === null) from = h;
    to = h + 1;
  }
  return { key, from, to };
}

/**
 * Where a job is at an hour: a place key, or 'home'; null without timetable.
 * @param {{jobs?: Object<string, string[]>}|null} timetable
 * @param {string} job
 * @param {number} hour 0..23
 */
export function placeAt(timetable, job, hour) {
  const hours = timetable?.jobs?.[job];
  if (!Array.isArray(hours)) return null;
  return hours[((hour % 24) + 24) % 24] ?? null;
}

/**
 * The neighbors that are usually at a public place at an hour (by their job),
 * sorted by name. Neighbors at home are at their home place.
 * @param {object} header
 * @param {object|null} timetable
 * @param {string} placeKey key or id of the place
 * @param {number} hour
 * @returns {string[]} neighbor ids
 */
export function peopleAt(header, timetable, placeKey, hour) {
  if (!timetable) return [];
  const place = (header?.places ?? []).find((p) => p.key === placeKey || p.id === placeKey);
  if (!place) return [];
  return (header?.neighbors ?? [])
    .filter((n) => {
      const at = placeAt(timetable, n.job, hour);
      return at === 'home' ? n.home === place.id : at === place.key;
    })
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((n) => n.id);
}

/**
 * Everything a card of a neighbor shows. Names of related people are sorted.
 * @param {object} header
 * @param {object|null} timetable
 * @param {string} id
 * @param {string} lang language of the interface
 * @returns {object|null}
 */
export function neighborProfile(header, timetable, id, lang) {
  const n = (header?.neighbors ?? []).find((x) => x.id === id);
  if (!n) return null;
  const L = langKey(lang);
  const rs = RUMOR[L];
  const byId = new Map((header.neighbors ?? []).map((x) => [x.id, x]));
  const places = header.places ?? [];
  const placeBy = (k) => places.find((p) => p.key === k || p.id === k);
  const groups = { family: [], friend: [], coworker: [], rival: [] };
  for (const r of header.relations ?? []) {
    const other = r.a === id ? r.b : r.b === id ? r.a : null;
    if (!other || !groups[r.type]) continue;
    const name = byId.get(other)?.name;
    if (name && !groups[r.type].includes(name)) groups[r.type].push(name);
  }
  for (const list of Object.values(groups)) list.sort((a, b) => a.localeCompare(b));
  const home = placeBy(n.home);
  const usual = usualPlace(timetable, n.job);
  let usualOut = null;
  if (usual?.key) usualOut = { key: usual.key, name: placeBy(usual.key)?.name ?? usual.key, from: usual.from, to: usual.to };
  else if (usual?.roaming) usualOut = { roaming: usual.roaming.map((k) => placeBy(k)?.name ?? k) };
  return {
    id: n.id,
    name: n.name,
    gender: n.gender,
    job: gendered(rs.jobs, n.job, n.gender),
    jobKey: n.job,
    trait: n.trait,
    traitName: gendered(rs.traits, n.trait, n.gender),
    traitPhrase: STRINGS[L].phrase[n.trait] ?? '',
    traitIcon: TRAIT_ICON[n.trait] ?? '',
    talk: TALK[n.trait] ?? 1,
    family: groups.family,
    friends: groups.friend,
    coworkers: groups.coworker,
    rivals: groups.rival,
    close: groups.family.length + groups.friend.length,
    home: home ? { id: home.id, key: home.key, name: home.name } : null,
    usual: usualOut,
  };
}

/**
 * The neighbors sorted for the list of whom to tell: by name, or by the people
 * close to them (family and friends), then by how much they talk, then by name.
 * @param {object[]} profiles from neighborProfile
 * @param {'name'|'close'} by
 */
export function sortProfiles(profiles, by = 'name') {
  const byName = (a, b) => a.name.localeCompare(b.name);
  if (by !== 'close') return [...profiles].sort(byName);
  return [...profiles].sort((a, b) => b.close - a.close || b.talk - a.talk || byName(a, b));
}
