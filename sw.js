/**
 * QU-DON | sw.js — Service Worker
 *
 * 快取策略：
 *   程式與資料（HTML / JS / JSON）→ Network First（3 秒逾時退回快取）
 *     連得上網就一定拿到最新版，離線或網路很慢時用上次的版本。
 *   圖片 / 音訊 / 字型 → Cache First（檔案大、很少改，先用快取省流量）
 *
 * ⚠️ 修改圖片或音訊時仍要更新 CACHE_NAME（Cache First 的檔案靠換版本號失效）。
 *    只改 JS / JSON 的話，線上玩家下次開啟就會拿到新版。
 */

const CACHE_NAME = 'qudon-v93';
const NETWORK_TIMEOUT_MS = 3000;

// ── 安裝時預快取：讓第一次開啟後就能離線遊玩 ──────────────────────────────────
// 不在清單上的同源檔案，第一次被請求時也會自動存進快取。
const PRECACHE = [
  './',
  './index.html',
  './main.js',
  './manifest.json',
  // ── Core ──────────────────────────────────────────────────────────────────
  './src/core/Input.js',
  './src/core/EntityManager.js',
  './src/core/AudioManager.js',
  './src/core/GameStateManager.js',
  './src/core/Layout.js',
  './src/core/SaveSystem.js',
  // ── UI 模組 ────────────────────────────────────────────────────────────────
  './src/ui/HomeScreen.js',
  './src/ui/ControlPanel.js',
  './src/ui/MembraneButton.js',
  './src/ui/CigarMenuOverlay.js',
  './src/ui/StatusScreen.js',
  './src/ui/WorldMapScreen.js',
  './src/ui/BattleUI.js',
  './src/ui/InventoryScreen.js',
  './src/ui/DialogueOverlay.js',
  './src/ui/VFDClock.js',
  './src/ui/TextPanelScreen.js',
  // ── 遊戲模組 ───────────────────────────────────────────────────────────────
  './src/modules/MapManager.js',
  './src/modules/InteractionManager.js',
  // ── 資料 JSON ──────────────────────────────────────────────────────────────
  './src/data/actors.json',
  './src/data/items.json',
  './src/data/journal.json',
  './src/data/entities/registry.json',
  './src/data/entities/actors/player.json',
  './src/data/entities/actors/enemy_thug.json',
  './src/data/entities/actors/enemy_pickpocket.json',
  './src/data/entities/actors/npc_clerk.json',
  './src/data/entities/actors/npc_const_guard.json',
  './src/data/entities/actors/enemy_redhound_thug.json',
  './src/data/entities/actors/npc_camp_elder.json',
  './src/data/entities/actors/npc_camp_youth.json',
  './src/data/entities/actors/npc_camp_kid.json',
  './src/data/entities/actors/npc_lena.json',
  './src/data/entities/actors/npc_doctor_chen.json',
  './src/data/entities/actors/npc_merchant_wang.json',
  './src/data/entities/actors/npc_bartender.json',
  './src/data/entities/actors/npc_homeless_vet.json',
  './src/data/entities/actors/npc_bookie.json',
  './src/data/entities/actors/npc_recycler_yang.json',
  './src/data/entities/actors/npc_eddie.json',
  './src/data/maps/config.json',
  './src/data/maps/map_black_rock_street.json',
  './src/data/maps/map_neon_bar.json',
  './src/data/maps/map_hakka_street.json',
  './src/data/maps/map_qu_don_room.json',
  './src/data/maps/map_back_alley.json',
  './src/data/maps/map_underground_parking.json',
  './src/data/maps/map_convenience_store.json',
  './src/data/maps/map_black_rock_west_suburb.json',
  './src/data/maps/map_hakka_east_suburb.json',
  './src/data/maps/map_const_office.json',
  './src/data/npcs/npcs_map_black_rock_street.json',
  './src/data/npcs/npcs_map_back_alley.json',
  './src/data/npcs/npcs_map_convenience_store.json',
  './src/data/npcs/npcs_map_black_rock_west_suburb.json',
  './src/data/npcs/npcs_map_neon_bar.json',
  './src/data/npcs/npcs_map_hakka_east_suburb.json',
  './src/data/npcs/npcs_map_hakka_street.json',
  // ── 圖片 / 音訊 ────────────────────────────────────────────────────────────
  './assets/sounds/bgm/neon_bar_theme.webm',
  './assets/images/home_bg.jpg',
  './assets/ui/interface/cigar_box.webp',
  './assets/ui/interface/cigar_single.webp',
  './assets/ui/interface/dark_wood_texture.jpg',
  './assets/ui/interface/warp_arrow_base.png',
  './assets/ui/interface/warp_door.png',
  './assets/ui/interface/warp_shutter.png',
  './assets/maps/tilesets/tileset_1000.png',
  './assets/sprites/entities/player_sheet.png',
  './assets/sprites/entities/pickpocket_sheet.png',
  './assets/sprites/entities/clerk_sheet.png',
  './assets/sprites/entities/const_guard_sheet.png',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
];

// ── CDN：嘗試快取，失敗不阻塞安裝 ────────────────────────────────────────────
const CDN_FILES = [
  'https://cdnjs.cloudflare.com/ajax/libs/pixi.js/8.2.6/pixi.min.js',
];

// ─── Install ──────────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // 逐一快取：單一檔案失敗不會讓整個 SW 安裝失敗（之後用到時會再抓）
    await Promise.allSettled(
      [...PRECACHE, ...CDN_FILES].map(url =>
        cache.add(new Request(url, { cache: 'reload' }))
          .catch(() => console.warn('[SW] 預快取失敗，之後再試:', url))
      )
    );
    await self.skipWaiting();
  })());
});

// ─── Activate：清除舊版快取 ───────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ─── Fetch ────────────────────────────────────────────────────────────────────
const isCodeOrData = (url) =>
  url.origin === self.location.origin &&
  (url.pathname.endsWith('/') || /\.(html|js|json)$/.test(url.pathname));

async function putInCache(request, response) {
  if (response && response.status === 200 && response.type !== 'opaque') {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  }
  return response;
}

// Network First：逾時或離線時退回快取
async function networkFirst(request) {
  const network = fetch(request, { cache: 'no-cache' }).then(res => putInCache(request, res));
  network.catch(() => {}); // 逾時後才失敗的請求不算未處理錯誤（已經用快取回應了）
  const timeout = new Promise(resolve => setTimeout(resolve, NETWORK_TIMEOUT_MS, null));
  try {
    const res = await Promise.race([network, timeout]);
    if (res) return res;
  } catch { /* 離線：往下用快取 */ }
  const cached = await caches.match(request);
  return cached ?? network; // 沒有快取就繼續等網路
}

// Cache First：快取沒有才上網抓，抓到後存起來
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  return putInCache(request, res);
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  event.respondWith(
    (isCodeOrData(url) ? networkFirst(event.request) : cacheFirst(event.request))
      .catch(() => Response.error())
  );
});
