// A tiny event bus. Events of the viewer:
//   'select' {neighbor: string|null}   'group' {key: string|null}
//   'seek'   {pos: number}             'zoom'  (camera changed)
//   'speed'  {value}                   'pause' {paused: boolean}
//   'fact'   {fact: string|null}       'loaded' (a recording is in, models too)
//   'ui'     {mode}                     'progress' {part, loaded, total}
//   'help'   (open or close the help card; the key ?)

/**
 * @typedef {object} Bus
 * @property {(type: string, fn: (payload: any) => void) => () => void} on returns the unsubscribe function
 * @property {(type: string, payload?: any) => void} emit
 */

/**
 * Creates a bus.
 * @param {(type: string, payload: any) => void} [after] called after the handlers of every emit
 * @returns {Bus}
 */
export function createBus(after = () => {}) {
  const handlers = new Map();
  return {
    on(type, fn) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type).add(fn);
      return () => handlers.get(type)?.delete(fn);
    },
    emit(type, payload = {}) {
      for (const fn of [...(handlers.get(type) ?? [])]) {
        try {
          fn(payload);
        } catch (err) {
          console.error(`bus: handler of '${type}' failed`, err);
        }
      }
      after(type, payload);
    },
  };
}
