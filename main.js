/**
 * QU-DON 瞿董默示錄 | main.js  v3
 * Entry point — 整合 Pixi App、InputManager、ControlPanel、MapManager
 *
 * 螢幕分區：
 *   上方 66% → 遊戲視野（MapManager / EntityManager）
 *   下方 34% → ControlPanel（D-Pad、Action、VFD 時鐘）
 */

import { InputManager }  from './src/core/Input.js';
import { ControlPanel }  from './src/ui/ControlPanel.js';
import { MapManager, DIR_DELTA } from './src/modules/MapManager.js';

// ─── VT323 字型（VFD 時鐘用）───────────────────────────────────────────────
const fontLink = document.createElement('link');
fontLink.rel  = 'stylesheet';
fontLink.href = 'https://fonts.googleapis.com/css2?family=VT323&display=swap';
document.head.appendChild(fontLink);

// ─── Safe Area ─────────────────────────────────────────────────────────────
function getSafeArea() {
  const s = getComputedStyle(document.body);
  return {
    top:    parseInt(s.paddingTop)    || 0,
    bottom: parseInt(s.paddingBottom) || 0,
    left:   parseInt(s.paddingLeft)   || 0,
    right:  parseInt(s.paddingRight)  || 0,
  };
}
function getViewport() {
  const safe = getSafeArea();
  return {
    W: window.innerWidth  - safe.left - safe.right,
    H: window.innerHeight - safe.top  - safe.bottom,
  };
}

// ─── Pixi App 初始化 ─────────────────────────────────────────────────────────
async function initPixi() {
  const { W, H } = getViewport();
  const app = new PIXI.Application();
  await app.init({
    width:        W,
    height:       H,
    backgroundColor: 0x080610,
    resolution:   window.devicePixelRatio || 1,
    autoDensity:  true,
    antialias:    false,
    eventMode:    'static',
  });
  document.getElementById('game-container').appendChild(app.canvas);
  // HTML 版觸控 UI 由 Pixi ControlPanel 取代
  const htmlCtrl = document.getElementById('touch-controls');
  if (htmlCtrl) htmlCtrl.style.display = 'none';
  return app;
}

// ─── 視窗縮放 ───────────────────────────────────────────────────────────────
function bindResize(app) {
  window.addEventListener('resize', () => {
    const { W, H } = getViewport();
    app.renderer.resize(W, H);
    app.stage.emit('resize', { width: W, height: H });
  });
}

// ─── 遊戲層（上方 66%）─────────────────────────────────────────────────────
function buildGameLayer(app) {
  const layer = new PIXI.Container();
  layer.label = 'gameLayer';
  // 遮罩：限制渲染區域不超出遊戲視野（防止滲入 ControlPanel）
  const mask = new PIXI.Graphics();
  const drawMask = () => {
    const H = app.screen.height;
    mask.clear();
    mask.rect(0, 0, app.screen.width, Math.floor(H * 0.66)).fill({ color: 0xffffff });
  };
  drawMask();
  app.stage.addChild(mask);
  layer.mask = mask;
  app.stage.on('resize', drawMask);
  app.stage.addChild(layer);
  return layer;
}

// ─── 玩家佔位精靈 ─────────────────────────────────────────────────────────
function buildPlayerSprite(tileSize) {
  const r   = Math.floor(tileSize * 0.34);
  const spr = new PIXI.Graphics();
  // 身體
  spr.circle(0, 0, r).fill({ color: 0xd8c8f0 });
  spr.circle(0, 0, r).stroke({ color: 0xf0e8ff, width: 1.5 });
  // 方向指示點
  spr.circle(0, -Math.floor(r * 0.5), Math.floor(r * 0.28))
    .fill({ color: 0x9070c0 });
  return spr;
}

// ─── 方向指示器動畫（移動時閃爍一下）──────────────────────────────────────
function flashPlayer(playerSpr, duration = 80) {
  playerSpr.alpha = 0.5;
  setTimeout(() => { playerSpr.alpha = 1; }, duration);
}

// ─── 主程式 ─────────────────────────────────────────────────────────────────
async function main() {
  const app       = await initPixi();
  bindResize(app);

  // InputManager：傳入 canvas 以啟用 tile-click 座標轉換
  const input = new InputManager(app.canvas);

  // 遊戲層
  const gameLayer = buildGameLayer(app);

  // ── MapManager：載入地圖 ─────────────────────────────────────────────────
  const mapManager = await MapManager.create(app, gameLayer);
  await mapManager.loadMap('map_01');

  // ── 玩家初始位置（從 spawnPoints 取得）────────────────────────────────────
  const spawn  = mapManager.mapData.spawnPoints.find(s => s.id === 'player_start');
  const player = { gx: spawn?.gx ?? 3, gy: spawn?.gy ?? 2 };

  // ── 玩家精靈 ──────────────────────────────────────────────────────────────
  const playerSpr = buildPlayerSprite(mapManager.tileSize);
  mapManager.entityLayer.addChild(playerSpr);

  // ── 同步玩家位置 + 鏡頭 + InputManager 格子點擊 ──────────────────────────
  const syncPlayer = () => {
    const px = mapManager.gridToPixel(player.gx, player.gy);
    playerSpr.x = px.x;
    playerSpr.y = px.y;
    mapManager.centerOn(player.gx, player.gy);
    // 每次鏡頭移動後更新 tile-click 座標轉換
    input.setGridConfig(mapManager.tileSize, mapManager.rootX, mapManager.rootY);
  };

  // 初始化
  syncPlayer();
  mapManager.updateFog(player.gx, player.gy, mapManager.visionRadius);

  // ── 視窗縮放：重建 tile 尺寸 + 重新置中 ──────────────────────────────────
  app.stage.on('resize', () => {
    mapManager.onResize(player.gx, player.gy);
    syncPlayer();
  });

  // ── 觸發點回調表（之後連接 DialogueEngine） ─────────────────────────────
  const TRIGGER_HANDLERS = {
    evt_laundry_door: () => console.log('[Trigger] 廢棄洗衣店：門鎖已壞，但不安全。'),
    evt_clinic_door:  () => console.log('[Trigger] 無牌診所：燈光從門縫滲出。'),
  };

  // ── ControlPanel ─────────────────────────────────────────────────────────
  const panel = await ControlPanel.create(app, input);
  app.stage.addChild(panel);

  // ── 主遊戲迴圈 ────────────────────────────────────────────────────────────
  app.ticker.add(() => {
    const state = input.update();
    let moved   = false;

    // ── 1. 方向鍵 / D-Pad 格子移動 ──────────────────────────────────────
    if (state.justMoved && state.justDir) {
      const { dx, dy } = DIR_DELTA[state.justDir];
      const nx = player.gx + dx;
      const ny = player.gy + dy;

      if (mapManager.isWalkable(nx, ny)) {
        player.gx = nx;
        player.gy = ny;
        moved = true;
        flashPlayer(playerSpr);
      }
    }

    // ── 2. Tile 點擊移動（相鄰 1 格直接走，遠端留給未來 Pathfinding）──────
    if (state.tileTarget) {
      const { gx, gy } = state.tileTarget;
      const dist = Math.hypot(gx - player.gx, gy - player.gy);

      if (dist <= 1.5 && mapManager.isWalkable(gx, gy)) {
        // 相鄰格：直接移動
        player.gx = gx;
        player.gy = gy;
        moved = true;
        flashPlayer(playerSpr);
      } else if (mapManager.isWalkable(gx, gy)) {
        // 遠端格：目前直接傳送（BattleEngine 路徑計算未實作時的佔位）
        player.gx = gx;
        player.gy = gy;
        moved = true;
        flashPlayer(playerSpr);
        console.log(`[PathFind] TODO: 計算 (${player.gx},${player.gy}) → (${gx},${gy})`);
      }
    }

    // ── 3. 移動後同步鏡頭 + 霧視野 + 傳送點 + 觸發點 ──────────────────
    if (moved) {
      syncPlayer();
      mapManager.updateFog(player.gx, player.gy, mapManager.visionRadius);

      // ── 3a. Warp 傳送點（優先於 trigger，避免同格衝突）─────────────────
      const warp = mapManager.checkWarp(player.gx, player.gy);
      if (warp) {
        input.lock();
        console.log(`[Warp] "${warp.label ?? warp.id}" → ${warp.targetMap} (${warp.targetGx}, ${warp.targetGy})`);

        mapManager.transitionTo(warp.targetMap, () => {
          player.gx = warp.targetGx;
          player.gy = warp.targetGy;
          // preserveEntities = true 確保 playerSpr 仍在 entityLayer，
          // 但若 entityLayer 被意外清除時以下行可補救：
          if (!mapManager.entityLayer.children.includes(playerSpr)) {
            mapManager.entityLayer.addChild(playerSpr);
          }
          syncPlayer();
          mapManager.updateFog(player.gx, player.gy, mapManager.visionRadius);
        }).then(() => {
          input.unlock();
        }).catch(err => {
          console.error('[Warp] 轉場失敗:', err);
          input.unlock();
        });
        return; // 本幀不繼續處理 trigger
      }

      // ── 3b. Trigger 觸發點（對話 / 事件）──────────────────────────────
      const trigger = mapManager.getTriggerAt(player.gx, player.gy);
      if (trigger) {
        console.log(`[Trigger] (${trigger.gx},${trigger.gy}) "${trigger.label}"`);
        const handler = TRIGGER_HANDLERS[trigger.eventId];
        if (handler) handler();
      }
    }

    // ── 4. Confirm 鍵：互動（靜止時也可觸發觸發點）────────────────────
    if (state.confirmJust && !moved) {
      const trigger = mapManager.getTriggerAt(player.gx, player.gy);
      if (trigger) {
        const handler = TRIGGER_HANDLERS[trigger.eventId];
        if (handler) handler();
      }
    }

    // TODO: BattleEngine.update(state)
    // TODO: EntityManager.update(state)
    // TODO: DialogueEngine.update(state)
  });

  const renderer = app.renderer.type === 1 ? 'WebGL' : 'WebGPU';
  console.log(`[QU-DON] Ready — ${renderer} @ ${app.screen.width}×${app.screen.height}`);
  console.log(`[QU-DON] 玩家起點: (${player.gx}, ${player.gy})`);
}

main().catch(console.error);
