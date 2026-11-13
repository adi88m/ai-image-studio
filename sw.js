const APP_VERSION = '2026.11.1';
const CACHE_NAME = `adi88m-ai-studio-${APP_VERSION}`;
const AI_MODEL_CACHE = 'adi88m-ai-models-v1';

const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/studio.css',
  './js/core-bus.js',
  './js/vendor-loader.js',
  './js/state-manager.js',
  './js/media-loader.js',
  './js/render-engine.js',
  './js/layer-compositor.js',
  './js/app.js'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.allSettled(
        CORE_ASSETS.map((url) => cache.add(url).catch(() => null))
      );
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME && key !== AI_MODEL_CACHE) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = req.url;
  const isHeavyModel =
    url.includes('.wasm') ||
    url.includes('.onnx') ||
    url.includes('tessdata') ||
    url.includes('traineddata');

  if (isHeavyModel) {
    event.respondWith(
      caches.open(AI_MODEL_CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        if (cached) return cached;
        try {
          const response = await fetch(req);
          if (response && response.status === 200) {
            cache.put(req, response.clone());
          }
          return response;
        } catch (err) {
          return new Response('', { status: 503, statusText: 'Model Offline' });
        }
      })
    );
    return;
  }

  event.respondWith(
    fetch(req)
      .then((response) => {
        if (response && response.status === 200 && req.url.startsWith(self.location.origin)) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return response;
      })
      .catch(() => caches.match(req))
  );
});
