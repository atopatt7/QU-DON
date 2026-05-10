/**
 * QU-DON 瞿董默示錄 | main.js  v4
 * Entry point — 整合所有系統
 *
 * 狀態機流程：
 *   HOME  ──新遊戲──▶  WORLD  ──選單──▶  INVENTORY
 *                        │                   │
 *                       觸發               關閉
 *                        ▼                   ▼
 *                     DIALOGUE  ──結束──▶  WORLD
 *                     BATTLE    ──結束──▶  WORLD
 */

import { InputManager }       from './src/core/Input.js';
import { ControlPanel }       from './src/ui/ControlPanel.js';
import { MapManager, DIR_DELTA } from './src/modules/MapManager.js';
import { GameStateManager, GameState } from './src/core/GameStateManager.js';
import { HomeScreen }         from './src/ui/HomeScreen.js';
import { BattleUI }           from './src/ui/BattleUI.js';
import { DialogueOverlay }    from './src/ui/DialogueOverlay.js';
import { InventoryScreen }    from './src/ui/InventoryScreen.js';

// ─── VT323 字型（VFD 時鐘 / 復古文字用）───────────────────────────────────
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

// ─── Pixi App 初始化 ────────────────────────────────────────────────────────
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
  const mask = new PIXI.Graphics();
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

// ─── 玩家精靈 ──────────────────────────────────────────────────────────────
function buildPlayerSprite(tileSize) {
  const r   = Math.floor(tileSize * 0.34);
  const spr = new PIXI.Graphics();
  spr.circle(0, 0, r).fill({ color: 0xd8c8f0 });
  spr.circle(0, 0, r).stroke({ color: 0xf0e8ff, width: 1.5 });
  spr.circle(0, -Math.floor(r * 0.5), Math.floor(r * 0.28))
     .fill({ color: 0x9070c0 });
  return spr;
}

function flashPlayer(playerSpr, duration = 80) {
  playerSpr.alpha = 0.5;
  setTimeout(() => { playerSpr.alpha = 1; }, duration);
}

// ─── 對話序列資料 ──────────────────────────────────────────────────────────
const DIALOGUE_DATA = {
  evt_laundry_door: [
    {
      speaker: '瞿董',
      text: '廢棄洗衣店。門鎖老早就壞了，但裡面不安全——上次進去的人沒出來過。',
      choices: [],
    },
    {
      speaker: '瞿董',
      text: '今晚還是算了。',
      choices: [],
    },
  ],
  evt_clinic_door: [
    {
      speaker: '???',
      text: '暗黃的燈光從門縫滲出，夾雜著消毒水的氣味。有人在裡面。',
      choices: [],
    },
    {
      speaker: '瞿董',
      text: '怎麼辦？',
      choices: [
        { label: '敲門' },
        { label: '離開' },
      ],
    },
  ],
};

// ─── 主程式 ────────────────────────────────────────────────────────────────
async function main() {
  const app = await initPixi();
  bindResize(app);

  // ── 狀態機 ────────────────────────────────────────────────────────────────
  const gsm   = new GameStateManager();
  const input = new InputManager(app.canvas);

  // ── 遊戲圖層（地圖）─── 初始隱藏，HOME 畫面先顯示 ─────────────────────
  const gameLayer = buildGameLayer(app);
  gameLayer.visible = false;

  // ── MapManager ────────────────────────────────────────────────────────────
  const mapManager = await MapManager.create(app, gameLayer);
  await mapManager.loadMap('map_01');

  const spawn  = mapManager.mapData.spawnPoints.find(s => s.id === 'player_start');
  const player = { gx: spawn?.gx ?? 3, gy: spawn?.gy ?? 2 };

  const playerSpr = buildPlayerSprite(mapManager.tileSize);
  mapManager.entityLayer.addChild(playerSpr);

  const syncPlayer = () => {
    const px = mapManager.gridToPixel(player.gx, player.gy);
    playerSpr.x = px.x;
    playerSpr.y = px.y;
    mapManager.centerOn(player.gx, player.gy);
    input.setGridConfig(mapManager.tileSize, mapManager.rootX, mapManager.rootY);
  };
  syncPlayer();
  mapManager.updateFog(player.gx, player.gy, mapManager.visionRadius);

  app.stage.on('resize', () => {
    mapManager.onResize(player.gx, player.gy);
    syncPlayer();
  });

  // ── ControlPanel（初始隱藏）─────────────────────────────────────────────
  const panel = await ControlPanel.create(app, input);
  panel.visible = false;
  app.stage.addChild(panel);

  // ── 覆蓋層（BattleUI / DialogueOverlay / InventoryScreen）──────────────
  const overlayContainer = new PIXI.Container();
  overlayContainer.label = 'overlayContainer';
  app.stage.addChild(overlayContainer);

  // ── HomeScreen（最頂層，初始可見）──────────────────────────────────────
  const homeScreen = new HomeScreen(app);
  app.stage.addChild(homeScreen);

  // ════════════════════════════════════════════════════════════════════════
  //  對話系統
  // ════════════════════════════════════════════════════════════════════════

  let dialogueOverlay = null;

  function _closeDialogue() {
    if (dialogueOverlay) {
      overlayContainer.removeChild(dialogueOverlay);
      dialogueOverlay.destroy({ children: true });
      dialogueOverlay = null;
    }
  }

  function showDialogue(seqId, onEnd = null) {
    const seq = DIALOGUE_DATA[seqId];
    if (!seq || seq.length === 0) { onEnd?.(); return; }

    input.lock();
    gsm.transition(GameState.DIALOGUE);

    let step = 0;

    const nextStep = (choiceIdx = -1) => {
      _closeDialogue();

      if (choiceIdx !== -1) {
        console.log(`[Dialogue] "${seqId}" 選擇 ${choiceIdx}: ${seq[step - 1]?.choices[choiceIdx]?.label}`);
        // 分支邏輯預留位（之後可接 seqId + '_choice_' + choiceIdx）
      }

      if (step >= seq.length) {
        // 對話序列結束
        gsm.transition(GameState.WORLD);
        input.unlock();
        onEnd?.();
        return;
      }

      const { speaker, text, choices } = seq[step++];
      dialogueOverlay = new DialogueOverlay(app, { speaker, text, choices });

      dialogueOverlay.once('next',   ()  => nextStep());
      dialogueOverlay.once('choice', (i) => nextStep(i));

      overlayContainer.addChild(dialogueOverlay);
    };

    nextStep();
  }

  // ── 觸發點處理表 ─────────────────────────────────────────────────────────
  const TRIGGER_HANDLERS = {
    evt_laundry_door: () => showDialogue('evt_laundry_door'),
    evt_clinic_door:  () => showDialogue('evt_clinic_door'),
  };

  // ════════════════════════════════════════════════════════════════════════
  //  背包系統
  // ════════════════════════════════════════════════════════════════════════

  let inventoryScreen = null;

  function openInventory() {
    if (!gsm.is(GameState.WORLD)) return;
    gsm.transition(GameState.INVENTORY);
    input.lock();

    inventoryScreen = new InventoryScreen(app, {
      player: {
        name: '瞿董', level: 8,
        hp: 204, maxHp: 240,
        sp: 144, maxSp: 240,
        weight: 18.4, maxWeight: 30,
        money: 340,
      },
    });

    inventoryScreen.once('close', () => {
      overlayContainer.removeChild(inventoryScreen);
      inventoryScreen.destroy({ children: true });
      inventoryScreen = null;
      gsm.transition(GameState.WORLD);
      input.unlock();
    });

    inventoryScreen.on('use', (itemId) => {
      console.log(`[Inventory] 使用道具: ${itemId}`);
    });

    overlayContainer.addChild(inventoryScreen);
  }

  // 監聽 ControlPanel 選單鍵
  panel.on('menu', openInventory);

  // ════════════════════════════════════════════════════════════════════════
  //  戰鬥系統（架構預留，可由觸發點啟動）
  // ════════════════════════════════════════════════════════════════════════

  let battleUI = null;

  function startBattle(enemyData) {
    if (battleUI || !gsm.is(GameState.WORLD)) return;
    gsm.transition(GameState.BATTLE);
    input.lock();

    battleUI = new BattleUI(app, {
      player: { name: '瞿董', level: 8, hp: 204, maxHp: 240, sp: 144, maxSp: 240 },
      enemy:  enemyData ?? { name: '街頭老大', level: 12, hp: 156, maxHp: 240 },
    });

    battleUI.on('action', (actionId) => {
      console.log(`[Battle] 行動: ${actionId}`);
      // TODO: 接 BattleEngine 計算
      battleUI.pushLog(actionIdLabel(actionId) + '！');

      // 示範：逃跑結束戰鬥
      if (actionId === 'escape') {
        setTimeout(() => endBattle(), 600);
      }
    });

    overlayContainer.addChild(battleUI);
  }

  function endBattle() {
    if (!battleUI) return;
    overlayContainer.removeChild(battleUI);
    battleUI.destroy({ children: true });
    battleUI = null;
    gsm.transition(GameState.WORLD);
    input.unlock();
  }

  function actionIdLabel(id) {
    const map = { attack: '攻擊', skill: '使用技能', item: '使用道具', escape: '嘗試逃跑' };
    return map[id] ?? id;
  }

  // 公開給 trigger handler 使用（未來擴充）
  window.__QU_startBattle = startBattle;

  // ════════════════════════════════════════════════════════════════════════
  //  GameStateManager — 狀態變化監聽
  // ════════════════════════════════════════════════════════════════════════

  gsm.on('change', ({ from, to }) => {
    console.log(`[GSM] ${from} → ${to}`);
    switch (to) {
      case GameState.WORLD:
        homeScreen.visible = false;
        gameLayer.visible  = true;
        panel.visible      = true;
        break;

      case GameState.HOME:
        homeScreen.visible = true;
        gameLayer.visible  = false;
        panel.visible      = false;
        break;

      case GameState.BATTLE:
        // gameLayer 與 panel 在 BATTLE 中隱藏（BattleUI 全螢幕）
        gameLayer.visible = false;
        panel.visible     = false;
        break;

      case GameState.DIALOGUE:
      case GameState.INVENTORY:
        // gameLayer + panel 繼續顯示，overlay 疊在上方
        gameLayer.visible = true;
        panel.visible     = true;
        break;
    }
  });

  // ════════════════════════════════════════════════════════════════════════
  //  HomeScreen 按鍵
  // ════════════════════════════════════════════════════════════════════════

  homeScreen.on('action', (actionId) => {
    switch (actionId) {
      case 'new_game':
        gsm.transition(GameState.WORLD);
        break;
      case 'load_game':
        console.log('[Home] 載入遊戲（未實作）');
        break;
      case 'settings':
        console.log('[Home] 設定（未實作）');
        break;
    }
  });

  // ════════════════════════════════════════════════════════════════════════
  //  主遊戲迴圈
  // ════════════════════════════════════════════════════════════════════════

  app.ticker.add(() => {
    // 僅在 WORLD 狀態處理地圖輸入
    if (!gsm.is(GameState.WORLD)) return;

    const state = input.update();
    let moved   = false;

    // ── 1. D-Pad 方向移動 ───────────────────────────────────────────────
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

    // ── 2. Tile 點擊移動 ────────────────────────────────────────────────
    if (state.tileTarget) {
      const { gx, gy } = state.tileTarget;
      if (mapManager.isWalkable(gx, gy)) {
        player.gx = gx;
        player.gy = gy;
        moved = true;
        flashPlayer(playerSpr);
        const dist = Math.hypot(gx - player.gx, gy - player.gy);
        if (dist > 1.5) {
          console.log(`[PathFind] TODO: (${player.gx},${player.gy}) → (${gx},${gy})`);
        }
      }
    }

    // ── 3. 移動後更新：鏡頭 / 霧 / Warp / Trigger ──────────────────────
    if (moved) {
      syncPlayer();
      mapManager.updateFog(player.gx, player.gy, mapManager.visionRadius);

      // Warp 傳送點
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
        }).then(() => input.unlock())
          .catch(err => { console.error('[Warp] 轉場失敗:', err); input.unlock(); });

        return; // 本幀不繼續處理 trigger
      }

      // Trigger 觸發點
      const trigger = mapManager.getTriggerAt(player.gx, player.gy);
      if (trigger) {
        console.log(`[Trigger] (${trigger.gx},${trigger.gy}) "${trigger.label}"`);
        const handler = TRIGGER_HANDLERS[trigger.eventId];
        if (handler) handler();
      }
    }

    // ── 4. Confirm 鍵：靜止時也可觸發觸發點 ────────────────────────────
    if (state.confirmJust && !moved) {
      const trigger = mapManager.getTriggerAt(player.gx, player.gy);
      if (trigger) {
        const handler = TRIGGER_HANDLERS[trigger.eventId];
        if (handler) handler();
      }
    }
  });

  const renderer = app.renderer.type === 1 ? 'WebGL' : 'WebGPU';
  console.log(`[QU-DON] v4 Ready — ${renderer} @ ${app.screen.width}×${app.screen.height}`);
  console.log(`[QU-DON] 玩家起點: (${player.gx}, ${player.gy})`);
  console.log(`[QU-DON] 狀態: HOME（點擊「新遊戲」開始）`);
}

main().catch(console.error);
