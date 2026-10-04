// Copies the on-device face finder into vendor/ so the app never loads code or models from elsewhere.
import { copyFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';

const from = 'node_modules/@mediapipe/tasks-vision/';
const to = 'vendor/mediapipe/';
mkdirSync(to, { recursive: true });
for (const f of ['vision_bundle.mjs', 'wasm/vision_wasm_internal.js', 'wasm/vision_wasm_internal.wasm', 'wasm/vision_wasm_nosimd_internal.js', 'wasm/vision_wasm_nosimd_internal.wasm']) {
  copyFileSync(from + f, to + f.replace('wasm/', ''));
}
const model = to + 'face_landmarker.task';
if (!existsSync(model)) {
  const res = await fetch('https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task');
  if (!res.ok) throw new Error(`model download failed: ${res.status}`);
  writeFileSync(model, Buffer.from(await res.arrayBuffer()));
}
console.log('vendored');
