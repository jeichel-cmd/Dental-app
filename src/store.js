// Encrypted storage in the tablet's own browser storage (IndexedDB). Nothing is sent anywhere.
// "index" holds patients, designs and favourites; each photo is stored on its own, also encrypted.

import { deriveKey, encryptJson, decryptJson, encryptBytes, decryptBytes, newSalt, ITERATIONS, b64, unb64 } from './crypto.js';

const DB = 'smile-studio';
const STORE = 'vault';

let dbPromise = null;
function open() {
  dbPromise ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
  });
}

const get = (k) => tx('readonly', (s) => s.get(k));
const put = (k, v) => tx('readwrite', (s) => s.put(v, k));
const del = (k) => tx('readwrite', (s) => s.delete(k));
const keys = () => tx('readonly', (s) => s.getAllKeys());

let key = null;
let meta = null;

export const emptyState = () => ({ version: 1, patients: [], settings: { lockMinutes: 5 } });

export async function hasVault() {
  return Boolean(await get('meta'));
}

export async function create(code, state) {
  meta = { salt: newSalt(), iterations: ITERATIONS, createdAt: new Date().toISOString() };
  key = await deriveKey(code, meta.salt, meta.iterations);
  await put('meta', meta);
  await save(state);
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
}

// Returns the decrypted state, or null when the code is wrong.
export async function unlock(code) {
  meta = await get('meta');
  const box = await get('index');
  const k = await deriveKey(code, meta.salt, meta.iterations);
  try {
    const state = await decryptJson(k, box);
    key = k;
    return state;
  } catch {
    return null;
  }
}

export function lock() {
  key = null;
}

export const isUnlocked = () => Boolean(key);

export async function save(state) {
  if (!key) throw new Error('locked');
  await put('index', await encryptJson(key, state));
}

// Photos and thumbnails: stored as encrypted bytes under their own keys.
export async function putImage(id, blob) {
  if (!key) throw new Error('locked');
  await put(`img:${id}`, await encryptBytes(key, await blob.arrayBuffer()));
}

export async function getImage(id, type = 'image/jpeg') {
  if (!key) throw new Error('locked');
  const box = await get(`img:${id}`);
  if (!box) return null;
  return new Blob([await decryptBytes(key, box)], { type });
}

export const deleteImage = (id) => del(`img:${id}`);

export async function changeCode(state, code) {
  // Re-encrypt everything with the new key.
  const oldKey = key;
  const ids = (await keys()).filter((k) => String(k).startsWith('img:'));
  const plain = [];
  for (const id of ids) plain.push([id, await decryptBytes(oldKey, await get(id))]);
  meta = { ...meta, salt: newSalt(), iterations: ITERATIONS };
  key = await deriveKey(code, meta.salt, meta.iterations);
  for (const [id, bytes] of plain) await put(id, await encryptBytes(key, bytes));
  await save(state);
  await put('meta', meta);
}

// A backup file holds everything, encrypted with the practice code like the data on the tablet.
export async function backupBlob(state) {
  const images = {};
  const ids = (await keys()).filter((k) => String(k).startsWith('img:'));
  for (const id of ids) images[id] = b64(await decryptBytes(key, await get(id)));
  const box = await encryptJson(key, { state, images });
  const file = { format: 'smile-studio-backup', version: 1, salt: meta.salt, iterations: meta.iterations, ...box, exportedAt: new Date().toISOString() };
  return new Blob([JSON.stringify(file)], { type: 'application/json' });
}

// Returns { state, images } from a backup file, or null when the code doesn't open it.
export async function readBackup(text, code) {
  const file = JSON.parse(text);
  if (file.format !== 'smile-studio-backup') throw new Error('not a backup');
  const k = await deriveKey(code, file.salt, file.iterations);
  try {
    return await decryptJson(k, file);
  } catch {
    return null;
  }
}

export async function restore(backup) {
  for (const k of await keys()) if (String(k).startsWith('img:')) await del(k);
  for (const [id, data] of Object.entries(backup.images)) await put(id, await encryptBytes(key, unb64(data)));
  await save(backup.state);
}

export async function wipe() {
  key = null;
  await tx('readwrite', (s) => s.clear());
}
