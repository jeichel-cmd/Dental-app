// The try-on screen: the patient's photo with the new teeth, and the controls to shape them.

import { h, icon, toast, promptSheet, confirmSheet, uid } from './ui.js';
import { renderSmile, photoLight, mouthBounds, splinePath, lipOutline } from './render.js';
import { DEFAULT_DESIGN, FORMS, outline } from './teeth.js';
import { SHADES, shadeRGB } from './shades.js';
import { LOOKS, applyLook, PLACEMENT } from './looks.js';
import { cropAround, composite, toBlob } from './exporter.js';
import { findMouth, mouthFromPoints, anchorFor } from './face.js';

const LOOK_KEYS = Object.keys(DEFAULT_DESIGN).filter((k) => !PLACEMENT.includes(k));
const sameLook = (a, b) => LOOK_KEYS.every((k) => (typeof a[k] === 'number' ? Math.abs(a[k] - b[k]) < 1e-6 : a[k] === b[k]));

// Small drawing of a central incisor for the form buttons.
function formIcon(form) {
  const pts = outline({ id: 'central' }, { form, edges: 0.4 });
  const d = pts.map(([u, v], i) => `${i ? 'L' : 'M'}${(20 + u * 26).toFixed(1)} ${(4 + v * 30).toFixed(1)}`).join('') + 'Z';
  const span = h('span', { class: 'form-icon' });
  span.innerHTML = `<svg viewBox="0 0 40 38" width="34" height="32"><path d="${d}" fill="#fff" stroke="currentColor" stroke-width="1.4"/></svg>`;
  return span;
}

function slider({ label, left, right, min, max, step = 0.01, value, onInput, onChange }) {
  const input = h('input', { type: 'range', min, max, step, value, 'aria-label': label });
  input.addEventListener('input', () => onInput(Number(input.value)));
  input.addEventListener('change', () => onChange(Number(input.value)));
  return h('div', { class: 'slider' },
    h('div', { class: 'slider-label' }, label),
    input,
    h('div', { class: 'slider-ends' }, h('span', {}, left), h('span', {}, right)));
}

function toggle(label, checked, onChange) {
  const input = h('input', { type: 'checkbox', checked });
  input.addEventListener('change', () => onChange(input.checked));
  return h('label', { class: 'switch' }, h('span', {}, label), input, h('span', { class: 'track' }));
}

export function openEditor(root, ctx) {
  const { patient, photo, image } = ctx;
  let design = { ...DEFAULT_DESIGN, ...photo.design };
  let mouth = structuredClone(photo.mouth);
  let history = [];
  let future = [];
  let gestureBase = null;
  let showing = 'after';
  let zoom = 'face';
  let editPoints = !mouth.auto && !photo.pointsChecked;
  let tab = editPoints ? 'position' : 'looks';
  let light = null;

  // Full-size picture: photo with the teeth drawn in.
  const full = h('canvas', { width: image.width, height: image.height });
  const fctx = full.getContext('2d', { willReadFrequently: true });
  fctx.drawImage(image, 0, 0);
  light = photoLight(fctx, mouth);

  const view = h('canvas', { class: 'view', 'aria-label': 'Foto mit neuen Zähnen' });
  const vctx = view.getContext('2d');
  const badge = h('div', { class: 'badge' });
  const hint = h('div', { class: 'hint' });
  const zoomBtn = h('button', { class: 'fab', 'aria-label': 'Ansicht wechseln', onclick: () => { zoom = zoom === 'face' ? 'smile' : 'face'; draw(); updateChrome(); } });
  const stage = h('div', { class: 'stage' }, view, badge, hint, zoomBtn);
  const strip = h('div', { class: 'strip', role: 'tablist', 'aria-label': 'Vergleich und Favoriten' });
  const panelBody = h('div', { class: 'panel-body' });
  const tabs = h('div', { class: 'tabs', role: 'tablist' });
  const undoBtn = h('button', { class: 'icon-btn', 'aria-label': 'Rückgängig', onclick: undo }, icon('undo'));
  const redoBtn = h('button', { class: 'icon-btn', 'aria-label': 'Wiederholen', onclick: redo }, icon('redo'));

  const screen = h('div', { class: 'screen editor' },
    h('header', { class: 'topbar' },
      h('button', { class: 'icon-btn', 'aria-label': 'Zurück', onclick: () => { flush(); ctx.onBack(); } }, icon('back')),
      h('div', { class: 'title' }, h('strong', {}, patient.name), h('span', { class: 'muted small' }, 'Anprobe')),
      h('div', { class: 'spacer' }),
      undoBtn, redoBtn,
      h('button', { class: 'btn ghost', onclick: saveFavorite }, icon('star', 20), h('span', { class: 'hide-sm' }, 'Als Favorit')),
      h('button', { class: 'btn primary', onclick: () => { flush(); ctx.onExport(design, mouth); } }, icon('share', 20), h('span', { class: 'hide-sm' }, 'Teilen'))),
    h('div', { class: 'editor-body' },
      h('div', { class: 'stage-wrap' }, stage, strip),
      h('aside', { class: 'panel' }, tabs, panelBody)));
  root.replaceChildren(screen);

  // ---- drawing ----------------------------------------------------------------------------

  let dirty = true;
  let frame = 0;
  let interacting = false; // quicker, lighter rendering while a finger or slider moves
  function rebuild() {
    dirty = true;
    if (!frame) frame = requestAnimationFrame(() => { frame = 0; draw(); });
  }

  let lastBounds = null;
  function paintFull() {
    const b = mouthBounds(mouth, 0.3);
    const area = lastBounds
      ? { x: Math.min(b.x, lastBounds.x), y: Math.min(b.y, lastBounds.y), x1: Math.max(b.x + b.w, lastBounds.x + lastBounds.w), y1: Math.max(b.y + b.h, lastBounds.y + lastBounds.h) }
      : { x: 0, y: 0, x1: image.width, y1: image.height };
    const x = Math.max(0, Math.floor(area.x));
    const y = Math.max(0, Math.floor(area.y));
    const w = Math.min(image.width, Math.ceil(area.x1)) - x;
    const hh = Math.min(image.height, Math.ceil(area.y1)) - y;
    fctx.clearRect(x, y, w, hh);
    fctx.drawImage(image, x, y, w, hh, x, y, w, hh);
    if (showing === 'after') renderSmile(fctx, mouth, design, light, { fast: interacting });
    lastBounds = b;
    dirty = false;
  }

  let map = null; // image <-> screen
  function viewRect() {
    if (drag?.kind === 'point' && map) return map.r; // keep the view still while moving lip points
    if (zoom === 'smile') return cropAround(mouth, image, 'smile');
    return { x: 0, y: 0, w: image.width, h: image.height };
  }

  function draw() {
    const dpr = window.devicePixelRatio || 1;
    const cw = stage.clientWidth;
    const ch = stage.clientHeight;
    if (!cw || !ch) return;
    if (view.width !== Math.round(cw * dpr) || view.height !== Math.round(ch * dpr)) {
      view.width = Math.round(cw * dpr);
      view.height = Math.round(ch * dpr);
    }
    if (dirty) paintFull();
    const r = viewRect();
    const scale = Math.min(view.width / r.w, view.height / r.h);
    const ox = (view.width - r.w * scale) / 2;
    const oy = (view.height - r.h * scale) / 2;
    map = { r, scale, ox, oy, dpr };
    vctx.fillStyle = getComputedStyle(stage).getPropertyValue('--stage-bg') || '#111';
    vctx.fillRect(0, 0, view.width, view.height);
    vctx.imageSmoothingQuality = 'high';
    vctx.drawImage(full, r.x, r.y, r.w, r.h, ox, oy, r.w * scale, r.h * scale);
    if (editPoints) drawHandles();
  }

  const toScreen = ([x, y]) => [map.ox + (x - map.r.x) * map.scale, map.oy + (y - map.r.y) * map.scale];
  const toImage = (sx, sy) => [map.r.x + (sx - map.ox) / map.scale, map.r.y + (sy - map.oy) / map.scale];

  function drawHandles() {
    const lips = lipOutline(mouth).map(toScreen);
    vctx.save();
    vctx.lineWidth = 1.5 * map.dpr;
    vctx.strokeStyle = 'rgba(255,255,255,0.9)';
    vctx.setLineDash([5 * map.dpr, 4 * map.dpr]);
    vctx.stroke(splinePath(lips));
    vctx.setLineDash([]);
    for (const p of mouth.poly.map(toScreen)) {
      vctx.beginPath();
      vctx.arc(p[0], p[1], 7 * map.dpr, 0, Math.PI * 2);
      vctx.fillStyle = 'rgba(29,111,139,0.9)';
      vctx.fill();
      vctx.lineWidth = 2 * map.dpr;
      vctx.strokeStyle = '#fff';
      vctx.stroke();
    }
    vctx.restore();
  }

  new ResizeObserver(() => draw()).observe(stage);

  // ---- changes and history ----------------------------------------------------------------

  let saveTimer = null;
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 500);
  }
  function flush() {
    clearTimeout(saveTimer);
    photo.design = design;
    photo.mouth = mouth;
    photo.updated = new Date().toISOString();
    ctx.save();
  }

  function setDesign(patch) {
    interacting = true;
    if (!gestureBase) gestureBase = { design, mouth: structuredClone(mouth) };
    design = { ...design, ...patch };
    if (showing !== 'after') {
      showing = 'after';
      updateChrome();
    }
    rebuild();
  }

  function commit() {
    if (interacting) {
      interacting = false;
      rebuild();
    }
    if (gestureBase) {
      history.push(gestureBase);
      if (history.length > 80) history.shift();
      future = [];
      gestureBase = null;
    }
    persist();
    updateChrome();
  }

  function restore(snap) {
    design = snap.design;
    mouth = structuredClone(snap.mouth);
    showing = 'after';
    rebuild();
    persist();
    renderPanel();
    updateChrome();
  }

  function undo() {
    if (!history.length) return;
    future.push({ design, mouth: structuredClone(mouth) });
    restore(history.pop());
  }
  function redo() {
    if (!future.length) return;
    history.push({ design, mouth: structuredClone(mouth) });
    restore(future.pop());
  }

  function applyDesign(next) {
    setDesign(next);
    commit();
    renderPanel();
  }

  // ---- comparison strip and favourites -------------------------------------------------------

  async function favThumb(fav) {
    const url = ctx.thumbs.get(`fav-${fav.id}`);
    if (url) return url;
    const blob = await ctx.getFavThumb(fav.id);
    if (!blob) return null;
    const u = URL.createObjectURL(blob);
    ctx.thumbs.set(`fav-${fav.id}`, u);
    return u;
  }

  function stripItem(label, active, onclick, thumbUrl, onRemove) {
    const img = h('span', { class: 'thumb' });
    if (thumbUrl instanceof Promise) thumbUrl.then((u) => u && (img.style.backgroundImage = `url(${u})`));
    const el = h('button', { class: `chip${active ? ' active' : ''}`, role: 'tab', 'aria-selected': String(active), onclick }, img, h('span', { class: 'chip-label' }, label));
    if (onRemove) {
      el.addEventListener('contextmenu', (e) => { e.preventDefault(); onRemove(); });
    }
    return el;
  }

  function updateChrome() {
    undoBtn.disabled = !history.length;
    redoBtn.disabled = !future.length;
    badge.textContent = showing === 'after' ? 'Nachher' : 'Vorher';
    badge.className = `badge ${showing}`;
    zoomBtn.replaceChildren(icon(zoom === 'face' ? 'zoom' : 'unzoom'), h('span', {}, zoom === 'face' ? 'Lächeln' : 'Gesicht'));
    hint.textContent = editPoints ? 'Punkte auf den inneren Lippenrand ziehen' : 'Ziehen zum Verschieben · zwei Finger zum Vergrößern';
    hint.hidden = showing !== 'after';
    const favs = patient.favorites || [];
    const activeFav = favs.find((f) => sameLook(f.design, design));
    strip.replaceChildren(
      stripItem('Vorher', showing === 'before', () => { showing = 'before'; rebuild(); updateChrome(); }, null),
      stripItem(activeFav ? 'Aktuell' : 'Aktuell', showing === 'after' && !activeFav, () => { showing = 'after'; rebuild(); updateChrome(); }, null),
      ...favs.map((f) => stripItem(f.name, showing === 'after' && f === activeFav, () => {
        const next = f.photoId === photo.id ? { ...f.design } : applyLook(design, f.design);
        applyDesign(next);
      }, favThumb(f))),
      h('button', { class: 'chip add', onclick: saveFavorite, 'aria-label': 'Aktuellen Look als Favorit speichern' }, icon('star', 18), h('span', { class: 'chip-label' }, 'Speichern')),
    );
  }

  async function saveFavorite() {
    const favs = (patient.favorites ||= []);
    const existing = favs.find((f) => sameLook(f.design, design));
    if (existing) {
      toast(`Schon gespeichert als „${existing.name}“`);
      return;
    }
    const name = await promptSheet('Favorit speichern', 'Name', `Look ${favs.length + 1}`);
    if (!name) return;
    const fav = { id: uid(), name, design: { ...design }, photoId: photo.id, created: new Date().toISOString() };
    // Thumbnail: the smile close-up with these teeth.
    const pic = composite(image, mouth, design, true);
    const area = cropAround(mouth, image, 'smile');
    const t = h('canvas', { width: 240, height: Math.round((240 * area.h) / area.w) });
    t.getContext('2d').drawImage(pic, area.x, area.y, area.w, area.h, 0, 0, t.width, t.height);
    await ctx.putFavThumb(fav.id, await toBlob(t, 'image/jpeg', 0.85));
    favs.push(fav);
    flush();
    toast(`„${name}“ gespeichert`);
    updateChrome();
    if (tab === 'looks') renderPanel();
  }

  async function removeFavorite(fav) {
    if (!(await confirmSheet('Favorit löschen?', `„${fav.name}“ wird entfernt.`, 'Löschen', { danger: true }))) return;
    patient.favorites = patient.favorites.filter((f) => f !== fav);
    ctx.deleteFavThumb(fav.id);
    flush();
    updateChrome();
    renderPanel();
  }

  // ---- controls -----------------------------------------------------------------------------

  const TABS = [
    ['looks', 'Looks'],
    ['form', 'Form'],
    ['color', 'Farbe'],
    ['details', 'Feinschliff'],
    ['position', 'Position'],
  ];

  function renderTabs() {
    tabs.replaceChildren(...TABS.map(([id, label]) => h('button', {
      class: `tab${tab === id ? ' active' : ''}`, role: 'tab', 'aria-selected': String(tab === id),
      onclick: () => {
        tab = id;
        if (id !== 'position' && editPoints) {
          editPoints = false;
          photo.pointsChecked = true;
          draw();
          updateChrome();
        }
        renderTabs();
        renderPanel();
      },
    }, label)));
  }

  const num = (key, label, left, right, min, max, step) => slider({
    label, left, right, min, max, step, value: design[key],
    onInput: (v) => setDesign({ [key]: v }),
    onChange: () => commit(),
  });

  function renderPanel() {
    const parts = [];
    if (tab === 'looks') {
      parts.push(h('p', { class: 'muted small' }, 'Startpunkte nach gängigen Regeln der Lächeln-Gestaltung. Danach unter „Form“ und „Farbe“ anpassen.'));
      parts.push(h('div', { class: 'looks' }, LOOKS.map((l) => h('button', {
        class: `look${sameLook(applyLook(design, l.design), design) ? ' active' : ''}`,
        onclick: () => applyDesign(applyLook(design, l.design)),
      }, h('strong', {}, l.name), h('span', { class: 'muted small' }, l.note)))));
      const favs = patient.favorites || [];
      parts.push(h('h3', {}, 'Favoriten'));
      if (!favs.length) parts.push(h('p', { class: 'muted small' }, 'Noch keine Favoriten. Gefällt ein Look, mit dem Stern speichern.'));
      parts.push(h('div', { class: 'fav-list' }, favs.map((f) => h('div', { class: 'fav-row' },
        h('button', { class: 'fav-open', onclick: () => applyDesign(f.photoId === photo.id ? { ...f.design } : applyLook(design, f.design)) }, (() => {
          const t = h('span', { class: 'thumb' });
          favThumb(f).then((u) => u && (t.style.backgroundImage = `url(${u})`));
          return t;
        })(), h('span', {}, f.name)),
        h('button', { class: 'icon-btn', 'aria-label': `${f.name} umbenennen`, onclick: async () => {
          const n = await promptSheet('Favorit umbenennen', 'Name', f.name);
          if (n) { f.name = n; flush(); updateChrome(); renderPanel(); }
        } }, icon('edit', 18)),
        h('button', { class: 'icon-btn', 'aria-label': `${f.name} löschen`, onclick: () => removeFavorite(f) }, icon('trash', 18))))));
    }
    if (tab === 'form') {
      parts.push(h('div', { class: 'label' }, 'Zahnform'));
      parts.push(h('div', { class: 'segmented forms' }, [['oval', 'Oval'], ['square', 'Eckig'], ['triangle', 'Spitz zulaufend']].map(([id, label]) => h('button', {
        class: design.form === id ? 'active' : '', onclick: () => applyDesign({ form: id }),
      }, formIcon(id), h('span', {}, label)))));
      parts.push(num('size', 'Größe', 'Kleiner', 'Größer', 0.8, 1.25, 0.01));
      parts.push(num('length', 'Länge', 'Kürzer', 'Länger', 0.8, 1.25, 0.01));
      parts.push(num('width', 'Breite', 'Schmaler', 'Breiter', 0.85, 1.15, 0.01));
      parts.push(num('edges', 'Kanten', 'Weich & rund', 'Markant & kantig', 0, 1, 0.01));
      parts.push(num('canines', 'Eckzähne', 'Rund', 'Spitz', 0, 1, 0.01));
    }
    if (tab === 'color') {
      const groups = [...new Set(SHADES.map((s) => s.group))];
      parts.push(h('p', { class: 'muted small' }, 'Farben nach VITA classical. Der Bildschirm zeigt sie nur ungefähr; die Farbe bitte mit dem Farbring bestätigen.'));
      for (const g of groups) {
        parts.push(h('div', { class: 'label' }, g === 'Bleach' ? 'Sehr hell (Bleach)' : `${g}-Farben`));
        parts.push(h('div', { class: 'shades' }, SHADES.filter((s) => s.group === g).map((s) => h('button', {
          class: `shade${design.shade === s.id ? ' active' : ''}`, 'aria-label': `Farbe ${s.id}`,
          onclick: () => applyDesign({ shade: s.id }),
        }, h('span', { class: 'swatch', style: { background: `rgb(${shadeRGB(s.id).map(Math.round).join(',')})` } }), s.id))));
      }
      parts.push(num('bright', 'Helligkeit', 'Dunkler', 'Heller', -1, 1, 0.01));
      parts.push(num('translucency', 'Schneidekante', 'Deckend', 'Transluzent', 0, 1, 0.01));
    }
    if (tab === 'details') {
      parts.push(num('curve', 'Lachlinie', 'Gerade', 'Geschwungen', 0, 1, 0.01));
      parts.push(num('step', 'Seitliche Schneidezähne', 'Gleich lang', 'Kürzer', 0, 1, 0.01));
      parts.push(num('arch', 'Zahnbogen', 'Schmal', 'Breit', 0, 1, 0.01));
      parts.push(num('gaps', 'Abstände', 'Eng', 'Kleine Lücken', 0, 1, 0.01));
      parts.push(num('diastema', 'Lücke zwischen den Einsern', 'Keine', 'Deutlich', 0, 1, 0.01));
      parts.push(num('texture', 'Oberfläche', 'Glatt & gleichmäßig', 'Natürliche Struktur', 0, 1, 0.01));
      parts.push(toggle('Untere Zähne zeigen', design.lower, (v) => applyDesign({ lower: v })));
      parts.push(toggle('Zahnfleisch zeigen', design.gum, (v) => applyDesign({ gum: v })));
    }
    if (tab === 'position') {
      parts.push(h('p', { class: 'muted small' }, 'Zähne im Foto mit dem Finger verschieben. Hier fein drehen und den Lippenrand anpassen.'));
      parts.push(num('rot', 'Drehen', 'Links', 'Rechts', -12, 12, 0.1));
      parts.push(slider({
        label: 'Lippenrand', left: 'Mehr Zähne', right: 'Weniger Zähne', min: -1.5, max: 2.5, step: 0.05, value: mouth.lip || 0,
        onInput: (v) => { interacting = true; if (!gestureBase) gestureBase = { design, mouth: structuredClone(mouth) }; mouth.lip = v; rebuild(); },
        onChange: () => commit(),
      }));
      parts.push(h('div', { class: 'row wrap' },
        h('button', { class: `btn ${editPoints ? 'primary' : 'ghost'}`, onclick: () => {
          editPoints = !editPoints;
          if (!editPoints) photo.pointsChecked = true;
          if (editPoints) zoom = 'smile';
          draw(); updateChrome(); renderPanel();
        } }, icon(editPoints ? 'check' : 'points', 20), editPoints ? 'Lippen fertig' : 'Lippen anpassen'),
        h('button', { class: 'btn ghost', onclick: () => applyDesign({ dx: 0, dy: 0, rot: 0 }) }, icon('refresh', 20), 'Position zurücksetzen'),
        h('button', { class: 'btn ghost', onclick: redetect }, icon('refresh', 20), 'Mund neu erkennen')));
      if (!mouth.auto) parts.push(h('p', { class: 'note' }, 'Kein Gesicht automatisch erkannt. Bitte die Punkte auf den inneren Lippenrand ziehen.'));
    }
    panelBody.replaceChildren(...parts);
  }

  async function redetect() {
    toast('Suche den Mund …');
    try {
      const found = await findMouth(image, image.width, image.height);
      if (!found) {
        toast('Kein Gesicht gefunden. Bitte Punkte von Hand setzen.');
        return;
      }
      gestureBase = { design, mouth: structuredClone(mouth) };
      mouth = { ...found, lip: mouth.lip || 0 };
      light = photoLight((() => { const c = h('canvas', { width: image.width, height: image.height }); const x = c.getContext('2d'); x.drawImage(image, 0, 0); return x; })(), mouth);
      lastBounds = null;
      commit();
      rebuild();
      renderPanel();
      toast('Mund erkannt');
    } catch (e) {
      console.error(e);
      toast('Erkennung nicht verfügbar');
    }
  }

  // ---- touch and mouse on the photo ------------------------------------------------------------

  const pointers = new Map();
  let drag = null;

  function local(e) {
    const r = view.getBoundingClientRect();
    return [(e.clientX - r.left) * map.dpr, (e.clientY - r.top) * map.dpr];
  }

  view.addEventListener('pointerdown', (e) => {
    if (!map || showing !== 'after') {
      if (showing !== 'after') { showing = 'after'; rebuild(); updateChrome(); }
      return;
    }
    view.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, local(e));
    if (pointers.size === 1) {
      const p = local(e);
      if (editPoints) {
        let best = -1;
        let bestD = 30 * map.dpr;
        mouth.poly.forEach((q, i) => {
          const s = toScreen(q);
          const d = Math.hypot(s[0] - p[0], s[1] - p[1]);
          if (d < bestD) { bestD = d; best = i; }
        });
        drag = best >= 0 ? { kind: 'point', index: best } : null;
      } else {
        drag = { kind: 'move', start: p, dx: design.dx, dy: design.dy };
      }
    } else if (pointers.size === 2 && !editPoints) {
      const [a, b] = [...pointers.values()];
      drag = { kind: 'pinch', dist: Math.hypot(a[0] - b[0], a[1] - b[1]), size: design.size };
    }
  });

  view.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId) || !drag) return;
    pointers.set(e.pointerId, local(e));
    const p = local(e);
    if (drag.kind === 'move') {
      const ddx = (p[0] - drag.start[0]) / map.scale;
      const ddy = (p[1] - drag.start[1]) / map.scale;
      const a = mouth.roll + (design.rot * Math.PI) / 180;
      const s = mouth.pxPerMm;
      setDesign({ dx: drag.dx + (ddx * Math.cos(a) + ddy * Math.sin(a)) / s, dy: drag.dy + (-ddx * Math.sin(a) + ddy * Math.cos(a)) / s });
    } else if (drag.kind === 'pinch' && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      setDesign({ size: Math.min(1.25, Math.max(0.8, drag.size * (d / drag.dist))) });
    } else if (drag.kind === 'point') {
      interacting = true;
      if (!gestureBase) gestureBase = { design, mouth: structuredClone(mouth) };
      mouth.poly[drag.index] = toImage(p[0], p[1]);
      if (!mouth.auto) {
        const m = mouthFromPoints(mouth.poly.slice(0, mouth.upper), mouth.poly.slice(mouth.upper));
        mouth.roll = m.roll;
        mouth.pxPerMm = m.pxPerMm;
        mouth.anchor = anchorFor(mouth.poly, mouth.upper, m.roll, m.pxPerMm);
      }
      rebuild();
    }
  });

  const end = (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size === 0) {
      if (drag?.kind === 'pinch' || drag?.kind === 'move' || drag?.kind === 'point') commit();
      drag = null;
    }
  };
  view.addEventListener('pointerup', end);
  view.addEventListener('pointercancel', end);
  view.addEventListener('wheel', (e) => {
    e.preventDefault();
    setDesign({ size: Math.min(1.25, Math.max(0.8, design.size * (e.deltaY < 0 ? 1.02 : 0.98))) });
    clearTimeout(view._wheel);
    view._wheel = setTimeout(commit, 300);
  }, { passive: false });

  renderTabs();
  renderPanel();
  updateChrome();
  requestAnimationFrame(draw);

  return { flush, get design() { return design; }, get mouth() { return mouth; } };
}
