// Simulated time. A tick is one simulated minute counted from 00:00 of day 0
// (docs/contrato.md, section 6); `start_weekday` of the header says which
// weekday day 0 is (0 = Monday). A `when` slot is half hours from 00:00 of
// day 0.

export const MINUTES_PER_DAY = 1440;
export const MINUTES_PER_SLOT = 30;

/** Weekday names, Monday first. */
export const WEEKDAYS = {
  es: ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'],
  en: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
};

// Twilight windows, in minutes of the day: dawn from 05:30 to 06:30, dusk
// from 20:30 to 21:30. Night is when daylight is below one half.
const DAWN = [5 * 60 + 30, 6 * 60 + 30];
const DUSK = [20 * 60 + 30, 21 * 60 + 30];

/**
 * Day number of a tick (0 is the first day of the run).
 * @param {number} tick
 * @returns {number}
 */
export function dayOf(tick) {
  return Math.floor(Math.floor(tick) / MINUTES_PER_DAY);
}

/**
 * Minute of the day, 0..1439.
 * @param {number} tick
 * @returns {number}
 */
export function minuteOfDay(tick) {
  const t = Math.floor(tick);
  return ((t % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

/**
 * Weekday of a tick, 0 = Monday.
 * @param {number} tick
 * @param {number} startWeekday the header's start_weekday
 * @returns {number}
 */
export function weekdayOf(tick, startWeekday = 0) {
  return (((startWeekday + dayOf(tick)) % 7) + 7) % 7;
}

/**
 * "HH:MM" of a minute of the day.
 * @param {number} minute
 * @returns {string}
 */
export function hhmm(minute) {
  const m = ((Math.floor(minute) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/**
 * Clock of a tick.
 * @param {number} tick
 * @param {number} startWeekday
 * @param {'es'|'en'} lang
 * @returns {{day: number, weekday: number, weekdayName: string, hour: number, minute: number, time: string, text: string}}
 *   text is "martes 21:30" / "Tuesday 21:30"
 */
export function clockOf(tick, startWeekday = 0, lang = 'es') {
  const m = minuteOfDay(tick);
  const weekday = weekdayOf(tick, startWeekday);
  const weekdayName = (WEEKDAYS[lang] ?? WEEKDAYS.en)[weekday];
  const time = hhmm(m);
  return {
    day: dayOf(tick),
    weekday,
    weekdayName,
    hour: Math.floor(m / 60),
    minute: m % 60,
    time,
    text: `${weekdayName} ${time}`,
  };
}

function smooth(x) {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

/**
 * Daylight from 0 (night) to 1 (day), smooth through dawn and dusk. Takes the
 * fractional tick, so a background that uses it changes without jumps.
 * @param {number} tick may have decimals
 * @returns {number}
 */
export function daylight(tick) {
  const m = ((tick % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  if (m < DAWN[0] || m >= DUSK[1]) return 0;
  if (m < DAWN[1]) return smooth((m - DAWN[0]) / (DAWN[1] - DAWN[0]));
  if (m < DUSK[0]) return 1;
  return 1 - smooth((m - DUSK[0]) / (DUSK[1] - DUSK[0]));
}

/**
 * Whether it is night (from 21:00 to 06:00).
 * @param {number} tick
 * @returns {boolean}
 */
export function isNight(tick) {
  return daylight(Math.floor(tick)) < 0.5;
}

/**
 * Tick at which a `when` slot starts.
 * @param {number} slot
 * @returns {number}
 */
export function slotTick(slot) {
  return slot * MINUTES_PER_SLOT;
}

/**
 * "HH:MM" of a `when` slot.
 * @param {number} slot
 * @returns {string}
 */
export function slotTime(slot) {
  return hhmm(slotTick(slot));
}
