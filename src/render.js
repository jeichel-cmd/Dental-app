// Draws the designed teeth into the patient's mouth on a canvas. Runs fully on the device.

import { layout, toothPath, DEFAULT_DESIGN, clamp, lerp } from './teeth.js';
import { shadeRGB } from './shades.js';

// ---- small helpers ---------------------------------------------------------------------------

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const rgb = (c, a = 1) => `rgba(${c.map((v) => Math.round(clamp(v, 0, 255))).join(',')},${a})`;

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
  if (!n) return { gain: 1, tint: [1, 1, 1] };
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
  return { gain, tint };
}

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
    const papilla = upper ? margin(t) + h * 0.3 : margin(t) - h * 0.3;
    if (i === 0) pts.push([l - 6, margin(t)]);
    pts.push([l, papilla], [l + (r - l) * 0.15, margin(t) + (upper ? h * 0.08 : -h * 0.08)], [(l + r) / 2, margin(t)], [r - (r - l) * 0.15, margin(t) + (upper ? h * 0.08 : -h * 0.08)], [r, papilla]);
    if (i === row.length - 1) pts.push([r + 6, margin(t)]);
  });
  pts.push([pts[pts.length - 1][0], far], [pts[0][0], far]);
  return polyPath(pts.map(map));
}

function drawTooth(g, tooth, design, map, base, s) {
  const path = polyPath(toothPath(tooth, design).map(map));
  const upper = tooth.jaw === 'upper';
  const cx = (tooth.x0 + tooth.x1) / 2;
  const w = Math.abs(tooth.x1 - tooth.x0);
  const gumY = upper ? tooth.top : tooth.edge;
  const edgeY = upper ? tooth.edge : tooth.top;
  // Teeth further back sit in the shadow of the cheeks (the "buccal corridor").
  const depth = clamp(tooth.z / 22, 0, 1);
  const dark = lerp(1, 0.55, depth) * (upper ? 1 : 0.88) * lerp(0.9, 1, tooth.facing);
  const c = base.map((v) => v * dark);

  const [gx0, gy0] = map([cx, gumY]);
  const [gx1, gy1] = map([cx, edgeY]);
  const vert = g.createLinearGradient(gx0, gy0, gx1, gy1);
  vert.addColorStop(0, rgb(mix(c, [190, 140, 95].map((v) => v * dark), 0.35)));
  vert.addColorStop(0.3, rgb(c));
  vert.addColorStop(0.78, rgb(mix(c, [255, 255, 255], 0.04)));
  vert.addColorStop(0.93, rgb(mix(c, [150, 160, 175].map((v) => v * dark), 0.35)));
  vert.addColorStop(1, rgb(mix(c, [120, 128, 140].map((v) => v * dark), 0.55)));
  g.fillStyle = vert;
  g.fill(path);

  g.save();
  g.clip(path);
  // Round surface: darker towards both sides, more on the side facing away.
  const [hx0, hy0] = map([cx - (w / 2) * tooth.side, (gumY + edgeY) / 2]);
  const [hx1, hy1] = map([cx + (w / 2) * tooth.side, (gumY + edgeY) / 2]);
  const horiz = g.createLinearGradient(hx0, hy0, hx1, hy1);
  horiz.addColorStop(0, 'rgba(70,40,30,0.30)');
  horiz.addColorStop(0.22, 'rgba(70,40,30,0)');
  horiz.addColorStop(0.68, 'rgba(70,40,30,0)');
  horiz.addColorStop(1, 'rgba(60,35,25,0.42)');
  g.fillStyle = horiz;
  g.fill(path);
  // Soft light reflection on the front teeth.
  if (upper && tooth.facing > 0.6) {
    const [lx, ly] = map([cx - w * 0.08 * tooth.side, gumY + (edgeY - gumY) * 0.42]);
    const rad = w * s * 0.42;
    const glow = g.createRadialGradient(lx, ly, 0, lx, ly, rad);
    glow.addColorStop(0, `rgba(255,255,255,${0.28 * tooth.facing})`);
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = glow;
    g.fillRect(lx - rad, ly - rad, rad * 2, rad * 2);
  }
  // Shadow near the gum line.
  const [sx, sy] = map([cx, gumY]);
  const neck = g.createLinearGradient(sx, sy, gx1, gy1);
  neck.addColorStop(0, 'rgba(90,40,30,0.25)');
  neck.addColorStop(0.18, 'rgba(90,40,30,0)');
  g.fillStyle = neck;
  g.fill(path);
  g.restore();

  g.lineWidth = Math.max(0.5, 0.1 * s);
  g.strokeStyle = `rgba(60,38,30,${upper ? 0.3 : 0.24})`;
  g.stroke(path);
}

// Renders the smile for one photo. `ctx` already holds the photo at full size.
export function renderSmile(ctx, mouth, design, light = { gain: 1, tint: [1, 1, 1] }) {
  const d = { ...DEFAULT_DESIGN, ...design };
  const b = mouthBounds(mouth, 0.08);
  const layer = makeCanvas(b.w, b.h);
  const g = layer.getContext('2d');
  g.translate(-b.x, -b.y);
  const s = mouth.pxPerMm * 1;
  const toPx = transform(mouth, d);
  const lips = lipOutline(mouth);
  const mouthShape = splinePath(lips);
  const [ax, ay] = toPx([0, -4]);

  // Inside of the mouth.
  const cavity = g.createRadialGradient(ax, ay, 0, ax, ay, b.w * 0.55);
  cavity.addColorStop(0, '#4a2224');
  cavity.addColorStop(0.6, '#2a1012');
  cavity.addColorStop(1, '#120506');
  g.fillStyle = cavity;
  g.fill(mouthShape);

  const teeth = layout(d);
  const base = shadeRGB(d.shade, d.bright).map((v, i) => v * light.gain * light.tint[i]);

  // Gums behind the teeth.
  if (d.gum) {
    for (const jaw of d.lower ? ['upper', 'lower'] : ['upper']) {
      const gp = gumPath(teeth, toPx, jaw);
      if (!gp) continue;
      const [x0, y0] = toPx([0, jaw === 'upper' ? -16 : 12]);
      const [x1, y1] = toPx([0, jaw === 'upper' ? -9 : 6]);
      const gum = g.createLinearGradient(x0, y0, x1, y1);
      const gc = [196, 104, 108].map((v, i) => v * light.gain * light.tint[i]);
      gum.addColorStop(0, rgb(gc.map((v) => v * 0.7)));
      gum.addColorStop(1, rgb(gc));
      g.fillStyle = gum;
      g.fill(gp);
    }
  }

  // Lower teeth first, then upper; back teeth before front teeth.
  const order = [...teeth].sort((p, q) => (p.jaw !== q.jaw ? (p.jaw === 'lower' ? -1 : 1) : q.z - p.z));
  for (const t of order) drawTooth(g, t, d, toPx, base, s);

  // Shadow cast by the lips onto the teeth.
  g.save();
  g.clip(mouthShape);
  const up = lips.slice(0, mouth.upper);
  const lo = [lips[mouth.upper - 1], ...lips.slice(mouth.upper), lips[0]];
  if ('filter' in g) g.filter = `blur(${Math.max(1, s * 1.1)}px)`;
  g.lineCap = 'round';
  g.strokeStyle = 'rgba(30,8,8,0.45)';
  g.lineWidth = s * 2.0;
  g.stroke(splinePath(up, false));
  g.strokeStyle = 'rgba(30,8,8,0.35)';
  g.lineWidth = s * 1.8;
  g.stroke(splinePath(lo, false));
  // Corners of the mouth are darker.
  for (const p of [lips[0], lips[mouth.upper - 1]]) {
    const r = s * 9;
    const corner = g.createRadialGradient(p[0], p[1], 0, p[0], p[1], r);
    corner.addColorStop(0, 'rgba(15,4,4,0.75)');
    corner.addColorStop(1, 'rgba(15,4,4,0)');
    g.fillStyle = corner;
    g.fillRect(p[0] - r, p[1] - r, r * 2, r * 2);
  }
  g.restore();

  // Keep everything inside the lips, with a soft edge.
  g.globalCompositeOperation = 'destination-in';
  if ('filter' in g) g.filter = `blur(${Math.max(1.2, s * 0.3)}px)`;
  g.fillStyle = '#000';
  g.fill(mouthShape);
  g.globalCompositeOperation = 'source-over';
  if ('filter' in g) g.filter = 'none';

  ctx.save();
  if ('filter' in ctx) ctx.filter = `blur(${Math.max(0, s * 0.05)}px)`;
  ctx.drawImage(layer, b.x, b.y);
  ctx.restore();
}
