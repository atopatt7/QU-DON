/**
 * QU-DON | sw.js — Service Worker
 * 快取策略：Cache First（靜態資源），Network First（動態資料）
 *
 * ⚠️ 每次修改任何遊戲檔案後，必須更新 CACHE_NAME 版本號，
 *    才能讓舊快取失效、手機端取得最新版本。
 */

const CACHE_NAME = 'qudon-v48';

// ── 本機檔案：安裝時全數預快取 ────────────────────────────────────────────────
// 包含所有 JS 模組、資料檔與圖片資源，確保離線 / 弱網路環境也能正常啟動
const LOCAL_FILES = [
  './',
  './index.html',
  './main.js',
  './manifest.json',
  // ── Core ──────────────────────────────────────────────────────────────────
  './src/core/Input.js',
  './src/core/EntityManager.js',
  './src/core/AudioManager.js',
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
  './src/modules/DataManager.js',
  // ── 資料 JSON ──────────────────────────────────────────────────────────────
  './src/data/actors.json',
  // ── 實體系統（registry + 獨立角色檔）──────────────────────────────────────
  './src/data/entities/registry.json',
  './src/data/entities/actors/player.json',
  './src/data/entities/actors/enemy_thug.json',
  './src/data/entities/actors/enemy_pickpocket.json',
  './src/data/entities/actors/npc_clerk.json',
  './src/data/maps/config.json',
  './src/data/maps/map_black_rock_street.json',
  './src/data/maps/map_neon_bar.json',
  './src/data/maps/map_hakka_street.json',
  './src/data/maps/map_qu_don_room.json',
  './src/data/maps/map_back_alley.json',
  './src/data/maps/map_underground_parking.json',
  './src/data/maps/map_convenience_store.json',
  './src/data/npcs/npcs_black_rock_street.json',
  './src/data/npcs/npcs_map_back_alley.json',
  './src/data/npcs/npcs_map_convenience_store.json',
  // ── 圖片資源（預快取後載入速度大幅提升）────────────────────────────────────
  './assets/sounds/bgm/neon_bar_theme.webm',
  './assets/images/home_bg.jpg',
  './assets/ui/interface/cigar_box.png',
  './assets/ui/interface/cigar_single.png',
  './assets/ui/interface/warp_arrow_base.png',
  './assets/ui/interface/warp_door.png',
  './assets/ui/interface/warp_shutter.png',
  './assets/ui/interface/mag_base.png',
  './assets/ui/interface/Wood067_1K-PNG_Color.png',
  './assets/ui/interface/bullet_single.png',
  './assets/maps/tilesets/tileset_1000.png',
];

// ── 實體貼圖：製作中，失敗不阻塞安裝（缺圖時遊戲以圓形佔位精靈替代）──────────
const ENTITY_SPRITES = [
  // 主角四向（靜態單幀，動畫幀製作前的 fallback）
  './assets/sprites/entities/player_down.png',
  './assets/sprites/entities/player_up.png',
  './assets/sprites/entities/player_left.png',
  './assets/sprites/entities/player_right.png',
  // 主角四向動畫幀（0=左腳, 1=站立, 2=右腳）
  './assets/sprites/entities/player_down_0.png',
  './assets/sprites/entities/player_down_1.png',
  './assets/sprites/entities/player_down_2.png',
  './assets/sprites/entities/player_up_0.png',
  './assets/sprites/entities/player_up_1.png',
  './assets/sprites/entities/player_up_2.png',
  './assets/sprites/entities/player_left_0.png',
  './assets/sprites/entities/player_left_1.png',
  './assets/sprites/entities/player_left_2.png',
  './assets/sprites/entities/player_right_0.png',
  './assets/sprites/entities/player_right_1.png',
  './assets/sprites/entities/player_right_2.png',
  // 扒手四向
  './assets/sprites/entities/pickpocket_down.png',
  './assets/sprites/entities/pickpocket_up.png',
  './assets/sprites/entities/pickpocket_left.png',
  './assets/sprites/entities/pickpocket_right.png',
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

    // 實體貼圖：製作中，缺圖不阻塞安裝
    await Promise.allSettled(
      ENTITY_SPRITES.map(url =>
        cache.add(url).catch(() => console.warn('[SW] 實體貼圖尚未製作，跳過快取:', url))
      )
    );

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
