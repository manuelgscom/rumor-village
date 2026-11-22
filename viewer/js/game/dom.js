// Small DOM helpers shared by the screens of the game.

/**
 * An element: el('button', {class: 'x', text: 'Hi', gm: 'start', onclick}, ...children).
 * `gm` sets data-gm (the anchors of the guided first game, see index.js).
 */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'gm') node.dataset.gm = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k in node && typeof v !== 'string') node[k] = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) node.append(c);
  return node;
}

/** A button (type=button). */
export function button(text, onclick, props = {}) {
  return el('button', { type: 'button', class: 'gm-btn', text, onclick, ...props });
}

/**
 * A row of toggle buttons; one is on. Pressing the one already on does
 * nothing: a second press never resets what it holds (phase 9-4).
 * @param {{value: any, label: string, disabled?: boolean, title?: string}[]} options
 * @param {any} value
 * @param {(v: any) => void} onPick
 * @param {{disabled?: boolean, gm?: string, key?: string, label?: string}} [o]
 *   key: each button gets data-key="<key>:<value>" (focus kept across repaints)
 */
export function segmented(options, value, onPick, { disabled = false, gm, key, label } = {}) {
  const box = el('div', { class: 'gm-seg', role: 'group', gm, 'aria-label': label });
  for (const o of options) {
    const b = el('button', {
      type: 'button',
      class: o.value === value ? 'on' : '',
      text: o.label,
      title: o.title,
      'aria-pressed': String(o.value === value),
      disabled: disabled || !!o.disabled,
      'data-key': key ? `${key}:${o.value}` : undefined,
      onclick: () => {
        if (o.value !== value) onPick(o.value);
      },
    });
    box.append(b);
  }
  return box;
}

/**
 * A <select>: options [{value, label}], with an optional blank first.
 * @param {{value: string, label: string}[]} options
 */
export function select(options, value, onChange, { blank = null, disabled = false, gm, label, key } = {}) {
  const s = el('select', { disabled, gm, 'aria-label': label, 'data-key': key });
  if (blank !== null) s.append(el('option', { value: '', text: blank }));
  for (const o of options) s.append(el('option', { value: String(o.value), text: o.label }));
  s.value = value === null || value === undefined ? '' : String(value);
  s.addEventListener('change', () => onChange(s.value));
  return s;
}

let labelSeq = 0;

/**
 * A labelled row of the form: «Label  [controls]», with a lock when fixed.
 * optional: a tag after the label («Opcional»); error: a message under the
 * controls (role alert); name: data-field, to find the row (focus on error);
 * gm: an anchor of the guided game on the controls.
 * With several controls (a list of them, like the 100 neighbors and their
 * filter) the controls are a role=group named by the visible label, so a
 * screen reader says the question on entering. A single control is left
 * alone: it carries its own aria-label, and a group around it would say the
 * same name twice.
 */
export function field(label, controls, { locked = false, lockText = '', lockTag = '', hint = null, optional = null, error = null, name, gm } = {}) {
  const group = Array.isArray(controls) && real(controls).length > 1;
  const id = group ? `gm-label-${++labelSeq}` : undefined;
  return el(
    'div',
    { class: `gm-field${locked ? ' gm-locked' : ''}${error ? ' gm-invalid' : ''}`, 'data-field': name },
    el(
      'span',
      { class: 'gm-label', id, text: label },
      optional && !locked ? el('span', { class: 'gm-opt', text: optional }) : null,
      locked ? el('span', { class: 'gm-lock', title: lockText, text: lockTag }) : null,
    ),
    el('div', { class: 'gm-controls', gm, role: group ? 'group' : undefined, 'aria-labelledby': id }, controls),
    hint ? el('div', { class: 'gm-hint', text: hint }) : null,
    error ? el('div', { class: 'gm-error gm-field-error', role: 'alert', text: error }) : null,
  );
}

/** A screen: a glass card with a title, its body and a footer. */
export function screen(kind, title, body, footer = null) {
  return el(
    'section',
    { class: `gm-screen gm-${kind} card-in`, 'data-screen': kind },
    title ? el('h2', { class: 'gm-title', text: title }) : null,
    el('div', { class: 'gm-body' }, body),
    footer ? el('div', { class: 'gm-foot' }, footer) : null,
  );
}

/** Copies text to the clipboard; resolves to whether it worked. */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

const real = (kids) => kids.flat().filter((k) => k !== null && k !== undefined && k !== false);

/** replaceChildren without the null/false/undefined placeholders («a ? x : null»). */
export function put(node, ...kids) {
  node.replaceChildren(...real(kids));
  return node;
}

/** append without the null/false/undefined placeholders. */
export function add(node, ...kids) {
  node.append(...real(kids));
  return node;
}
