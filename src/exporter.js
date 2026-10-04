// Builds the images patients take home, and hands them to the tablet's share sheet (Mail, AirDrop, Photos...).

import { BRAND } from './brand.js';
import { renderSmile, photoLight, mouthBounds } from './render.js';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.round(w);
  c.height = Math.round(h);
  return c;
}

export function composite(photo, mouth, design, after = true) {
  const c = canvas(photo.width, photo.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(photo, 0, 0);
  if (after) renderSmile(ctx, mouth, design, photoLight(ctx, mouth));
  return c;
}

// A crop around the face (or the smile) so exported pictures focus on what matters.
export function cropAround(mouth, photo, mode) {
  const b = mouthBounds(mouth, 0);
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const mm = mouth.pxPerMm;
  let w;
  let h;
  if (mode === 'smile') {
    w = 90 * mm;
    h = 45 * mm;
  } else {
    w = 190 * mm;
    h = 250 * mm;
  }
  w = Math.min(w, photo.width);
  h = Math.min(h, photo.height);
  let x = cx - w / 2;
  let y = mode === 'smile' ? cy - h / 2 : cy - h * 0.66;
  x = Math.max(0, Math.min(photo.width - w, x));
  y = Math.max(0, Math.min(photo.height - h, y));
  return { x, y, w, h };
}

function footer(ctx, W, H, band, label) {
  ctx.fillStyle = BRAND.colors.paper;
  ctx.fillRect(0, H - band, W, band);
  ctx.fillStyle = BRAND.colors.brand;
  ctx.fillRect(0, H - band, W, Math.max(2, band * 0.04));
  const pad = band * 0.32;
  ctx.fillStyle = BRAND.colors.ink;
  ctx.font = `600 ${band * 0.27}px -apple-system, "Helvetica Neue", Arial, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.fillText(BRAND.name, pad, H - band * 0.6);
  ctx.font = `${band * 0.17}px -apple-system, "Helvetica Neue", Arial, sans-serif`;
  ctx.fillStyle = '#5b6770';
  ctx.fillText(`${label} · ${BRAND.disclaimer}`, pad, H - band * 0.27);
  ctx.textAlign = 'right';
  ctx.fillText(new Date().toLocaleDateString('de-DE'), W - pad, H - band * 0.6);
  ctx.textAlign = 'left';
}

function tag(ctx, x, y, text, size) {
  ctx.font = `600 ${size}px -apple-system, "Helvetica Neue", Arial, sans-serif`;
  const w = ctx.measureText(text).width + size * 1.2;
  ctx.fillStyle = 'rgba(255,255,255,0.88)';
  ctx.beginPath();
  ctx.roundRect(x, y, w, size * 1.8, size * 0.9);
  ctx.fill();
  ctx.fillStyle = BRAND.colors.ink;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + size * 0.6, y + size * 0.92);
}

// kind: 'after' (one photo), 'compare' (before and after side by side), 'smile' (close-up, before and after).
export function buildExport(photo, mouth, design, kind, lookName = '') {
  const after = composite(photo, mouth, design, true);
  const before = composite(photo, mouth, design, false);
  const area = cropAround(mouth, photo, kind === 'smile' ? 'smile' : 'face');
  const target = kind === 'after' ? 1600 : 1100; // width of each picture in px
  const scale = Math.min(target / area.w, 2.5);
  const pw = area.w * scale;
  const ph = area.h * scale;
  const gap = kind === 'after' ? 0 : Math.round(pw * 0.02);
  const W = kind === 'after' ? pw : pw * 2 + gap;
  const band = Math.round(W * (kind === 'after' ? 0.09 : 0.06));
  const out = canvas(W, ph + band);
  const ctx = out.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = BRAND.colors.paper;
  ctx.fillRect(0, 0, out.width, out.height);
  const size = Math.round(band * 0.2);
  if (kind === 'after') {
    ctx.drawImage(after, area.x, area.y, area.w, area.h, 0, 0, pw, ph);
  } else {
    ctx.drawImage(before, area.x, area.y, area.w, area.h, 0, 0, pw, ph);
    ctx.drawImage(after, area.x, area.y, area.w, area.h, pw + gap, 0, pw, ph);
    tag(ctx, size, size, 'Vorher', size);
    tag(ctx, pw + gap + size, size, 'Nachher', size);
  }
  footer(ctx, out.width, out.height, band, lookName ? `Look: ${lookName}` : 'Ihr neues Lächeln');
  return out;
}

export const toBlob = (c, type = 'image/jpeg', q = 0.92) => new Promise((r) => c.toBlob(r, type, q));

export function fileName(patientName, kind) {
  const safe = (patientName || 'Patient').normalize('NFKD').replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '');
  const date = new Date().toISOString().slice(0, 10);
  return `${safe}-${{ after: 'Nachher', compare: 'Vorher-Nachher', smile: 'Laecheln' }[kind] || 'Bild'}-${date}.jpg`;
}

export function canShareFiles(file) {
  try {
    return Boolean(navigator.canShare?.({ files: [file] }));
  } catch {
    return false;
  }
}

export async function shareFiles(files, text) {
  await navigator.share({ files, title: BRAND.name, text });
}

export function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
