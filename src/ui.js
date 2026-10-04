// Small DOM helpers shared by all screens.

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const ICONS = {
  back: '<path d="M15 5l-7 7 7 7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  image: '<rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M5 18l5-5 3 3 2-2 4 4"/>',
  star: '<path d="M12 4l2.4 5 5.4.6-4 3.7 1.1 5.4L12 16l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6z"/>',
  share: '<path d="M12 4v11M8 8l4-4 4 4"/><path d="M6 12v7h12v-7"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>',
  undo: '<path d="M9 7L5 11l4 4"/><path d="M5 11h9a5 5 0 010 10h-2"/>',
  redo: '<path d="M15 7l4 4-4 4"/><path d="M19 11h-9a5 5 0 000 10h2"/>',
  zoom: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5M11 8v6M8 11h6"/>',
  unzoom: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5M8 11h6"/>',
  trash: '<path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13"/>',
  edit: '<path d="M5 19h4L19 9l-4-4L5 15z"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  mail: '<rect x="4" y="6" width="16" height="12" rx="2"/><path d="M4 8l8 5 8-5"/>',
  download: '<path d="M12 4v11M8 11l4 4 4-4"/><path d="M5 19h14"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
  points: '<circle cx="6" cy="12" r="2"/><circle cx="12" cy="8" r="2"/><circle cx="18" cy="12" r="2"/><circle cx="12" cy="16" r="2"/>',
  refresh: '<path d="M19 12a7 7 0 11-2-5"/><path d="M19 4v4h-4"/>',
  compare: '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M12 5v14"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
};

export function icon(name, size = 22) {
  const span = document.createElement('span');
  span.className = 'icon';
  span.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  return span;
}

let toastTimer = null;
export function toast(text) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = h('div', { class: 'toast', role: 'status' });
    document.body.append(el);
  }
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

// A modal sheet. Returns { close }.
export function sheet(title, body, { onClose, wide } = {}) {
  const backdrop = h('div', { class: 'backdrop' });
  const close = () => {
    backdrop.remove();
    onClose?.();
  };
  const panel = h('div', { class: `sheet${wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'sheet-head' }, h('h2', {}, title), h('button', { class: 'icon-btn', 'aria-label': 'Schließen', onclick: close }, icon('close'))),
    body);
  backdrop.append(panel);
  backdrop.addEventListener('pointerdown', (e) => {
    if (e.target === backdrop) close();
  });
  document.body.append(backdrop);
  return { close, panel };
}

export function confirmSheet(title, text, okLabel = 'OK', { danger } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    const s = sheet(title, h('div', {},
      h('p', { class: 'muted' }, text),
      h('div', { class: 'row end' },
        h('button', { class: 'btn ghost', onclick: () => { answered = true; s.close(); resolve(false); } }, 'Abbrechen'),
        h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, onclick: () => { answered = true; s.close(); resolve(true); } }, okLabel))),
    { onClose: () => !answered && resolve(false) });
  });
}

export function promptSheet(title, label, value = '', okLabel = 'Speichern') {
  return new Promise((resolve) => {
    let answered = false;
    const input = h('input', { class: 'field', value, 'aria-label': label });
    const done = (v) => { answered = true; s.close(); resolve(v); };
    const s = sheet(title, h('form', { onsubmit: (e) => { e.preventDefault(); done(input.value.trim()); } },
      h('label', { class: 'label' }, label, input),
      h('div', { class: 'row end' },
        h('button', { type: 'button', class: 'btn ghost', onclick: () => done(null) }, 'Abbrechen'),
        h('button', { class: 'btn primary' }, okLabel))),
    { onClose: () => !answered && resolve(null) });
    setTimeout(() => input.focus(), 50);
  });
}

export const uid = () => crypto.getRandomValues(new Uint32Array(2)).reduce((s, n) => s + n.toString(36), '');

export function formatDate(iso) {
  return new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
