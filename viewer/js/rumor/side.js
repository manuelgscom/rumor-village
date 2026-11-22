// The #side card, rebuilt from the model when it changes.
//
// Without a selection: consequences and the graph.
//
//   CONSECUENCIAS              ¿quién va y cuándo?
//   ┌────────┬────────┬────────┐
//   │   33   │    2   │    4   │  one tile per group; a click shows its
//   │al sitio│a otra  │a otro  │  members and the culprit
//   └────────┴────────┴────────┘
//   QUIÉN SE LO CONTÓ A QUIÉN
//   ◆─●─●─●                       tree canvas, a click selects
//
// With a neighbor selected: their card, then the graph with their chain.
//
//   (EL) Elena                 [deformada] ×
//        maestra · prudente · vive en barrio oeste
//   QUÉ CREE AHORA        frente al original
//   [QUIÉN Manuel ✓] [DÓNDE plaza ✓] [CUÁNDO ~~22:00~~ 23:00 ✗] [CUÁNTOS 50 ✓]
//   CÓMO LE LLEGÓ                 sigue «cuándo»
//   ◆ 20:10 → Carmen
//   ● 20:28 Luis → Ana   cuándo a las ~~22:00~~ 23:00?  suposición declarada
//   SE LO CONTÓ Ana 20:36   SE LO HA CONTADO A …
//
// Inside the game (phase 9-5) the card of a neighbor says who they are as the
// lists of the game do (core/neighbors.js neighborProfile, person.js
// profileLines): the character with its phrase and icon, family and friends,
// rivals, where they live and spend the day; it shows even before the rumor
// starts. Until the game ends no culprit is named (the model comes with
// `secret`, rumor/index.js).

import { clockOf, slotTime } from '../core/clock.js';
import { neighborInitials, neighborName, neighborOf, placeName, slotValueText, unitOf } from '../core/names.js';
import { neighborProfile } from '../core/neighbors.js';
import { inGame } from '../core/params.js';
import { versionColor, VERSION_COLORS } from '../core/theme.js';
import { actBtn, el, put } from './dom.js';
import { drawGraph, graphLayout, pickNode } from './graph.js';
import { afterTheEnd, gameTiles, GROUP_KEYS, hourPassed } from './groups.js';
import { STRINGS as STORY } from '../story/strings.js';
import { GROUP_COLORS, INK } from './overlay.js';
import { gendered, placeWithThe, profileLines } from './person.js';
import { fill } from './strings.js';

export { morph } from './dom.js';

const MAX_NAMES = 12;

/**
 * Creates the side view.
 * @param {object} app
 * @param {object} t texts (strings.js, picked)
 * @param {{select: (id: string|null) => void, group: (key: string|null) => void, lead: (slot: string) => void, seek: (tick: number) => void}} act
 */
export function createSide(app, t, act) {
  const root = app.zones.side;
  const header = app.header;
  const game = inGame(app.params);
  const time = (tick) => clockOf(tick, header.start_weekday ?? 0, app.lang).time;
  const name = (id) => neighborName(header, id);

  const nameBtn = (id, cls = '') => actBtn(`rs-name${cls}`, name(id), { act: 'select', id });
  const timeBtn = (tick) => {
    const b = actBtn('rs-time', time(tick), { act: 'seek', tick: String(tick) });
    b.title = t.seek;
    return b;
  };
  const value = (slot, v) => (v ? slotValueText(slot, v.value, header) + (v.state === 'doubt' ? '?' : '') : t.nothing);
  const head = (text, extra) => {
    const h = el('div', 'rs-h');
    h.append(el('span', 'rs-htitle', text));
    if (extra) h.append(el('span', 'rs-hextra', extra));
    return h;
  };
  const tag = (cause) => el('span', 'rs-cause', t.causes[cause] ?? cause);
  let unit = ''; // of the amount of the fact shown (render)

  /** «a las ~~22:00~~ **23:00?**», with the prefix of the slot and the unit of the amount. */
  const change = (slot, oldV, newV) => {
    const box = el('span', 'rs-change');
    const p = t.prefix[slot];
    if (p && newV) box.append(`${p} `);
    if (oldV) box.append(el('s', 'rs-old', value(slot, oldV)), ' ');
    box.append(el('b', 'rs-new', value(slot, newV)));
    if (slot === 'amount' && unit && newV) box.append(` ${unit}`);
    return box;
  };
  const note = (m, kind) => {
    const k = m.cause === 'forgot' ? `${kind}Forgot` : `${kind}Dropped`;
    return el('div', 'rs-note', fill(t[k], { slot: t.slots[m.slot] ?? '', time: time(m.tick) }));
  };
  const nameList = (ids, max = MAX_NAMES) => {
    const box = el('div', 'rs-names');
    for (const id of ids.slice(0, max)) box.append(nameBtn(id));
    if (ids.length > max) box.append(el('span', 'rs-more', fill(t.more, { n: ids.length - max })));
    return box;
  };

  // ── Card of the selected neighbor ────────────────────────────────

  function personHead(m) {
    const id = m.select;
    const n = neighborOf(header, id);
    const v = m.versions.of.get(id) ?? null;
    const box = el('section', 'rs-person');
    const top = el('div', 'rs-who');
    const avatar = el('span', 'rs-avatar', neighborInitials(header, id));
    avatar.style.setProperty('--v', versionColor(v));
    const idBox = el('div', 'rs-id');
    idBox.append(el('div', 'rs-pname', name(id)));
    const profile = game ? neighborProfile(header, app.timetable ?? null, id, app.lang) : null;
    if (profile) {
      idBox.append(el('div', 'rs-role', profile.job));
    } else if (n) {
      const role = [gendered(t.jobs, n.job, n.gender), gendered(t.traits, n.trait, n.gender)].filter(Boolean).join(' · ');
      idBox.append(el('div', 'rs-role', role));
    }
    const x = actBtn('rs-x', '×', { act: 'select', id: '' });
    x.title = t.close;
    x.setAttribute('aria-label', t.close);
    top.append(avatar, idBox, x);
    box.append(top);
    if (profile) {
      const lines = el('div', 'rs-profile');
      for (const line of profileLines(profile, t, app.lang)) lines.append(el('div', 'rs-pline', line));
      box.append(lines);
    }
    const where = el('div', 'rs-where');
    const pill = el('span', `rs-pill rs-${v ?? 'unknown'}`, v ? t.versions[v] : t.unknownPill);
    where.append(pill);
    const bits = [];
    if (n?.home && !profile) bits.push(fill(t.lives, { place: placeName(header, n.home) }));
    const s = app.store.state.neighbors.get(id);
    if (s) bits.push(s.place ? fill(t.nowAt, { place: placeWithThe(header, s.place, app.lang) }) : s.trip ? t.onTheWay : '');
    where.append(el('span', 'rs-place', bits.filter(Boolean).join(' · ')));
    box.append(where);
    return box;
  }

  /** What they believe: one tile per slot, like the tiles of the fact in #rumor. */
  function belief(m) {
    const sec = el('section', 'rs-sec');
    sec.append(head(t.believes, t.vsOriginal));
    const grid = el('div', 'rs-belief');
    for (const r of m.person.belief) {
      const tile = el('div', `rs-btile rs-${r.status}`);
      const top = el('div', 'rs-btop');
      top.append(el('span', 'rs-slot', t.slots[r.slot]), el('span', 'rs-mark', r.status === 'same' ? '✓' : r.status === 'changed' ? '✗' : '–'));
      const val = el('div', 'rs-val');
      const original = r.original === null ? null : { value: r.original, state: 'sure' };
      const unitOfSlot = () => (r.slot === 'amount' && unit ? [el('span', 'rc-unit', unit)] : []);
      if (r.status === 'same') {
        val.append(el('b', 'rs-new', value(r.slot, r.now)), ...unitOfSlot());
        if (r.now.state === 'doubt') val.append(el('span', 'rs-doubt', t.doubt));
      } else if (r.status === 'changed') {
        if (original) val.append(el('s', 'rs-old', value(r.slot, original)), ' ');
        val.append(el('b', 'rs-new', value(r.slot, r.now)), ...unitOfSlot());
      } else {
        val.append(el('s', 'rs-old', value(r.slot, original)), el('span', 'rs-gone', r.forgotten ? t.forgotten : t.neverGot));
      }
      tile.append(top, val);
      grid.append(tile);
    }
    sec.append(grid);
    return sec;
  }

  function links(m) {
    const sec = el('section', 'rs-sec rs-links');
    const from = el('div', 'rs-link');
    from.append(el('div', 'rs-htitle', t.heardFrom));
    const f = m.person.from;
    const line = el('div', 'rs-names');
    if (f?.from) line.append(nameBtn(f.from), timeBtn(f.tick));
    else if (f && game) line.append(el('span', 'rs-dimtext', t.firstHandGame), timeBtn(f.tick));
    else if (f) line.append(el('span', 'rs-dimtext', t.firstHand), timeBtn(f.tick));
    from.append(line);
    const to = el('div', 'rs-link');
    const n = m.person.told.length;
    to.append(el('div', 'rs-htitle', n ? `${t.toldTo} · ${n}` : t.toldTo));
    if (m.person.told.length) to.append(nameList(m.person.told.map((x) => x.to), 6));
    else to.append(el('div', 'rs-dimtext', t.toldNobody));
    sec.append(from, to);
    return sec;
  }

  function chain(m) {
    const c = m.chain;
    const sec = el('section', 'rs-sec rs-chain');
    // «sigue "cuándo"» only outside the game: the player does not need it.
    if (game) sec.append(head(fill(t.howItCameOf, { slot: t.slotThe[c.lead] ?? t.slots[c.lead] })));
    else sec.append(head(t.howItCame, fill(t.following, { slot: t.slots[c.lead] })));
    if (m.paths.length > 1) {
      const chips = el('div', 'rs-chips');
      chips.append(el('span', 'rs-dimtext', t.byPath));
      for (const p of m.paths) {
        const label = p.slots.map((s) => t.slots[s]).join(' · ');
        chips.append(actBtn(`rs-chip${p.slots.includes(c.lead) ? ' rs-on' : ''}`, label, { act: 'lead', slot: p.slots[0] }));
      }
      sec.append(chips);
    }
    const original = m.fact.slots[c.lead] ?? null;
    const list = el('ol', 'rs-steps');
    if (c.origin) {
      const li = el('li', 'rs-step rs-origin');
      li.style.setProperty('--dot', INK);
      const line = el('div', 'rs-line');
      line.append(timeBtn(c.origin.tick), el('span', 'rs-arrow', '◆ →'), nameBtn(c.origin.who), el('span', 'rs-dimtext', game ? t.originGame : t.origin));
      li.append(line);
      list.append(li);
    }
    for (const st of c.steps) {
      const lead = st.slots.find((s) => s.slot === c.lead);
      const got = lead?.got ?? lead?.heard;
      const dot = !got ? VERSION_COLORS.incomplete : got.value === original ? VERSION_COLORS.correct : VERSION_COLORS.wrong;
      const changed = st.slots.filter((s) => s.changed);
      // Inside the game only a change of the followed detail is marked.
      const hit = game ? changed.some((x) => x.slot === c.lead) : changed.length > 0;
      const li = el('li', `rs-step${hit ? ' rs-hit' : ''}`);
      li.style.setProperty('--dot', dot);
      const line = el('div', 'rs-line');
      line.append(timeBtn(st.tick), nameBtn(st.from), el('span', 'rs-arrow', '→'), nameBtn(st.to));
      if (!changed.length) line.append(el('span', 'rs-faithful', t.faithful));
      li.append(line);
      for (const s of changed) {
        const row = el('div', `rs-hop${s.slot === c.lead ? ' rs-lead' : ''}`);
        row.append(el('span', 'rs-slot', t.slots[s.slot]), change(s.slot, s.old, s.got ?? s.heard));
        if (s.cause) row.append(tag(s.cause));
        li.append(row);
        for (const n of s.notes) li.append(note(n, 'note'));
      }
      for (const s of st.slots) {
        if (s.conflict && !s.changed) li.append(el('div', 'rs-note', `${t.slots[s.slot]}: ${t.conflict}`));
      }
      list.append(li);
    }
    for (const n of c.tail) {
      const li = el('li', 'rs-step rs-tail');
      li.style.setProperty('--dot', VERSION_COLORS.unknown);
      li.append(note(n, 'tail'));
      list.append(li);
    }
    sec.append(list);
    return sec;
  }

  // ── Consequences ─────────────────────────────────────────────────

  function groups(m) {
    const sec = el('section', 'rs-sec rs-groupsec');
    // Inside the game: plans while it runs, arrivals once it ended or the hour
    // of the rumor has passed (phase 9-5).
    const ended = game && (!!app.store.state?.ended || hourPassed(m.fact.slots, Math.floor(app.store.pos)));
    const tiles = game ? gameTiles(m.groups, ended) : null;
    sec.append(game ? head(ended ? t.groupsEnded : t.groupsGame) : head(t.groupsTitle, t.groupsSub));
    const late = game ? afterTheEnd(m.fact.slots, header.params?.end_tick) : null;
    if (late !== null) {
      const the = STORY[app.lang === 'en' ? 'en' : 'es'].the?.[m.fact.what] ?? '';
      const what = the.charAt(0).toUpperCase() + the.slice(1);
      sec.append(el('div', 'rs-note rs-late', fill(ended ? t.afterEndPast : t.afterEnd, { what, time: slotTime(m.fact.slots.when) })));
    }
    if (!m.group && GROUP_KEYS.every((k) => !m.groups?.[k]?.length)) {
      sec.append(el('div', 'rs-dimtext', t.noPlans));
      return sec;
    }
    const row = el('div', 'rs-tiles');
    for (const k of GROUP_KEYS) {
      const members = m.groups?.[k] ?? [];
      const arrived = members.filter((x) => x.arrived).length;
      const n = tiles ? tiles[k].n : members.length;
      const b = actBtn(`rs-tile${m.group === k ? ' rs-on' : ''}${members.length ? '' : ' rs-zero'}`, undefined, {
        act: 'group',
        next: m.group === k ? '' : k,
      });
      b.style.setProperty('--g', GROUP_COLORS[k]);
      const count = el('b', 'rs-tcount', String(n));
      count.dataset.count = String(n); // counts when it changes (rumor/index.js)
      b.append(count, el('span', 'rs-tlabel', tiles ? (ended ? t.groupsDone[k] : t.groupsPlan[k]) : t.groupsShort[k]));
      const sub = !members.length || (tiles && ended) ? ' ' : fill(tiles ? t.thereNow : t.arrived, { a: arrived });
      b.append(el('span', 'rs-tsub', sub));
      row.append(b);
    }
    sec.append(row);
    if (!m.group) {
      sec.append(el('div', 'rs-hint', m.secret ? t.groupHintGame : t.groupHint));
      return sec;
    }
    const members = m.groups?.[m.group] ?? [];
    const box = el('div', 'rs-members');
    box.style.setProperty('--g', GROUP_COLORS[m.group]);
    const h = el('div', 'rs-mhead');
    h.append(el('span', 'rs-htitle', t.groups[m.group]));
    const x = actBtn('rs-x rs-xs', '×', { act: 'group' });
    x.title = t.clearGroup;
    h.append(x);
    box.append(h);
    if (members.length) box.append(nameList(members.map((x) => x.who)));
    else box.append(el('div', 'rs-dimtext', t.nobody));
    sec.append(box);
    if (m.group === 'right') sec.append(el('div', 'rs-ok', t.noCulprit));
    if (m.culprits) sec.append(culprits(m));
    return sec;
  }

  function culprits(m) {
    const box = el('div', 'rs-culprits');
    const { culprits: list, unexplained } = m.culprits;
    for (const { culprit: c, members } of list) {
      const item = el('div', 'rs-culprit');
      const top = el('div', 'rs-ctop');
      top.append(el('span', 'rs-ckicker', `⚠ ${list.length > 1 ? t.culprits : t.culprit}`), nameBtn(c.who, ' rs-cname'), timeBtn(c.tick));
      // Turn and plan ids only in the technical view; «en su plan» always.
      if (c.kind === 'turn') top.append(el('span', 'rs-cid tech-only', fill(t.turn, { id: c.id })));
      else {
        const cid = el('span', 'rs-cid');
        cid.append(el('span', 'tech-only', `${fill(t.plan, { id: c.id })} · `), t.inPlan);
        top.append(cid);
      }
      item.append(top);
      const row = el('div', 'rs-hop rs-lead');
      row.append(el('span', 'rs-slot', t.slots[c.slot]), change(c.slot, c.old, c.new));
      if (c.cause) row.append(tag(c.cause));
      item.append(row);
      for (const n of c.notes) item.append(note(n, 'note'));
      const led = el('div', 'rs-led');
      led.append(el('span', 'rs-dimtext', fill(t.ledTo, { n: members.length, names: '' })));
      for (const id of members) led.append(nameBtn(id));
      item.append(led);
      box.append(item);
    }
    if (unexplained.length) box.append(el('div', 'rs-dimtext', fill(t.unexplained, { names: unexplained.map(name).join(', ') })));
    return box;
  }

  // ── Graph ────────────────────────────────────────────────────────

  function graphSection(m) {
    const sec = el('section', 'rs-sec rs-graphsec');
    sec.append(head(t.graphTitle));
    sec.append(el('canvas', 'rs-graph'));
    if (!m.select) sec.append(el('div', 'rs-hint', game ? t.graphHintGame : t.graphHint));
    return sec;
  }

  /** Highlights of the graph for a model. */
  function graphMarks(m) {
    const edges = new Set();
    const rings = new Map();
    const labels = new Map();
    if (m.chain) {
      if (m.chain.origin) edges.add(`>${m.chain.origin.who}`);
      for (const st of m.chain.steps) edges.add(`${st.from}>${st.to}`);
      rings.set(m.chain.target, INK);
      labels.set(m.chain.target, name(m.chain.target));
    } else if (m.select) {
      rings.set(m.select, INK);
    } else if (m.group) {
      for (const x of m.groups?.[m.group] ?? []) rings.set(x.who, GROUP_COLORS[m.group]);
      for (const { culprit, members } of m.culprits?.culprits ?? []) {
        for (const who of members) {
          const chain = m.culprits.chains.get(who);
          const k = chain ? chain.steps.findIndex((st) => st.turn.id === culprit.id) : -1;
          if (k >= 0) for (const st of chain.steps.slice(k)) edges.add(`${st.from}>${st.to}`);
        }
        rings.set(culprit.who, INK);
        labels.set(culprit.who, `⚠ ${name(culprit.who)}`);
      }
    }
    return { edges, rings, labels };
  }

  let pendingGraph = null;

  /** Rebuilds the card for a model. */
  function render(m) {
    if (!m.fact) {
      // Inside the game the card of a neighbor shows before the rumor too.
      if (game && m.select) {
        const wrap = el('div', 'rside rs-selected');
        wrap.append(personHead(m));
        put(root, wrap);
      } else root.replaceChildren();
      pendingGraph = null;
      return;
    }
    unit = unitOf(m.fact.what, app.lang);
    const wrap = el('div', `rside${m.select ? ' rs-selected' : ''}`);
    if (m.select) {
      wrap.append(personHead(m));
      if (m.person && m.chain) {
        // The chain right after the belief: it shows where the change came from.
        wrap.append(belief(m), chain(m), links(m));
      }
    } else {
      wrap.append(groups(m));
    }
    const graph = m.tree && m.tree.nodes.length;
    if (graph) wrap.append(graphSection(m));
    put(root, wrap);
    // The canvas on screen may be the one kept by morph, not the new one.
    pendingGraph = graph ? { canvas: root.querySelector('canvas.rs-graph'), m } : null;
    paintGraph();
  }

  function paintGraph() {
    if (!pendingGraph) return;
    const { canvas, m } = pendingGraph;
    const width = canvas.clientWidth;
    if (!width) return;
    const layout = graphLayout(m.tree, width);
    const marks = graphMarks(m);
    drawGraph(canvas, m.tree, layout, {
      color: (id) => versionColor(m.versions.of.get(id) ?? null),
      edges: marks.edges,
      rings: marks.rings,
      labels: marks.labels,
      ink: INK,
      line: 'rgba(30, 42, 54, 0.22)',
      text: INK,
      dim: !!(m.chain || m.group),
    });
    canvas.onclick = (ev) => {
      const r = canvas.getBoundingClientRect();
      const id = pickNode(layout, ev.clientX - r.left, ev.clientY - r.top);
      if (id) act.select(id);
    };
    canvas.onmousemove = (ev) => {
      const r = canvas.getBoundingClientRect();
      const id = pickNode(layout, ev.clientX - r.left, ev.clientY - r.top);
      canvas.title = id ? name(id) : '';
      canvas.style.cursor = id ? 'pointer' : 'default';
    };
  }

  root.addEventListener('click', (ev) => {
    const b = ev.target instanceof Element ? ev.target.closest('button[data-act]') : null;
    if (!b || !root.contains(b)) return;
    const d = b.dataset;
    if (d.act === 'select') act.select(d.id || null);
    else if (d.act === 'seek') act.seek(Number(d.tick));
    else if (d.act === 'lead') act.lead(d.slot);
    else if (d.act === 'group') act.group(d.next || null);
  });

  new ResizeObserver(() => paintGraph()).observe(root);
  return { render };
}
