/**
 * QU-DON 瞿董默示錄 | main.js  v6
 *
 * 流程：HomeScreen → 新遊戲 → 地圖行走
 * 包含：HomeScreen（照片背景）/ 地圖渲染 / 碰撞 / 霧視野
 *       D-Pad + 鍵盤 / 方向性精靈 / 場景轉場 (Warp) / ControlPanel
 */

import { InputManager }          from './src/core/Input.js';
import { EntityManager }         from './src/core/EntityManager.js';
import { ControlPanel }          from './src/ui/ControlPanel.js';
import { MapManager, DIR_DELTA } from './src/modules/MapManager.js';
import { HomeScreen }            from './src/ui/HomeScreen.js';
import { VFDClock }              from './src/ui/VFDClock.js';
import { DialogueOverlay }       from './src/ui/DialogueOverlay.js';
import { InteractionManager }    from './src/modules/InteractionManager.js';
import { CigarMenuOverlay }      from './src/ui/CigarMenuOverlay.js';
import { BattleUI }              from './src/ui/BattleUI.js';
import { AudioManager }          from './src/core/AudioManager.js';
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

// ─── 載入玩家貼圖 ────────────────────────────────────────────────────────────
// 支援兩種格式：
//   新格式：visuals.spriteSheet — 單張雪碧圖，Canvas 2D 裁切（繞過 PixiJS v8 UV 問題）
//   舊格式：visuals.mapSprites  — 向下相容，逐檔載入
// 同時回傳 playerJson（供戰鬥頭像使用）
async function loadPlayerSprites() {
  try {
    const resp       = await fetch('./src/data/entities/actors/player.json');
    const playerJson = await resp.json();
    const vis        = playerJson?.visuals ?? {};

    const sheet = await PIXI.Assets.load(`./${vis.spriteSheet}`);
    const src   = sheet.source;
    const img   = src?.resource ?? src?.htmlElement ?? src?.bitmap ?? src;
    const fw    = vis.frameWidth  ?? 128;
    const fh    = vis.frameHeight ?? 256;

    if (!img || !(img.width > 0 || img.naturalWidth > 0)) {
      throw new Error('spriteSheet ImageBitmap 無效');
    }

    // X 軸（col）= 方向：0=down 1=up 2=left 3=right
    // Y 軸（row）= 動作：0=idle 1=walkA 2=walkB
    const DIR_COLS   = { down: 0, up: 1, left: 2, right: 3 };
    const FRAME_ROWS = 3;
    const texMap     = {};

    for (const [dir, col] of Object.entries(DIR_COLS)) {
      const frames = [];
      for (let row = 0; row < FRAME_ROWS; row++) {
        const canvas = document.createElement('canvas');
        canvas.width  = fw;
        canvas.height = fh;
        canvas.getContext('2d').drawImage(img, col * fw, row * fh, fw, fh, 0, 0, fw, fh);
        frames.push(PIXI.Texture.from(canvas));
      }
      texMap[dir] = frames;
    }
    return { texMap, playerJson };

  } catch (e) {
    console.warn('[QU-DON] 無法載入玩家雪碧圖，使用圓形佔位精靈', e);
    return { texMap: {}, playerJson: null };
  }
}

// ─── 建立玩家精靈（HD-2D spriteSheet 專用）────────────────────────────────
// texMap[dir] = [idle, walkA, walkB]（Canvas 2D 從 spriteSheet 裁切而來）
// 停止 → textures=[idle]；行走 → 4 步循環 [walkA, idle, walkB, idle]
function buildPlayerSprite(tileSize, texMap = {}, playerJson = null) {
  const heightInTiles = playerJson?.visuals?.heightInTiles ?? 1.7;
  const baseSrc = texMap.down ?? Object.values(texMap)[0] ?? null;

  if (baseSrc) {
    const fh     = baseSrc[1].height;
    let _dir     = 'down';
    let _walking = false;

    const walkSequence = [1, 0, 2, 0];
    const getFrames = (dir, walk) => {
      const t = texMap[dir] ?? texMap.down ?? baseSrc;
      return walk ? walkSequence.map(row => t[row]) : [t[0]];
    };

    const spr = new PIXI.AnimatedSprite([baseSrc[0]]);
    spr.animationSpeed = 0.1;
    spr.loop           = true;
    spr.gotoAndStop(0);

    spr.startWalk = () => {
      if (_walking) return;
      _walking = true;
      spr.textures = getFrames(_dir, true);
      spr.play();
    };

    spr.stopWalk = () => {
      _walking = false;
      spr.textures = getFrames(_dir, false);
      spr.gotoAndStop(0);
    };

    spr.setDir = (dir) => {
      if (dir === _dir) return;
      _dir = dir;
      spr.textures = getFrames(dir, _walking);
      if (_walking) spr.play(); else spr.gotoAndStop(0);
    };

    spr.scale.set((tileSize * heightInTiles) / fh);
    spr.anchor.set(0.5, 1.0);
    spr.resizeTo = (s) => spr.scale.set((s * heightInTiles) / fh);
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
  PIXI.Assets.load(['assets/ui/interface/cigar_box.png', 'assets/ui/interface/cigar_single.png'])
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

  // ⚡ overlay 設為最頂層（zIndex 最大），確保遮住地圖初始化期間的所有畫面
  // gameLayer 加到 stage 的順序比 overlay 晚，自然在 overlay 上方渲染，
  // 必須用 sortableChildren + zIndex 才能讓 overlay 蓋住 gameLayer。
  app.stage.sortableChildren = true;
  overlay.zIndex = 99999;

  const mapManager    = await MapManager.create(app, gameLayer);
  const entityManager = new EntityManager(app);
  mapManager.setEntityManager(entityManager); // loadMap 時自動呼叫 entityManager.init

  // ⚡ 平行載入：地圖 JSON、玩家貼圖、控制面板、角色資料 同時進行，
  //    大幅縮短黑屏等待時間（原本依序 await，現在同步發出所有請求）
  const [, { texMap: playerTexMap, playerJson: _playerJson }, panel, _actorsJson] = await Promise.all([
    mapManager.loadMap(_devMode ? 'map_qu_don_room' : 'map_black_rock_street'),
    loadPlayerSprites(),
    ControlPanel.create(app, input),
    fetch('./src/data/actors.json').then(r => r.json()).catch(() => null),
  ]);

  const spawn   = mapManager.mapData.spawnPoints?.find(s => s.id === 'player_start')
               ?? mapManager.mapData.spawnPoints?.[0];
  const spawnGx = spawn?.gx ?? 19;
  const spawnGy = spawn?.gy ?? 12;
  // ⚡ vx/vy 直接設為出生座標，防止 ticker 第一幀用初始值 0 重設鏡頭
  const player  = { gx: spawnGx, gy: spawnGy, vx: spawnGx, vy: spawnGy };
  let   facing  = spawn?.facing ?? 'down';

  const playerSpr = buildPlayerSprite(mapManager.tileSize, playerTexMap, _playerJson);
  playerSpr.setDir(facing);
  mapManager.entityLayer.addChild(playerSpr);

  // ── Lerp 動畫常數 ────────────────────────────────────────────────────────────
  const LERP_FACTOR = 0.30;   // 放開按鍵後的收斂比例（自然減速停步）
  const LERP_SNAP   = 0.01;   // 誤差小於此值時強制對齊
  // 按住方向鍵時的定速移動量（tiles/frame @ 30fps）
  // 0.15 → 每格約 7 幀 ≈ 233ms；調高加速，調低放慢
  const MOVE_SPEED  = 0.15;
  let   _isAnimating = false;
  let   _stepPhase   = 0;     // 0–1，用於步伐上下搖晃

  // ── 精靈像素位置更新（接受浮點 grid 座標）──────────────────────────────────
  function updateSpritePos(vgx, vgy) {
    const s  = mapManager.tileSize;
    const px = mapManager.gridToPixel(vgx, vgy);
    const bob = _isAnimating ? Math.sin(_stepPhase * Math.PI) * (s * 0.06) : 0;
    playerSpr.x = px.x;
    playerSpr.y = (Object.keys(playerTexMap).length > 0 ? px.y + s * 0.5 : px.y) - bob;
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

  // ── 初始狀態：同步玩家位置 + 霧視野（鏡頭由 ticker 第一幀揭幕前確認）──────────
  syncPlayer();
  mapManager.updateFog(player.gx, player.gy, mapManager.visionRadius);

  // ── resize 處理：重建貼圖 + 重新置中，立即渲染（不依賴 ticker）──────────────
  app.stage.on('resize', () => {
    mapManager.onResize(player.gx, player.gy);
    playerSpr.resizeTo?.(mapManager.tileSize);
    // setCameraVisual 沒有 centerOn 的 early-return guard，確保 tileSize 改變後鏡頭重算
    mapManager.setCameraVisual(player.vx, player.vy);
    mapManager.render();
  });

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

  // ── 戰鬥介面（地圖世界用）────────────────────────────────────────────────
  const battleUI = new BattleUI(app);
  battleUI.visible = false;
  battleUI.zIndex = 2000;
  app.stage.addChild(battleUI);

  // 從 actors.json 取得初始玩家數值（已在 Promise.all 平行載入）
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

  // ── 觸發戰鬥：鎖定輸入、顯示 BattleUI、戰後處理 NPC ─────────────────────
  function _startBattle(npc) {
    if (!npc.entityData) return;
    AudioManager.stopBGM();
    input.lock();
    panel.visible = false;
    MapManager.onActorMoveEnd(playerSpr);

    const playerBase = _quDonData ?? { name: '瞿董', stats: { hp: 85, maxHp: 85, atk: 10, def: 5 } };
    const playerData = { ...playerBase, visuals: _playerJson?.visuals ?? null };
    battleUI.visible = true;
    battleUI.startBattle(playerData, npc.entityData);

    const cleanup = (isWin) => {
      battleUI.off('win',  onWin);
      battleUI.off('lose', onLose);
      battleUI.visible = false;
      panel.visible = true;
      if (isWin) entityManager.hideNpc(npc.id);
      input.unlock();
    };
    const onWin  = () => cleanup(true);
    const onLose = () => cleanup(false);
    battleUI.on('win',  onWin);
    battleUI.on('lose', onLose);
  }

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
  interaction.setEntityManager(entityManager);

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

  // ⚠️ overlay 不在此處 destroy，由 ticker 第一幀在鏡頭定位後才揭幕（見下方）

  // ── requestUpdate：移動後立刻更新霧視野 + 鏡頭（精靈由 lerp 連續更新）──────
  function requestUpdate() {
    mapManager.updateFog(player.gx, player.gy, mapManager.visionRadius);
    mapManager.render();
  }

  // ── tryMovePlayer：嘗試向 dir 方向移動一格 ────────────────────────────────
  // 回傳 'moved' | 'blocked' | 'warping'
  // 連鎖移動（連續按住）與初次移動共用同一段邏輯，避免重複。
  function tryMovePlayer(dir) {
    facing = dir;
    playerSpr.setDir(facing);
    const { dx, dy } = DIR_DELTA[dir];
    const nx = player.gx + dx;
    const ny = player.gy + dy;
    if (!mapManager.isWalkable(nx, ny)) return 'blocked';

    player.gx = nx;
    player.gy = ny;
    _isAnimating = true;
    _stepPhase   = 0;
    MapManager.onActorMoveStart(playerSpr);
    mapManager.updateFog(player.gx, player.gy, mapManager.visionRadius);
    updateCamera();

    const warp = mapManager.checkWarp(player.gx, player.gy);
    if (warp) {
      input.lock();
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
        syncPlayer();
        requestUpdate();
      })
        .then(() => input.unlock())
        .catch(() => {
          console.warn(`[Warp] 目標地圖 "${warp.targetMap}" 尚未建立，略過轉場`);
          input.unlock();
        });
      return 'warping';
    }
    return 'moved';
  }

  // ── 3. 主遊戲迴圈 ────────────────────────────────────────────────────────
  //
  //  ⚡ Stage 4 + Lerp：
  //     a) 有輸入 → 更新邏輯座標，啟動 lerp 動畫
  //     b) 動畫進行中 → 每幀推進 vx/vy 直到收斂
  //     c) 靜止且無動畫 → 直接返回，CPU ≈ 0
  //
  // ── overlay（zIndex=99999）蓋住初始化畫面，ticker 第一幀定位後才揭幕 ──────────
  let _revealOverlay = overlay;

  app.ticker.add(() => {
    // ── 第一幀揭幕：overlay 確實擋住畫面，在此確認鏡頭正確後銷毀 ──────────────
    if (_revealOverlay) {
      syncPlayer();        // 確保精靈 & 鏡頭對齊（vx/vy 已設為出生座標，不會拉回 0）
      mapManager.render(); // 若 _isDirty（resize 等觸發），重算 _root.x/y
      _revealOverlay.destroy();
      _revealOverlay = null;
      return; // 揭幕幀不處理輸入，避免「按新遊戲」的 pointerup 殘留觸發移動
    }

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
    if (state.justMoved && state.justDir && !_isAnimating) {
      if (tryMovePlayer(state.justDir) === 'warping') return;
    }

    // ── b) 移動推進（精靈 + 相機同步）──────────────────────────────────────────
    //   按住方向鍵：定速線性移動（無加減速，消除格間頓挫感）
    //   放開按鍵後：lerp 自然減速至對齊格子中心
    if (_isAnimating) {
      const ex   = player.gx - player.vx;
      const ey   = player.gy - player.vy;
      const dist = Math.abs(ex) + Math.abs(ey); // 軸對齊移動，兩分量僅一為非 0
      const held = state.direction;

      // 按住：snap 門檻擴大至一步之內，到位後立刻銜接下一格
      // 放開：只在誤差極小時才 snap，讓 lerp 把最後幾幀自然收完
      const snapAt = held ? MOVE_SPEED + LERP_SNAP : LERP_SNAP;

      if (dist < snapAt) {
        player.vx    = player.gx;
        player.vy    = player.gy;
        _isAnimating = false;
        _stepPhase   = 0;

        // ── NPC 碰撞檢定：踏入格子時若有敵對 NPC → 觸發戰鬥 ─────────────────
        const landedNpc = entityManager.getNpcAt(player.gx, player.gy);
        if (landedNpc?.combatCollidable) {
          updateSpritePos(player.vx, player.vy);
          mapManager.setCameraVisual(player.vx, player.vy);
          mapManager.render();
          _startBattle(landedNpc);
          return;
        }

        if (held && !interaction.isActive) {
          const result = tryMovePlayer(held);
          if (result === 'warping') return;
          if (result === 'blocked') MapManager.onActorMoveEnd(playerSpr);
          // 'moved'：_isAnimating 已重置為 true，AnimatedSprite 持續播放不重啟
        } else {
          MapManager.onActorMoveEnd(playerSpr);
        }
      } else if (held) {
        // 定速線性：每幀推進固定 MOVE_SPEED（tiles），不會在格尾減速
        const step  = Math.min(MOVE_SPEED, dist);
        player.vx  += (ex / dist) * step;
        player.vy  += (ey / dist) * step;
        _stepPhase  = Math.min(_stepPhase + 0.14, 1);
      } else {
        // 放開後：lerp 自然減速，最後幾幀會慢下來再 snap
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
