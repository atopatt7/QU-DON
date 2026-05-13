/**
 * QU-DON 瞿董默示錄 | main.js  v6
 *
 * 流程：HomeScreen → 新遊戲 → 地圖行走
 * 包含：HomeScreen（照片背景）/ 地圖渲染 / 碰撞 / 霧視野
 *       D-Pad + 鍵盤 / 方向性精靈 / 場景轉場 (Warp) / ControlPanel
 */

import { InputManager }          from './src/core/Input.js';
import { ControlPanel }          from './src/ui/ControlPanel.js';
import { MapManager, DIR_DELTA } from './src/modules/MapManager.js';
import { HomeScreen }            from './src/ui/HomeScreen.js';
import { VFDClock }              from './src/ui/VFDClock.js';

// ─── VT323 字型 ────────────────────────────────────────────────────────────
const fontLink = document.createElement('link');
fontLink.rel  = 'stylesheet';
fontLink.href = 'https://fonts.googleapis.com/css2?family=VT323&display=swap';
document.head.appendChild(fontLink);

// ─── Safe Area / Viewport ──────────────────────────────────────────────────
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

// ─── 單一 App 實例守衛 ────────────────────────────────────────────────────────
let _appInstance = null;

// ─── Pixi 全域設定（必須在第一個 Application 建立前執行）──────────────────────
function applyPixiGlobalSettings() {
  // 降低 Fragment Shader 精度（Pixi v7 有效；v8 由 renderer 內部控制）
  if (typeof PIXI.settings !== 'undefined') {
    PIXI.settings.PRECISION_FRAGMENT = 'lowp';
  }
  // 縮短貼圖 GC 週期（預設 3600 幀，改為 600 幀 ≈ 20 秒 @ 30fps）
  if (PIXI.TextureGCSystem) {
    PIXI.TextureGCSystem.defaultMaxIdle = 600;
  }
}

// ─── Pixi App ──────────────────────────────────────────────────────────────
async function initPixi() {
  // 防止重複初始化（熱重載或多次呼叫 main() 的保險）
  if (_appInstance) {
    console.warn('[QU-DON] PIXI.Application 已存在，略過重複初始化');
    return _appInstance;
  }

  applyPixiGlobalSettings();

  const { W, H } = getViewport();
  const app = new PIXI.Application();
  await app.init({
    width:           W,
    height:          H,
    backgroundColor: 0x080610,
    resolution:      window.devicePixelRatio || 1,
    autoDensity:     true,
    antialias:       false,
    eventMode:       'static',
  });

  // ⚡ Stage 3/4 效能：30fps 上限，減半 ticker 喚醒次數
  app.ticker.maxFPS = 30;

  _appInstance = app;
  document.getElementById('game-container').appendChild(app.canvas);
  const htmlCtrl = document.getElementById('touch-controls');
  if (htmlCtrl) htmlCtrl.style.display = 'none';
  return app;
}

// ─── 視窗縮放 ──────────────────────────────────────────────────────────────
function bindResize(app) {
  window.addEventListener('resize', () => {
    const { W, H } = getViewport();
    app.renderer.resize(W, H);
    app.stage.emit('resize', { width: W, height: H });
  });
}

// ─── 遊戲圖層（上方 66%，帶遮罩）──────────────────────────────────────────
function buildGameLayer(app) {
  const layer = new PIXI.Container();
  layer.label = 'gameLayer';
  const mask  = new PIXI.Graphics();
  const drawMask = () => {
    mask.clear();
    mask.rect(0, 0, app.screen.width, Math.floor(app.screen.height * 0.66))
        .fill({ color: 0xffffff });
  };
  drawMask();
  app.stage.addChild(mask);
  layer.mask = mask;
  app.stage.on('resize', drawMask);
  app.stage.addChild(layer);
  return layer;
}

// ─── 載入玩家精靈圖（失敗時回傳 null）─────────────────────────────────────
async function loadPlayerSheet() {
  try {
    const tex = await PIXI.Assets.load('./assets/sprites/player_sheet.png');
    console.log(`[QU-DON] 玩家精靈圖 ${tex.width}×${tex.height} 載入成功`);
    return tex;
  } catch {
    console.warn('[QU-DON] player_sheet.png 不存在，使用圓形佔位精靈');
    return null;
  }
}

// ─── 建立玩家精靈 ──────────────────────────────────────────────────────────
function buildPlayerSprite(tileSize, sheetTex = null) {
  if (sheetTex) {
    const fw  = Math.floor(sheetTex.width / 4);
    const fw3 = sheetTex.width - fw * 3;
    const fh  = sheetTex.height;

    const DIR_FRAMES = {
      down:  new PIXI.Texture({ source: sheetTex.source, frame: new PIXI.Rectangle(0,      0, fw,  fh) }),
      up:    new PIXI.Texture({ source: sheetTex.source, frame: new PIXI.Rectangle(fw,     0, fw,  fh) }),
      right: new PIXI.Texture({ source: sheetTex.source, frame: new PIXI.Rectangle(fw * 2, 0, fw,  fh) }),
      left:  new PIXI.Texture({ source: sheetTex.source, frame: new PIXI.Rectangle(fw * 3, 0, fw3, fh) }),
    };

    const spr = new PIXI.Sprite(DIR_FRAMES.down);
    const dispH = Math.floor(tileSize * 2.0);
    const dispW = Math.floor(dispH * (fw / fh));
    spr.width  = dispW;
    spr.height = dispH;
    spr.anchor.set(0.5, 1.0);

    spr.setDir   = (dir) => {
      const t = DIR_FRAMES[dir] ?? DIR_FRAMES.down;
      if (spr.texture !== t) spr.texture = t;
    };
    spr.resizeTo = (s) => {
      const h = Math.floor(s * 2.0);
      spr.height = h;
      spr.width  = Math.floor(h * (fw / fh));
    };
    return spr;
  }

  // ── 圓形佔位 ─────────────────────────────────────────────────────────────
  const r   = Math.floor(tileSize * 0.34);
  const gfx = new PIXI.Graphics();
  gfx.circle(0, 0, r).fill({ color: 0xd8c8f0 })
     .stroke({ color: 0xf0e8ff, width: 1.5 });
  const dot = new PIXI.Graphics();
  dot.circle(0, -Math.floor(r * 0.5), Math.floor(r * 0.28))
     .fill({ color: 0x9070c0 });
  gfx.addChild(dot);

  const DIR_ANGLES = { down: 0, up: Math.PI, right: Math.PI / 2, left: -Math.PI / 2 };
  gfx.setDir   = (dir) => { gfx.rotation = DIR_ANGLES[dir] ?? 0; };
  gfx.resizeTo = () => {};
  return gfx;
}

// ─── 移動閃光 ──────────────────────────────────────────────────────────────
function flashPlayer(spr, ms = 80) {
  spr.alpha = 0.55;
  setTimeout(() => { spr.alpha = 1; }, ms);
}

// ═══════════════════════════════════════════════════════════════════════════
//  首頁 → 遊戲 淡出過場
// ═══════════════════════════════════════════════════════════════════════════
function fadeOut(app, duration = 600) {
  return new Promise(resolve => {
    const overlay = new PIXI.Graphics();
    overlay.rect(0, 0, app.screen.width, app.screen.height)
           .fill({ color: 0x000000 });
    overlay.alpha = 0;
    app.stage.addChild(overlay);

    const start = performance.now();
    const tick = () => {
      const t = Math.min((performance.now() - start) / duration, 1);
      overlay.alpha = t;
      if (t < 1) {
        requestAnimationFrame(tick);
      } else {
        resolve(overlay);
      }
    };
    requestAnimationFrame(tick);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  主程式
// ═══════════════════════════════════════════════════════════════════════════
async function main() {
  const app = await initPixi();
  bindResize(app);

  // ── 1. 顯示首頁 ──────────────────────────────────────────────────────────
  const homeScreen = await HomeScreen.create(app);
  app.stage.addChild(homeScreen);

  // 等待玩家點「新遊戲」
  await new Promise(resolve => {
    homeScreen.on('action', (id) => {
      if (id === 'new_game') resolve();
    });
  });

  // 淡出首頁
  const overlay = await fadeOut(app, 500);
  homeScreen.destroy({ children: true });

  // ── 2. 建立遊戲世界 ────────────────────────────────────────────────────
  const input     = new InputManager(app.canvas);
  const gameLayer = buildGameLayer(app);

  const mapManager = await MapManager.create(app, gameLayer);
  await mapManager.loadMap('map_black_rock_street');

  const spawn  = mapManager.mapData.spawnPoints.find(s => s.id === 'player_start');
  const player = { gx: spawn?.gx ?? 19, gy: spawn?.gy ?? 12 };
  let   facing = spawn?.facing ?? 'down';

  const sheetTex  = await loadPlayerSheet();
  const playerSpr = buildPlayerSprite(mapManager.tileSize, sheetTex);
  playerSpr.setDir(facing);
  mapManager.entityLayer.addChild(playerSpr);

  const syncPlayer = () => {
    const s  = mapManager.tileSize;
    const px = mapManager.gridToPixel(player.gx, player.gy);
    playerSpr.x = px.x;
    playerSpr.y = sheetTex ? px.y + s * 0.5 : px.y;
    mapManager.centerOn(player.gx, player.gy);
    input.setGridConfig(s, mapManager.rootX, mapManager.rootY);
  };

  // ── 初始狀態：同步玩家位置 + 霧視野，並立即渲染鏡頭（不等 ticker）──────────
  syncPlayer();
  mapManager.updateFog(player.gx, player.gy, mapManager.visionRadius);
  mapManager.render(); // ← 初始 render：確保鏡頭在第一幀就正確

  // ── resize 處理：重建貼圖 + 重新置中，立即渲染（不依賴 ticker）──────────────
  app.stage.on('resize', () => {
    mapManager.onResize(player.gx, player.gy);
    playerSpr.resizeTo?.(mapManager.tileSize);
    syncPlayer();
    mapManager.render(); // ← resize 後立即刷新鏡頭
  });

  const panel = await ControlPanel.create(app, input);
  app.stage.addChild(panel);

  // ── VFD 時鐘（左下角，遊戲區底部）────────────────────────────────────────
  const clock = new VFDClock({ color: 'green', fontSize: 18, showSeconds: false });
  app.stage.addChild(clock);

  const positionClock = () => {
    const safe  = getSafeArea();
    const gameH = Math.floor(app.screen.height * 0.66);
    clock.x = 12 + safe.left;
    clock.y = gameH - clock.displayHeight - 8;
  };
  positionClock();
  app.stage.on('resize', positionClock);

  // 初始地圖名稱
  clock.updateLocation(mapManager.mapData?.name);

  // 移除淡出遮罩（讓遊戲顯現）
  overlay.destroy();

  // ── requestUpdate：所有「狀態改變後的渲染更新」都集中在此 ──────────────────
  //
  //  ⚡ Stage 4 核心：render() 完全脫離 ticker，只由此函式主動觸發。
  //     畫面靜止時 ticker 內不執行任何 Pixi 物件修改。
  //
  function requestUpdate() {
    syncPlayer();                                                    // 精靈位置 + centerOn（標記 dirty）
    mapManager.updateFog(player.gx, player.gy, mapManager.visionRadius); // 霧視野（有守衛，座標不變則跳過）
    mapManager.render();                                             // 鏡頭（有守衛，!dirty 則跳過）
  }

  // ── 3. 主遊戲迴圈 ────────────────────────────────────────────────────────
  //
  //  ⚡ Stage 4：ticker 內部只做輸入採樣 + 移動判斷。
  //     玩家靜止時，整個 ticker callback 不觸碰任何 Pixi 物件，CPU ≈ 0。
  //
  app.ticker.add(() => {
    const state = input.update();

    // 玩家靜止時直接返回——不執行任何 Pixi 操作
    if (!state.justMoved || !state.justDir) return;

    facing = state.justDir;
    playerSpr.setDir(facing);

    const { dx, dy } = DIR_DELTA[state.justDir];
    const nx = player.gx + dx;
    const ny = player.gy + dy;

    if (!mapManager.isWalkable(nx, ny)) return; // 撞牆：不移動，不渲染

    player.gx = nx;
    player.gy = ny;
    flashPlayer(playerSpr);

    // ── 移動後：一次性更新所有狀態（精靈 + 霧 + 鏡頭）──────────────────────
    requestUpdate();

    // ── 傳送門檢查 ───────────────────────────────────────────────────────────
    const warp = mapManager.checkWarp(player.gx, player.gy);
    if (!warp) return;

    input.lock();
    console.log(`[Warp] "${warp.label ?? warp.id}" → ${warp.targetMap}`);

    mapManager.transitionTo(warp.targetMap, () => {
      player.gx = warp.targetGx;
      player.gy = warp.targetGy;
      if (!mapManager.entityLayer.children.includes(playerSpr)) {
        mapManager.entityLayer.addChild(playerSpr);
      }
      clock.updateLocation(mapManager.mapData?.name); // [修改] 切換地圖時同步顯示名稱
      requestUpdate(); // 黑畫面期間同步新地圖的鏡頭 + 霧視野
    })
      .then(() => input.unlock())
      .catch(() => {
        console.warn(`[Warp] 目標地圖 "${warp.targetMap}" 尚未建立，略過轉場`);
        input.unlock();
      });
  });

  const renderer = app.renderer.type === 1 ? 'WebGL' : 'WebGPU';
  console.log(`[QU-DON] v6 — ${renderer} @ ${app.screen.width}×${app.screen.height}`);
  console.log(`[QU-DON] 玩家起點 (${player.gx}, ${player.gy}) 面向: ${facing}`);
}
main().catch(console.error);
