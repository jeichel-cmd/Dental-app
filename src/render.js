// Draws the designed teeth into the patient's mouth on a canvas. Runs fully on the device.

import { layout, toothPath, outline, DEFAULT_DESIGN, clamp, lerp } from './teeth.js';
import { shadeRGB } from './shades.js';

// ---- small helpers ---------------------------------------------------------------------------


function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(Math.max(1, w), Math.max(1, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  return c;
}

// Smooth closed (or open) curve through points (Catmull-Rom as Bézier).
export function splinePath(points, closed = true) {
  const p = new Path2D();
  const n = points.length;
  if (n < 3) return p;
  const at = (i) => (closed ? points[(i + n) % n] : points[clamp(i, 0, n - 1)]);
  p.moveTo(points[0][0], points[0][1]);
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    p.bezierCurveTo(
      p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6,
      p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6,
      p2[0], p2[1],
    );
  }
  if (closed) p.closePath();
  return p;
}

function polyPath(points) {
  const p = new Path2D();
  points.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)));
  p.closePath();
  return p;
}

// Maps smile millimetres to photo pixels for a mouth and design.
export function transform(mouth, design) {
  const d = { ...DEFAULT_DESIGN, ...design };
  const s = mouth.pxPerMm;
  const a = mouth.roll + (d.rot * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const [ax, ay] = mouth.anchor;
  return ([x, y]) => {
    const X = (x + d.dx) * s;
    const Y = (y + d.dy) * s;
    return [ax + X * cos - Y * sin, ay + X * sin + Y * cos];
  };
}

// The lip outline, pulled inwards (positive) or pushed outwards (negative) by `mouth.lip` millimetres.
export function lipOutline(mouth) {
  const n = mouth.poly.length;
  const shift = (mouth.lip || 0) * mouth.pxPerMm;
  if (!shift) return mouth.poly;
  return mouth.poly.map((p, i) => {
    const a = mouth.poly[(i - 1 + n) % n];
    const b = mouth.poly[(i + 1) % n];
    // Normal of the outline at this point, pointing inside (the outline runs clockwise on screen).
    let nx = -(b[1] - a[1]);
    let ny = b[0] - a[0];
    const len = Math.hypot(nx, ny) || 1;
    nx /= len;
    ny /= len;
    const cx = mouth.poly.reduce((t, q) => t + q[0], 0) / n;
    const cy = mouth.poly.reduce((t, q) => t + q[1], 0) / n;
    if (nx * (cx - p[0]) + ny * (cy - p[1]) < 0) {
      nx = -nx;
      ny = -ny;
    }
    return [p[0] + nx * shift, p[1] + ny * shift];
  });
}

export function mouthBounds(mouth, pad = 0.15) {
  const xs = mouth.poly.map((p) => p[0]);
  const ys = mouth.poly.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  const px = (x1 - x0) * pad + 4;
  const py = (y1 - y0) * pad + 4;
  return { x: Math.floor(x0 - px), y: Math.floor(y0 - py), w: Math.ceil(x1 - x0 + 2 * px), h: Math.ceil(y1 - y0 + 2 * py) };
}

// Brightness and colour of the skin around the mouth, so the teeth match the photo's light.
export function photoLight(ctx, mouth) {
  const b = mouthBounds(mouth, 0.6);
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const x = clamp(b.x, 0, W - 1);
  const y = clamp(b.y, 0, H - 1);
  const w = clamp(b.w, 1, W - x);
  const h = clamp(b.h, 1, H - y);
  const data = ctx.getImageData(x, y, w, h).data;
  const inner = mouthBounds(mouth, 0.05);
  let r = 0;
  let g = 0;
  let bl = 0;
  let n = 0;
  for (let j = 0; j < h; j += 3) {
    for (let i = 0; i < w; i += 3) {
      const X = x + i;
      const Y = y + j;
      if (X > inner.x && X < inner.x + inner.w && Y > inner.y && Y < inner.y + inner.h) continue;
      const k = (j * w + i) * 4;
      r += data[k];
      g += data[k + 1];
      bl += data[k + 2];
      n++;
    }
  }
  if (!n) return { gain: 1, tint: [1, 1, 1], grain: 1.5 };
  const skin = [r / n, g / n, bl / n];
  const lum = (0.2126 * skin[0] + 0.7152 * skin[1] + 0.0722 * skin[2]) / 255;
  const gain = clamp(0.72 + lum * 0.55, 0.78, 1.1);
  // Gentle white balance: follow the photo's colour cast a little, relative to typical skin.
  const ref = [214, 166, 140];
  const norm = (c) => {
    const m = (c[0] + c[1] + c[2]) / 3 || 1;
    return c.map((v) => v / m);
  };
  const a = norm(skin);
  const e = norm(ref);
  const tint = a.map((v, i) => clamp(1 + (v / e[i] - 1) * 0.35, 0.85, 1.15));
  // Sensor grain: typical difference of a pixel to its neighbours on the skin, so the teeth get the same grain.
  const diffs = [];
  for (let j = 1; j < h - 1; j += 4) {
    for (let i = 1; i < w - 1; i += 4) {
      const L = (k) => 0.3 * data[k] + 0.59 * data[k + 1] + 0.11 * data[k + 2];
      const k = (j * w + i) * 4;
      diffs.push(Math.abs(L(k) - (L(k - 4) + L(k + 4) + L(k - w * 4) + L(k + w * 4)) / 4));
    }
  }
  diffs.sort((p, q) => p - q);
  const grain = clamp((diffs[Math.floor(diffs.length / 2)] || 1) * 1.2, 0.6, 7);
  return { gain, tint, grain, blur: edgeBlur(data, x, y, w, h, mouth) };
}

// How soft the photo is: width of the light-to-dark step across the lip edge, so the new teeth are exactly as sharp.
function edgeBlur(data, ox, oy, w, h, mouth) {
  const lum = (X, Y) => {
    const i = clamp(Math.round(X - ox), 0, w - 1);
    const j = clamp(Math.round(Y - oy), 0, h - 1);
    const k = (j * w + i) * 4;
    return 0.3 * data[k] + 0.59 * data[k + 1] + 0.11 * data[k + 2];
  };
  const poly = mouth.poly;
  const n = poly.length;
  const reach = Math.max(6, mouth.pxPerMm * 2.5);
  const widths = [];
  for (let i = 0; i < n; i++) {
    if (i === 0 || i === mouth.upper - 1) continue; // corners are too soft to judge
    const a = poly[(i - 1 + n) % n];
    const b = poly[(i + 1) % n];
    let nx = -(b[1] - a[1]);
    let ny = b[0] - a[0];
    const len = Math.hypot(nx, ny) || 1;
    nx /= len;
    ny /= len;
    const prof = [];
    for (let t = -reach; t <= reach; t += 0.5) prof.push(lum(poly[i][0] + nx * t, poly[i][1] + ny * t));
    const lo = Math.min(...prof);
    const hi = Math.max(...prof);
    if (hi - lo < 25) continue;
    // Steepest part of the profile and the distance it takes to go from 20% to 80% of the step.
    const t20 = lo + (hi - lo) * 0.2;
    const t80 = lo + (hi - lo) * 0.8;
    let best = Infinity;
    for (let s0 = 0; s0 < prof.length; s0++) {
      if (!(prof[s0] <= t20 || prof[s0] >= t80)) continue;
      const up = prof[s0] <= t20;
      for (let s1 = s0 + 1; s1 < prof.length; s1++) {
        if (up ? prof[s1] >= t80 : prof[s1] <= t20) {
          best = Math.min(best, (s1 - s0) * 0.5);
          break;
        }
      }
    }
    if (Number.isFinite(best)) widths.push(best);
  }
  if (widths.length < 3) return 0;
  widths.sort((p, q) => p - q);
  // A 20-80% rise of a blurred edge spans about 1.7 sigma; lips are never perfectly sharp, so allow a little.
  return clamp(widths[Math.floor(widths.length * 0.35)] / 1.7 - 0.5, 0, 8);
}

// ---- noise -------------------------------------------------------------------------------------

function hash(x, y, seed) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 982451653)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function vnoise(x, y, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi, seed);
  const b = hash(xi + 1, yi, seed);
  const c = hash(xi, yi + 1, seed);
  const d = hash(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

const fbm = (x, y, seed) => vnoise(x, y, seed) * 0.55 + vnoise(x * 2.1, y * 2.1, seed + 7) * 0.3 + vnoise(x * 4.3, y * 4.3, seed + 13) * 0.15;

const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

function norm3(x, y, z) {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

// Light as in a typical practice photo: from the front, a little from above and from the left.
const LIGHT = norm3(-0.14, -0.4, 1);
const HALF = norm3(LIGHT[0], LIGHT[1], LIGHT[2] + 1);
const WARM_DARK = [0.17, 0.06, 0.06];
const SIDE_TONE = [0.62, 0.55, 0.52]; // rounded tooth sides: a little darker and warmer

// ---- drawing -----------------------------------------------------------------------------------

function gumPath(teeth, map, jaw) {
  const row = teeth.filter((t) => t.jaw === jaw).sort((a, b) => (a.x0 + a.x1) - (b.x0 + b.x1));
  if (!row.length) return null;
  const pts = [];
  const upper = jaw === 'upper';
  const far = upper ? -40 : 40;
  const margin = (t) => (upper ? t.top : t.edge);
  row.forEach((t, i) => {
    const l = Math.min(t.x0, t.x1);
    const r = Math.max(t.x0, t.x1);
    const h = Math.abs(t.edge - t.top);
    const papilla = upper ? margin(t) + h * 0.46 : margin(t) - h * 0.4;
    const dip = upper ? h * 0.08 : -h * 0.08;
    if (i === 0) pts.push([l - 6, margin(t)]);
    pts.push([l, papilla], [l + (r - l) * 0.15, margin(t) + dip], [(l + r) / 2, margin(t)], [r - (r - l) * 0.15, margin(t) + dip], [r, papilla]);
    if (i === row.length - 1) pts.push([r + 6, margin(t)]);
  });
  pts.push([pts[pts.length - 1][0], far], [pts[0][0], far]);
  const p = new Path2D();
  pts.map(map).forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)));
  p.closePath();
  return p;
}

// Per-tooth constants for the shading.
function toothLook(t, d, base) {
  const upper = t.jaw === 'upper';
  const seed = t.index * 13 + (t.side > 0 ? 1 : 2) + (upper ? 0 : 50);
  const tr = clamp(d.translucency, 0, 1);
  const tex = clamp(d.texture, 0, 1);
  const startBase = { central: 0.72, lateral: 0.66, canine: 0.82 }[t.id] ?? 0.9;
  const incisalStart = lerp(0.93, startBase - 0.04, tr);
  // Canines are naturally a little darker and more saturated; each tooth varies slightly.
  const own = 1 + (hash(seed, 1, 3) - 0.5) * 0.05 * tex;
  const chroma = t.id === 'canine' ? [1, 0.975, 0.92] : t.id.startsWith('premolar') ? [1, 0.98, 0.94] : [1, 1, 1];
  const S = base.map((c, i) => (c / 255) * chroma[i] * own * (t.id === 'canine' ? 0.965 : 1));
  const lum = 0.3 * S[0] + 0.59 * S[1] + 0.11 * S[2];
  return {
    upper,
    seed,
    tr,
    tex,
    incisalStart,
    dentin: S.map((c, i) => c * [1, 0.955, 0.86][i] * 0.97),
    enamel: S.map((c) => c + (1 - c) * 0.1),
    incisal: [0.56, 0.6, 0.67].map((c) => c * (0.55 + lum * 0.45)),
    phi: Math.acos(clamp(t.facing, 0, 1)) * t.side,
    corridor: lerp(1, 0.4, Math.pow(clamp(t.z / 30, 0, 1), 0.85)),
    jaw: upper ? 1 : 0.72,
    gloss: (upper ? 1 : 0.5) * lerp(1, 0.75, tex),
  };
}

// Renders the smile for one photo. `ctx` already holds the photo at full size.
export function renderSmile(ctx, mouth, design, light = { gain: 1, tint: [1, 1, 1], grain: 1.5 }, { fast = false } = {}) {
  const d = { ...DEFAULT_DESIGN, ...design };
  const b = mouthBounds(mouth, 0.08);
  const s = mouth.pxPerMm;
  // Work at ~7 px per mm or more so small mouths still get crisp detail; a lighter pass while dragging.
  let ss = clamp(7 / s, 1, 3);
  ss = Math.min(ss, (fast ? 480 : 1800) / b.w);
  const W = Math.max(1, Math.round(b.w * ss));
  const H = Math.max(1, Math.round(b.h * ss));
  const ps = s * ss;
  const angle = mouth.roll + (d.rot * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const [ax, ay] = mouth.anchor;
  const toImg = transform(mouth, d);
  const toLayer = (p) => {
    const [X, Y] = toImg(p);
    return [(X - b.x) * ss, (Y - b.y) * ss];
  };
  // Layer pixel -> smile millimetres.
  const mmX = (px, py) => {
    const X = b.x + (px + 0.5) / ss - ax;
    const Y = b.y + (py + 0.5) / ss - ay;
    return (X * cos + Y * sin) / s - d.dx;
  };
  const mmY = (px, py) => {
    const X = b.x + (px + 0.5) / ss - ax;
    const Y = b.y + (py + 0.5) / ss - ay;
    return (-X * sin + Y * cos) / s - d.dy;
  };

  const maskCanvas = makeCanvas(W, H);
  const m = maskCanvas.getContext('2d', { willReadFrequently: true });
  const R = new Float32Array(W * H);
  const G = new Float32Array(W * H);
  const B = new Float32Array(W * H);
  const gain = light.gain;
  const tint = light.tint;

  // Inside of the mouth: dark, darkest towards the corners.
  const [cx0, cy0] = toLayer([0, -3]);
  const reach = 30 * ps;
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const r = Math.hypot(px - cx0, (py - cy0) * 1.6) / reach;
      const t = smooth(0, 1, r);
      const n = 1 + (vnoise(px / (ps * 3), py / (ps * 3), 77) - 0.5) * 0.2;
      const i = py * W + px;
      R[i] = lerp(0.3, 0.05, t) * n;
      G[i] = lerp(0.12, 0.02, t) * n;
      B[i] = lerp(0.13, 0.025, t) * n;
    }
  }

  const coverage = (path, x0, y0, x1, y1) => {
    const w = x1 - x0;
    const h = y1 - y0;
    m.setTransform(1, 0, 0, 1, 0, 0);
    m.clearRect(x0, y0, w, h);
    m.fillStyle = '#fff';
    m.fill(path);
    return m.getImageData(x0, y0, w, h).data;
  };

  const teeth = layout(d);

  // Gums: soft pink, lighter near the teeth, with fine stippling and a wet sheen.
  if (d.gum) {
    for (const jaw of d.lower ? ['upper', 'lower'] : ['upper']) {
      const gp = gumPath(teeth, toLayer, jaw);
      if (!gp) continue;
      const a = coverage(gp, 0, 0, W, H);
      const upper = jaw === 'upper';
      for (let py = 0; py < H; py++) {
        for (let px = 0; px < W; px++) {
          const i = py * W + px;
          const al = a[i * 4 + 3] / 255;
          if (!al) continue;
          const x = mmX(px, py);
          const y = mmY(px, py);
          const g = upper ? smooth(-16, -9, y) : smooth(15, 8, y);
          const stip = (fbm(x * 2.6, y * 2.6, 99) - 0.5) * 0.09;
          const sheen = Math.pow(fbm(x * 0.6, y * 0.9, 5), 3) * 0.22;
          const side = lerp(1, 0.38, smooth(12, 28, Math.abs(x)));
          const k = (1 + stip) * side;
          const cr = (lerp(0.55, 0.86, g) * k + sheen * side) * gain * tint[0];
          const cg = (lerp(0.24, 0.5, g) * k + sheen * side * 0.8) * gain * tint[1];
          const cb = (lerp(0.27, 0.52, g) * k + sheen * side * 0.8) * gain * tint[2];
          R[i] += (cr - R[i]) * al;
          G[i] += (cg - G[i]) * al;
          B[i] += (cb - B[i]) * al;
        }
      }
    }
  }

  // Teeth: lower jaw first, then upper; back teeth before front teeth.
  const base = shadeRGB(d.shade, d.bright);
  const order = [...teeth].sort((p, q) => (p.jaw !== q.jaw ? (p.jaw === 'lower' ? -1 : 1) : q.z - p.z));
  for (const t of order) {
    const pts = toothPath(t, d).map(toLayer);
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const x0 = clamp(Math.floor(Math.min(...xs)) - 1, 0, W);
    const x1 = clamp(Math.ceil(Math.max(...xs)) + 1, 0, W);
    const y0 = clamp(Math.floor(Math.min(...ys)) - 1, 0, H);
    const y1 = clamp(Math.ceil(Math.max(...ys)) + 1, 0, H);
    if (x1 <= x0 || y1 <= y0) continue;
    const path = new Path2D();
    pts.forEach(([x, y], i) => (i ? path.lineTo(x, y) : path.moveTo(x, y)));
    path.closePath();
    const a = coverage(path, x0, y0, x1, y1);
    const L = toothLook(t, d, base);
    const shape = outline(t, d).shape;
    const cx = (t.x0 + t.x1) / 2;
    const w = Math.abs(t.x1 - t.x0);
    const h = t.edge - t.top;
    const cphi = Math.cos(L.phi);
    const sphi = Math.sin(L.phi);
    const bw = x1 - x0;
    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        const al = a[((py - y0) * bw + (px - x0)) * 4 + 3] / 255;
        if (!al) continue;
        const x = mmX(px, py);
        const y = mmY(px, py);
        const v = clamp(L.upper ? (y - t.top) / h : (t.edge - y) / h, 0, 1.04);
        const u = ((x - cx) / w) * t.side;
        const half = shape.halfW(clamp(v, shape.capH, 1)) || 0.5;
        const un = clamp(u / half / 1, -1, 1);
        const au = Math.abs(un);

        // Surface direction: flat in the middle, rounding off towards the sides; bulging at the neck.
        const nxl = Math.sign(un) * Math.pow(au, 2.2) * 0.93;
        let nyl = L.upper ? lerp(-0.42, 0.3, v) : lerp(0.42, -0.25, v);
        nyl += smooth(0.9, 1.02, v) * 0.35 * (L.upper ? 1 : -1);
        const nzl = Math.sqrt(Math.max(0.04, 1 - nxl * nxl - nyl * nyl));
        const [nx, ny, nz] = norm3(nxl * cphi + nzl * sphi, nyl, -nxl * sphi + nzl * cphi);

        const ndl = nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2];
        const diff = 0.5 + 0.56 * Math.max(0, ndl);
        const ndh = Math.max(0, nx * HALF[0] + ny * HALF[1] + nz * HALF[2]);
        const n1 = fbm(x * 0.9 + L.seed, y * 0.9, L.seed) - 0.5;
        const streak = 0.5 + 0.5 * fbm(u * 2.4 + L.seed * 0.37, v * 6.5, L.seed + 3);
        // Fine horizontal growth lines in the enamel (perikymata).
        const peri = Math.sin(((L.upper ? y : -y) * Math.PI * 2) / 0.32 + n1 * 9 + u * 3);
        let spec = (Math.pow(ndh, 90) * 0.85 + Math.pow(ndh, 16) * 0.1) * streak * L.gloss;
        spec *= 1 + peri * 0.1 * L.tex * (0.5 + n1);
        const fres = Math.pow(1 - Math.max(0, nz), 2.4);

        // Colour layers: warmer dentin at the neck, enamel in the body, translucent biting edge with mamelons.
        const cerv = 1 - smooth(0, 0.45, v);
        const lobe = Math.pow(Math.cos(un * Math.PI * 1.5), 2);
        const tEdge = smooth(L.incisalStart + 0.08 * lobe * (0.4 + 0.6 * L.tex), 1, v) * (0.3 + 0.7 * L.tr);
        const side = fres * 0.2 * L.tr;
        const halo = smooth(0.965, 0.988, v) * (1 - smooth(0.99, 1.02, v)) * 0.12 * (0.4 + L.tr);
        const texMul = 1 + n1 * 0.06 * L.tex + peri * 0.006 * L.tex;
        const ao = (0.6 + 0.4 * smooth(0, 0.22, v)) * (1 - 0.45 * smooth(0.7, 1, au));
        const lit = diff * texMul * gain;
        // Shadowed parts of the mouth take on the warm dark of the mouth, not grey.
        const occ = ao * L.corridor * L.jaw;
        const i = py * W + px;
        const col = [0, 1, 2].map((c) => {
          let alb = L.enamel[c] + (L.dentin[c] - L.enamel[c]) * cerv * 0.75;
          alb += (L.incisal[c] - alb) * tEdge;
          alb += (SIDE_TONE[c] * (0.6 + 0.4 * alb) - alb) * side;
          return WARM_DARK[c] + (alb * lit * tint[c] - WARM_DARK[c]) * occ + spec * L.corridor + halo * L.corridor;
        });
        R[i] += (col[0] - R[i]) * al;
        G[i] += (col[1] - G[i]) * al;
        B[i] += (col[2] - B[i]) * al;
      }
    }
  }

  // Mouth outline with a soft edge decides what is visible.
  const lips = lipOutline(mouth);
  const lipsLayer = lips.map(([X, Y]) => [(X - b.x) * ss, (Y - b.y) * ss]);
  m.setTransform(1, 0, 0, 1, 0, 0);
  m.clearRect(0, 0, W, H);
  if ('filter' in m) m.filter = `blur(${Math.max(1, s * 0.25 * ss)}px)`;
  m.fillStyle = '#fff';
  m.fill(splinePath(lipsLayer));
  if ('filter' in m) m.filter = 'none';
  const mouthA = m.getImageData(0, 0, W, H).data;

  // Final pixels, with the photo's own grain so the teeth don't look pasted in.
  const out = m.createImageData(W, H);
  const o = out.data;
  const grain = (light.grain ?? 1.5) * ss;
  for (let i = 0; i < W * H; i++) {
    const nz = (hash(i % W, (i / W) | 0, 11) + hash(i % W, (i / W) | 0, 12) - 1) * grain * 1.7;
    o[i * 4] = clamp(R[i] * 255 + nz, 0, 255);
    o[i * 4 + 1] = clamp(G[i] * 255 + nz, 0, 255);
    o[i * 4 + 2] = clamp(B[i] * 255 + nz, 0, 255);
    o[i * 4 + 3] = mouthA[i * 4 + 3];
  }
  const layer = makeCanvas(W, H);
  const g = layer.getContext('2d');
  g.putImageData(out, 0, 0);

  // Shadows from the lips and the corners of the mouth, only on what is visible.
  g.globalCompositeOperation = 'source-atop';
  const up = lipsLayer.slice(0, mouth.upper);
  const lo = [lipsLayer[mouth.upper - 1], ...lipsLayer.slice(mouth.upper), lipsLayer[0]];
  g.lineCap = 'round';
  if ('filter' in g) g.filter = `blur(${Math.max(1, ps * 1.3)}px)`;
  g.strokeStyle = 'rgba(28,8,8,0.5)';
  g.lineWidth = ps * 2.4;
  g.stroke(splinePath(up, false));
  g.strokeStyle = 'rgba(28,8,8,0.28)';
  g.lineWidth = ps * 1.6;
  g.stroke(splinePath(lo, false));
  if ('filter' in g) g.filter = 'none';
  for (const p of [lipsLayer[0], lipsLayer[mouth.upper - 1]]) {
    const r = ps * 10;
    const corner = g.createRadialGradient(p[0], p[1], 0, p[0], p[1], r);
    corner.addColorStop(0, 'rgba(12,3,3,0.8)');
    corner.addColorStop(1, 'rgba(12,3,3,0)');
    g.fillStyle = corner;
    g.fillRect(p[0] - r, p[1] - r, r * 2, r * 2);
  }

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  if (light.blur > 0.3 && 'filter' in ctx) ctx.filter = `blur(${light.blur.toFixed(2)}px)`;
  ctx.drawImage(layer, b.x, b.y, b.w, b.h);
  ctx.restore();
}
