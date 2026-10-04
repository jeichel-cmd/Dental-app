import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layout, toothPath, xAtArc } from '../src/teeth.js';
import { applyLook, LOOKS } from '../src/looks.js';
import { shadeRGB } from '../src/shades.js';

test('arc length walks along the arch', () => {
  assert.equal(xAtArc(10, 0), 10);
  assert.ok(xAtArc(10, 0.05) < 10);
});

test('upper teeth mirror around the midline, centrals widest and longest', () => {
  const t = layout({ lower: false });
  assert.equal(t.length, 12);
  const right = t.filter((x) => x.side === 1);
  const width = (x) => Math.abs(x.x1 - x.x0);
  assert.ok(width(right[0]) > width(right[1]));
  assert.ok(right[0].edge > right[1].edge, 'laterals end higher than centrals');
  const left = t.find((x) => x.side === -1 && x.id === 'central');
  assert.equal(left.x1, -right[0].x1);
});

test('bigger, longer and gaps change the layout as expected', () => {
  const base = layout({ lower: false });
  const big = layout({ size: 1.2, lower: false });
  assert.ok(big[0].x1 > base[0].x1);
  const long = layout({ length: 1.2, lower: false });
  assert.ok(long[0].edge - long[0].top > base[0].edge - base[0].top);
  const gap = layout({ diastema: 1, lower: false });
  assert.ok(gap[0].x0 > 0.9);
});

test('tooth outlines are closed shapes inside their box', () => {
  for (const form of ['oval', 'square', 'triangle']) {
    for (const t of layout({ form })) {
      const pts = toothPath(t, { form });
      assert.ok(pts.length > 20);
      const xs = pts.map((p) => p[0]);
      const lo = Math.min(t.x0, t.x1) - 0.6;
      const hi = Math.max(t.x0, t.x1) + 0.6;
      assert.ok(xs.every((x) => x >= lo && x <= hi), `${form} ${t.id} stays in its box`);
      assert.ok(pts.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1])));
    }
  }
});

test('looks keep the position on the photo', () => {
  const current = { dx: 3, dy: -1, rot: 2, lower: false, gum: true };
  const next = applyLook(current, LOOKS[4].design);
  assert.equal(next.dx, 3);
  assert.equal(next.shade, 'BL2');
});

test('brightness lightens and darkens a shade', () => {
  const [r] = shadeRGB('A2');
  assert.ok(shadeRGB('A2', 1)[0] > r);
  assert.ok(shadeRGB('A2', -1)[0] < r);
});
