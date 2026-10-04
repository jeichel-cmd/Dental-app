// Smile Studio: lock screen, patients, photos, try-on and sharing.

import * as store from './store.js';
import { BRAND } from './brand.js';
import { h, icon, toast, sheet, confirmSheet, uid, formatDate } from './ui.js';
import { openEditor } from './editor.js';
import { findMouth, defaultMouth } from './face.js';
import { DEFAULT_DESIGN } from './teeth.js';
import { LOOKS } from './looks.js';
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
    toast('Speichern fehlgeschlagen');
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
      title.textContent = 'Praxis-Code eingeben';
      msg.textContent = 'Patientendaten bleiben verschlüsselt auf diesem Gerät.';
    } else if (!first) {
      title.textContent = 'Praxis-Code festlegen';
      msg.textContent = 'Mindestens 6 Ziffern. Schützt alle Patientenfotos auf diesem Gerät. Ohne Code sind die Daten nicht wiederherstellbar.';
    } else {
      title.textContent = 'Code wiederholen';
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
      msg.textContent = 'Der Code braucht mindestens 6 Ziffern.';
      return;
    }
    busy = true;
    if (exists) {
      msg.textContent = 'Wird entsperrt …';
      const s = await store.unlock(code);
      busy = false;
      if (!s) {
        code = '';
        paint();
        msg.textContent = 'Falscher Code.';
        dots.classList.add('shake');
        setTimeout(() => dots.classList.remove('shake'), 400);
        return;
      }
      state = s;
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
      msg.textContent = 'Die Codes waren verschieden. Bitte neu festlegen.';
      paint();
    } else {
      msg.textContent = 'Wird eingerichtet …';
      state = store.emptyState();
      await store.create(code, state);
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
    class: `key${k === 'ok' ? ' ok' : ''}`, 'aria-label': k === 'del' ? 'Löschen' : k === 'ok' ? 'Bestätigen' : k,
    onclick: () => press(k),
  }, k === 'del' ? '⌫' : k === 'ok' ? icon('check', 26) : k)));
  setTexts();
  paint();
  app.replaceChildren(h('div', { class: 'screen lock' }, h('div', { class: 'lock-box' }, brandMark(), title, dots, msg, pad)));
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
    const ok = await confirmSheet('Einwilligung', `Hat ${patient.name} der Aufnahme und Speicherung von Fotos für die Zahnauswahl zugestimmt?`, 'Ja, liegt vor');
    if (!ok) return;
    patient.consent = new Date().toISOString();
  }
  const busy = sheet('Foto wird vorbereitet', h('div', { class: 'center' }, h('div', { class: 'spinner' }), h('p', { class: 'muted' }, 'Der Mund wird auf diesem Gerät gesucht. Das Foto verlässt das Gerät nicht.')));
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
      design: { ...DEFAULT_DESIGN, ...LOOKS[0].design },
    };
    patient.photos.unshift(photo);
    patient.updated = photo.created;
    await save();
    busy.close();
    if (!mouth) toast('Kein Gesicht erkannt – bitte Lippen von Hand anpassen');
    showEditor(patient, photo);
  } catch (e) {
    console.error(e);
    busy.close();
    toast('Dieses Bild konnte nicht gelesen werden');
  }
}

function pickPhoto(patient, camera) {
  const input = h('input', { type: 'file', accept: 'image/*', ...(camera ? { capture: 'user' } : {}), style: { display: 'none' } });
  input.addEventListener('change', () => {
    const f = input.files?.[0];
    input.remove();
    if (f) addPhoto(patient, f);
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
  const search = h('input', { class: 'field search', type: 'search', placeholder: 'Patient suchen', value: query, 'aria-label': 'Patient suchen' });
  const paint = () => {
    const q = search.value.trim().toLowerCase();
    const items = state.patients
      .filter((p) => !q || p.name.toLowerCase().includes(q))
      .sort((a, b) => (b.updated || b.created).localeCompare(a.updated || a.created));
    if (!state.patients.length) {
      list.replaceChildren(h('div', { class: 'empty' },
        h('h2', {}, 'Willkommen'),
        h('p', { class: 'muted' }, 'Lege den ersten Patienten an, mache ein Foto vom Lächeln und probiere neue Zähne aus.'),
        h('button', { class: 'btn primary big', onclick: () => editPatient() }, icon('plus'), 'Neuer Patient')));
      return;
    }
    list.replaceChildren(...items.map((p) => h('button', { class: 'patient-card', onclick: () => showPatient(p) },
      thumbEl(p.photos[0]?.thumb, 'thumb big'),
      h('span', { class: 'patient-info' },
        h('strong', {}, p.name),
        h('span', { class: 'muted small' }, `${p.photos.length} ${p.photos.length === 1 ? 'Foto' : 'Fotos'} · ${(p.favorites || []).length} Favoriten`),
        h('span', { class: 'muted small' }, `Zuletzt ${formatDate(p.updated || p.created)}`)))));
    if (!items.length) list.replaceChildren(h('p', { class: 'muted center' }, 'Kein Patient gefunden.'));
  };
  search.addEventListener('input', paint);
  app.replaceChildren(h('div', { class: 'screen' },
    topbar(brandMark(true), '', [
      h('button', { class: 'icon-btn', 'aria-label': 'Sperren', onclick: lockNow }, icon('lock')),
      h('button', { class: 'icon-btn', 'aria-label': 'Einstellungen', onclick: showSettings }, icon('settings')),
    ]),
    h('main', { class: 'content' },
      h('div', { class: 'row between' }, h('h1', {}, 'Patienten'), h('button', { class: 'btn primary', onclick: () => editPatient() }, icon('plus'), 'Neuer Patient')),
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
  const s = sheet(isNew ? 'Neuer Patient' : 'Patient bearbeiten', h('form', {
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
  h('label', { class: 'label' }, 'Name', name),
  h('div', { class: 'grid2' }, h('label', { class: 'label' }, 'E-Mail', email), h('label', { class: 'label' }, 'Telefon', phone)),
  h('label', { class: 'label' }, 'Notiz', notes),
  h('label', { class: 'check' }, consent, h('span', {}, 'Einwilligung zu Fotos und Speicherung liegt vor')),
  h('div', { class: 'row end' },
    h('button', { type: 'button', class: 'btn ghost', onclick: () => s.close() }, 'Abbrechen'),
    h('button', { class: 'btn primary' }, isNew ? 'Anlegen' : 'Speichern'))));
  setTimeout(() => name.focus(), 50);
}

function showPatient(p) {
  editor = null;
  const photos = h('div', { class: 'photos' },
    h('button', { class: 'photo-add', onclick: () => pickPhoto(p, true) }, icon('camera', 30), h('strong', {}, 'Foto aufnehmen'), h('span', { class: 'muted small' }, 'Lächeln, Mund leicht offen')),
    h('button', { class: 'photo-add', onclick: () => pickPhoto(p, false) }, icon('image', 30), h('strong', {}, 'Foto hochladen'), h('span', { class: 'muted small' }, 'Aus der Mediathek')),
    ...p.photos.map((ph) => h('div', { class: 'photo' },
      h('button', { class: 'photo-open', onclick: () => showEditor(p, ph), 'aria-label': 'Foto öffnen' }, thumbEl(ph.thumb, 'thumb fill')),
      h('div', { class: 'photo-meta' }, h('span', { class: 'small muted' }, formatDate(ph.created)),
        h('button', { class: 'icon-btn small', 'aria-label': 'Foto löschen', onclick: async () => {
          if (!(await confirmSheet('Foto löschen?', 'Das Foto und seine Einstellungen werden von diesem Gerät gelöscht.', 'Löschen', { danger: true }))) return;
          p.photos = p.photos.filter((x) => x !== ph);
          await store.deleteImage(ph.id);
          await store.deleteImage(ph.thumb);
          await save();
          showPatient(p);
        } }, icon('trash', 18))))));
  const favs = (p.favorites || []);
  app.replaceChildren(h('div', { class: 'screen' },
    topbar(h('button', { class: 'icon-btn', 'aria-label': 'Zurück', onclick: () => showPatients() }, icon('back')), h('strong', {}, p.name), [
      h('button', { class: 'btn ghost', onclick: () => editPatient(p) }, icon('edit', 20), h('span', { class: 'hide-sm' }, 'Bearbeiten')),
    ]),
    h('main', { class: 'content' },
      h('div', { class: 'patient-head' },
        h('div', {}, h('h1', {}, p.name),
          h('p', { class: 'muted small' }, [p.email, p.phone].filter(Boolean).join(' · ') || 'Keine Kontaktdaten'),
          p.notes ? h('p', { class: 'small' }, p.notes) : null,
          h('p', { class: 'small muted' }, p.consent ? `Einwilligung vom ${formatDate(p.consent)}` : 'Einwilligung zu Fotos noch nicht erfasst'))),
      h('h2', {}, 'Fotos'),
      photos,
      favs.length ? h('h2', {}, 'Favoriten') : null,
      favs.length ? h('div', { class: 'fav-grid' }, favs.map((f) => {
        const ph = p.photos.find((x) => x.id === f.photoId) || p.photos[0];
        return h('button', { class: 'fav-card', onclick: () => ph && showEditor(p, ph, f) }, thumbEl(`fav-${f.id}`, 'thumb wide'), h('span', {}, f.name));
      })) : null,
      h('div', { class: 'danger-zone' }, h('button', { class: 'btn ghost danger-text', onclick: async () => {
        if (!(await confirmSheet('Patient löschen?', `${p.name} mit allen Fotos und Favoriten wird von diesem Gerät gelöscht.`, 'Löschen', { danger: true }))) return;
        for (const ph of p.photos) { await store.deleteImage(ph.id); await store.deleteImage(ph.thumb); }
        for (const f of favs) await store.deleteImage(`fav-${f.id}`);
        state.patients = state.patients.filter((x) => x !== p);
        await save();
        showPatients();
      } }, icon('trash', 18), 'Patient löschen')))));
}

async function showEditor(patient, photo, favorite) {
  app.replaceChildren(h('div', { class: 'screen center' }, h('div', { class: 'spinner' })));
  const image = await loadPhoto(photo.id);
  if (favorite) photo.design = { ...photo.design, ...favorite.design, ...(favorite.photoId === photo.id ? {} : { dx: photo.design.dx, dy: photo.design.dy, rot: photo.design.rot }) };
  editor = openEditor(app, {
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

function showExport(patient, photo, image, design, mouth) {
  const fav = (patient.favorites || []).find((f) => JSON.stringify(f.design) === JSON.stringify(design));
  let kind = 'compare';
  const preview = h('img', { class: 'export-preview', alt: 'Vorschau' });
  let current = null;
  const kinds = [['compare', 'Vorher / Nachher'], ['after', 'Nur Nachher'], ['smile', 'Lächeln nah']];
  const seg = h('div', { class: 'segmented' });
  const paint = async () => {
    seg.replaceChildren(...kinds.map(([id, label]) => h('button', { class: kind === id ? 'active' : '', onclick: () => { kind = id; paint(); } }, label)));
    const c = buildExport(image, mouth, design, kind, { lookName: fav?.name, patientName: patient.name, logo: await brandLogo() });
    const blob = await toBlob(c);
    if (preview.src) URL.revokeObjectURL(preview.src);
    preview.src = URL.createObjectURL(blob);
    current = new File([blob], fileName(patient.name, kind), { type: 'image/jpeg' });
  };
  const text = `Ihr Lächeln-Entwurf von ${BRAND.name}. ${BRAND.disclaimer}`;
  const share = async () => {
    if (!current) return;
    if (canShareFiles(current)) {
      try {
        await shareFiles([current], text);
      } catch (e) {
        if (e.name !== 'AbortError') toast('Teilen nicht möglich');
      }
    } else {
      download(current, current.name);
      toast('Bild gespeichert');
    }
  };
  const mail = async () => {
    if (!current) return;
    if (patient.email) {
      try { await navigator.clipboard.writeText(patient.email); toast(`E-Mail-Adresse kopiert: ${patient.email}`); } catch { /* not allowed */ }
    }
    if (canShareFiles(current)) {
      try {
        await shareFiles([current], text);
      } catch (e) {
        if (e.name !== 'AbortError') toast('Teilen nicht möglich');
      }
    } else {
      download(current, current.name);
      const subject = encodeURIComponent(`Ihr neues Lächeln – ${BRAND.name}`);
      const body = encodeURIComponent(`Guten Tag ${patient.name},\n\nanbei Ihr Lächeln-Entwurf (Bild im Anhang).\n\n${BRAND.disclaimer}\n\nIhr ${BRAND.name}`);
      location.href = `mailto:${encodeURIComponent(patient.email || '')}?subject=${subject}&body=${body}`;
      toast('Bild gespeichert – bitte in der E-Mail anhängen');
    }
  };
  sheet('Bild teilen', h('div', { class: 'export' },
    seg, preview,
    h('p', { class: 'muted small' }, 'Teilen öffnet das Menü des Geräts: Mail, Nachrichten, AirDrop oder „Bild sichern“. Das Bild wird erst beim Senden weitergegeben.'),
    h('div', { class: 'row end wrap' },
      h('button', { class: 'btn ghost', onclick: () => current && (download(current, current.name), toast('Bild gespeichert')) }, icon('download', 20), 'Speichern'),
      h('button', { class: 'btn ghost', onclick: mail }, icon('mail', 20), patient.email ? `E-Mail an ${patient.email}` : 'Per E-Mail'),
      h('button', { class: 'btn primary', onclick: share }, icon('share', 20), 'Teilen'))), { wide: true });
  paint();
}

// ---- settings ----------------------------------------------------------------------------------

function showSettings() {
  const lockSel = h('select', { class: 'field' }, [[1, '1 Minute'], [5, '5 Minuten'], [15, '15 Minuten'], [60, '1 Stunde']].map(([v, l]) => h('option', { value: v, selected: (state.settings.lockMinutes ?? 5) === v }, l)));
  lockSel.addEventListener('change', async () => {
    state.settings.lockMinutes = Number(lockSel.value);
    await save();
    resetIdle();
    toast('Gespeichert');
  });
  const fileIn = h('input', { type: 'file', accept: 'application/json,.json', style: { display: 'none' } });
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files?.[0];
    if (!f) return;
    const code = prompt('Praxis-Code der Sicherung');
    if (!code) return;
    try {
      const backup = await store.readBackup(await f.text(), code);
      if (!backup) return toast('Falscher Code für diese Sicherung');
      if (!(await confirmSheet('Sicherung laden?', 'Alle Patienten auf diesem Gerät werden durch die Sicherung ersetzt.', 'Laden', { danger: true }))) return;
      await store.restore(backup);
      state = backup.state;
      thumbs.clear();
      s.close();
      showPatients();
      toast('Sicherung geladen');
    } catch (e) {
      console.error(e);
      toast('Das ist keine gültige Sicherung');
    }
  });
  const s = sheet('Einstellungen', h('div', { class: 'settings' },
    h('label', { class: 'label' }, 'Automatisch sperren nach', lockSel),
    h('h3', {}, 'Sicherung'),
    h('p', { class: 'muted small' }, 'Die Daten liegen nur auf diesem Gerät. Eine Sicherung ist eine verschlüsselte Datei mit allen Patienten und Fotos, geschützt mit dem Praxis-Code.'),
    h('div', { class: 'row wrap' },
      h('button', { class: 'btn ghost', onclick: async () => {
        toast('Sicherung wird erstellt …');
        const blob = await store.backupBlob(state);
        download(blob, `smile-studio-sicherung-${new Date().toISOString().slice(0, 10)}.json`);
      } }, icon('download', 20), 'Sicherung speichern'),
      h('button', { class: 'btn ghost', onclick: () => fileIn.click() }, icon('refresh', 20), 'Sicherung laden'), fileIn),
    h('h3', {}, 'Praxis-Code'),
    h('button', { class: 'btn ghost', onclick: async () => {
      const a = prompt('Neuer Praxis-Code (mindestens 6 Ziffern)');
      if (!a) return;
      if (!/^\d{6,12}$/.test(a)) return toast('Bitte 6 bis 12 Ziffern');
      if (prompt('Neuen Code wiederholen') !== a) return toast('Die Codes waren verschieden');
      toast('Code wird geändert …');
      await store.changeCode(state, a);
      toast('Code geändert');
    } }, icon('lock', 20), 'Code ändern'),
    h('h3', {}, 'Datenschutz'),
    h('p', { class: 'muted small' }, 'Fotos werden nur auf diesem Gerät verarbeitet und verschlüsselt gespeichert. Die App lädt nichts hoch. Bilder verlassen das Gerät nur, wenn Sie sie selbst teilen.'),
    h('button', { class: 'btn ghost danger-text', onclick: async () => {
      if (!(await confirmSheet('Alle Daten löschen?', 'Alle Patienten, Fotos und der Praxis-Code werden von diesem Gerät gelöscht. Das lässt sich nicht rückgängig machen.', 'Alles löschen', { danger: true }))) return;
      await store.wipe();
      state = null;
      s.close();
      showLock();
    } }, icon('trash', 18), 'Alle Daten löschen'),
    h('p', { class: 'muted small' }, `${BRAND.app} · ${BRAND.name}`)));
}

// ---- start -------------------------------------------------------------------------------------

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
showLock();
