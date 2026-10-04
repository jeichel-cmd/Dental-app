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

const FONT = '-apple-system, "SF Pro Display", "Helvetica Neue", "Segoe UI", Arial, sans-serif';

// The practice mark used on screen, drawn into exported images.
const TOOTH_PATH = 'M9 5c-3 0-5 2.5-5 6.5 0 3.5 1.6 6 2.4 9.5.7 3.2 1.2 6 2.9 6 1.6 0 1.8-3.4 2.6-6 .5-1.7 1.3-2.5 4.1-2.5s3.6.8 4.1 2.5c.8 2.6 1 6 2.6 6 1.7 0 2.2-2.8 2.9-6 .8-3.5 2.4-6 2.4-9.5C28 7.5 26 5 23 5c-2.6 0-4.3 1.6-7 1.6S11.6 5 9 5z';

function header(ctx, W, y, unit, title, subtitle, logo) {
  const pad = unit * 4;
  if (logo) {
    const h = unit * 3.2;
    ctx.drawImage(logo, pad, y, (logo.width / logo.height) * h, h);
  } else {
    ctx.save();
    ctx.translate(pad, y);
    ctx.scale((unit * 3.2) / 32, (unit * 3.2) / 32);
    ctx.fillStyle = BRAND.colors.brand;
    ctx.fill(new Path2D(TOOTH_PATH));
    ctx.restore();
    ctx.fillStyle = BRAND.colors.ink;
    ctx.textBaseline = 'alphabetic';
    ctx.font = `600 ${unit * 1.35}px ${FONT}`;
    ctx.fillText(BRAND.name, pad + unit * 4, y + unit * 1.55);
    ctx.fillStyle = BRAND.colors.brand;
    ctx.font = `600 ${unit * 0.8}px ${FONT}`;
    ctx.fillText(BRAND.app.toUpperCase().split('').join(' '), pad + unit * 4, y + unit * 2.85);
  }
  ctx.textAlign = 'right';
  ctx.fillStyle = BRAND.colors.ink;
  ctx.font = `600 ${unit * 1.35}px ${FONT}`;
  ctx.fillText(title, W - pad, y + unit * 1.55);
  ctx.fillStyle = '#6b7780';
  ctx.font = `${unit * 0.85}px ${FONT}`;
  ctx.fillText(subtitle, W - pad, y + unit * 2.85);
  ctx.textAlign = 'left';
}

function footer(ctx, W, y, unit, label) {
  const pad = unit * 4;
  ctx.fillStyle = '#e4e9ec';
  ctx.fillRect(pad, y, W - pad * 2, Math.max(1, unit * 0.06));
  ctx.fillStyle = '#6b7780';
  ctx.font = `${unit * 0.75}px ${FONT}`;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(`${label ? `${label} · ` : ''}${BRAND.disclaimer}`, pad, y + unit * 1.6);
  ctx.textAlign = 'right';
  ctx.fillStyle = BRAND.colors.brand;
  ctx.font = `600 ${unit * 0.75}px ${FONT}`;
  ctx.fillText(BRAND.web, W - pad, y + unit * 1.6);
  ctx.textAlign = 'left';
}

// A photo panel with rounded corners, a soft shadow and a label.
function panel(ctx, src, area, x, y, w, h, unit, label, accent) {
  const r = unit * 0.9;
  ctx.save();
  ctx.shadowColor = 'rgba(16,30,40,0.18)';
  ctx.shadowBlur = unit * 1.6;
  ctx.shadowOffsetY = unit * 0.4;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.clip();
  // Cover-fit the area into the panel.
  const k = Math.max(w / area.w, h / area.h);
  const sw = w / k;
  const sh = h / k;
  ctx.drawImage(src, area.x + (area.w - sw) / 2, area.y + (area.h - sh) / 2, sw, sh, x, y, w, h);
  ctx.restore();
  if (label) {
    ctx.font = `600 ${unit * 0.8}px ${FONT}`;
    const tw = ctx.measureText(label).width + unit * 1.6;
    const th = unit * 1.6;
    ctx.fillStyle = accent ? BRAND.colors.brand : 'rgba(255,255,255,0.92)';
    ctx.beginPath();
    ctx.roundRect(x + unit * 0.8, y + unit * 0.8, tw, th, th / 2);
    ctx.fill();
    ctx.fillStyle = accent ? '#fff' : BRAND.colors.ink;
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + unit * 1.6, y + unit * 0.8 + th / 2 + unit * 0.04);
    ctx.textBaseline = 'alphabetic';
  }
}

// kind: 'compare' (before and after, with smile close-ups), 'after' (one portrait), 'smile' (close-ups only).
export function buildExport(photo, mouth, design, kind, { lookName = '', patientName = '', logo = null } = {}) {
  const after = composite(photo, mouth, design, true);
  const before = composite(photo, mouth, design, false);
  const face = cropAround(mouth, photo, 'face');
  const smile = cropAround(mouth, photo, 'smile');
  const W = kind === 'after' ? 1800 : 2400;
  const unit = W / 60;
  const pad = unit * 4;
  const gap = unit * 1.2;
  const headH = unit * 6.5;
  const date = new Date().toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
  const subtitle = [patientName, date].filter(Boolean).join(' · ');
  const inner = W - pad * 2;
  let H;
  const draw = [];
  if (kind === 'compare') {
    const pw = (inner - gap) / 2;
    const ph = pw * 1.22;
    const sh = pw * 0.48;
    H = headH + ph + gap + sh + unit * 6;
    draw.push((c) => panel(c, before, face, pad, headH, pw, ph, unit, 'Vorher'));
    draw.push((c) => panel(c, after, face, pad + pw + gap, headH, pw, ph, unit, 'Nachher', true));
    draw.push((c) => panel(c, before, smile, pad, headH + ph + gap, pw, sh, unit));
    draw.push((c) => panel(c, after, smile, pad + pw + gap, headH + ph + gap, pw, sh, unit));
  } else if (kind === 'after') {
    const ph = inner * 1.22;
    H = headH + ph + unit * 6;
    draw.push((c) => panel(c, after, face, pad, headH, inner, ph, unit, 'Ihr neues Lächeln', true));
  } else {
    const sh = inner * 0.42;
    H = headH + sh * 2 + gap + unit * 6;
    draw.push((c) => panel(c, before, smile, pad, headH, inner, sh, unit, 'Vorher'));
    draw.push((c) => panel(c, after, smile, pad, headH + sh + gap, inner, sh, unit, 'Nachher', true));
  }
  const out = canvas(W, H);
  const ctx = out.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#ffffff');
  bg.addColorStop(1, '#f3f6f7');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  header(ctx, W, unit * 1.8, unit, 'Ihr Lächeln-Entwurf', subtitle, logo);
  for (const f of draw) f(ctx);
  footer(ctx, W, H - unit * 3, unit, lookName ? `Look „${lookName}“` : '');
  return out;
}

export const toBlob = (c, type = 'image/jpeg', q = 0.94) => new Promise((r) => c.toBlob(r, type, q));

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
