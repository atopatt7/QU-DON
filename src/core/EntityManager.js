/**
 * QU-DON | src/core/EntityManager.js
 * 負責載入、管理與渲染當前地圖上的所有 NPC 實體。
 *
 * NPC JSON 格式（src/data/npcs/npcs_{mapId}.json）：
 * [
 *   {
 *     "id":        "suburb_guard_01",          // 場景唯一實例 ID
 *     "entityRef": "npc_const_guard",          // registry.json 的鍵
 *     "category":  "hostile",                  // hostile | recruitable | system
 *     "position":  { "x": 10, "y": 16 },      // 初始格子座標
 *     "direction": "right",                    // 初始朝向
 *     "behavior":  "patrol",                   // idle | patrol
 *     "path":      [[10,16],[14,16],[14,15],[10,15]],  // 巡邏路徑點（循環，點與點之間逐格行走）
 *     "moveSpeed": 0.5,                        // 格/秒（0.5 = 每 2 秒一格）
 *     "tint":      "0xbfb8a8",                 // 可選：精靈色調（同一張雪碧圖扮演不同角色）
 *     "dialogue":  ["..."], "choices": [...],  // 可選：覆寫實體的對話 / 選項（見 InteractionManager._runScript）
 *     "variants":  [                           // 可選：條件成立時覆寫上述欄位（第一個成立者生效）
 *       { "if": "flag", "position": { "x": 12, "y": 14 }, "dialogue": ["..."] },
 *       { "ifNot": "flag", "hidden": true }
 *     ]
 *   }
 * ]
 *
 * 每幀呼叫 update(deltaMS, isPlayerAt) 以驅動 patrol 動畫插值。
 *
 * 佔位規則：
 *   - NPC 佔據 position 格；移動中同時佔據目標格（npc._target）
 *   - getNpcAt() 兩者都會命中，玩家不能走進正在被 NPC 進入的格子
 */

// ─── 跨地圖共用快取（registry / 角色 JSON / 裁切後的幀貼圖）────────────────────
// 貼圖以 spriteSheet 路徑為鍵永久保留：角色種類有限，重複進出地圖不再重新裁切，
// 也就不會每次換圖都產生一批無人釋放的 canvas 貼圖
let   _registryPromise = null;
const _entityCache     = new Map();  // entityRef → Promise<entityData|null>
const _sheetCache      = new Map();  // `${path}|${fw}|${fh}` → Promise<texMap|null>

const DIR_COLS   = { down: 0, up: 1, left: 2, right: 3 };
const FRAME_ROWS = 3;   // 0=idle 1=walkA 2=walkB
const WALK_SEQ   = [1, 0, 2, 0];

function _loadRegistry() {
  _registryPromise ??= fetch('./src/data/entities/registry.json')
    .then(r => r.json())
    .catch(() => ({}));
  return _registryPromise;
}

function _loadEntity(entityRef) {
  if (!_entityCache.has(entityRef)) {
    _entityCache.set(entityRef, (async () => {
      const registry   = await _loadRegistry();
      const entityPath = registry[entityRef];
      if (!entityPath) return null;
      const res = await fetch(`./src/data/entities/${entityPath}`);
      return res.ok ? res.json() : null;
    })().catch(() => null));
  }
  return _entityCache.get(entityRef);
}

// X 軸（col）= 方向：0=down 1=up 2=left 3=right
// Y 軸（row）= 動作：0=idle 1=walkA 2=walkB
function _loadSheetFrames(path, fw, fh) {
  const key = `${path}|${fw}|${fh}`;
  if (!_sheetCache.has(key)) {
    _sheetCache.set(key, (async () => {
      const sheet = await PIXI.Assets.load(`./${path}`);
      const src   = sheet.source;
      const img   = src?.resource ?? src?.htmlElement ?? src?.bitmap ?? src;
      if (!img || !(img.width > 0 || img.naturalWidth > 0)) return null;

      const texMap = {};
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
      return texMap;
    })().catch(() => null));
  }
  return _sheetCache.get(key);
}

export class EntityManager {
  constructor(app) {
    this.app       = app;
    this.npcs      = [];
    this.sprites   = new Map();
    this.container = null;
    this._tileSize = 48;
    this._removed  = new Set();  // 已擊敗 / 已招募的 NPC id（跨地圖保留，重回地圖不再生成）
    this._initSeq  = 0;          // 防止快速連續換圖時，舊的 init 把 NPC 加進新地圖
  }

  // ─── 切換地圖時呼叫 ────────────────────────────────────────────────────────
  async init(mapId, parentContainer, tileSize = 48) {
    this.clear();
    const seq = ++this._initSeq;
    this._tileSize = tileSize;

    // NPC 精靈直接掛在 entityLayer（與玩家精靈同層），
    // 才能以 zIndex = y 和玩家互相排序；若包在子容器內，玩家只會跟整個容器比較
    this.container = parentContainer;
    parentContainer.sortableChildren = true;

    const npcData = (await this._loadNpcData(mapId))
      .filter(n => !this._removed.has(n.id))
      .map(n => ({ id: n.id, _base: n })); // _base 保留原始 JSON，variant 每次都從它解析
    if (seq !== this._initSeq) return;
    // 先同步套用一次（位置 / 碰撞立即生效），貼圖載入後再補上實體資料
    for (const npc of npcData) this._applyVariant(npc, true);
    this.npcs = npcData;

    for (const npc of npcData) {
      const spr = await this._createSprite(npc);
      if (seq !== this._initSeq) { spr.destroy(); return; }
      this.container.addChild(spr);
      this.sprites.set(npc.id, spr);
    }
  }

  // ─── 從 npcs_{mapId}.json 讀取 NPC 列表 ───────────────────────────────────
  async _loadNpcData(mapId) {
    try {
      const res = await fetch(`./src/data/npcs/npcs_${mapId}.json`);
      if (!res.ok) return [];
      return await res.json();
    } catch {
      console.warn(`[EntityManager] 找不到 NPC 資料：npcs_${mapId}.json`);
      return [];
    }
  }

  // ─── 依 category 掛載行為屬性 ─────────────────────────────────────────────
  _applyCategory(npc) {
    switch (npc.category ?? 'system') {
      case 'hostile':
        npc.combatCollidable = true;
        npc.interactable     = false;
        break;
      case 'recruitable':
        npc.combatCollidable = false;
        npc.interactable     = true;
        break;
      default: // system
        npc.combatCollidable = false;
        npc.interactable     = true;
    }
  }

  /**
   * 注入條件解析器（通常是 base => gsm.resolveVariant(base)）。
   * NPC JSON 可帶 variants: [{ if, ifNot, requiresItem, ...覆寫欄位 }]，
   * 第一個成立的 variant 覆寫 dialogue / choices / position / hidden 等欄位。
   */
  setConditionResolver(fn) {
    this._resolve = fn;
    this.refreshVariants();
  }

  /** 旗標或背包變動後呼叫：重新套用每個 NPC 目前成立的 variant。 */
  refreshVariants() {
    for (const npc of this.npcs) this._applyVariant(npc);
  }

  /**
   * 依目前條件套用 NPC 資料。
   * 對話 / 數值 / 顯示狀態每次都更新；位置 / 行為只在切換到不同 variant 時重設
   * （避免巡邏中的 NPC 每次旗標變動都被拉回原位）。
   */
  _applyVariant(npc, initial = false) {
    const v = this._resolve ? this._resolve(npc._base) : { ...npc._base, _variant: -1 };
    const changed = initial || v._variant !== npc._variant;
    npc._variant = v._variant;

    // 實例欄位覆寫 / 補足實體資料（例如同一實體在不同地圖說不同台詞；
    // 無 entityRef 的 NPC 也能靠實例上的 name / dialogue 進行對話）
    const overrides = {};
    for (const key of ['name', 'dialogue', 'choices', 'stats', 'onEnd']) {
      if (v[key] !== undefined) overrides[key] = v[key];
    }
    npc.entityData = (npc._entity || Object.keys(overrides).length)
      ? { ...(npc._entity ?? {}), ...overrides }
      : null;

    npc.category = v.category;
    this._applyCategory(npc);
    npc.hidden = !!v.hidden;

    const spr = this.sprites.get(npc.id);
    if (spr) spr.visible = !npc.hidden;

    if (changed) {
      npc.position  = { ...v.position };
      npc.direction = v.direction;
      npc.behavior  = v.behavior;
      npc.path      = v.path;
      npc.moveSpeed = v.moveSpeed;
      npc._patrol   = null;
      npc._target   = null;
      if (spr) {
        spr.stopWalk?.();
        spr.setDir?.(npc.direction ?? 'down');
        this._placeSprite(npc, spr);
      }
    }
  }

  // ─── 建立單一 NPC 精靈（回傳精靈，由 init 掛載）──────────────────────────────
  async _createSprite(npc) {
    let spr = null;

    const ref = npc._base.entityRef;
    npc._entity = ref ? await _loadEntity(ref) : null;
    this._applyVariant(npc, true);

    if (npc._entity) {
      spr = await this._buildEntitySprite(npc._entity, npc.direction ?? 'down');
    }

    // 色調：讓同一張雪碧圖扮演不同角色（實例 / variant 的 tint 優先於實體設定）
    const tint = npc._base.tint ?? npc._entity?.visuals?.tint;
    if (spr && tint != null) spr.tint = typeof tint === 'string' ? parseInt(tint) : tint;

    // Fallback：色塊佔位（entityRef 缺失或貼圖載入失敗時使用）
    // 高度與玩家精靈一致（1.7 格），寬度 0.5 格；以 1 格 = 1px 繪製再縮放，resize 只需改 scale
    if (!spr) {
      const colorMap = { hostile: 0xff4444, recruitable: 0x00ccff, system: 0xffcc00 };
      spr = new PIXI.Graphics();
      spr.rect(-0.25, -1.7, 0.5, 1.7).fill({ color: colorMap[npc.category] ?? 0xaaaaaa });
      spr.resizeTo = (s) => spr.scale.set(s);
    }

    spr.resizeTo(this._tileSize);
    spr.visible = !npc.hidden;
    this._placeSprite(npc, spr);
    return spr;
  }

  // ─── entityData → spriteSheet 幀 → AnimatedSprite ─────────────────────────
  // 找不到 vis.spriteSheet 或貼圖載入失敗時回傳 null，由呼叫端降級至色塊佔位
  async _buildEntitySprite(entData, direction) {
    const vis = entData?.visuals ?? {};
    if (!vis.spriteSheet) return null;

    const fw     = vis.frameWidth  ?? 128;
    const fh     = vis.frameHeight ?? 256;
    const texMap = await _loadSheetFrames(vis.spriteSheet, fw, fh);
    if (!texMap) return null;

    const heightInTiles = vis.heightInTiles ?? 1.7;
    const base     = texMap[direction] ?? texMap.down;
    let   _dir     = direction;
    let   _walking = false;

    const getFrames = (dir, walk) => {
      const t = texMap[dir] ?? texMap.down ?? base;
      return walk ? WALK_SEQ.map(row => t[row]) : [t[0]];
    };

    const spr = new PIXI.AnimatedSprite([base[0]]);
    spr.animationSpeed = 0.1;
    spr.loop           = true;
    spr.gotoAndStop(0);
    spr.anchor.set(0.5, 1.0);
    spr.resizeTo = (s) => spr.scale.set((s * heightInTiles) / fh);

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
      _dir = dir;
      spr.textures = getFrames(dir, _walking);
      if (_walking) spr.play(); else spr.gotoAndStop(0);
    };

    return spr;
  }

  // ─── 依邏輯座標（+ 移動進度）放置精靈：anchor 底部對齊格子底邊 ────────────
  _placeSprite(npc, spr = this.sprites.get(npc.id)) {
    if (!spr) return;
    const s = this._tileSize;
    const p = npc._patrol;
    let gx = npc.position.x;
    let gy = npc.position.y;
    if (p?.moving && npc._target) {
      const t = Math.min(p.timer / p.walkDur, 1);
      gx += (npc._target.x - gx) * t;
      gy += (npc._target.y - gy) * t;
    }
    spr.x = gx * s + s * 0.5;
    spr.y = gy * s + s;
    spr.zIndex = spr.y;
  }

  // ─── 每幀驅動巡邏動畫（由 main.js ticker 呼叫）────────────────────────────
  /**
   * @param {number}   deltaMS     自上一幀的毫秒數（app.ticker.deltaMS）
   * @param {Function} isPlayerAt  (gx, gy) => boolean，玩家是否佔據該格
   * @returns {object|null}  本幀試圖走進玩家格子的敵對 NPC（由呼叫端觸發戰鬥）
   */
  update(deltaMS, isPlayerAt = () => false) {
    let contact = null;

    for (const npc of this.npcs) {
      if (npc.hidden || npc.behavior !== 'patrol' || !npc.path?.length) continue;

      npc._patrol ??= this._initPatrol(npc);
      const p   = npc._patrol;
      const spr = this.sprites.get(npc.id);
      if (p.steps.length < 2) continue;

      p.timer += deltaMS;

      if (p.moving) {
        if (p.timer >= p.walkDur) {
          // 抵達下一格：更新邏輯座標
          p.idx          = (p.idx + 1) % p.steps.length;
          npc.position.x = npc._target.x;
          npc.position.y = npc._target.y;
          npc._target    = null;
          p.moving = false;
          // 路徑點停頓；路徑點之間的格子直接銜接下一步
          p.timer  = p.waypoints.has(p.idx) ? 0 : p.pauseDur;
          if (p.timer === 0) spr?.stopWalk?.();
        }
      } else if (p.timer >= p.pauseDur) {
        const [nx, ny] = p.steps[(p.idx + 1) % p.steps.length];
        const [cx, cy] = [npc.position.x, npc.position.y];
        const dir      = nx > cx ? 'right' : nx < cx ? 'left'
                       : ny < cy ? 'up'    : 'down';

        if (isPlayerAt(nx, ny)) {
          // 玩家擋路：敵對 NPC 撲上去開戰；其他 NPC 轉身等待
          spr?.setDir?.(dir);
          spr?.stopWalk?.();
          if (npc.combatCollidable && !contact) contact = npc;
          continue;
        }
        if (this.getNpcAt(nx, ny, npc)) {
          spr?.stopWalk?.();
          continue; // 其他 NPC 擋路：下一幀再試
        }

        npc._target = { x: nx, y: ny };
        p.moving = true;
        p.timer  = 0;
        if (spr) { spr.setDir?.(dir); spr.startWalk?.(); }
      }

      this._placeSprite(npc, spr);
    }

    return contact;
  }

  // ─── 初始化巡邏狀態：把路徑點展開成逐格步驟 ─────────────────────────────────
  _initPatrol(npc) {
    const speed   = npc.moveSpeed ?? npc.entityData?.stats?.moveSpeed ?? 0.5;
    const tileMs  = 1000 / speed; // ms per tile（0.5 格/秒 → 2000 ms/格）

    // 路徑點之間逐格展開（先走 X 再走 Y），閉合回起點
    const steps     = [];
    const waypoints = new Set();
    const pts = npc.path;
    for (let i = 0; i < pts.length; i++) {
      let [x, y]     = pts[i];
      const [tx, ty] = pts[(i + 1) % pts.length];
      waypoints.add(steps.length);
      steps.push([x, y]);
      while (x !== tx || y !== ty) {
        if (x !== tx) x += Math.sign(tx - x); else y += Math.sign(ty - y);
        if (x === tx && y === ty) break; // 下一個路徑點由下一輪加入
        steps.push([x, y]);
      }
    }

    // 從 NPC 目前所在格開始巡邏；不在路徑上則瞬移到起點
    let idx = steps.findIndex(([x, y]) => x === npc.position.x && y === npc.position.y);
    if (idx < 0) {
      idx = 0;
      npc.position.x = steps[0][0];
      npc.position.y = steps[0][1];
    }

    return {
      steps, waypoints, idx,
      timer:    0,
      walkDur:  tileMs * 0.65,  // 每格移動時間
      pauseDur: tileMs * 0.35,  // 路徑點停頓時間
      moving:   false,
    };
  }

  // ─── 視窗縮放：重算精靈大小與位置 ─────────────────────────────────────────
  resize(tileSize) {
    this._tileSize = tileSize;
    for (const npc of this.npcs) {
      const spr = this.sprites.get(npc.id);
      if (!spr) continue;
      spr.resizeTo?.(tileSize);
      this._placeSprite(npc, spr);
    }
  }

  // ─── 查詢指定格子的 NPC（含移動中正在進入該格的 NPC）──────────────────────
  getNpcAt(gx, gy, exclude = null) {
    return this.npcs.find(n => n !== exclude && !n.hidden && (
      (n.position.x === gx && n.position.y === gy) ||
      (n._target && n._target.x === gx && n._target.y === gy)
    )) ?? null;
  }

  // ─── 戰後 / 招募後移除 NPC（記住 id，重回地圖不再生成）─────────────────────
  hideNpc(id) {
    this._removed.add(id);
    const spr = this.sprites.get(id);
    if (spr) spr.visible = false;
    this.npcs = this.npcs.filter(n => n.id !== id);
  }

  // ─── 清除當前地圖所有 NPC ─────────────────────────────────────────────────
  clear() {
    // container 是共用的 entityLayer（含玩家精靈），只銷毀自己建立的 NPC 精靈；
    // 幀貼圖由模組層快取共用，不隨精靈銷毀
    for (const spr of this.sprites.values()) spr.destroy();
    this.container = null;
    this.npcs = [];
    this.sprites.clear();
  }
}
