// The smile catalogue: real photos of teeth, fitted into the patient's mouth.
// Each entry marks four points on its photo (both canine tips, the middle of the front teeth's biting edge,
// and the gum line above the front teeth) and the inner edge of the lips, so only teeth and gums are used.

import { transform, mouthBounds, lipOutline, splinePath, makeCanvas, hash, finishLayer, photoLight } from './render.js';
import { DEFAULT_DESIGN, clamp } from './teeth.js';
import { shadeRGB } from './shades.js';

// Built-in photos shipped with the app (assets/catalog/).
export const BUILT_IN = [
  {
    id: 'smile-01',
    name: { de: 'Natürlich hell', en: 'Natural bright' },
    src: 'assets/catalog/smile-01.jpg',
    points: { left: [195, 570], right: [1255, 555], mid: [705, 543], zenith: [705, 185] },
    lips: [
      [40, 420], [80, 260], [150, 170], [300, 112], [500, 88], [700, 80], [900, 88], [1100, 112], [1270, 160], [1370, 250], [1405, 420],
      [1390, 560], [1300, 668], [1100, 724], [900, 748], [700, 756], [500, 744], [300, 704], [150, 648], [55, 560],
    ],
    upper: 11,
  },
];

// Where the reference points sit on the patient, in smile millimetres (see teeth.js).
const TARGET = { half: 15.2, length: 10.6 };

// Shades offered in the simple colour row: the photo as it is, then VITA shades from natural to bleached.
export const PHOTO_SHADES = ['original', 'A3', 'A2', 'A1', 'B1', 'BL2'];

const prepared = new Map();

async function loadImage(src) {
  if (src instanceof Blob) return createImageBitmap(src);
  const img = new Image();
  img.src = src;
  await img.decode();
  return img;
}

// Cuts the teeth and gums out of the photo along the lips and measures the colour of the teeth.
export async function prepare(entry, source) {
  if (prepared.has(entry.id)) return prepared.get(entry.id);
  const img = await loadImage(source || new URL(`../${entry.src}`, import.meta.url).href);
  const W = img.width;
  const H = img.height;
  const c = makeCanvas(W, H);
  const g = c.getContext('2d', { willReadFrequently: true });
  // Soft cut along the inner lip line.
  const feather = Math.max(2, Math.hypot(entry.points.right[0] - entry.points.left[0], entry.points.right[1] - entry.points.left[1]) / 220);
  if ('filter' in g) g.filter = `blur(${feather}px)`;
  g.fillStyle = '#fff';
  g.fill(splinePath(shrink(entry.lips, feather * 1.5)));
  if ('filter' in g) g.filter = 'none';
  g.globalCompositeOperation = 'source-in';
  g.drawImage(img, 0, 0);
  g.globalCompositeOperation = 'source-over';
  const data = g.getImageData(0, 0, W, H);
  // How much each pixel is tooth (bright, not red) rather than gum or shadow.
  const d = data.data;
  const weight = new Float32Array(W * H);
  let sr = 0;
  let sg = 0;
  let sb = 0;
  let sw = 0;
  for (let i = 0; i < W * H; i++) {
    const r = d[i * 4] / 255;
    const gg = d[i * 4 + 1] / 255;
    const b = d[i * 4 + 2] / 255;
    const a = d[i * 4 + 3] / 255;
    const lum = 0.3 * r + 0.59 * gg + 0.11 * b;
    const red = r - (gg + b) / 2;
    const w = a * smoothstep(0.42, 0.62, lum) * (1 - smoothstep(0.06, 0.16, red));
    weight[i] = w;
    sr += r * w;
    sg += gg * w;
    sb += b * w;
    sw += w;
  }
  const result = { entry, canvas: c, data, weight, mean: sw ? [sr / sw, sg / sw, sb / sw] : [0.85, 0.82, 0.75], shaded: new Map() };
  prepared.set(entry.id, result);
  return result;
}

export function forget(id) {
  prepared.delete(id);
}

function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

function shrink(poly, by) {
  const cx = poly.reduce((t, p) => t + p[0], 0) / poly.length;
  const cy = poly.reduce((t, p) => t + p[1], 0) / poly.length;
  return poly.map(([x, y]) => {
    const dx = cx - x;
    const dy = cy - y;
    const l = Math.hypot(dx, dy) || 1;
    return [x + (dx / l) * by, y + (dy / l) * by];
  });
}

// The cut-out with the teeth recoloured to a shade and brightness. Gums and shadows stay as they are.
function shadedCutout(p, shade, bright) {
  const key = `${shade}|${bright.toFixed(2)}`;
  if (p.shaded.has(key)) return p.shaded.get(key);
  const { width: W, height: H } = p.canvas;
  const src = p.data.data;
  const out = new ImageData(W, H);
  const o = out.data;
  const target = shade === 'original' ? p.mean : shadeRGB(shade).map((v) => v / 255);
  const ratio = target.map((v, i) => v / p.mean[i]);
  const lift = 1 + clamp(bright, -1, 1) * 0.12;
  for (let i = 0; i < W * H; i++) {
    const w = p.weight[i];
    for (let c = 0; c < 3; c++) {
      const v = src[i * 4 + c];
      const t = v * ratio[c] * lift;
      // Lighter shades also lift the shadows a little less than the highlights, like real bleaching.
      o[i * 4 + c] = clamp(v + (t - v) * w, 0, 255);
    }
    o[i * 4 + 3] = src[i * 4 + 3];
  }
  const c = makeCanvas(W, H);
  c.getContext('2d').putImageData(out, 0, 0);
  if (p.shaded.size > 8) p.shaded.clear();
  p.shaded.set(key, c);
  return c;
}

// Matrix that takes the catalogue photo into the patient photo.
export function fitMatrix(entry, mouth, design) {
  const d = { ...DEFAULT_DESIGN, ...design };
  const { left, right, mid, zenith } = entry.points;
  let ex = [right[0] - left[0], right[1] - left[1]];
  const span = Math.hypot(ex[0], ex[1]);
  ex = [ex[0] / span, ex[1] / span];
  const ey = [-ex[1], ex[0]];
  const pxPerMmX = span / (TARGET.half * 2);
  const down = (mid[0] - zenith[0]) * ey[0] + (mid[1] - zenith[1]) * ey[1];
  const pxPerMmY = Math.max(1, down) / TARGET.length;
  const kx = (d.size * d.width) / pxPerMmX;
  const ky = (d.size * d.length) / pxPerMmY;
  const toImg = transform(mouth, d);
  const O = toImg([0, 0]);
  const X = toImg([1, 0]).map((v, i) => v - O[i]);
  const Y = toImg([0, 1]).map((v, i) => v - O[i]);
  // P = O + X·kx·(ex·(p−mid)) + Y·ky·(ey·(p−mid))
  const a = X[0] * kx * ex[0] + Y[0] * ky * ey[0];
  const b = X[1] * kx * ex[0] + Y[1] * ky * ey[0];
  const c = X[0] * kx * ex[1] + Y[0] * ky * ey[1];
  const e = X[1] * kx * ex[1] + Y[1] * ky * ey[1];
  return [a, b, c, e, O[0] - (a * mid[0] + c * mid[1]), O[1] - (b * mid[0] + e * mid[1])];
}

// Draws a catalogue smile into the patient's mouth. `ctx` already holds the patient photo.
export function renderPhotoSmile(ctx, mouth, design, p, light = { gain: 1, tint: [1, 1, 1], grain: 1.5 }, { fast = false } = {}) {
  const d = { ...DEFAULT_DESIGN, ...design };
  const b = mouthBounds(mouth, 0.08);
  const s = mouth.pxPerMm;
  const ss = fast ? Math.min(1, 520 / b.w) : clamp(5 / s, 1, 2);
  const W = Math.max(1, Math.round(b.w * ss));
  const H = Math.max(1, Math.round(b.h * ss));
  const ps = s * ss;
  const layer = makeCanvas(W, H);
  const g = layer.getContext('2d', { willReadFrequently: true });

  // Dark inside of the mouth behind everything.
  const toImg = transform(mouth, d);
  const [cx, cy] = toImg([0, -3]);
  const cav = g.createRadialGradient((cx - b.x) * ss, (cy - b.y) * ss, 0, (cx - b.x) * ss, (cy - b.y) * ss, 30 * ps);
  cav.addColorStop(0, '#4a1d1f');
  cav.addColorStop(0.6, '#240b0c');
  cav.addColorStop(1, '#0d0404');
  g.fillStyle = cav;
  g.fillRect(0, 0, W, H);

  // The catalogue smile, recoloured and fitted.
  const cut = shadedCutout(p, d.shade, d.bright || 0);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = fast ? 'low' : 'high';
  // Back teeth in the shadow of the cheeks: a wider, darker copy behind, so the corners never look empty.
  const wide = fitMatrix(p.entry, mouth, { ...d, width: d.width * 1.32, length: d.length * 0.96 });
  g.save();
  g.setTransform(wide[0] * ss, wide[1] * ss, wide[2] * ss, wide[3] * ss, (wide[4] - b.x) * ss, (wide[5] - b.y) * ss);
  if ('filter' in g) g.filter = `brightness(0.42) blur(${Math.max(1, 3 / ss)}px)`;
  g.globalAlpha = 0.9;
  g.drawImage(cut, 0, 0);
  g.restore();
  const m = fitMatrix(p.entry, mouth, d);
  g.save();
  g.setTransform(m[0] * ss, m[1] * ss, m[2] * ss, m[3] * ss, (m[4] - b.x) * ss, (m[5] - b.y) * ss);
  g.drawImage(cut, 0, 0);
  g.restore();

  // Match the patient photo's light and grain, and keep everything inside the lips.
  const lipsLayer = lipOutline(mouth).map(([X, Y]) => [(X - b.x) * ss, (Y - b.y) * ss]);
  const mask = makeCanvas(W, H);
  const mg = mask.getContext('2d', { willReadFrequently: true });
  if ('filter' in mg) mg.filter = `blur(${Math.max(1, s * 0.25 * ss)}px)`;
  mg.fillStyle = '#fff';
  mg.fill(splinePath(lipsLayer));
  const ma = mg.getImageData(0, 0, W, H).data;
  const img = g.getImageData(0, 0, W, H);
  const o = img.data;
  const grain = (light.grain ?? 1.5) * ss;
  const gain = light.gain * 0.9; // teeth in everyday photos are a little darker than in a flash close-up
  for (let i = 0; i < W * H; i++) {
    const n = (hash(i % W, (i / W) | 0, 11) + hash(i % W, (i / W) | 0, 12) - 1) * grain * 1.7;
    o[i * 4] = clamp(o[i * 4] * gain * light.tint[0] + n, 0, 255);
    o[i * 4 + 1] = clamp(o[i * 4 + 1] * gain * light.tint[1] + n, 0, 255);
    o[i * 4 + 2] = clamp(o[i * 4 + 2] * gain * light.tint[2] + n, 0, 255);
    o[i * 4 + 3] = ma[i * 4 + 3];
  }
  g.putImageData(img, 0, 0);
  finishLayer(ctx, g, lipsLayer, mouth, ps, b, light);
}

export { photoLight };
