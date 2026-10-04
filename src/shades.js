// Tooth shades by the VITA classical guide plus bleach shades, as approximate screen colours.
// Screens and photos cannot show a real shade exactly; the shade guide in the practice decides.

export const SHADES = [
  { id: 'BL1', group: 'Bleach', rgb: [246, 243, 234] },
  { id: 'BL2', group: 'Bleach', rgb: [242, 238, 226] },
  { id: 'BL3', group: 'Bleach', rgb: [238, 232, 216] },
  { id: 'A1', group: 'A', rgb: [237, 228, 207] },
  { id: 'A2', group: 'A', rgb: [232, 219, 190] },
  { id: 'A3', group: 'A', rgb: [224, 207, 172] },
  { id: 'A3.5', group: 'A', rgb: [216, 196, 157] },
  { id: 'A4', group: 'A', rgb: [204, 181, 139] },
  { id: 'B1', group: 'B', rgb: [240, 234, 215] },
  { id: 'B2', group: 'B', rgb: [234, 222, 191] },
  { id: 'B3', group: 'B', rgb: [223, 205, 162] },
  { id: 'B4', group: 'B', rgb: [215, 194, 147] },
  { id: 'C1', group: 'C', rgb: [226, 220, 203] },
  { id: 'C2', group: 'C', rgb: [216, 205, 180] },
  { id: 'C3', group: 'C', rgb: [205, 192, 162] },
  { id: 'C4', group: 'C', rgb: [189, 174, 140] },
  { id: 'D2', group: 'D', rgb: [225, 216, 196] },
  { id: 'D3', group: 'D', rgb: [217, 204, 178] },
  { id: 'D4', group: 'D', rgb: [211, 196, 164] },
];

export function shadeRGB(id, bright = 0) {
  const s = SHADES.find((x) => x.id === id) || SHADES.find((x) => x.id === 'A2');
  const t = Math.max(-1, Math.min(1, bright)) * 0.12;
  return s.rgb.map((v) => (t >= 0 ? v + (255 - v) * t : v * (1 + t)));
}
