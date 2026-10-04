// Keeps the app working offline. The app never talks to any server except the one it was installed from.
const VERSION = 'v3';
const SHELL = `shell-${VERSION}`;
const MODEL = 'model-v1';

const SHELL_FILES = [
  './',
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/apple-touch-icon.png',
  'src/app.js',
  'src/brand.js',
  'src/catalog.js',
  'src/crypto.js',
  'src/editor.js',
  'src/exporter.js',
  'src/face.js',
  'src/i18n.js',
  'src/looks.js',
  'src/render.js',
  'src/shades.js',
  'src/smile.js',
  'src/store.js',
  'src/teeth.js',
  'src/ui.js',
  'assets/catalog/smile-01.jpg',
];

const MODEL_FILES = [
  'vendor/mediapipe/vision_bundle.mjs',
  'vendor/mediapipe/vision_wasm_internal.js',
  'vendor/mediapipe/vision_wasm_internal.wasm',
  'vendor/mediapipe/face_landmarker.task',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    Promise.all([
      caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)),
      // The face finder is large; fetch it in the background so the first photo works offline too.
      caches.open(MODEL).then((c) => c.addAll(MODEL_FILES).catch(() => {})),
    ]).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== MODEL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.includes('/vendor/')) {
    e.respondWith(caches.open(MODEL).then(async (c) => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok) c.put(e.request, res.clone());
      return res;
    }));
    return;
  }
  // App files: network first so updates arrive, cache when offline.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))),
  );
});
