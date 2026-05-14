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
import { DialogueOverlay }       from './src/ui/DialogueOverlay.js';
import { InteractionManager }    from './src/modules/InteractionManager.js';
import { CigarMenuOverlay }      from './src/ui/CigarMenuOverlay.js';
import { BattleUI }              from './src/ui/BattleUI.js';
import { StatusScreen }          from './src/ui/StatusScreen.js';
import { WorldMapScreen }        from './src/ui/WorldMapScreen.js';

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

// ─── 開發輔助旗標 ──────────────────────────────────────────────────────────
window.SHOW_COORDS = false;

// ═══════════════════════════════════════════════════════════════════════════
//  主程式
// ═══════════════════════════════════════════════════════════════════════════
async function main() {
  const app = await initPixi();
  bindResize(app);

  // 雪茄盒選單素材預載：與首頁顯示並行，不阻塞畫面
  PIXI.Assets.load(['assets/ui/cigar_box.png', 'assets/ui/cigar_single.png'])
    .catch(() => console.warn('[QU-DON] CigarMenu 素材預載失敗，選單將使用佔位圖形'));

  // ── 1. 顯示首頁 ──────────────────────────────────────────────────────────
  const homeScreen = await HomeScreen.create(app);
  app.stage.addChild(homeScreen);

  // 等待玩家點「新遊戲」或「DEV ZONE」
  let _devMode = false;
  await new Promise(resolve => {
    homeScreen.on('action', (id) => {
      if (id === 'new_game') resolve();
    });
    homeScreen.on('startDevMode', () => {
      _devMode = true;
      resolve();
    });
  });

  // 淡出首頁
  const overlay = await fadeOut(app, _devMode ? 250 : 500);
  homeScreen.destroy({ children: true });

  // ── DEV MODE：直接啟動戰鬥測試，跳過地圖世界建置 ─────────────────────────
  if (_devMode) {
    window.DEV_MODE = true;
    console.log('[DEV MODE] 啟動戰鬥測試介面');
    overlay.destroy();

    const actorsJson = await fetch('./src/data/actors.json').then(r => r.json()).catch(() => null);
    const enemyData  = actorsJson?.actors?.find(a => a.id === 'enemy_red_dog_thug_01')
                    ?? { name: '紅犬幫混混', stats: { hp: 50, maxHp: 50, atk: 8, def: 2 } };
    const playerData = actorsJson?.actors?.find(a => a.id === 'qu_don')
                    ?? { name: '瞿董', stats: { hp: 85, maxHp: 85 } };

    const battleUI = new BattleUI(app);
    app.stage.addChild(battleUI);
    battleUI.startBattle(playerData, enemyData);

    battleUI.on('action', (id) => console.log(`[DEV BATTLE] action → ${id}`));
    return;
  }

  // ── 2. 建立遊戲世界 ────────────────────────────────────────────────────
  const input     = new InputManager(app.canvas);
  const gameLayer = buildGameLayer(app);

  const mapManager = await MapManager.create(app, gameLayer);
  await mapManager.loadMap(_devMode ? 'map_qu_don_room' : 'map_black_rock_street');

  const spawn  = mapManager.mapData.spawnPoints?.find(s => s.id === 'player_start')
              ?? mapManager.mapData.spawnPoints?.[0];
  const player = { gx: spawn?.gx ?? 19, gy: spawn?.gy ?? 12, vx: 0, vy: 0 };
  let   facing = spawn?.facing ?? 'down';

  const sheetTex  = await loadPlayerSheet();
  const playerSpr = buildPlayerSprite(mapManager.tileSize, sheetTex);
  playerSpr.setDir(facing);
  mapManager.entityLayer.addChild(playerSpr);

  // ── Lerp 動畫常數 ────────────────────────────────────────────────────────────
  const LERP_FACTOR = 0.30;   // 每幀收斂比例（30fps ≈ 150ms 抵達）
  const LERP_SNAP   = 0.01;   // 誤差小於此值時強制對齊
  let   _isAnimating = false;
  let   _stepPhase   = 0;     // 0–1，用於步伐上下搖晃

  // ── 精靈像素位置更新（接受浮點 grid 座標）──────────────────────────────────
  function updateSpritePos(vgx, vgy) {
    const s  = mapManager.tileSize;
    const px = mapManager.gridToPixel(vgx, vgy);
    const bob = _isAnimating ? Math.sin(_stepPhase * Math.PI) * (s * 0.06) : 0;
    playerSpr.x = px.x;
    playerSpr.y = (sheetTex ? px.y + s * 0.5 : px.y) - bob;
  }

  // ── 輸入座標系更新（每次移動後同步 touch→grid 的座標基準）───────────────────
  //    ※ 相機位置由 lerp 驅動，此函式不再呼叫 centerOn
  function updateCamera() {
    input.setGridConfig(mapManager.tileSize, mapManager.rootX, mapManager.rootY);
  }

  // ── syncPlayer：強制精靈 & 鏡頭立即對齊（用於初始 / resize / 傳送）──────────
  const syncPlayer = () => {
    player.vx  = player.gx;
    player.vy  = player.gy;
    _isAnimating = false;
    _stepPhase   = 0;
    mapManager.centerOn(player.gx, player.gy); // snap 視覺相機到邏輯座標
    updateSpritePos(player.vx, player.vy);
    updateCamera();
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

  // ── 雪茄盒主選單（暫停選單）────────────────────────────────────────────────
  // 素材已由前述 PIXI.Assets.load() 預載，此處同步取回並建立選單
  const cigarMenu = CigarMenuOverlay.create(app);
  cigarMenu.visible = false;
  app.stage.sortableChildren = true;
  cigarMenu.zIndex = 1000;
  app.stage.addChild(cigarMenu);

  // 關閉選單時恢復控制面板
  const _hideMenu = () => { cigarMenu.hide(); panel.visible = true; };
  const _showMenu = () => { cigarMenu.show(); panel.visible = false; };

  cigarMenu.on('close', _hideMenu);

  // ── 狀態與專長介面 ────────────────────────────────────────────────────────
  const statusScreen = new StatusScreen(app);
  statusScreen.zIndex = 1100;
  app.stage.addChild(statusScreen);

  // ── 城市地圖介面 ──────────────────────────────────────────────────────────
  const worldMap = new WorldMapScreen(app);
  worldMap.zIndex = 1100;
  app.stage.addChild(worldMap);

  // 從 actors.json 取得初始玩家數值（若已載入）
  const _actorsJson = await fetch('./src/data/actors.json').then(r => r.json()).catch(() => null);
  const _quDonData  = _actorsJson?.actors?.find(a => a.id === 'qu_don');
  if (_quDonData) {
    statusScreen.updateData({
      name:         _quDonData.name,
      level:        1,
      exp:          0,
      nextLevelExp: _quDonData.levelProgression?.xpPerLevel ?? 100,
      hp:           _quDonData.stats.hp,
      maxHp:        _quDonData.stats.maxHp,
      atk:          _quDonData.stats.attack,
      def:          _quDonData.stats.defense,
      stamina:      _quDonData.stats.hp,
      maxStamina:   _quDonData.stats.maxHp,
      skillPoints:  3,
      perks:        (_quDonData.passives ?? []).map(p => ({
        label: p.label, rank: 1, desc: p.effect,
      })),
    });
  }

  statusScreen.on('close', () => {
    _showMenu(); // 關閉狀態介面後回到雪茄選單
  });

  // ── 具名事件 Stubs（功能待實作）──────────────────────────────────────────
  cigarMenu.on('resume',    ()              => _hideMenu());
  cigarMenu.on('status',    ()              => { cigarMenu.hide(); statusScreen.show(); });
  cigarMenu.on('inventory', ({ label })     => { console.log(`[Menu] ${label}`); });
  cigarMenu.on('crew',      ({ label })     => { console.log(`[Menu] ${label}`); });
  cigarMenu.on('journal',   ({ label })     => { console.log(`[Menu] ${label}`); });
  cigarMenu.on('map',       ()              => { cigarMenu.hide(); worldMap.show(); });
  cigarMenu.on('settings',  ()              => { window.SHOW_COORDS = !window.SHOW_COORDS; _hideMenu(); });
  cigarMenu.on('save',      ({ label })     => { console.log(`[Menu] ${label}`); });
  cigarMenu.on('quit',      ()              => { console.log('[Menu] 放棄生存'); });

  worldMap.on('close', () => { _showMenu(); });
  // ────────────────────────────────────────────────────────────────────────

  // 控制面板實體選單按鈕
  panel.on('menu', () => {
    if (!cigarMenu.visible && !interaction.isActive) {
      _showMenu();
    }
  });

  // Escape 開啟選單；選單自身的 Escape handler 負責關閉
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !cigarMenu.visible && !interaction.isActive) {
      e.preventDefault();
      _showMenu();
    }
  });

  // ── 環境調查系統 ────────────────────────────────────────────────────────────
  const dialogueOverlay = new DialogueOverlay(app, { text: '', speaker: '' });
  dialogueOverlay.visible = false;
  app.stage.addChild(dialogueOverlay);

  const interaction = new InteractionManager(mapManager, dialogueOverlay);

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

  // 初始地圖名稱（優先讀 displayName，無則 fallback 到 name）
  const getMapLabel = (data) => data?.displayName ?? data?.name ?? '---';
  clock.updateLocation(getMapLabel(mapManager.mapData));

  // 移除淡出遮罩（讓遊戲顯現）
  overlay.destroy();

  // ── requestUpdate：移動後立刻更新霧視野 + 鏡頭（精靈由 lerp 連續更新）──────
  function requestUpdate() {
    mapManager.updateFog(player.gx, player.gy, mapManager.visionRadius);
    mapManager.render();
  }

  // ── 3. 主遊戲迴圈 ────────────────────────────────────────────────────────
  //
  //  ⚡ Stage 4 + Lerp：
  //     a) 有輸入 → 更新邏輯座標，啟動 lerp 動畫
  //     b) 動畫進行中 → 每幀推進 vx/vy 直到收斂
  //     c) 靜止且無動畫 → 直接返回，CPU ≈ 0
  //
  app.ticker.add(() => {
    const state = input.update();

    // ── 座標顯示更新 ──────────────────────────────────────────────────────────
    panel.updateCoordinates(player.gx, player.gy);

    // ── 0) 環境調查：確認鍵邏輯 ────────────────────────────────────────────
    if (interaction.isActive) {
      // 對話框開啟中：確認鍵跳過打字機或關閉對話；其餘輸入全部丟棄
      if (state.confirmJust) interaction.advance();
      return;
    }
    if (state.confirmJust) {
      // 嘗試調查正前方 Tile；若成功觸發則本幀跳過移動
      if (interaction.tryInteract(player.gx, player.gy, facing)) return;
    }

    // ── a) 有新輸入：嘗試移動 ──────────────────────────────────────────────
    if (state.justMoved && state.justDir) {
      facing = state.justDir;
      playerSpr.setDir(facing);

      const { dx, dy } = DIR_DELTA[state.justDir];
      const nx = player.gx + dx;
      const ny = player.gy + dy;

      if (mapManager.isWalkable(nx, ny)) {
        player.gx = nx;
        player.gy = ny;

        // 啟動（或重啟）lerp：視覺座標從當前位置平滑推進到新格子
        _isAnimating = true;
        _stepPhase   = 0;

        // 霧視野立即對齊新格（Pixi 自動渲染 alpha 變化）
        mapManager.updateFog(player.gx, player.gy, mapManager.visionRadius);
        // 輸入座標系更新（相機位置由 lerp section b 逐幀推進，不在此 snap）
        updateCamera();

        // ── 傳送門檢查 ─────────────────────────────────────────────────────
        const warp = mapManager.checkWarp(player.gx, player.gy);
        if (warp) {
          input.lock();
          // 進入傳送前停止 lerp，避免 ticker section-b 在轉場期間干擾相機座標
          _isAnimating = false;
          _stepPhase   = 0;
          console.log(`[Warp] "${warp.label ?? warp.id}" → ${warp.targetMap}`);
          mapManager.transitionTo(warp.targetMap, () => {
            player.gx = warp.targetGx;
            player.gy = warp.targetGy;
            if (!mapManager.entityLayer.children.includes(playerSpr)) {
              mapManager.entityLayer.addChild(playerSpr);
            }
            clock.updateLocation(getMapLabel(mapManager.mapData));
            syncPlayer(); // 傳送後強制對齊，不做 lerp
            requestUpdate();
          })
            .then(() => input.unlock())
            .catch(() => {
              console.warn(`[Warp] 目標地圖 "${warp.targetMap}" 尚未建立，略過轉場`);
              input.unlock();
            });
          return; // 傳送期間不繼續 lerp
        }
      }
    }

    // ── b) Lerp 動畫推進（精靈 + 相機同步）────────────────────────────────────
    if (_isAnimating) {
      const ex = player.gx - player.vx;
      const ey = player.gy - player.vy;

      if (Math.abs(ex) < LERP_SNAP && Math.abs(ey) < LERP_SNAP) {
        // 誤差夠小 → 強制對齊，結束動畫
        player.vx    = player.gx;
        player.vy    = player.gy;
        _isAnimating = false;
        _stepPhase   = 0;
      } else {
        player.vx  += ex * LERP_FACTOR;
        player.vy  += ey * LERP_FACTOR;
        _stepPhase  = Math.min(_stepPhase + 0.12, 1);
      }

      // 精靈 & 相機同步到相同浮點視覺座標 → 地圖移動與角色完全一致，不暈
      updateSpritePos(player.vx, player.vy);
      mapManager.setCameraVisual(player.vx, player.vy);
      mapManager.render();
      return;
    }

    // ── c) 靜止且無動畫：不觸碰任何 Pixi 物件，CPU ≈ 0 ─────────────────────
  });

  const renderer = app.renderer.type === 1 ? 'WebGL' : 'WebGPU';
  console.log(`[QU-DON] v6 — ${renderer} @ ${app.screen.width}×${app.screen.height}`);
  console.log(`[QU-DON] 玩家起點 (${player.gx}, ${player.gy}) 面向: ${facing}`);
}
main().catch(console.error);
