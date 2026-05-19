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
 *     "path":      [[10,16],[14,16],[14,15],[10,15]],  // 巡邏路徑（循環）
 *     "moveSpeed": 0.5                         // 格/秒（0.5 = 每 2 秒一格）
 *   }
 * ]
 *
 * 每幀呼叫 update(deltaMS) 以驅動 patrol 動畫插值。
 */

export class EntityManager {
  constructor(app) {
    this.app      = app;
    this.npcs     = [];
    this.sprites  = new Map();
    this.container = null;
    this._tileSize = 48;
  }

  // ─── 切換地圖時呼叫 ────────────────────────────────────────────────────────
  async init(mapId, parentContainer, tileSize = 48) {
    this.clear();
    this._tileSize = tileSize;

    this.container = new PIXI.Container();
    this.container.sortableChildren = true;  // 啟用 Y 軸深度排序
    parentContainer.sortableChildren = true; // 讓玩家精靈也參與同層排序
    parentContainer.addChild(this.container);

    const npcData = await this._loadNpcData(mapId);
    this.npcs = npcData;

    for (const npc of this.npcs) {
      await this._createSprite(npc);
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

  // ─── 建立單一 NPC 精靈 ─────────────────────────────────────────────────────
  async _createSprite(npc) {
    const s = this._tileSize;
    this._applyCategory(npc);

    let spr = null;

    if (npc.entityRef) {
      const result = await this._buildEntitySprite(npc.entityRef, npc.direction ?? 'down', s);
      spr = result.sprite;
      npc.entityData = result.entityData; // 供戰鬥系統使用
    }

    // Fallback：色塊佔位（entityRef 缺失或貼圖載入失敗時使用）
    // 高度與玩家精靈一致（tileSize × 1.7），寬度取 0.5 倍
    if (!spr) {
      const colorMap = { hostile: 0xff4444, recruitable: 0x00ccff, system: 0xffcc00 };
      const fillColor = colorMap[npc.category] ?? 0xaaaaaa;
      const fbW = Math.floor(s * 0.5);
      const fbH = Math.floor(s * 1.7);
      const gfx = new PIXI.Graphics();
      gfx.rect(0, 0, fbW, fbH).fill({ color: fillColor });
      const tex = this.app.renderer.generateTexture({ target: gfx });
      gfx.destroy();
      spr = new PIXI.Sprite(tex);
      spr.anchor.set(0.5, 1.0);
    }

    // 格子座標 → entityLayer 局部像素座標（anchor 底部對齊格子底邊）
    spr.x = npc.position.x * s + s * 0.5;
    spr.y = npc.position.y * s + s;

    this.container.addChild(spr);
    this.sprites.set(npc.id, spr);
  }

  // ─── registry → entity JSON → spriteSheet 裁切 → 建立精靈 ────────────────
  // X 軸（col）= 方向：0=down 1=up 2=left 3=right
  // Y 軸（row）= 動作：0=idle 1=walkA 2=walkB
  // 找不到 vis.spriteSheet 時回傳 { sprite: null }，由呼叫端降級至色塊佔位
  // 回傳 { sprite, entityData }
  async _buildEntitySprite(entityRef, direction, tileSize) {
    try {
      const regRes     = await fetch('./src/data/entities/registry.json');
      const registry   = await regRes.json();
      const entityPath = registry[entityRef];
      if (!entityPath) return { sprite: null, entityData: null };

      const entRes        = await fetch(`./src/data/entities/${entityPath}`);
      const entData       = await entRes.json();
      const vis           = entData?.visuals ?? {};
      const heightInTiles = vis.heightInTiles ?? 1.7;

      if (!vis.spriteSheet) return { sprite: null, entityData: entData };

      const sheet = await PIXI.Assets.load(`./${vis.spriteSheet}`);
      const src   = sheet.source;
      const img   = src?.resource ?? src?.htmlElement ?? src?.bitmap ?? src;
      const fw    = vis.frameWidth  ?? 128;
      const fh    = vis.frameHeight ?? 256;

      if (!img || !(img.width > 0 || img.naturalWidth > 0)) {
        return { sprite: null, entityData: entData };
      }

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

      const base = texMap[direction] ?? texMap.down;
      let _dir     = direction;
      let _walking = false;

      const walkSequence = [1, 0, 2, 0];
      const getFrames = (dir, walk) => {
        const t = texMap[dir] ?? texMap.down ?? base;
        return walk ? walkSequence.map(row => t[row]) : [t[0]];
      };

      const spr = new PIXI.AnimatedSprite([base[0]]);
      spr.animationSpeed = 0.1;
      spr.loop           = true;
      spr.gotoAndStop(0);
      spr.scale.set((tileSize * heightInTiles) / fh);
      spr.anchor.set(0.5, 1.0);

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

      return { sprite: spr, entityData: entData };

    } catch {
      return { sprite: null, entityData: null };
    }
  }

  // ─── 每幀驅動巡邏動畫（由 main.js ticker 呼叫）────────────────────────────
  // deltaMS：自上一幀的毫秒數（app.ticker.deltaMS）
  update(deltaMS) {
    const s = this._tileSize;
    for (const npc of this.npcs) {
      if (npc.behavior !== 'patrol' || !npc.path?.length) continue;

      if (!npc._patrol) npc._patrol = this._initPatrol(npc);
      const p   = npc._patrol;
      const spr = this.sprites.get(npc.id);

      p.timer += deltaMS;

      if (p.moving) {
        // 插值移動：0→1 映射至 fromXY → toXY
        const t = Math.min(p.timer / p.walkDur, 1);
        if (spr) {
          spr.x = p.fromX + (p.toX - p.fromX) * t;
          spr.y = p.fromY + (p.toY - p.fromY) * t;
        }
        if (t >= 1) {
          // 抵達路徑點：更新邏輯座標，停止動畫
          p.idx          = (p.idx + 1) % npc.path.length;
          npc.position.x = npc.path[p.idx][0];
          npc.position.y = npc.path[p.idx][1];
          if (spr) { spr.x = p.toX; spr.y = p.toY; spr.stopWalk?.(); }
          p.moving = false;
          p.timer  = 0;
        }
      } else {
        // 在路徑點等待 pauseDur 後啟動下一步
        if (p.timer >= p.pauseDur) {
          const nextIdx    = (p.idx + 1) % npc.path.length;
          const [nx, ny]   = npc.path[nextIdx];
          const [cx, cy]   = [npc.position.x, npc.position.y];
          const dir        = nx > cx ? 'right' : nx < cx ? 'left'
                           : ny < cy ? 'up'    : 'down';
          p.fromX  = cx * s + s * 0.5;
          p.fromY  = cy * s + s;
          p.toX    = nx * s + s * 0.5;
          p.toY    = ny * s + s;
          p.moving = true;
          p.timer  = 0;
          if (spr) { spr.setDir?.(dir); spr.startWalk?.(); }
        }
      }
    }

    // ── 所有 NPC 按像素 Y 排序（Y 越大 = 越靠下 = 圖層越高）──────────────
    for (const npc of this.npcs) {
      const spr = this.sprites.get(npc.id);
      if (spr) spr.zIndex = spr.y;
    }
    this.container.sortChildren();
  }

  // ─── 初始化巡邏狀態物件 ────────────────────────────────────────────────────
  _initPatrol(npc) {
    const speed   = npc.moveSpeed ?? npc.entityData?.stats?.moveSpeed ?? 0.5;
    const totalMs = 1000 / speed; // ms per tile（0.5 格/秒 → 2000 ms/格）
    return {
      idx:      0,            // 當前所在路徑點索引
      timer:    0,            // 計時器（ms）
      walkDur:  totalMs * 0.65, // 移動佔 65% 時間
      pauseDur: totalMs * 0.35, // 停頓佔 35% 時間
      moving:   false,
      fromX: 0, fromY: 0,
      toX:   0, toY:   0,
    };
  }

  // ─── 查詢指定格子的 NPC ───────────────────────────────────────────────────
  getNpcAt(gx, gy) {
    return this.npcs.find(n => n.position.x === gx && n.position.y === gy) ?? null;
  }

  // ─── 戰後隱藏 NPC（精靈不可見，從碰撞列表移除）────────────────────────────
  hideNpc(id) {
    const spr = this.sprites.get(id);
    if (spr) spr.visible = false;
    this.npcs = this.npcs.filter(n => n.id !== id);
  }

  // ─── 清除當前地圖所有 NPC ─────────────────────────────────────────────────
  clear() {
    if (this.container) {
      this.container.destroy({ children: true });
      this.container = null;
    }
    this.npcs = [];
    this.sprites.clear();
  }
}
