// Smile Studio: lock screen, patients, photos, try-on and sharing.

import * as store from './store.js';
import { BRAND } from './brand.js';
import { h, icon, toast, sheet, confirmSheet, uid, formatDate } from './ui.js';
import { openEditor, photoDesign } from './editor.js';
import { findMouth, defaultMouth } from './face.js';
import { BUILT_IN, PHOTO_SHADES } from './catalog.js';
import { setCatalog, ensureSource, dropSource } from './smile.js';
import { splinePath } from './render.js';
import { t, tr, getLang, setLang } from './i18n.js';
import { buildExport, toBlob, fileName, canShareFiles, shareFiles, download } from './exporter.js';

const app = document.getElementById('app');
let state = null;
let editor = null;
const thumbs = new Map(); // id -> object URL, cleared on lock

// ---- saving ------------------------------------------------------------------------------------

let saving = Promise.resolve();
function save() {
  saving = saving.then(() => store.save(state)).catch((e) => {
    console.error(e);
    toast(t('saveFailed'));
  });
  return saving;
}

// ---- lock --------------------------------------------------------------------------------------

let idleTimer = null;
function resetIdle() {
  clearTimeout(idleTimer);
  if (!state) return;
  const minutes = state.settings?.lockMinutes ?? 5;
  if (minutes > 0) idleTimer = setTimeout(lockNow, minutes * 60000);
}
['pointerdown', 'keydown'].forEach((ev) => document.addEventListener(ev, resetIdle, { passive: true }));

async function lockNow() {
  editor?.flush();
  editor = null;
  await saving;
  state = null;
  store.lock();
  for (const u of thumbs.values()) URL.revokeObjectURL(u);
  thumbs.clear();
  document.querySelectorAll('.backdrop').forEach((b) => b.remove());
  showLock();
}

function brandMark(small) {
  if (BRAND.logo) return h('img', { class: `logo${small ? ' small' : ''}`, src: BRAND.logo, alt: BRAND.name });
  return h('div', { class: `wordmark${small ? ' small' : ''}` },
    h('span', { class: 'mark', html: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M9 5c-3 0-5 2.5-5 6.5 0 3.5 1.6 6 2.4 9.5.7 3.2 1.2 6 2.9 6 1.6 0 1.8-3.4 2.6-6 .5-1.7 1.3-2.5 4.1-2.5s3.6.8 4.1 2.5c.8 2.6 1 6 2.6 6 1.7 0 2.2-2.8 2.9-6 .8-3.5 2.4-6 2.4-9.5C28 7.5 26 5 23 5c-2.6 0-4.3 1.6-7 1.6S11.6 5 9 5z" fill="currentColor"/></svg>' }),
    h('span', { class: 'names' }, h('strong', {}, BRAND.name), h('span', {}, BRAND.app)));
}

async function showLock() {
  const exists = await store.hasVault();
  let first = null;
  let code = '';
  const dots = h('div', { class: 'dots', 'aria-hidden': 'true' });
  const msg = h('p', { class: 'muted' });
  const title = h('h1', {});
  const setTexts = () => {
    if (exists) {
      title.textContent = t('enterCode');
      msg.textContent = t('enterCodeNote');
    } else if (!first) {
      title.textContent = t('setCode');
      msg.textContent = t('setCodeNote');
    } else {
      title.textContent = t('repeatCode');
      msg.textContent = '';
    }
  };
  const paint = () => {
    dots.replaceChildren(...Array.from({ length: Math.max(6, code.length) }, (_, i) => h('span', { class: i < code.length ? 'on' : '' })));
  };
  let busy = false;
  const submit = async () => {
    if (busy) return;
    if (code.length < (exists ? 4 : 6)) {
      msg.textContent = t('codeTooShort');
      return;
    }
    busy = true;
    if (exists) {
      msg.textContent = t('unlocking');
      const s = await store.unlock(code);
      busy = false;
      if (!s) {
        code = '';
        paint();
        msg.textContent = t('wrongCode');
        dots.classList.add('shake');
        setTimeout(() => dots.classList.remove('shake'), 400);
        return;
      }
      state = s;
      opened();
      resetIdle();
      showPatients();
    } else if (!first) {
      first = code;
      code = '';
      busy = false;
      setTexts();
      paint();
    } else if (first !== code) {
      first = null;
      code = '';
      busy = false;
      setTexts();
      msg.textContent = t('codesDiffer');
      paint();
    } else {
      msg.textContent = t('settingUp');
      state = store.emptyState();
      await store.create(code, state);
      opened();
      busy = false;
      resetIdle();
      showPatients();
    }
  };
  const press = (k) => {
    if (busy) return;
    if (k === 'del') code = code.slice(0, -1);
    else if (k === 'ok') return submit();
    else if (code.length < 12) code += k;
    paint();
  };
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'ok'];
  const pad = h('div', { class: 'keypad' }, keys.map((k) => h('button', {
    class: `key${k === 'ok' ? ' ok' : ''}`, 'aria-label': k === 'del' ? t('delete') : k === 'ok' ? t('confirm') : k,
    onclick: () => press(k),
  }, k === 'del' ? '⌫' : k === 'ok' ? icon('check', 26) : k)));
  setTexts();
  paint();
  app.replaceChildren(h('div', { class: 'screen lock' }, h('div', { class: 'lock-lang' }, langToggle(showLock)), h('div', { class: 'lock-box' }, brandMark(), title, dots, msg, pad)));
  const onKey = (e) => {
    if (!app.querySelector('.lock')) return document.removeEventListener('keydown', onKey);
    if (/^\d$/.test(e.key)) press(e.key);
    else if (e.key === 'Backspace') press('del');
    else if (e.key === 'Enter') press('ok');
  };
  document.addEventListener('keydown', onKey);
}

// ---- images ------------------------------------------------------------------------------------

async function imageURL(id) {
  if (thumbs.has(id)) return thumbs.get(id);
  const blob = await store.getImage(id);
  if (!blob) return null;
  const u = URL.createObjectURL(blob);
  thumbs.set(id, u);
  return u;
}

function thumbEl(id, cls = 'thumb') {
  const el = h('span', { class: cls });
  if (id) imageURL(id).then((u) => u && (el.style.backgroundImage = `url(${u})`));
  return el;
}

async function loadPhoto(id) {
  const blob = await store.getImage(id);
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  c.getContext('2d').drawImage(bmp, 0, 0);
  bmp.close?.();
  return c;
}

// Scales a picture from the camera or library down to a sensible size, upright.
async function prepare(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const max = 2200;
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  const t = document.createElement('canvas');
  const tk = 420 / Math.max(c.width, c.height);
  t.width = Math.round(c.width * tk);
  t.height = Math.round(c.height * tk);
  t.getContext('2d').drawImage(c, 0, 0, t.width, t.height);
  return { canvas: c, full: await toBlob(c, 'image/jpeg', 0.92), thumb: await toBlob(t, 'image/jpeg', 0.8) };
}

async function addPhoto(patient, file) {
  if (!patient.consent) {
    const ok = await confirmSheet(t('consent'), t('consentAsk', { name: patient.name }), t('consentYes'));
    if (!ok) return;
    patient.consent = new Date().toISOString();
  }
  const busy = sheet(t('preparingPhoto'), h('div', { class: 'center' }, h('div', { class: 'spinner' }), h('p', { class: 'muted' }, t('preparingNote'))));
  try {
    const { canvas, full, thumb } = await prepare(file);
    let mouth = null;
    try {
      mouth = await findMouth(canvas, canvas.width, canvas.height);
    } catch (e) {
      console.error(e);
    }
    const id = uid();
    await store.putImage(id, full);
    await store.putImage(`${id}-t`, thumb);
    const photo = {
      id,
      thumb: `${id}-t`,
      w: canvas.width,
      h: canvas.height,
      created: new Date().toISOString(),
      mouth: mouth || defaultMouth(canvas.width, canvas.height),
      design: photoDesign(BUILT_IN[0].id),
    };
    patient.photos.unshift(photo);
    patient.updated = photo.created;
    await save();
    busy.close();
    if (!mouth) toast(t('noFace'));
    showEditor(patient, photo);
  } catch (e) {
    console.error(e);
    busy.close();
    toast(t('unreadable'));
  }
}

function pickPhoto(patient, camera) {
  pickFile(camera, (f) => addPhoto(patient, f));
}

function pickFile(camera, then) {
  const input = h('input', { type: 'file', accept: 'image/*', ...(camera ? { capture: 'user' } : {}), style: { display: 'none' } });
  input.addEventListener('change', () => {
    const f = input.files?.[0];
    input.remove();
    if (f) then(f);
  });
  document.body.append(input);
  input.click();
}

// ---- patients ----------------------------------------------------------------------------------

function topbar(left, title, right = []) {
  return h('header', { class: 'topbar' }, left, h('div', { class: 'title' }, title), h('div', { class: 'spacer' }), ...right);
}

function showPatients(query = '') {
  editor = null;
  const list = h('div', { class: 'patients' });
  const search = h('input', { class: 'field search', type: 'search', placeholder: t('searchPatient'), value: query, 'aria-label': t('searchPatient') });
  const paint = () => {
    const q = search.value.trim().toLowerCase();
    const items = state.patients
      .filter((p) => !q || p.name.toLowerCase().includes(q))
      .sort((a, b) => (b.updated || b.created).localeCompare(a.updated || a.created));
    if (!state.patients.length) {
      list.replaceChildren(h('div', { class: 'empty' },
        h('h2', {}, t('welcome')),
        h('p', { class: 'muted' }, t('welcomeNote')),
        h('button', { class: 'btn primary big', onclick: () => editPatient() }, icon('plus'), t('newPatient'))));
      return;
    }
    list.replaceChildren(...items.map((p) => h('button', { class: 'patient-card', onclick: () => showPatient(p) },
      thumbEl(p.photos[0]?.thumb, 'thumb big'),
      h('span', { class: 'patient-info' },
        h('strong', {}, p.name),
        h('span', { class: 'muted small' }, `${p.photos.length === 1 ? t('photoCount') : t('photosCount', { n: p.photos.length })} · ${t('favCount', { n: (p.favorites || []).length })}`),
        h('span', { class: 'muted small' }, t('lastChanged', { date: formatDate(p.updated || p.created) }))))));
    if (!items.length) list.replaceChildren(h('p', { class: 'muted center' }, t('noPatientFound')));
  };
  search.addEventListener('input', paint);
  current = () => showPatients(search.value);
  app.replaceChildren(h('div', { class: 'screen' },
    topbar(brandMark(true), '', [
      langToggle(() => current()),
      h('button', { class: 'icon-btn', 'aria-label': t('lock'), onclick: lockNow }, icon('lock')),
      h('button', { class: 'icon-btn', 'aria-label': t('settings'), onclick: showSettings }, icon('settings')),
    ]),
    h('main', { class: 'content' },
      h('div', { class: 'row between' }, h('h1', {}, t('patients')), h('button', { class: 'btn primary', onclick: () => editPatient() }, icon('plus'), t('newPatient'))),
      state.patients.length ? search : null,
      list)));
  paint();
}

function editPatient(patient) {
  const isNew = !patient;
  const p = patient || { id: uid(), name: '', email: '', phone: '', notes: '', consent: null, photos: [], favorites: [], created: new Date().toISOString() };
  const name = h('input', { class: 'field', value: p.name, required: true, autocomplete: 'off' });
  const email = h('input', { class: 'field', type: 'email', value: p.email || '', autocomplete: 'off' });
  const phone = h('input', { class: 'field', type: 'tel', value: p.phone || '', autocomplete: 'off' });
  const notes = h('textarea', { class: 'field', rows: 3 }, p.notes || '');
  const consent = h('input', { type: 'checkbox', checked: Boolean(p.consent) });
  const s = sheet(isNew ? t('newPatient') : t('editPatient'), h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      if (!name.value.trim()) return name.focus();
      p.name = name.value.trim();
      p.email = email.value.trim();
      p.phone = phone.value.trim();
      p.notes = notes.value.trim();
      p.consent = consent.checked ? (p.consent || new Date().toISOString()) : null;
      p.updated = new Date().toISOString();
      if (isNew) state.patients.push(p);
      await save();
      s.close();
      showPatient(p);
    },
  },
  h('label', { class: 'label' }, t('name'), name),
  h('div', { class: 'grid2' }, h('label', { class: 'label' }, t('email'), email), h('label', { class: 'label' }, t('phone'), phone)),
  h('label', { class: 'label' }, t('note'), notes),
  h('label', { class: 'check' }, consent, h('span', {}, t('consentGiven'))),
  h('div', { class: 'row end' },
    h('button', { type: 'button', class: 'btn ghost', onclick: () => s.close() }, t('cancel')),
    h('button', { class: 'btn primary' }, isNew ? t('create') : t('save')))));
  setTimeout(() => name.focus(), 50);
}

function showPatient(p) {
  editor = null;
  current = () => showPatient(p);
  const photos = h('div', { class: 'photos' },
    h('button', { class: 'photo-add', onclick: () => pickPhoto(p, true) }, icon('camera', 30), h('strong', {}, t('takePhoto')), h('span', { class: 'muted small' }, t('takePhotoNote'))),
    h('button', { class: 'photo-add', onclick: () => pickPhoto(p, false) }, icon('image', 30), h('strong', {}, t('uploadPhoto')), h('span', { class: 'muted small' }, t('uploadPhotoNote'))),
    ...p.photos.map((ph) => h('div', { class: 'photo' },
      h('button', { class: 'photo-open', onclick: () => showEditor(p, ph), 'aria-label': t('openPhoto') }, thumbEl(ph.thumb, 'thumb fill')),
      h('div', { class: 'photo-meta' }, h('span', { class: 'small muted' }, formatDate(ph.created)),
        h('button', { class: 'icon-btn small', 'aria-label': t('deletePhoto'), onclick: async () => {
          if (!(await confirmSheet(t('deletePhotoQ'), t('deletePhotoNote'), t('delete'), { danger: true }))) return;
          p.photos = p.photos.filter((x) => x !== ph);
          await store.deleteImage(ph.id);
          await store.deleteImage(ph.thumb);
          await save();
          showPatient(p);
        } }, icon('trash', 18))))));
  const favs = (p.favorites || []);
  app.replaceChildren(h('div', { class: 'screen' },
    topbar(h('button', { class: 'icon-btn', 'aria-label': t('back'), onclick: () => showPatients() }, icon('back')), h('strong', {}, p.name), [
      h('button', { class: 'btn ghost', onclick: () => editPatient(p) }, icon('edit', 20), h('span', { class: 'hide-sm' }, t('edit'))),
    ]),
    h('main', { class: 'content' },
      h('div', { class: 'patient-head' },
        h('div', {}, h('h1', {}, p.name),
          h('p', { class: 'muted small' }, [p.email, p.phone].filter(Boolean).join(' · ') || t('noContact')),
          p.notes ? h('p', { class: 'small' }, p.notes) : null,
          h('p', { class: 'small muted' }, p.consent ? t('consentFrom', { date: formatDate(p.consent) }) : t('consentMissing')))),
      h('h2', {}, t('photos')),
      photos,
      favs.length ? h('h2', {}, t('favorites')) : null,
      favs.length ? h('div', { class: 'fav-grid' }, favs.map((f) => {
        const ph = p.photos.find((x) => x.id === f.photoId) || p.photos[0];
        return h('button', { class: 'fav-card', onclick: () => ph && showEditor(p, ph, f) }, thumbEl(`fav-${f.id}`, 'thumb wide'), h('span', {}, f.name));
      })) : null,
      h('div', { class: 'danger-zone' }, h('button', { class: 'btn ghost danger-text', onclick: async () => {
        if (!(await confirmSheet(t('deletePatientQ'), t('deletePatientNote', { name: p.name }), t('delete'), { danger: true }))) return;
        for (const ph of p.photos) { await store.deleteImage(ph.id); await store.deleteImage(ph.thumb); }
        for (const f of favs) await store.deleteImage(`fav-${f.id}`);
        state.patients = state.patients.filter((x) => x !== p);
        await save();
        showPatients();
      } }, icon('trash', 18), t('deletePatient'))))));
}

async function showEditor(patient, photo, favorite) {
  current = () => { editor?.flush(); showEditor(patient, photo); };
  app.replaceChildren(h('div', { class: 'screen center' }, h('div', { class: 'spinner' })));
  const image = await loadPhoto(photo.id);
  if (favorite) photo.design = { ...photo.design, ...favorite.design, ...(favorite.photoId === photo.id ? {} : { dx: photo.design.dx, dy: photo.design.dy, rot: photo.design.rot }) };
  editor = await openEditor(app, {
    patient,
    photo,
    image,
    thumbs,
    save,
    onBack: () => showPatient(patient),
    onExport: (design, mouth) => showExport(patient, photo, image, design, mouth),
    getFavThumb: (id) => store.getImage(`fav-${id}`),
    putFavThumb: async (id, blob) => {
      await store.putImage(`fav-${id}`, blob);
      const old = thumbs.get(`fav-${id}`);
      if (old) URL.revokeObjectURL(old);
      thumbs.delete(`fav-${id}`);
    },
    deleteFavThumb: (id) => store.deleteImage(`fav-${id}`),
    catalogImage,
    onAddCatalog: () => pickFile(false, (f) => showCatalogSetup(f, (entry) => {
      photo.design = { ...photo.design, source: `photo:${entry.id}`, shade: PHOTO_SHADES.includes(photo.design.shade) ? photo.design.shade : 'original' };
      save();
      showEditor(patient, photo);
    }, () => showEditor(patient, photo))),
  });
}

// ---- sharing ----

let logoImage;
async function brandLogo() {
  if (!BRAND.logo) return null;
  if (logoImage === undefined) {
    logoImage = new Image();
    logoImage.src = BRAND.logo;
    await logoImage.decode().catch(() => (logoImage = null));
  }
  return logoImage;
}

async function showExport(patient, photo, image, design, mouth) {
  await ensureSource(design);
  const fav = (patient.favorites || []).find((f) => JSON.stringify(f.design) === JSON.stringify(design));
  let kind = 'compare';
  const preview = h('img', { class: 'export-preview', alt: t('preview') });
  let current = null;
  const kinds = [['compare', t('kindCompare')], ['after', t('kindAfter')], ['smile', t('kindSmile')]];
  const seg = h('div', { class: 'segmented' });
  const paint = async () => {
    seg.replaceChildren(...kinds.map(([id, label]) => h('button', { class: kind === id ? 'active' : '', onclick: () => { kind = id; paint(); } }, label)));
    const c = buildExport(image, mouth, design, kind, { lookName: fav?.name, patientName: patient.name, logo: await brandLogo() });
    const blob = await toBlob(c);
    if (preview.src) URL.revokeObjectURL(preview.src);
    preview.src = URL.createObjectURL(blob);
    current = new File([blob], fileName(patient.name, kind), { type: 'image/jpeg' });
  };
  const text = t('shareText', { brand: BRAND.name, disclaimer: t('disclaimer') });
  const share = async () => {
    if (!current) return;
    if (canShareFiles(current)) {
      try {
        await shareFiles([current], text);
      } catch (e) {
        if (e.name !== 'AbortError') toast(t('shareFailed'));
      }
    } else {
      download(current, current.name);
      toast(t('imageSaved'));
    }
  };
  const mail = async () => {
    if (!current) return;
    if (patient.email) {
      try { await navigator.clipboard.writeText(patient.email); toast(t('emailCopied', { email: patient.email })); } catch { /* not allowed */ }
    }
    if (canShareFiles(current)) {
      try {
        await shareFiles([current], text);
      } catch (e) {
        if (e.name !== 'AbortError') toast(t('shareFailed'));
      }
    } else {
      download(current, current.name);
      const subject = encodeURIComponent(t('mailSubject', { brand: BRAND.name }));
      const body = encodeURIComponent(t('mailBody', { name: patient.name, disclaimer: t('disclaimer'), brand: BRAND.name }));
      location.href = `mailto:${encodeURIComponent(patient.email || '')}?subject=${subject}&body=${body}`;
      toast(t('imageSavedAttach'));
    }
  };
  sheet(t('shareImage'), h('div', { class: 'export' },
    seg, preview,
    h('p', { class: 'muted small' }, t('shareNote')),
    h('div', { class: 'row end wrap' },
      h('button', { class: 'btn ghost', onclick: () => current && (download(current, current.name), toast(t('imageSaved'))) }, icon('download', 20), t('save')),
      h('button', { class: 'btn ghost', onclick: mail }, icon('mail', 20), patient.email ? t('emailTo', { email: patient.email }) : t('byEmail')),
      h('button', { class: 'btn primary', onclick: share }, icon('share', 20), t('share')))), { wide: true });
  paint();
}

// ---- settings ----------------------------------------------------------------------------------

function showSettings() {
  const lockSel = h('select', { class: 'field' }, [[1, 'min1'], [5, 'min5'], [15, 'min15'], [60, 'hour1']].map(([v, l]) => h('option', { value: v, selected: (state.settings.lockMinutes ?? 5) === v }, t(l))));
  lockSel.addEventListener('change', async () => {
    state.settings.lockMinutes = Number(lockSel.value);
    await save();
    resetIdle();
    toast(t('saved'));
  });
  const fileIn = h('input', { type: 'file', accept: 'application/json,.json', style: { display: 'none' } });
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files?.[0];
    if (!f) return;
    const code = prompt(t('backupCode'));
    if (!code) return;
    try {
      const backup = await store.readBackup(await f.text(), code);
      if (!backup) return toast(t('backupWrongCode'));
      if (!(await confirmSheet(t('loadBackupQ'), t('loadBackupNote'), t('load'), { danger: true }))) return;
      await store.restore(backup);
      state = backup.state;
      thumbs.clear();
      opened();
      s.close();
      showPatients();
      toast(t('backupLoaded'));
    } catch (e) {
      console.error(e);
      toast(t('notABackup'));
    }
  });
  const own = state.catalog || [];
  const s = sheet(t('settings'), h('div', { class: 'settings' },
    h('div', { class: 'label' }, t('language'), langToggle(() => { s.close(); current(); showSettings(); })),
    h('label', { class: 'label' }, t('autoLock'), lockSel),
    h('h3', {}, t('catalogTitle')),
    h('p', { class: 'muted small' }, own.length ? t('catalogOwnNote') : t('catalogEmptyOwn')),
    h('div', { class: 'cat-list' }, own.map((e) => h('div', { class: 'cat-row' },
      (() => { const th = h('span', { class: 'thumb' }); catalogImage(e).then((u) => u && (th.style.backgroundImage = `url(${u})`)); return th; })(),
      h('span', { class: 'cat-row-name' }, tr(e.name)),
      h('button', { class: 'icon-btn', 'aria-label': `${t('remove')}: ${tr(e.name)}`, onclick: async () => {
        if (!(await confirmSheet(t('catalogRemoveQ'), t('catalogRemoveNote', { name: tr(e.name) }), t('remove'), { danger: true }))) return;
        state.catalog = state.catalog.filter((x) => x !== e);
        await store.deleteImage(`cat-${e.id}`);
        const u = thumbs.get(`cat-${e.id}`);
        if (u) URL.revokeObjectURL(u);
        thumbs.delete(`cat-${e.id}`);
        dropSource(e.id);
        setCatalog(state.catalog);
        await save();
        s.close();
        showSettings();
      } }, icon('trash', 18))))),
    h('button', { class: 'btn ghost', onclick: () => { s.close(); pickFile(false, (f) => showCatalogSetup(f, () => current(), () => current())); } }, icon('plus', 20), t('addToCatalogNote')),
    h('h3', {}, t('backup')),
    h('p', { class: 'muted small' }, t('backupNote')),
    h('div', { class: 'row wrap' },
      h('button', { class: 'btn ghost', onclick: async () => {
        toast(t('backupCreating'));
        const blob = await store.backupBlob(state);
        download(blob, `smile-studio-backup-${new Date().toISOString().slice(0, 10)}.json`);
      } }, icon('download', 20), t('backupSave')),
      h('button', { class: 'btn ghost', onclick: () => fileIn.click() }, icon('refresh', 20), t('backupLoad')), fileIn),
    h('h3', {}, t('practiceCode')),
    h('button', { class: 'btn ghost', onclick: async () => {
      const a = prompt(t('newCode'));
      if (!a) return;
      if (!/^\d{6,12}$/.test(a)) return toast(t('codeDigits'));
      if (prompt(t('repeatNewCode')) !== a) return toast(t('codesDifferShort'));
      toast(t('codeChanging'));
      await store.changeCode(state, a);
      toast(t('codeChanged'));
    } }, icon('lock', 20), t('changeCode')),
    h('h3', {}, t('privacy')),
    h('p', { class: 'muted small' }, t('privacyNote')),
    h('button', { class: 'btn ghost danger-text', onclick: async () => {
      if (!(await confirmSheet(t('wipeQ'), t('wipeNote'), t('wipeAll'), { danger: true }))) return;
      await store.wipe();
      state = null;
      s.close();
      showLock();
    } }, icon('trash', 18), t('wipe')),
    h('p', { class: 'muted small' }, `${BRAND.app} · ${BRAND.name}`)));
}

// ---- language ------------------------------------------------------------------------------------

let current = () => showPatients();

function langToggle(after) {
  return h('div', { class: 'lang', role: 'group', 'aria-label': t('language') }, ['de', 'en'].map((l) => h('button', {
    type: 'button', class: getLang() === l ? 'active' : '', 'aria-pressed': String(getLang() === l),
    onclick: () => { if (getLang() !== l) { setLang(l); after(); } },
  }, l.toUpperCase())));
}

// ---- teeth catalogue -------------------------------------------------------------------------------

// Called once the vault is open: the practice's own catalogue photos come from encrypted storage.
function opened() {
  state.catalog ||= [];
  setCatalog(state.catalog, (id) => store.getImage(`cat-${id}`));
}

function catalogImage(entry) {
  if (BUILT_IN.some((e) => e.id === entry.id)) return Promise.resolve(new URL(`../${entry.src}`, import.meta.url).href);
  return imageURL(`cat-${entry.id}`);
}

const MARKS = [
  ['left', 'markLeft', '#2f7fe0'],
  ['right', 'markRight', '#22a35a'],
  ['mid', 'markMid', '#e0445a'],
  ['zenith', 'markZenith', '#8e4fd6'],
];

// The practice adds its own photo of beautiful teeth: four points and the inner lip line tell the app
// where the teeth are, so it can fit them into any patient's smile.
async function showCatalogSetup(file, onDone, onCancel) {
  let c;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k);
    c.height = Math.round(bmp.height * k);
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close?.();
  } catch (e) {
    console.error(e);
    toast(t('unreadable'));
    return;
  }
  const W = c.width;
  const H = c.height;
  const marks = { left: [W * 0.2, H * 0.62], right: [W * 0.8, H * 0.62], mid: [W * 0.5, H * 0.6], zenith: [W * 0.5, H * 0.3] };
  const N = 16;
  const lips = Array.from({ length: N }, (_, i) => {
    const a = Math.PI + (i / N) * Math.PI * 2;
    return [W * (0.5 + 0.46 * Math.cos(a)), H * (0.5 + 0.42 * Math.sin(a))];
  });

  const view = h('canvas', { class: 'view', 'aria-label': t('catalogSetup') });
  const stage = h('div', { class: 'stage' }, view, h('div', { class: 'hint' }, t('catalogSetupNote')));
  const name = h('input', { class: 'field', value: '', placeholder: t('catalogNamePlaceholder'), autocomplete: 'off' });
  let map = null;
  const draw = () => {
    const dpr = window.devicePixelRatio || 1;
    const cw = stage.clientWidth;
    const ch = stage.clientHeight;
    if (!cw || !ch) return;
    view.width = Math.round(cw * dpr);
    view.height = Math.round(ch * dpr);
    const scale = Math.min(view.width / W, view.height / H);
    map = { scale, ox: (view.width - W * scale) / 2, oy: (view.height - H * scale) / 2, dpr };
    const x = view.getContext('2d');
    x.fillStyle = '#0f1418';
    x.fillRect(0, 0, view.width, view.height);
    x.drawImage(c, map.ox, map.oy, W * scale, H * scale);
    const sp = ([px, py]) => [map.ox + px * scale, map.oy + py * scale];
    x.lineWidth = 2 * dpr;
    x.strokeStyle = 'rgba(255,255,255,0.95)';
    x.setLineDash([6 * dpr, 4 * dpr]);
    x.stroke(splinePath(lips.map(sp)));
    x.setLineDash([]);
    for (const p of lips.map(sp)) {
      x.beginPath();
      x.arc(p[0], p[1], 6 * dpr, 0, Math.PI * 2);
      x.fillStyle = '#fff';
      x.fill();
      x.strokeStyle = 'rgba(0,0,0,0.5)';
      x.lineWidth = 1 * dpr;
      x.stroke();
    }
    MARKS.forEach(([id, , color], i) => {
      const [px, py] = sp(marks[id]);
      x.beginPath();
      x.arc(px, py, 11 * dpr, 0, Math.PI * 2);
      x.fillStyle = color;
      x.fill();
      x.lineWidth = 2.5 * dpr;
      x.strokeStyle = '#fff';
      x.stroke();
      x.fillStyle = '#fff';
      x.font = `700 ${12 * dpr}px sans-serif`;
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      x.fillText(String(i + 1), px, py + 0.5 * dpr);
    });
  };
  const handles = () => [...MARKS.map(([id]) => ({ mark: id, p: marks[id] })), ...lips.map((p, i) => ({ lip: i, p }))];
  let drag = null;
  const local = (e) => {
    const r = view.getBoundingClientRect();
    return [((e.clientX - r.left) * map.dpr - map.ox) / map.scale, ((e.clientY - r.top) * map.dpr - map.oy) / map.scale];
  };
  view.addEventListener('pointerdown', (e) => {
    if (!map) return;
    const p = local(e);
    let best = null;
    let bestD = (34 * map.dpr) / map.scale;
    for (const hd of handles()) {
      const d = Math.hypot(hd.p[0] - p[0], hd.p[1] - p[1]);
      if (d < bestD) { bestD = d; best = hd; }
    }
    if (!best) return;
    drag = { ...best, off: [best.p[0] - p[0], best.p[1] - p[1]] };
    view.setPointerCapture(e.pointerId);
  });
  view.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const p = local(e);
    const q = [Math.max(0, Math.min(W, p[0] + drag.off[0])), Math.max(0, Math.min(H, p[1] + drag.off[1]))];
    if (drag.mark) marks[drag.mark] = q;
    else lips[drag.lip] = q;
    draw();
  });
  const end = () => { drag = null; };
  view.addEventListener('pointerup', end);
  view.addEventListener('pointercancel', end);

  const saveEntry = async () => {
    const label = name.value.trim() || t('catalogNameDefault', { n: (state.catalog || []).length + 1 });
    const id = uid();
    await store.putImage(`cat-${id}`, await toBlob(c, 'image/jpeg', 0.92));
    const round = ([px, py]) => [Math.round(px), Math.round(py)];
    const entry = {
      id,
      name: { de: label, en: label },
      points: Object.fromEntries(Object.entries(marks).map(([k2, v]) => [k2, round(v)])),
      lips: lips.map(round),
      upper: N / 2 + 1,
      created: new Date().toISOString(),
    };
    state.catalog.push(entry);
    setCatalog(state.catalog);
    await save();
    toast(t('catalogSaved'));
    onDone(entry);
  };

  current = () => showCatalogSetup(file, onDone, onCancel);
  app.replaceChildren(h('div', { class: 'screen editor' },
    h('header', { class: 'topbar' },
      h('button', { class: 'icon-btn', 'aria-label': t('back'), onclick: onCancel }, icon('back')),
      h('div', { class: 'title' }, h('strong', {}, t('catalogSetup')), h('span', { class: 'muted small' }, t('catalogTitle'))),
      h('div', { class: 'spacer' }),
      h('button', { class: 'btn primary', onclick: saveEntry }, icon('check', 20), t('save'))),
    h('div', { class: 'editor-body' },
      h('div', { class: 'stage-wrap' }, stage),
      h('aside', { class: 'panel' }, h('div', { class: 'panel-body' },
        h('p', { class: 'muted small' }, t('catalogSetupNote')),
        h('ol', { class: 'mark-list' }, MARKS.map(([, key, color]) => h('li', {}, h('span', { class: 'mark-dot', style: { background: color } }), t(key)))),
        h('p', { class: 'muted small' }, t('catalogLipsNote')),
        h('label', { class: 'label' }, t('catalogName'), name),
        h('p', { class: 'muted small' }, t('catalogTip')))))));
  new ResizeObserver(draw).observe(stage);
  requestAnimationFrame(draw);
}

// ---- start -------------------------------------------------------------------------------------

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
showLock();
