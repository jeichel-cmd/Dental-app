// Starting points for the try-on, following common smile-design guidelines
// (tooth form, incisal edge and smile line by personality and age). Each one only sets the shape and colour;
// position and the lip outline stay as they are.

export const LOOKS = [
  {
    id: 'natural',
    name: 'Natürlich',
    note: 'Ovale Form, sanfte Lachlinie, A2',
    design: { form: 'oval', size: 1, length: 1, width: 1, edges: 0.4, canines: 0.45, step: 0.5, curve: 0.55, gaps: 0, diastema: 0, arch: 0.5, shade: 'A2', bright: 0 },
  },
  {
    id: 'youthful',
    name: 'Jugendlich',
    note: 'Lange Einser, runde Ecken, deutliche Stufe, hell',
    design: { form: 'oval', size: 1.02, length: 1.12, width: 0.96, edges: 0.2, canines: 0.35, step: 0.85, curve: 0.8, gaps: 0, diastema: 0, arch: 0.55, shade: 'A1', bright: 0.2 },
  },
  {
    id: 'soft',
    name: 'Feminin & weich',
    note: 'Oval, abgerundete Kanten, geschwungen',
    design: { form: 'oval', size: 0.96, length: 1.05, width: 0.94, edges: 0.1, canines: 0.25, step: 0.7, curve: 0.75, gaps: 0, diastema: 0, arch: 0.5, shade: 'B1', bright: 0.1 },
  },
  {
    id: 'strong',
    name: 'Markant',
    note: 'Eckige Form, gerade Kanten, spitze Eckzähne',
    design: { form: 'square', size: 1.05, length: 1, width: 1.08, edges: 0.85, canines: 0.85, step: 0.2, curve: 0.3, gaps: 0, diastema: 0, arch: 0.6, shade: 'A2', bright: 0 },
  },
  {
    id: 'hollywood',
    name: 'Hollywood',
    note: 'Breit, gleichmäßig, sehr hell',
    design: { form: 'square', size: 1.08, length: 1.08, width: 1.05, edges: 0.55, canines: 0.3, step: 0.15, curve: 0.5, gaps: 0, diastema: 0, arch: 0.9, shade: 'BL2', bright: 0.3 },
  },
  {
    id: 'mature',
    name: 'Reif & dezent',
    note: 'Kürzer, abgenutzte gerade Kanten, wärmer',
    design: { form: 'square', size: 0.97, length: 0.9, width: 1.04, edges: 0.75, canines: 0.25, step: 0.1, curve: 0.2, gaps: 0.1, diastema: 0, arch: 0.45, shade: 'A3', bright: -0.1 },
  },
  {
    id: 'tapered',
    name: 'Spitz zulaufend',
    note: 'Dreieckige Form, schmaler Zahnhals',
    design: { form: 'triangle', size: 1, length: 1.02, width: 1, edges: 0.5, canines: 0.6, step: 0.55, curve: 0.6, gaps: 0, diastema: 0, arch: 0.45, shade: 'A2', bright: 0 },
  },
  {
    id: 'character',
    name: 'Mit Charakter',
    note: 'Kleine Lücken und Mittellücke',
    design: { form: 'oval', size: 1, length: 1, width: 1, edges: 0.45, canines: 0.5, step: 0.6, curve: 0.55, gaps: 0.35, diastema: 0.6, arch: 0.5, shade: 'A2', bright: 0 },
  },
];

// Settings that belong to the photo rather than the look.
export const PLACEMENT = ['dx', 'dy', 'rot', 'lower', 'gum'];

export function applyLook(current, look) {
  const keep = Object.fromEntries(PLACEMENT.map((k) => [k, current[k]]).filter(([, v]) => v !== undefined));
  return { ...current, ...look, ...keep };
}
