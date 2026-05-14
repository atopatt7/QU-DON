/**
 * QU-DON | sw.js — Service Worker
 * 快取策略：Cache First（靜態資源），Network First（動態資料）
 *
 * ⚠️ 每次修改任何遊戲檔案後，必須更新 CACHE_NAME 版本號，
 *    才能讓舊快取失效、手機端取得最新版本。
 */

const CACHE_NAME = 'qudon-v15';

// ── 本機檔案：安裝時全數預快取 ────────────────────────────────────────────────
// 包含所有 JS 模組、資料檔與圖片資源，確保離線 / 弱網路環境也能正常啟動
const LOCAL_FILES = [
  './',
  './index.html',
  './main.js',
  './manifest.json',
  // ── Core ──────────────────────────────────────────────────────────────────
  './src/core/Input.js',
  // ── UI 模組 ────────────────────────────────────────────────────────────────
  './src/ui/HomeScreen.js',
  './src/ui/ControlPanel.js',
  './src/ui/MembraneButton.js',
  './src/ui/CigarMenuOverlay.js',
  './src/ui/StatusScreen.js',
  './src/ui/WorldMapScreen.js',
  './src/ui/BattleUI.js',
  './src/ui/DialogueOverlay.js',
  './src/ui/VFDClock.js',
  // ── 遊戲模組 ───────────────────────────────────────────────────────────────
  './src/modules/MapManager.js',
  './src/modules/InteractionManager.js',
  // ── 資料 JSON ──────────────────────────────────────────────────────────────
  './src/data/actors.json',
  './src/data/maps/config.json',
  './src/data/maps/map_black_rock_street.json',
  './src/data/maps/map_neon_bar.json',
  './src/data/maps/map_hakka_street.json',
  './src/data/maps/map_qu_don_room.json',
  './src/data/maps/map_back_alley.json',
  './src/data/maps/map_underground_parking.json',
  './src/data/npcs/npcs_black_rock_street.json',
  // ── 圖片資源（預快取後載入速度大幅提升）────────────────────────────────────
  './assets/images/home_bg.jpg',
  './assets/sprites/player_sheet.png',
  './assets/ui/cigar_box.png',
  './assets/ui/cigar_single.png',
  './assets/ui/warp_arrow_base.png',
  './assets/ui/warp_door.png',
  './assets/ui/warp_shutter.png',
  './assets/ui/mag_base.png',
  './assets/ui/Wood067_1K-PNG_Color.png',
  './assets/ui/bullet_single.png',
];

// ── CDN 資源：嘗試快取，失敗不阻塞安裝（網路可用時仍可從 CDN 抓取）────────────
const CDN_FILES = [
  'https://cdnjs.cloudflare.com/ajax/libs/pixi.js/8.2.6/pixi.min.js',
];

// ─── Install：預快取所有本機資源 ──────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);

    // 本地檔案：全數快取（任一失敗則 SW 安裝中止，舊版 SW 繼續服務）
    await cache.addAll(LOCAL_FILES);

    // CDN 檔案：逐一嘗試，失敗靜默忽略（不阻塞安裝）
    await Promise.allSettled(
      CDN_FILES.map(url =>
        cache.add(url).catch(e => console.warn('[SW] CDN 快取失敗，將在使用時即時載入:', url))
      )
    );

    await self.skipWaiting();
  })());
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
      }).catch(() => {
        // 網路請求失敗（離線），靜默返回 undefined（瀏覽器顯示原生錯誤）
        console.warn('[SW] 網路請求失敗:', event.request.url);
      });
    })
  );
});
