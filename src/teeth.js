// The tooth model: turns a handful of easy settings into tooth outlines, in millimetres.
// No drawing here, so it can be tested on its own. x goes right from the midline, y goes down,
// and y = 0 is the incisal edge of the upper central incisors.

// Average adult crown sizes in mm (width across, visible crown height), midline outwards.
const UPPER = [
  { id: 'central', w: 8.6, h: 10.6 },
  { id: 'lateral', w: 6.6, h: 9.0 },
  { id: 'canine', w: 7.6, h: 10.0 },
  { id: 'premolar1', w: 7.0, h: 8.4 },
  { id: 'premolar2', w: 6.6, h: 7.6 },
  { id: 'molar', w: 10.0, h: 6.8 },
];
const LOWER = [
  { id: 'central', w: 5.3, h: 9.0 },
  { id: 'lateral', w: 5.9, h: 9.2 },
  { id: 'canine', w: 6.9, h: 10.5 },
  { id: 'premolar1', w: 7.0, h: 8.2 },
  { id: 'premolar2', w: 7.1, h: 7.6 },
  { id: 'molar', w: 11.0, h: 7.0 },
];

// Tooth forms used in denture tooth selection: oval (ovoid), square, tapering (triangular).
export const FORMS = {
  oval: { cervical: 0.74, widest: 0.5, incisal: 0.9, bulge: 0.05 },
  square: { cervical: 0.86, widest: 0.72, incisal: 1.0, bulge: 0.0 },
  triangle: { cervical: 0.62, widest: 0.86, incisal: 1.0, bulge: 0.0 },
};

export const DEFAULT_DESIGN = Object.freeze({
  form: 'oval',
  size: 1, // overall size, 0.8 to 1.25
  length: 1, // crown length, 0.8 to 1.25
  width: 1, // crown width, 0.85 to 1.15
  edges: 0.4, // incisal corners: 0 soft and round, 1 sharp and angular
  canines: 0.45, // 0 round, 1 pointed
  step: 0.5, // how much shorter the lateral incisors are: 0 level, 1 pronounced
  curve: 0.5, // smile line: 0 flat, 1 strongly curved
  gaps: 0, // 0 tight contacts, 1 visible gaps
  diastema: 0, // gap between the two front teeth, 0 to 1
  arch: 0.5, // 0 narrow, 1 broad
  shade: 'A2',
  bright: 0, // -1 darker to 1 brighter
  translucency: 0.55, // biting edges: 0 opaque, 1 very translucent like young natural teeth
  texture: 0.5, // surface character: 0 smooth and uniform, 1 natural texture and colour play
  lower: true, // show lower teeth
  gum: true, // show gum between the teeth
  dx: 0, // position offset in mm, set by dragging
  dy: 0,
  rot: 0, // degrees
});

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, t) => a + (b - a) * t;

// Arch as a parabola: depth z = k·x². Narrow arches curve back faster.
function archK(arch, lower) {
  return lerp(0.05, 0.024, clamp(arch, 0, 1)) * (lower ? 1.15 : 1);
}

// x position on the parabola reached after walking an arc length s from the midline.
export function xAtArc(s, k) {
  let x = 0;
  let walked = 0;
  const step = 0.02;
  while (walked < s) {
    const d = step * Math.sqrt(1 + (2 * k * x) ** 2);
    if (walked + d >= s) return x + (step * (s - walked)) / d;
    walked += d;
    x += step;
  }
  return x;
}

// Lay the teeth of one quadrant along the arch and project them to the front view.
// Returns one entry per tooth on the right side; the left side mirrors it.
function quadrant(design, lower) {
  const sizes = lower ? LOWER : UPPER;
  const k = archK(design.arch, lower);
  const scaleW = design.size * design.width;
  const scaleH = design.size * design.length;
  const gap = design.gaps * 0.9 - 0.08; // a slight overlap reads as tight contacts
  const half = (design.diastema * 2.2) / 2;
  const focal = 320; // camera distance in mm, for a gentle perspective
  let s = half;
  const out = [];
  sizes.forEach((t, i) => {
    const w = t.w * scaleW;
    const x0 = xAtArc(s, k);
    const x1 = xAtArc(s + w, k);
    const xm = (x0 + x1) / 2;
    const z = k * xm * xm;
    const facing = Math.cos(Math.atan(2 * k * xm)); // 1 = facing the camera
    const p = focal / (focal + z);
    out.push({ ...t, index: i, x0: x0 * p, x1: x1 * p, z, facing, persp: p, h: t.h * scaleH * p, wReal: w });
    s += w + Math.max(gap, -0.15);
  });
  return out;
}

// Height of the incisal edge at horizontal position x (mm). Positive = higher up (smaller y).
function smileRise(x, curve) {
  const c = lerp(0.0015, 0.0115, clamp(curve, 0, 1));
  return c * x * x;
}

export function layout(design) {
  const d = { ...DEFAULT_DESIGN, ...design };
  const teeth = [];
  for (const t of quadrant(d, false)) {
    const xm = (t.x0 + t.x1) / 2;
    let edge = -smileRise(xm, d.curve);
    if (t.id === 'lateral') edge -= lerp(0, 1.6, d.step) * d.size;
    if (t.id === 'canine') edge -= 0.2;
    const top = edge - t.h;
    for (const side of [1, -1]) {
      teeth.push({ ...t, jaw: 'upper', side, x0: side * t.x0, x1: side * t.x1, top, edge });
    }
  }
  if (d.lower) {
    // Lower incisal edges sit about 2 mm behind and above the upper ones (overbite).
    for (const t of quadrant(d, true)) {
      const xm = (t.x0 + t.x1) / 2;
      const edge = -2.2 - smileRise(xm, d.curve) * 0.7 + (t.id === 'canine' ? -0.6 : 0);
      for (const side of [1, -1]) {
        teeth.push({ ...t, jaw: 'lower', side, x0: side * t.x0, x1: side * t.x1, top: edge, edge: edge + t.h });
      }
    }
  }
  return teeth;
}

// Outline of one tooth in its own box: u from -0.5 (towards the midline) to 0.5, v from 0 (gum) to 1 (biting edge).
// Lower teeth use the same outline flipped vertically.
export function outline(tooth, design) {
  const d = { ...DEFAULT_DESIGN, ...design };
  const f = FORMS[d.form] || FORMS.oval;
  const id = tooth.id;
  const back = id === 'premolar1' || id === 'premolar2' || id === 'molar';
  const cervical = back ? 0.8 : f.cervical;
  const widestAt = back ? 0.55 : f.widest;
  const incisal = back ? 0.9 : f.incisal;
  // Corner radii as a share of the tooth width. Laterals are softer by nature; the distal corner is always rounder.
  let r = lerp(0.3, 0.05, clamp(d.edges, 0, 1));
  if (id === 'lateral') r += 0.08;
  if (back) r = 0.22;
  const rMesial = r;
  const rDistal = r * 1.45;
  // Cusp depth for canines and premolars.
  let cusp = 0;
  if (id === 'canine') cusp = lerp(0.04, 0.2, clamp(d.canines, 0, 1));
  if (id === 'premolar1') cusp = lerp(0.03, 0.12, clamp(d.canines, 0, 1));
  if (id === 'premolar2') cusp = 0.05;
  const capH = 0.16; // height of the rounded gum margin

  const halfW = (v) => {
    // Width profile from the neck of the tooth to the biting edge.
    if (v <= widestAt) {
      const t = (v - capH) / Math.max(widestAt - capH, 0.01);
      return 0.5 * lerp(cervical, 1, Math.sin((clamp(t, 0, 1) * Math.PI) / 2));
    }
    const t = (v - widestAt) / Math.max(1 - widestAt, 0.01);
    return 0.5 * lerp(1, incisal, t * t) + f.bulge * Math.sin(t * Math.PI) * 0.1;
  };

  const pts = [];
  // Gum margin: a rounded cap, highest in the middle (slightly distal, like a real zenith).
  const capW = halfW(capH);
  for (let i = 0; i <= 12; i++) {
    const a = Math.PI + (i / 12) * Math.PI;
    pts.push([Math.cos(a) * capW + 0.04 * Math.sin((i / 12) * Math.PI), capH + Math.sin(a) * capH]);
  }
  // Biting edge: slightly convex, or a cusp for canines and premolars.
  const ue = halfW(1);
  const edgeY = (u) => (cusp ? 1 - cusp * Math.min(1, Math.abs(u + 0.02) / 0.5) : 1 + 0.015 * Math.cos(u * Math.PI));
  const sideEnd = (sign, rr) => Math.min(1 - rr * 0.9, edgeY(sign * ue) - 0.03);
  // Distal side (u > 0) down to the corner.
  for (let v = capH; v <= sideEnd(1, rDistal); v += 0.04) pts.push([halfW(v), v]);
  const corner = (sign, rr) => {
    // Quadratic curve from the side round to the edge.
    const p0 = [sign * halfW(sideEnd(sign, rr)), sideEnd(sign, rr)];
    const p1 = [sign * ue, edgeY(sign * ue)];
    const p2 = [sign * (ue - rr), edgeY(sign * (ue - rr))];
    const seg = [];
    for (let i = 1; i <= 8; i++) {
      const t = i / 8;
      seg.push([
        (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0],
        (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1],
      ]);
    }
    return seg;
  };
  pts.push(...corner(1, rDistal));
  for (let u = ue - rDistal - 0.03; u > -ue + rMesial + 0.03; u -= 0.03) pts.push([u, edgeY(u)]);
  // Mesial corner, walked from the edge back up to the side.
  const mesial = corner(-1, rMesial).reverse();
  pts.push(...mesial.slice(1), [-halfW(sideEnd(-1, rMesial)), sideEnd(-1, rMesial)]);
  // Mesial side back up to the gum.
  for (let v = sideEnd(-1, rMesial) - 0.04; v > capH; v -= 0.04) pts.push([-halfW(v), v]);
  pts.shape = { halfW, edgeY, capH, cusp };
  return pts;
}

// Outline of a tooth in smile millimetres, with u flipped so "mesial" always faces the midline.
export function toothPath(tooth, design) {
  const local = outline(tooth, design);
  const w = Math.abs(tooth.x1 - tooth.x0);
  const cx = (tooth.x0 + tooth.x1) / 2;
  const h = tooth.edge - tooth.top;
  return local.map(([u, v]) => {
    const x = cx + u * w * tooth.side; // side=1: right of midline, mesial (u<0) points left
    const y = tooth.jaw === 'upper' ? tooth.top + v * h : tooth.edge - v * h;
    return [x, y];
  });
}

export { UPPER, LOWER, clamp, lerp };
