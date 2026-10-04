// The try-on screen: the patient's photo with the new teeth, and a few simple controls.

import { h, icon, toast, promptSheet, confirmSheet, uid } from './ui.js';
import { photoLight, mouthBounds, splinePath, lipOutline } from './render.js';
import { DEFAULT_DESIGN } from './teeth.js';
import { shadeRGB } from './shades.js';
import { LOOKS, applyLook, PLACEMENT } from './looks.js';
import { PHOTO_SHADES } from './catalog.js';
import { catalog, ensureSource, paintSmile, sourceId, isOwn } from './smile.js';
import { cropAround, composite, toBlob } from './exporter.js';
import { findMouth, mouthFromPoints, anchorFor } from './face.js';
import { t, tr } from './i18n.js';

const LOOK_KEYS = [...Object.keys(DEFAULT_DESIGN).filter((k) => !PLACEMENT.includes(k)), 'source'];
const sameLook = (a, b) => LOOK_KEYS.every((k) => (typeof a[k] === 'number' ? Math.abs(a[k] - (b[k] ?? 0)) < 1e-6 : (a[k] ?? null) === (b[k] ?? null)));

// The drawn models offered next to the real photos.
const MODEL_LOOKS = ['natural', 'hollywood', 'strong'];
const MODEL_NAMES = {
  natural: { de: 'Natürlich', en: 'Natural' },
  hollywood: { de: 'Hollywood', en: 'Hollywood' },
  strong: { de: 'Markant', en: 'Bold' },
};

// Size, width, length and brightness are the only shape controls: the catalogue photo brings the form.
const SIMPLE = { size: 1, width: 1, length: 1, bright: 0 };

export const photoDesign = (id) => ({ ...DEFAULT_DESIGN, ...SIMPLE, source: `photo:${id}`, shade: 'original' });

function slider({ label, left, right, min, max, step = 0.01, value, onInput, onChange }) {
  const input = h('input', { type: 'range', min, max, step, value, 'aria-label': label });
  input.addEventListener('input', () => onInput(Number(input.value)));
  input.addEventListener('change', () => onChange(Number(input.value)));
  return h('div', { class: 'slider' },
    h('div', { class: 'slider-label' }, label),
    input,
    h('div', { class: 'slider-ends' }, h('span', {}, left), h('span', {}, right)));
}

export async function openEditor(root, ctx) {
  const { patient, photo, image } = ctx;
  let design = { ...DEFAULT_DESIGN, ...photo.design };
  let mouth = structuredClone(photo.mouth);
  let history = [];
  let future = [];
  let gestureBase = null;
  let showing = 'after';
  let zoom = 'face';
  let editPoints = !mouth.auto && !photo.pointsChecked;
  let tab = editPoints ? 'position' : 'teeth';
  let light = null;

  await ensureSource(design);

  // Full-size picture: photo with the teeth drawn in.
  const full = h('canvas', { width: image.width, height: image.height });
  const fctx = full.getContext('2d', { willReadFrequently: true });
  fctx.drawImage(image, 0, 0);
  light = photoLight(fctx, mouth);

  const view = h('canvas', { class: 'view', 'aria-label': t('photoWithTeeth') });
  const vctx = view.getContext('2d');
  const badge = h('div', { class: 'badge' });
  const hint = h('div', { class: 'hint' });
  const zoomBtn = h('button', { class: 'fab', 'aria-label': t('switchView'), onclick: () => { zoom = zoom === 'face' ? 'smile' : 'face'; draw(); updateChrome(); } });
  const stage = h('div', { class: 'stage' }, view, badge, hint, zoomBtn);
  const strip = h('div', { class: 'strip', role: 'tablist', 'aria-label': t('favorites') });
  const panelBody = h('div', { class: 'panel-body' });
  const tabs = h('div', { class: 'tabs', role: 'tablist' });
  const undoBtn = h('button', { class: 'icon-btn', 'aria-label': t('undo'), onclick: undo }, icon('undo'));
  const redoBtn = h('button', { class: 'icon-btn', 'aria-label': t('redo'), onclick: redo }, icon('redo'));

  const screen = h('div', { class: 'screen editor' },
    h('header', { class: 'topbar' },
      h('button', { class: 'icon-btn', 'aria-label': t('back'), onclick: () => { flush(); ctx.onBack(); } }, icon('back')),
      h('div', { class: 'title' }, h('strong', {}, patient.name), h('span', { class: 'muted small' }, t('tryOn'))),
      h('div', { class: 'spacer' }),
      undoBtn, redoBtn,
      h('button', { class: 'btn ghost', onclick: saveFavorite }, icon('star', 20), h('span', { class: 'hide-sm' }, t('asFavorite'))),
      h('button', { class: 'btn primary', onclick: () => { flush(); ctx.onExport(design, mouth); } }, icon('share', 20), h('span', { class: 'hide-sm' }, t('share')))),
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
    if (showing === 'after') paintSmile(fctx, mouth, design, light, { fast: interacting });
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
    const brand = getComputedStyle(document.documentElement).getPropertyValue('--brand').trim() || '#e4761e';
    vctx.save();
    vctx.lineWidth = 1.5 * map.dpr;
    vctx.strokeStyle = 'rgba(255,255,255,0.9)';
    vctx.setLineDash([5 * map.dpr, 4 * map.dpr]);
    vctx.stroke(splinePath(lips));
    vctx.setLineDash([]);
    for (const p of mouth.poly.map(toScreen)) {
      vctx.beginPath();
      vctx.arc(p[0], p[1], 7 * map.dpr, 0, Math.PI * 2);
      vctx.fillStyle = brand;
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

  async function restore(snap) {
    await ensureSource(snap.design);
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

  async function applyDesign(next) {
    await ensureSource(next);
    setDesign(next);
    commit();
    renderPanel();
  }

  // A favourite from another photo keeps this photo's position.
  const favDesign = (f) => (f.photoId === photo.id ? { ...f.design } : applyLook(design, { ...f.design, source: f.design.source ?? null }));

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
    if (onRemove) el.addEventListener('contextmenu', (e) => { e.preventDefault(); onRemove(); });
    return el;
  }

  function updateChrome() {
    undoBtn.disabled = !history.length;
    redoBtn.disabled = !future.length;
    badge.textContent = showing === 'after' ? t('after') : t('before');
    badge.className = `badge ${showing}`;
    zoomBtn.replaceChildren(icon(zoom === 'face' ? 'zoom' : 'unzoom'), h('span', {}, zoom === 'face' ? t('viewSmile') : t('viewFace')));
    hint.textContent = editPoints ? t('hintPoints') : t('hintMove');
    hint.hidden = showing !== 'after';
    const favs = patient.favorites || [];
    const activeFav = favs.find((f) => sameLook(f.design, design));
    strip.replaceChildren(
      stripItem(t('before'), showing === 'before', () => { showing = 'before'; rebuild(); updateChrome(); }, null),
      stripItem(t('current'), showing === 'after' && !activeFav, () => { showing = 'after'; rebuild(); updateChrome(); }, null),
      ...favs.map((f) => stripItem(f.name, showing === 'after' && f === activeFav, () => applyDesign(favDesign(f)), favThumb(f), () => removeFavorite(f))),
      h('button', { class: 'chip add', onclick: saveFavorite, 'aria-label': t('saveFavorite') }, icon('star', 18), h('span', { class: 'chip-label' }, t('save'))),
    );
  }

  async function saveFavorite() {
    const favs = (patient.favorites ||= []);
    const existing = favs.find((f) => sameLook(f.design, design));
    if (existing) {
      toast(t('alreadySaved', { name: existing.name }));
      return;
    }
    const name = await promptSheet(t('favoriteSave'), t('name'), t('lookN', { n: favs.length + 1 }));
    if (!name) return;
    const fav = { id: uid(), name, design: { ...design }, photoId: photo.id, created: new Date().toISOString() };
    // Thumbnail: the smile close-up with these teeth.
    const pic = composite(image, mouth, design, true);
    const area = cropAround(mouth, image, 'smile');
    const c = h('canvas', { width: 240, height: Math.round((240 * area.h) / area.w) });
    c.getContext('2d').drawImage(pic, area.x, area.y, area.w, area.h, 0, 0, c.width, c.height);
    await ctx.putFavThumb(fav.id, await toBlob(c, 'image/jpeg', 0.85));
    favs.push(fav);
    flush();
    toast(t('favoriteSaved', { name }));
    updateChrome();
    if (tab === 'teeth') renderPanel();
  }

  async function removeFavorite(fav) {
    if (!(await confirmSheet(t('deleteFavQ'), t('deleteFavNote', { name: fav.name }), t('delete'), { danger: true }))) return;
    patient.favorites = patient.favorites.filter((f) => f !== fav);
    ctx.deleteFavThumb(fav.id);
    flush();
    updateChrome();
    renderPanel();
  }

  // ---- controls -----------------------------------------------------------------------------

  const TABS = [['teeth', 'tabTeeth'], ['adjust', 'tabAdjust'], ['position', 'tabPosition']];

  function renderTabs() {
    tabs.replaceChildren(...TABS.map(([id, key]) => h('button', {
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
    }, t(key))));
  }

  const num = (key, label, left, right, min, max, step) => slider({
    label, left, right, min, max, step, value: design[key],
    onInput: (v) => setDesign({ [key]: v }),
    onChange: () => commit(),
  });

  function catalogCard(entry) {
    const active = sourceId(design) === entry.id;
    const pic = h('span', { class: 'cat-pic' });
    ctx.catalogImage(entry).then((u) => u && (pic.style.backgroundImage = `url(${u})`));
    return h('button', {
      class: `cat-card${active ? ' active' : ''}`, 'aria-pressed': String(active),
      onclick: () => applyDesign({ ...design, ...(sourceId(design) ? {} : SIMPLE), source: `photo:${entry.id}`, shade: PHOTO_SHADES.includes(design.shade) ? design.shade : 'original' }),
    }, pic, h('span', { class: 'cat-name' }, tr(entry.name)), isOwn(entry.id) ? h('span', { class: 'cat-tag' }, t('ownTag')) : null);
  }

  function renderPanel() {
    const parts = [];
    if (tab === 'teeth') {
      parts.push(h('h3', {}, t('catalogPhotos')));
      parts.push(h('div', { class: 'cat-grid' },
        catalog().map(catalogCard),
        h('button', { class: 'cat-card add', onclick: () => { flush(); ctx.onAddCatalog(); } }, icon('plus', 26), h('span', { class: 'cat-name' }, t('addToCatalog')), h('span', { class: 'muted small' }, t('addToCatalogNote')))));
      parts.push(h('h3', {}, t('catalogModels')));
      parts.push(h('div', { class: 'looks' }, MODEL_LOOKS.map((id) => {
        const look = LOOKS.find((l) => l.id === id);
        const next = applyLook(design, { ...look.design, source: null });
        return h('button', { class: `look${sameLook(next, design) ? ' active' : ''}`, onclick: () => applyDesign(next) }, h('strong', {}, tr(MODEL_NAMES[id])));
      })));
      const favs = patient.favorites || [];
      parts.push(h('h3', {}, t('favorites')));
      if (!favs.length) parts.push(h('p', { class: 'muted small' }, t('noFavs')));
      parts.push(h('div', { class: 'fav-list' }, favs.map((f) => h('div', { class: 'fav-row' },
        h('button', { class: 'fav-open', onclick: () => applyDesign(favDesign(f)) }, (() => {
          const th = h('span', { class: 'thumb' });
          favThumb(f).then((u) => u && (th.style.backgroundImage = `url(${u})`));
          return th;
        })(), h('span', {}, f.name)),
        h('button', { class: 'icon-btn', 'aria-label': t('renameFav'), onclick: async () => {
          const n = await promptSheet(t('renameFav'), t('name'), f.name);
          if (n) { f.name = n; flush(); updateChrome(); renderPanel(); }
        } }, icon('edit', 18)),
        h('button', { class: 'icon-btn', 'aria-label': t('delete'), onclick: () => removeFavorite(f) }, icon('trash', 18))))));
    }
    if (tab === 'adjust') {
      const photoMode = Boolean(sourceId(design));
      parts.push(h('div', { class: 'label' }, t('color')));
      parts.push(h('div', { class: 'shades' }, PHOTO_SHADES.filter((s) => photoMode || s !== 'original').map((s) => h('button', {
        class: `shade${design.shade === s ? ' active' : ''}`, 'aria-label': `${t('color')} ${s === 'original' ? t('shadeOriginal') : s}`,
        onclick: () => applyDesign({ shade: s }),
      }, h('span', { class: `swatch${s === 'original' ? ' original' : ''}`, style: s === 'original' ? {} : { background: `rgb(${shadeRGB(s).map(Math.round).join(',')})` } }), s === 'original' ? t('shadeOriginal') : s))));
      parts.push(h('p', { class: 'muted small' }, t('shadeNote')));
      parts.push(num('size', t('size'), t('smaller'), t('bigger'), 0.8, 1.25, 0.01));
      parts.push(num('width', t('width'), t('narrower'), t('wider'), 0.85, 1.15, 0.01));
      parts.push(num('length', t('length'), t('shorter'), t('longer'), 0.8, 1.25, 0.01));
      parts.push(num('bright', t('brightness'), t('darker'), t('brighter'), -1, 1, 0.01));
      parts.push(h('div', { class: 'row wrap' },
        h('button', { class: 'btn ghost', onclick: () => applyDesign({ ...SIMPLE, shade: photoMode ? 'original' : design.shade }) }, icon('refresh', 20), t('resetAdjust'))));
    }
    if (tab === 'position') {
      parts.push(h('p', { class: 'muted small' }, t('positionNote')));
      parts.push(num('rot', t('rotate'), t('left'), t('right'), -12, 12, 0.1));
      parts.push(slider({
        label: t('lipEdge'), left: t('moreTeeth'), right: t('fewerTeeth'), min: -1.5, max: 2.5, step: 0.05, value: mouth.lip || 0,
        onInput: (v) => { interacting = true; if (!gestureBase) gestureBase = { design, mouth: structuredClone(mouth) }; mouth.lip = v; rebuild(); },
        onChange: () => commit(),
      }));
      parts.push(h('div', { class: 'row wrap' },
        h('button', { class: `btn ${editPoints ? 'primary' : 'ghost'}`, onclick: () => {
          editPoints = !editPoints;
          if (!editPoints) photo.pointsChecked = true;
          if (editPoints) zoom = 'smile';
          draw(); updateChrome(); renderPanel();
        } }, icon(editPoints ? 'check' : 'points', 20), editPoints ? t('lipsDone') : t('lipsAdjust')),
        h('button', { class: 'btn ghost', onclick: () => applyDesign({ dx: 0, dy: 0, rot: 0 }) }, icon('refresh', 20), t('resetPosition')),
        h('button', { class: 'btn ghost', onclick: redetect }, icon('refresh', 20), t('redetect'))));
      if (!mouth.auto) parts.push(h('p', { class: 'note' }, t('noFaceNote')));
    }
    panelBody.replaceChildren(...parts);
  }

  async function redetect() {
    toast(t('searchingMouth'));
    try {
      const found = await findMouth(image, image.width, image.height);
      if (!found) {
        toast(t('noFaceManual'));
        return;
      }
      gestureBase = { design, mouth: structuredClone(mouth) };
      mouth = { ...found, lip: mouth.lip || 0 };
      const c = h('canvas', { width: image.width, height: image.height });
      const x = c.getContext('2d');
      x.drawImage(image, 0, 0);
      light = photoLight(x, mouth);
      lastBounds = null;
      commit();
      rebuild();
      renderPanel();
      toast(t('mouthFound'));
    } catch (e) {
      console.error(e);
      toast(t('detectUnavailable'));
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
