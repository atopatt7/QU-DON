/**
 * QU-DON | src/core/EntityManager.js
 * 負責載入、管理與渲染當前地圖上的所有 NPC 實體。
 *
 * NPC JSON 格式（src/data/npcs/npcs_{mapId}.json）：
 * [
 *   {
 *     "id":        "pickpocket_ba_01",   // 場景唯一實例 ID
 *     "entityRef": "enemy_pickpocket",   // registry.json 的鍵
 *     "category":  "hostile",            // hostile | recruitable | system
 *     "position":  { "x": 4, "y": 6 },  // 格子座標
 *     "direction": "down",               // 初始朝向
 *     "behavior":  "idle"                // idle | patrol（待實作）
 *   }
 * ]
 */

import { MapManager } from '../modules/MapManager.js';

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
      spr = await this._buildEntitySprite(npc.entityRef, npc.direction ?? 'down', s);
    }

    // Fallback：色塊佔位（entityRef 缺失或貼圖載入失敗時使用）
    if (!spr) {
      const colorMap = { hostile: 0xff4444, recruitable: 0x00ccff, system: 0xffcc00 };
      const fillColor = colorMap[npc.category] ?? 0xaaaaaa;
      const gfx = new PIXI.Graphics();
      gfx.rect(0, 0, s, s).fill({ color: fillColor });
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

  // ─── 從 registry → entity JSON → 載入貼圖 → 建立精靈 ─────────────────────
  async _buildEntitySprite(entityRef, direction, tileSize) {
    try {
      const regRes  = await fetch('./src/data/entities/registry.json');
      const registry = await regRes.json();
      const entityPath = registry[entityRef];
      if (!entityPath) return null;

      const entRes   = await fetch(`./src/data/entities/${entityPath}`);
      const entData  = await entRes.json();
      const mapSprites = entData?.visuals?.mapSprites;
      if (!mapSprites) return null;

      // 預載入所有方向貼圖（放入 PIXI.Assets 快取，createActorSprite 會從快取取用）
      await Promise.allSettled(
        Object.entries(mapSprites).map(async ([, src]) => {
          try {
            if (Array.isArray(src)) {
              await Promise.all(src.map(p => PIXI.Assets.load(`./${p}`)));
            } else {
              await PIXI.Assets.load(`./${src}`);
            }
          } catch {}
        })
      );

      return MapManager.createActorSprite(mapSprites, direction, tileSize);
    } catch {
      return null;
    }
  }

  // ─── 查詢指定格子的 NPC ───────────────────────────────────────────────────
  getNpcAt(gx, gy) {
    return this.npcs.find(n => n.position.x === gx && n.position.y === gy) ?? null;
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
