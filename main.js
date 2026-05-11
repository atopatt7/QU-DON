/**
 * QU-DON 瞿董默示錄 | main.js  v5 — walk-only
 *
 * 目標：角色在地圖上正常行走
 * 包含：地圖渲染 / 碰撞 / 霧視野 / D-Pad + 鍵盤 + Tile 點擊移動
 *       方向性精靈 / 場景轉場 (Warp) / ControlPanel
 * 移除：HomeScreen / BattleUI / DialogueOverlay / InventoryScreen（日後逐步加回）
 */

import { InputManager }          from './src/core/Input.js';
import { ControlPanel }          from './src/ui/ControlPanel.js';
import { MapManager, DIR_DELTA } from './src/modules/MapManager.js';

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

// ─── Pixi App ──────────────────────────────────────────────────────────────
async function initPixi() {
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
/**
 * sheetTex 存在 → 4 方向 PIXI.Sprite（FRONT/BACK/SIDE-R/SIDE-L 並排）
 * sheetTex 為 null → PIXI.Graphics 圓形佔位（方向點旋轉）
 *
 * 錨點：(0.5, 1.0) 底部中央
 * 定位：syncPlayer 中 y = tileCenter.y + tileSize * 0.5（腳踩格子底邊）
 */
function buildPlayerSprite(tileSize, sheetTex = null) {

  if (sheetTex) {
    const fw  = Math.floor(sheetTex.width / 4);   // 前三幀寬
    const fw3 = sheetTex.width - fw * 3;           // 第四幀（可能多 1px）
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
//  主程式
// ═══════════════════════════════════════════════════════════════════════════
async function main() {
  const app = await initPixi();
  bindResize(app);

  const input     = new InputManager(app.canvas);
  const gameLayer = buildGameLayer(app);

  // ── MapManager：載入 Black Rock Street ──────────────────────────────────
  const mapManager = await MapManager.create(app, gameLayer);
  await mapManager.loadMap('map_black_rock_street');

  const spawn  = mapManager.mapData.spawnPoints.find(s => s.id === 'player_start');
  const player = { gx: spawn?.gx ?? 19, gy: spawn?.gy ?? 12 };
  let   facing = spawn?.facing ?? 'down';

  // ── 玩家精靈 ─────────────────────────────────────────────────────────────
  const sheetTex  = await loadPlayerSheet();
  const playerSpr = buildPlayerSprite(mapManager.tileSize, sheetTex);
  playerSpr.setDir(facing);
  mapManager.entityLayer.addChild(playerSpr);

  // ── syncPlayer：同步座標 + 鏡頭 + InputManager ──────────────────────────
  const syncPlayer = () => {
    const s  = mapManager.tileSize;
    const px = mapManager.gridToPixel(player.gx, player.gy);
    playerSpr.x = px.x;
    // sheetTex: 錨點在底部，y += s/2 讓腳踩格子底邊
    // 圓形:     錨點在圓心，y 不偏移
    playerSpr.y = sheetTex ? px.y + s * 0.5 : px.y;
    mapManager.centerOn(player.gx, player.gy);
    input.setGridConfig(s, mapManager.rootX, mapManager.rootY);
  };

  syncPlayer();
  mapManager.updateFog(player.gx, player.gy, mapManager.visionRadius);

  // ── Resize ───────────────────────────────────────────────────────────────
  app.stage.on('resize', () => {
    mapManager.onResize(player.gx, player.gy);
    playerSpr.resizeTo?.(mapManager.tileSize);
    syncPlayer();
  });

  // ── ControlPanel ─────────────────────────────────────────────────────────
  const panel = await ControlPanel.create(app, input);
  app.stage.addChild(panel);

  // ═══════════════════════════════════════════════════════════════════════
  //  主遊戲迴圈
  // ═══════════════════════════════════════════════════════════════════════
  app.ticker.add(() => {
    const state = input.update();
    let moved   = false;

    // ── 1. D-Pad / 方向鍵移動 ────────────────────────────────────────────
    if (state.justMoved && state.justDir) {
      // 先轉向（即使撞牆也轉，符合 RPG 慣例）
      facing = state.justDir;
      playerSpr.setDir(facing);

      const { dx, dy } = DIR_DELTA[state.justDir];
      const nx = player.gx + dx;
      const ny = player.gy + dy;
      if (mapManager.isWalkable(nx, ny)) {
        player.gx = nx;
        player.gy = ny;
        moved     = true;
        flashPlayer(playerSpr);
      }
    }

    // ── 2. 移動後：鏡頭 / 霧視野 / Warp ─────────────────────────────────
    if (moved) {
      syncPlayer();
      mapManager.updateFog(player.gx, player.gy, mapManager.visionRadius);

      const warp = mapManager.checkWarp(player.gx, player.gy);
      if (warp) {
        input.lock();
        console.log(`[Warp] "${warp.label ?? warp.id}" → ${warp.targetMap}`);

        mapManager.transitionTo(warp.targetMap, () => {
          player.gx = warp.targetGx;
          player.gy = warp.targetGy;
          if (!mapManager.entityLayer.children.includes(playerSpr)) {
            mapManager.entityLayer.addChild(playerSpr);
          }
          syncPlayer();
          mapManager.updateFog(player.gx, player.gy, mapManager.visionRadius);
        })
          .then(() => input.unlock())
          .catch(() => {
            // 目標地圖尚未建立 → 取消轉場，原地解鎖
            console.warn(`[Warp] 目標地圖 "${warp.targetMap}" 尚未建立，略過轉場`);
            input.unlock();
          });

        return; // 本幀不繼續處理
      }
    }
  });

  const renderer = app.renderer.type === 1 ? 'WebGL' : 'WebGPU';
  console.log(`[QU-DON] v5 walk-only — ${renderer} @ ${app.screen.width}×${app.screen.height}`);
  console.log(`[QU-DON] 玩家起點 (${player.gx}, ${player.gy}) 面向: ${facing}`);
}

main().catch(console.error);
