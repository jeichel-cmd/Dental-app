// Draws the new teeth: either a real photo from the catalogue (design.source = 'photo:<id>')
// or the drawn tooth model (no source).

import { renderSmile } from './render.js';
import { BUILT_IN, prepare, forget, renderPhotoSmile } from './catalog.js';

let own = []; // the practice's own catalogue photos: { id, name, points, lips, upper }
let loadOwn = async () => null; // id -> Blob of the photo

const ready = new Map(); // id -> prepared cut-out

export function setCatalog(entries, loader) {
  own = entries || [];
  if (loader) loadOwn = loader;
}

export const catalog = () => [...BUILT_IN, ...own];
export const isOwn = (id) => own.some((e) => e.id === id);

export function sourceId(design) {
  return design?.source?.startsWith('photo:') ? design.source.slice(6) : null;
}

// The catalogue entry a design uses. A removed photo falls back to the first built-in one.
export function entryFor(design) {
  const id = sourceId(design);
  if (!id) return null;
  return catalog().find((e) => e.id === id) || BUILT_IN[0];
}

// Loads and cuts out the catalogue photo a design needs. Call before paintSmile.
export async function ensureSource(design) {
  const entry = entryFor(design);
  if (!entry || ready.has(entry.id)) return;
  const blob = isOwn(entry.id) ? await loadOwn(entry.id) : undefined;
  if (isOwn(entry.id) && !blob) return;
  ready.set(entry.id, await prepare(entry, blob));
}

export function dropSource(id) {
  ready.delete(id);
  forget(id);
}

export function paintSmile(ctx, mouth, design, light, opts) {
  const entry = entryFor(design);
  const p = entry && (ready.get(entry.id) || ready.get(BUILT_IN[0].id));
  if (p) return renderPhotoSmile(ctx, mouth, design, p, light, opts);
  // The drawn model has no "as photo" colour.
  const shade = !design.shade || design.shade === 'original' ? 'A2' : design.shade;
  return renderSmile(ctx, mouth, { ...design, shade }, light, opts);
}
