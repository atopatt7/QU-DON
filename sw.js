/**
 * QU-DON | sw.js — Service Worker
 * 快取策略：Cache First（靜態資源），Network First（動態資料）
 */

const CACHE_NAME = 'qudon-v2';
const STATIC_FILES = [
  './',
  './index.html',
  './main.js',
  './manifest.json',
  './src/core/Input.js',
  // Pixi.js CDN 快取
  'https://cdnjs.cloudflare.com/ajax/libs/pixi.js/8.2.6/pixi.min.js',
];

// ─── Install：預快取靜態資源 ─────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_FILES))
      .then(() => self.skipWaiting())
  );
});

// ─── Activate：清除舊版快取 ───────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ─── Fetch：Cache First 策略 ──────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  // 略過非 GET 請求
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        // 只快取成功的 2xx 回應
        if (!response || response.status !== 200 || response.type === 'error') {
          return response;
        }
        const toCache = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, toCache));
        return response;
      });
    })
  );
});
