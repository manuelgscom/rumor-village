// The telephone strip on screen (phase 8-2, 2.12): a band over the bottom
// bar, only for the telephone row (render/layout.js isRow). The model is
// strip.js; a cell is a button that selects its neighbor.
//
//   .rstrip (in .layout; <html data-strip> lets the rest make room)
//   ┌ ENTRA ─┐ ┌Carmen┐›┌ Ana ─┐›┌Elena─┐ … ┌ SALE · Rafael ┐
//   │ Manuel │ │Manuel│ │Manuel│ │Manuel│   │ Manuel        │
//   │ plaza  │ │plaza │ │plaza │ │ bar  │   │ bar           │  red: changed in
//   │ 21:00  │ │21:00 │ │21:00 │ │19:30 │   │ 19:30         │  that hop (cells),
//   │ 50     │ │ 0?   │ │ 0    │ │ 0    │   │ 6             │  or off the original (out)
//   └────────┘ └──────┘ └──────┘ └──────┘   └───────────────┘
//
// Hidden with embed (not built), in photo mode (core.css), in the story mode
// and on phones (rumor.css).

import { neighborName, slotValueText } from '../core/names.js';
import { el, put } from './dom.js';
import { stripAt } from './strip.js';
import { fill } from './strings.js';

/**
 * Creates the strip (the caller checks that the run is a row).
 * @param {object} app
 * @param {object} t texts (strings.js, picked)
 * @param {ReturnType<import('./history.js').createHistory>} h fed by the caller
 * @param {(id: string) => void} select
 * @returns {{render: (idx: number, fact: string|null, selected: string|null) => void}}
 */
export function createStrip(app, t, h, select) {
  const { header } = app;
  const s = t.strip;
  const root = el('section', 'rstrip');
  root.setAttribute('aria-label', s.label);
  (document.querySelector('.layout') ?? document.body).append(root);
  document.documentElement.dataset.strip = '1';
  const name = (id) => neighborName(header, id);
  const text = (x) => (x.value === null ? '—' : slotValueText(x.slot, x.value, header) + (x.state === 'doubt' ? '?' : ''));

  const values = (slots) => {
    const box = el('span', 'rstrip-vals');
    for (const x of slots) {
      const v = el('span', `rstrip-v${x.changed ? ' changed' : ''}${x.value === null ? ' none' : ''}`, text(x));
      box.append(v);
    }
    return box;
  };

  root.addEventListener('click', (ev) => {
    const b = ev.target instanceof Element ? ev.target.closest('.rstrip-cell') : null;
    if (b) select(b.dataset.id);
  });

  let key = '';
  return {
    render(idx, fact, selected) {
      const k = `${idx}|${fact}|${selected}`;
      if (k === key) return;
      key = k;
      const m = stripAt(h, header, fact, idx);
      root.hidden = !m;
      if (!m) return;
      const wrap = el('div', 'rstrip-in');
      const inBox = el('div', 'rstrip-end rstrip-start');
      inBox.append(el('span', 'rstrip-k', s.in));
      inBox.append(values(Object.keys(m.original).length ? ['who', 'where', 'when', 'amount'].map((slot) => ({ slot, value: m.original[slot] ?? null, state: 'sure', changed: false })) : []));
      const list = el('ol', 'rstrip-cells');
      for (const c of m.cells) {
        const li = el('li');
        const b = el('button', `rstrip-cell${c.told ? '' : ' off'}${c.who === selected ? ' on' : ''}`);
        b.type = 'button';
        b.dataset.id = c.who;
        b.title = `${c.told ? (c.from ? fill(s.cell, { name: name(c.who), from: name(c.from) }) : fill(s.cellFirst, { name: name(c.who) })) : fill(s.cellNot, { name: name(c.who) })} · ${fill(s.show, { name: name(c.who) })}`;
        b.append(el('span', 'rstrip-name', name(c.who)), values(c.slots));
        li.append(b);
        list.append(li);
      }
      const outBox = el('div', 'rstrip-end rstrip-out');
      outBox.title = s.changed;
      outBox.append(el('span', 'rstrip-k', m.out ? fill(s.outOf, { name: name(m.out.who) }) : s.out));
      if (m.out) outBox.append(values(m.out.slots));
      wrap.append(inBox, list, outBox);
      put(root, wrap);
    },
  };
}
