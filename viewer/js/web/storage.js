// Where the web version keeps what `rumor play` keeps on disk (phase 10,
// package F): JSON values by key, in sessionStorage (the game of this tab)
// or localStorage (profile and «Mis partidas»).
//
//   store.get(key) / store.set(key, value|null)
//        │ storage usable ─► sessionStorage / localStorage
//        └ it throws ──────► window.name (survives the reloads of the tab,
//                            not its closing): the game goes on, only the
//                            progress is lost when the tab closes
//
// Every access is wrapped: a private window or blocked site data never stops
// the game. No DOM besides the two objects given.

const NAME_MARK = 'rv-web:';

/**
 * A map kept in `holder.name` (window.name), JSON after a mark; another value
 * there is left alone until something is written.
 * @param {{name: string}} holder
 */
export function nameMap(holder) {
  const read = () => {
    try {
      const raw = String(holder?.name ?? '');
      if (!raw.startsWith(NAME_MARK)) return {};
      const map = JSON.parse(raw.slice(NAME_MARK.length));
      return map && typeof map === 'object' ? map : {};
    } catch {
      return {};
    }
  };
  return {
    get(key) {
      return read()[key] ?? null;
    },
    set(key, text) {
      try {
        const map = read();
        if (text === null) delete map[key];
        else map[key] = text;
        holder.name = NAME_MARK + JSON.stringify(map);
      } catch {
        // Nowhere to keep it: this page only.
      }
    },
  };
}

/**
 * A JSON store over a Web Storage getter, falling back to `fallback` (a
 * nameMap) whenever the storage throws; with neither, the values live in
 * memory.
 * @param {() => Storage} storage a getter: reading window.localStorage may throw
 * @param {ReturnType<typeof nameMap>|null} fallback
 */
export function createStore(storage, fallback = null) {
  const memory = new Map();
  const backup = fallback ?? { get: (k) => memory.get(k) ?? null, set: (k, v) => (v === null ? memory.delete(k) : memory.set(k, v)) };
  let usable = null; // learnt on first use
  const real = () => {
    if (usable === false) return null;
    try {
      const s = storage();
      if (!s) throw new Error('no storage');
      if (usable === null) {
        const probe = '__rv_web_probe__';
        s.setItem(probe, '1');
        s.removeItem(probe);
      }
      usable = true;
      return s;
    } catch {
      usable = false;
      return null;
    }
  };
  const parse = (text) => {
    if (text === null || text === undefined) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  };
  return {
    /** Whether the real storage works (false: window.name or memory). */
    get persistent() {
      return real() !== null;
    },
    get(key) {
      const s = real();
      if (s) {
        try {
          return parse(s.getItem(key));
        } catch {
          usable = false;
        }
      }
      return parse(backup.get(key));
    },
    set(key, value) {
      const text = value === null ? null : JSON.stringify(value);
      const s = real();
      if (s) {
        try {
          if (text === null) s.removeItem(key);
          else s.setItem(key, text);
          return true;
        } catch {
          // Full or blocked from now on: the fallback keeps it.
          usable = false;
        }
      }
      backup.set(key, text);
      return false;
    },
  };
}
