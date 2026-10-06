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
import { InventoryScreen }       from './src/ui/InventoryScreen.js';
import { TextPanelScreen }       from './src/ui/TextPanelScreen.js';
import { GameStateManager }      from './src/core/GameStateManager.js';
import { gameAreaHeight, isLandscape } from './src/core/Layout.js';
import { SaveSystem, Settings }  from './src/core/SaveSystem.js';

// 新遊戲的起點：瞿董的房間（序章）
const START_MAP = 'map_qu_don_room';

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
    // 解析度上限 2：像素風畫面在 3x 螢幕上看不出差別，但要填的像素多 2.25 倍（手機 GPU 的主要負擔）
    resolution:      Math.min(window.devicePixelRatio || 1, 2),
    autoDensity:     true,
    antialias:       false,
    eventMode:       'static',
  });

  // 60fps 上限：移動已改為以時間計算（見 BASE_FRAME_MS），高刷新率螢幕不會多燒電
  app.ticker.maxFPS = 60;

  _appInstance = app;
  document.getElementById('game-container').appendChild(app.canvas);
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

// ─── 遊戲圖層（直式：上方 66%；橫式：全畫面。帶遮罩）──────────────────────────────────────────
function buildGameLayer(app) {
  const layer = new PIXI.Container();
  layer.label = 'gameLayer';
  const mask  = new PIXI.Graphics();
  const drawMask = () => {
    mask.clear();
    mask.rect(0, 0, app.screen.width, gameAreaHeight(app.screen.width, app.screen.height))
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

// ─── 無輸入快照（全螢幕介面開啟時取代 input.update() 結果）────────────────
const IDLE_INPUT = Object.freeze({
  direction: null, justMoved: false, justDir: null, tileTarget: null,
  confirmJust: false, cancelJust: false, action: {}, raw: {},
});

// ─── 開發輔助旗標 ──────────────────────────────────────────────────────────
window.SHOW_COORDS = new URLSearchParams(location.search).has('dev');

// ═══════════════════════════════════════════════════════════════════════════
//  主程式
// ═══════════════════════════════════════════════════════════════════════════
async function main() {
  const app = await initPixi();
  bindResize(app);

  // 雪茄盒選單素材預載：與首頁顯示並行，不阻塞畫面
  PIXI.Assets.load(['assets/ui/interface/cigar_box.webp', 'assets/ui/interface/cigar_single.webp'])
    .catch(() => console.warn('[QU-DON] CigarMenu 素材預載失敗，選單將使用佔位圖形'));

  // 套用音樂設定（首頁就能切換）
  AudioManager.setMuted(!Settings.get().music);

  // ── 1. 顯示首頁 ──────────────────────────────────────────────────────────
  const homeScreen = await HomeScreen.create(app, { hasSave: SaveSystem.has() });
  app.stage.addChild(homeScreen);

  // 等待玩家點「新遊戲」「載入遊戲」或「DEV ZONE」
  let _devMode  = false;
  let _saveData = null;   // 載入遊戲時的存檔內容；新遊戲為 null
  await new Promise(resolve => {
    homeScreen.on('action', (id) => {
      if (id === 'new_game') resolve();
      if (id === 'load_game') {
        _saveData = SaveSystem.load();
        if (_saveData) resolve();
      }
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
  // 讀檔：已擊敗 / 已招募的 NPC 必須在第一張地圖載入前就排除
  for (const id of _saveData?.removedNpcs ?? []) entityManager._removed.add(id);
  app.mapManager = mapManager;               // 供 WorldMapScreen 讀取當前地圖 ID

  // ⚡ 平行載入：地圖 JSON、玩家貼圖、控制面板、角色資料 同時進行，
  //    大幅縮短黑屏等待時間（原本依序 await，現在同步發出所有請求）
  const [, { texMap: playerTexMap, playerJson: _playerJson }, panel, _actorsJson] = await Promise.all([
    mapManager.loadMap(_saveData?.map ?? START_MAP),
    loadPlayerSprites(),
    ControlPanel.create(app, input),
    fetch('./src/data/actors.json').then(r => r.json()).catch(() => null),
  ]);

  const spawn   = mapManager.mapData.spawnPoints?.find(s => s.id === 'player_start')
               ?? mapManager.mapData.spawnPoints?.[0];
  const spawnGx = _saveData?.gx ?? spawn?.gx ?? 1;
  const spawnGy = _saveData?.gy ?? spawn?.gy ?? 1;
  // ⚡ vx/vy 直接設為出生座標，防止 ticker 第一幀用初始值 0 重設鏡頭
  const player  = { gx: spawnGx, gy: spawnGy, vx: spawnGx, vy: spawnGy };
  let   facing  = _saveData?.facing ?? spawn?.facing ?? 'down';

  const playerSpr = buildPlayerSprite(mapManager.tileSize, playerTexMap, _playerJson);
  playerSpr.setDir(facing);
  mapManager.entityLayer.addChild(playerSpr);

  // ── Lerp 動畫常數 ────────────────────────────────────────────────────────────
  // 以下數值都以「30fps 的一幀」為單位定義，實際每幀依 deltaMS 換算（見 ticker 內的 f）
  const BASE_FRAME_MS = 1000 / 30;
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
    entityManager.resize(mapManager.tileSize);
    // setCameraVisual 沒有 centerOn 的 early-return guard，確保 tileSize 改變後鏡頭重算
    mapManager.setCameraVisual(player.vx, player.vy);
    mapManager.render();
    // 精靈位置以 tileSize 換算，轉向 / 縮放後必須重算，否則玩家會留在舊的像素位置
    updateSpritePos(player.vx, player.vy);
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

  // ── 備忘錄 / 隊伍人脈（共用文字面板）──────────────────────────────────────
  const textPanel = new TextPanelScreen(app);
  textPanel.zIndex = 1100;
  app.stage.addChild(textPanel);
  const _journalData = await fetch('./src/data/journal.json').then(r => r.json()).catch(() => ({ quests: [] }));

  // ── 背包介面 ──────────────────────────────────────────────────────────────
  const inventoryScreen = await InventoryScreen.create(app);
  inventoryScreen.zIndex = 1200;
  app.stage.addChild(inventoryScreen);

  // 玩家背包：讀檔時沿用存檔；新遊戲用初始存量（工地通行證在序章裡從門縫撿到）
  const playerInventory = _saveData?.inventory?.map(e => ({ ...e })) ?? [
    { id: 'painkiller',    qty: 3 },
    { id: 'cigarette',     qty: 5 },
    { id: 'bento',         qty: 1 },
    { id: 'bandage',       qty: 2 },
    { id: 'energy_drink',  qty: 1 },
  ];

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

  // ── 玩家當前 HP（跨戰鬥保留；之後由存檔系統接手）────────────────────────
  const playerBase = _quDonData ?? { name: '瞿董', stats: { hp: 85, maxHp: 85, atk: 10, def: 5 } };
  let   playerHp   = _saveData?.hp ?? playerBase.stats.hp;

  const _setPlayerHp = (hp) => {
    playerHp = Math.max(0, Math.min(hp, playerBase.stats.maxHp));
    statusScreen.updateData({ hp: playerHp });
  };

  // ── 觸發戰鬥：鎖定輸入、顯示 BattleUI、戰後處理 NPC ─────────────────────
  function _startBattle(npc) {
    if (!npc.entityData || battleUI.visible) return;
    AudioManager.stopBGM();
    input.lock();
    panel.visible = false;
    MapManager.onActorMoveEnd(playerSpr);

    const playerData = {
      ...playerBase,
      stats:   { ...playerBase.stats, hp: playerHp },
      visuals: _playerJson?.visuals ?? null,
    };
    battleUI.visible = true;
    battleUI.startBattle(playerData, npc.entityData);

    const cleanup = () => {
      battleUI.off('win',  onWin);
      battleUI.off('lose', onLose);
      battleUI.off('flee', onFlee);
      battleUI.visible = false;
      panel.visible = true;
      input.unlock();
      _autosave();
    };
    const onWin = ({ talked } = {}) => {
      _setPlayerHp(battleUI.playerHp);
      entityManager.hideNpc(npc.id);
      gsm.setFlag(`defeated_${npc.id}`); // 供對話 variants 判斷（例如「你把守衛打了？」）
      if (talked) gsm.setFlag(`talked_down_${npc.id}`); // 談判收場（沒有動手打倒）
      cleanup();
    };
    const onLose = () => {
      cleanup();
      _wakeUpAtHome();
    };
    // 逃跑：敵人留在原地；短暫無敵時間，避免巡邏中的敵人下一步又撞上來
    const onFlee = () => {
      _setPlayerHp(battleUI.playerHp);
      _battleGraceUntil = performance.now() + 3000;
      cleanup();
    };
    battleUI.on('win',  onWin);
    battleUI.on('lose', onLose);
    battleUI.on('flee', onFlee);
  }
  let _battleGraceUntil = 0;

  // ── 戰敗：昏倒後在自己房間醒來，HP 回滿；擊敗你的敵人仍留在原地 ───────────
  const HOME_MAP = 'map_qu_don_room';
  function _wakeUpAtHome() {
    _setPlayerHp(playerBase.stats.maxHp);
    _warpTo(HOME_MAP, null, null).then(() => {
      interaction.showMessage('……你在自己房間的床上醒來。渾身痠痛，但還活著。', '（系統）');
    });
  }

  // ── 具名事件 Stubs（功能待實作）──────────────────────────────────────────
  cigarMenu.on('resume',    ()              => _hideMenu());
  cigarMenu.on('status',    ()              => { cigarMenu.hide(); statusScreen.show(); });
  cigarMenu.on('inventory', ()              => { _showInventory(); });
  cigarMenu.on('crew',      ()              => { cigarMenu.hide(); textPanel.show(_buildCrewPanel()); });
  cigarMenu.on('journal',   ()              => { cigarMenu.hide(); textPanel.show(_buildJournalPanel()); });
  cigarMenu.on('map',       ()              => { cigarMenu.hide(); worldMap.show(); });
  cigarMenu.on('settings',  ()              => {
    const { music } = Settings.set({ music: !Settings.get().music });
    AudioManager.setMuted(!music);
    _hideMenu();
    interaction.showMessage(`音樂已${music ? '開啟' : '關閉'}。`, '（系統）');
  });
  cigarMenu.on('save',      ()              => {
    _hideMenu();
    const ok = SaveSystem.save(_collectSave());
    interaction.showMessage(ok ? '進度已儲存。' : '無法儲存：這個瀏覽器不允許寫入本機儲存空間（例如無痕模式）。', '（系統）');
  });
  // 放棄生存：存檔後回到標題畫面
  cigarMenu.on('quit',      ()              => { SaveSystem.save(_collectSave()); location.reload(); });
  textPanel.on('close', () => { _showMenu(); });

  worldMap.on('close', () => { _showMenu(); });

  const _showInventory = () => {
    cigarMenu.hide();
    panel.visible = false;
    inventoryScreen.show(playerInventory);
  };

  inventoryScreen.on('close', () => { panel.visible = true; });

  // 使用道具：目前支援 heal_hp（items.json 的 useProps.effects）。
  // 沒有可套用效果、或 HP 已滿時不消耗（能量飲料等留給之後的 SP 系統，也可拿來當交涉道具）
  /** 道具的回復量（含浮動）；不是回血道具時回傳 0 */
  function _rollHeal(itemId) {
    const def = gsm.itemDef(itemId);
    if (!def?.usable) return 0;
    return (def.useProps?.effects ?? [])
      .filter(e => e.type === 'heal_hp')
      .reduce((sum, e) => sum + e.value + Math.round((Math.random() * 2 - 1) * (e.variance ?? 0)), 0);
  }

  // 戰鬥中的物品選單：只列出回血道具；使用時扣背包、回傳回復量給 BattleUI
  battleUI.setItemProvider({
    list: () => gsm.inventory
      .filter(e => e.qty > 0 && _rollHeal(e.id) > 0)
      .map(e => ({ id: e.id, name: gsm.itemName(e.id), qty: e.qty })),
    use:  (id) => {
      const heal = _rollHeal(id);
      return heal > 0 && gsm.removeItem(id, 1) ? heal : null;
    },
    name: (id) => gsm.itemName(id),
  });

  inventoryScreen.on('use', (itemId) => {
    const def  = gsm.itemDef(itemId);
    const heal = _rollHeal(itemId);
    if (!def?.usable || heal <= 0 || playerHp >= playerBase.stats.maxHp) return;
    if (!gsm.removeItem(itemId, 1)) return;
    _setPlayerHp(playerHp + heal);
    console.log(`[Inventory] 使用：${itemId}  HP +${heal} → ${playerHp}`);
    inventoryScreen.show(playerInventory); // 重新渲染（數量更新）
  });
  // ────────────────────────────────────────────────────────────────────────

  // 任一全螢幕介面（選單 / 狀態 / 地圖 / 背包 / 戰鬥）開啟中
  const _isUiOpen = () =>
    cigarMenu.visible || statusScreen.visible || worldMap.visible
    || inventoryScreen.visible || battleUI.visible || textPanel.visible;

  // 可開啟選單 / 背包：無介面、無對話、非轉場或戰鬥鎖定
  const _canOpenOverlay = () =>
    !_isUiOpen() && !interaction.isActive && !input.isLocked;

  // 控制面板實體選單按鈕
  panel.on('menu', () => {
    if (_canOpenOverlay()) _showMenu();
  });

  // Escape 開啟選單；I 鍵開啟背包；各介面自身的 handler 負責關閉
  window.addEventListener('keydown', (e) => {
    // 介面自身的 handler 先註冊、先執行；已處理（preventDefault）的按鍵不再重開選單，
    // 否則 Esc 關閉選單後會在同一個事件內被這裡立刻重新打開
    if (e.defaultPrevented) return;
    if (e.key === 'Escape' && _canOpenOverlay()) {
      e.preventDefault();
      _showMenu();
    }
    if ((e.key === 'i' || e.key === 'I') && _canOpenOverlay()) {
      e.preventDefault();
      _showInventory();
    }
  });

  // ── 環境調查系統 ────────────────────────────────────────────────────────────
  const dialogueOverlay = new DialogueOverlay(app, { text: '', speaker: '' });
  dialogueOverlay.visible = false;
  app.stage.addChild(dialogueOverlay);

  // ── GameStateManager（隊伍 / 旗標 / 狀態機）────────────────────────────────
  const gsm = new GameStateManager();
  gsm.inventory = playerInventory;          // 與 InventoryScreen 共用同一個陣列
  gsm.itemDefs  = inventoryScreen.itemDefs;

  // NPC 的條件式 variants（位置 / 對話 / 是否出現）隨旗標與背包即時更新
  entityManager.setConditionResolver(base => gsm.resolveVariant(base));
  gsm.on('flag:set',         () => entityManager.refreshVariants());
  gsm.on('inventory:change', () => entityManager.refreshVariants());

  // 訂閱戰鬥觸發（InteractionManager BATTLE 選項 → 這裡接手）
  gsm.on('battle:trigger', ({ npc }) => {
    if (npc?.entityData) _startBattle(npc);
  });

  // 訂閱招募成功（未來可在此更新隊伍 UI / EntityManager 跟隨行為）
  gsm.on('party:join', ({ id }) => {
    entityManager.hideNpc(id); // 暫時：招募後從地圖移除（後期改為跟隨 AI）
    console.log(`[main] 隊伍成員已加入：${id}`);
  });

  const interaction = new InteractionManager(mapManager, dialogueOverlay);
  interaction.setEntityManager(entityManager);
  interaction.setGameStateManager(gsm);

  // ── 讀檔：還原旗標 / 隊伍（NPC variants 依旗標重新套用）─────────────────────
  if (_saveData) {
    Object.assign(gsm.flags, _saveData.flags ?? {});
    gsm.party.push(...(_saveData.party ?? []));
    Object.assign(gsm.partyNames, _saveData.partyNames ?? {});
    entityManager.refreshVariants();
  }
  statusScreen.updateData({ hp: playerHp });

  // ── 存檔 ──────────────────────────────────────────────────────────────────
  // 自動存檔：旗標 / 背包 / 隊伍變動、換地圖、戰鬥結束後。手機玩家隨時可能關掉分頁。
  function _collectSave() {
    return {
      map:         mapManager.mapData.id,
      gx:          player.gx,
      gy:          player.gy,
      facing,
      hp:          playerHp,
      flags:       { ...gsm.flags },
      inventory:   gsm.inventory.map(e => ({ ...e })),
      party:       [...gsm.party],
      partyNames:  { ...gsm.partyNames },
      removedNpcs: [...entityManager._removed],
    };
  }
  let _saveTimer = null;
  function _autosave() {
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => {
      // 轉場 / 戰鬥中狀態不完整，延後到結束再存
      if (input.isLocked || battleUI.visible) { _autosave(); return; }
      SaveSystem.save(_collectSave());
    }, 400);
  }
  gsm.on('flag:set',         _autosave);
  gsm.on('inventory:change', _autosave);
  gsm.on('party:join',       _autosave);

  // ── 備忘錄 / 隊伍人脈內容 ─────────────────────────────────────────────────
  function _buildJournalPanel() {
    const sections = [];
    for (const q of _journalData.quests ?? []) {
      const lines = (q.entries ?? []).filter(e => gsm.meets(e)).map(e => e.text);
      if (!lines.length) continue;
      const done = q.doneIf && gsm.meets({ if: q.doneIf });
      sections.push({ heading: q.title, tag: done ? '［完成］' : '［進行中］', lines });
    }
    // 進行中的排前面
    sections.sort((a, b) => (a.tag === b.tag ? 0 : a.tag === '［進行中］' ? -1 : 1));
    return { title: '備忘錄', subtitle: '1986　洛城　雨季', sections, empty: '（還沒有記下任何事。）' };
  }

  function _buildCrewPanel() {
    const sections = gsm.party.map(id => ({
      heading: gsm.partyNames[id] ?? id,
      lines:   ['跟著你行動。'],
    }));
    return { title: '隊伍人脈', sections, empty: '（現在還沒有人跟著你。在這座城市，信任比子彈還貴。）' };
  }

  // ── VFD 時鐘（左下角，遊戲區底部）────────────────────────────────────────
  const clock = new VFDClock({ color: 'green', fontSize: 18, showSeconds: false });
  app.stage.addChild(clock);

  const positionClock = () => {
    const safe = getSafeArea();
    const { width: W, height: H } = app.screen;
    clock.x = 12 + safe.left;
    // 橫式時左下角是 D-Pad，時鐘移到左上角
    clock.y = isLandscape(W, H) ? 8 + safe.top : gameAreaHeight(W, H) - clock.displayHeight - 8;
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

  // ── _warpTo：轉場到指定地圖座標（gx/gy 為 null 時使用該地圖的 player_start）──
  function _warpTo(targetMap, gx, gy) {
    input.lock();
    _isAnimating = false;
    _stepPhase   = 0;
    MapManager.onActorMoveEnd(playerSpr);
    return mapManager.transitionTo(targetMap, () => {
      const spawn = mapManager.mapData.spawnPoints?.find(s => s.id === 'player_start')
                 ?? mapManager.mapData.spawnPoints?.[0];
      player.gx = gx ?? spawn?.gx ?? 0;
      player.gy = gy ?? spawn?.gy ?? 0;
      if (!mapManager.entityLayer.children.includes(playerSpr)) {
        mapManager.entityLayer.addChild(playerSpr);
      }
      clock.updateLocation(getMapLabel(mapManager.mapData));
      syncPlayer();
      requestUpdate();
    })
      .then(() => { input.unlock(); _autosave(); })
      .catch(() => {
        console.warn(`[Warp] 目標地圖 "${targetMap}" 尚未建立，略過轉場`);
        input.unlock();
      });
  }

  // ── tryMovePlayer：嘗試向 dir 方向移動一格 ────────────────────────────────
  // 回傳 'moved' | 'blocked' | 'warping' | 'battle'
  // 連鎖移動（連續按住）與初次移動共用同一段邏輯，避免重複。
  function tryMovePlayer(dir) {
    facing = dir;
    playerSpr.setDir(facing);
    const { dx, dy } = DIR_DELTA[dir];
    const nx = player.gx + dx;
    const ny = player.gy + dy;
    if (!mapManager.isWalkable(nx, ny)) return 'blocked';

    // NPC 佔據的格子不可進入；撞上敵對 NPC 直接開戰（玩家留在原格）
    const npc = entityManager.getNpcAt(nx, ny);
    if (npc) {
      if (npc.combatCollidable) {
        _startBattle(npc);
        return 'battle';
      }
      return 'blocked';
    }

    player.gx = nx;
    player.gy = ny;
    _isAnimating = true;
    _stepPhase   = 0;
    MapManager.onActorMoveStart(playerSpr);
    mapManager.updateFog(player.gx, player.gy, mapManager.visionRadius);
    updateCamera();

    const warp = mapManager.checkWarp(player.gx, player.gy);
    if (warp) {
      console.log(`[Warp] "${warp.label ?? warp.id}" → ${warp.targetMap}`);
      _warpTo(warp.targetMap, warp.targetGx, warp.targetGy);
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
      // 新遊戲：序章（門縫裡的通行證）。見 docs/WORLD.md〈6.2 阿吳與通行證〉
      if (!_saveData && !gsm.getFlag('prologue_done')) {
        interaction.play({
          speaker:  '（旁白）',
          dialogue: [
            '一九八六年，五月。洛城，雨季的第一場雨。',
            '茶桌散了兩年。你還是每天晚上醒著，聽雨打在鐵皮屋簷上。',
            '……門縫底下，塞著一張紙片。',
            '是一張工地通行證。照片已經模糊，名字寫著「吳○○」。',
            '翻到背面，有人用原子筆潦草地寫了幾個字——「西郊　救救我們」。',
          ],
          onEnd: { giveItem: { id: 'id_card', qty: 1 }, setFlag: 'prologue_done' },
        });
      }
      return; // 揭幕幀不處理輸入，避免「按新遊戲」的 pointerup 殘留觸發移動
    }

    // NPC 巡邏（任何介面 / 對話 / 轉場 / 戰鬥期間暫停）
    // 玩家佔據邏輯格與目前視覺所在格（移動途中兩格都算），避免 NPC 穿過玩家
    if (!_isUiOpen() && !interaction.isActive && !input.isLocked) {
      const contact = entityManager.update(app.ticker.deltaMS, (x, y) =>
        (x === player.gx && y === player.gy) ||
        (x === Math.round(player.vx) && y === Math.round(player.vy)));
      if (contact && performance.now() > _battleGraceUntil) _startBattle(contact);
    }
    // 玩家精靈 zIndex 同步（與 NPC 共用 entityLayer 排序）
    playerSpr.zIndex = playerSpr.y;

    // 介面開啟時仍需消費輸入佇列，但丟棄結果：
    // 選單用方向鍵 / Enter 操作時，不得同時移動玩家或觸發調查
    const rawState = input.update();
    const state    = _isUiOpen() ? IDLE_INPUT : rawState;

    // ── 座標顯示更新 ──────────────────────────────────────────────────────────
    panel.updateCoordinates(player.gx, player.gy);

    // ── 0) 環境調查：確認鍵邏輯 ────────────────────────────────────────────
    if (interaction.isActive) {
      // 對話框開啟中：方向鍵移動選項游標；確認鍵跳過打字機 / 選定選項 / 推進對話
      if (state.justDir === 'up'   || state.justDir === 'left')  interaction.moveChoice(-1);
      if (state.justDir === 'down' || state.justDir === 'right') interaction.moveChoice(1);
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

      // 以時間為準：f = 本幀經過了幾個「30fps 基準幀」。60fps 時約 0.5，掉幀時變大，
      // 走路速度與畫面更新率無關（上限 3，避免切回分頁時一次瞬移好幾格）
      const f    = Math.min(app.ticker.deltaMS / BASE_FRAME_MS, 3);
      const step = MOVE_SPEED * f;

      // 按住：snap 門檻擴大至一步之內，到位後立刻銜接下一格
      // 放開：只在誤差極小時才 snap，讓 lerp 把最後幾幀自然收完
      const snapAt = held ? step + LERP_SNAP : LERP_SNAP;

      if (dist < snapAt) {
        player.vx    = player.gx;
        player.vy    = player.gy;
        _isAnimating = false;
        _stepPhase   = 0;

        if (held && !interaction.isActive) {
          const result = tryMovePlayer(held);
          if (result === 'warping') return;
          if (result === 'blocked') MapManager.onActorMoveEnd(playerSpr);
          if (result === 'battle') {
            updateSpritePos(player.vx, player.vy);
            mapManager.setCameraVisual(player.vx, player.vy);
            mapManager.render();
            return;
          }
          // 'moved'：_isAnimating 已重置為 true，AnimatedSprite 持續播放不重啟
        } else {
          MapManager.onActorMoveEnd(playerSpr);
        }
      } else if (held) {
        // 定速線性：每個基準幀推進 MOVE_SPEED（tiles），不會在格尾減速
        const s     = Math.min(step, dist);
        player.vx  += (ex / dist) * s;
        player.vy  += (ey / dist) * s;
        _stepPhase  = Math.min(_stepPhase + 0.14 * f, 1);
      } else {
        // 放開後：lerp 自然減速，最後幾幀會慢下來再 snap（指數衰減換算成與幀率無關）
        const k     = 1 - Math.pow(1 - LERP_FACTOR, f);
        player.vx  += ex * k;
        player.vy  += ey * k;
        _stepPhase  = Math.min(_stepPhase + 0.12 * f, 1);
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
