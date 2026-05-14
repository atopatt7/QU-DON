// EntityManager.js
// 負責載入、管理與渲染當前地圖上的所有 NPC

export class EntityManager {
  constructor(app, gameStateManager) {
    this.app = app;
    this.gsm = gameStateManager;
    this.npcs = [];           // 當前地圖的 NPC 資料陣列
    this.sprites = new Map(); // npc.id -> Pixi Sprite
    this.container = null;    // NPC 專屬的 Pixi Container
  }

  // 切換地圖時呼叫，載入對應 NPC
  // parentContainer 傳入 MapManager.entityLayer
  async init(mapId, parentContainer) {
    this.clear();

    this.container = new PIXI.Container();
    parentContainer.addChild(this.container);

    const npcData = await this._loadNpcData(mapId);
    this.npcs = npcData;

    for (const npc of this.npcs) {
      this._createSprite(npc);
    }
  }

  // 根據 mapId 載入對應的 NPC JSON
  async _loadNpcData(mapId) {
    try {
      const res = await fetch(`./src/data/npcs/npcs_${mapId}.json`);
      if (!res.ok) return [];
      return await res.json();
    } catch (e) {
      console.warn(`[EntityManager] 找不到 NPC 資料：npcs_${mapId}.json`);
      return [];
    }
  }

  // 根據 category 為實體掛載預設行為屬性
  _applyCategory(npc) {
    const category = npc.category ?? 'system';

    switch (category) {
      case 'system':
        // 純互動型：無戰鬥碰撞，僅觸發對話 / 商店
        npc.combatCollidable = false;
        npc.interactable    = true;
        // TODO: 綁定 serviceType 對應的 UI 開啟邏輯
        break;

      case 'hostile':
        // 敵對型：開啟視野偵測，預設 patrol 巡邏狀態
        npc.combatCollidable = true;
        npc.interactable     = false;
        npc.aiState          = 'patrol';
        npc.aggroActive      = true;
        // TODO: 在 CombatManager 中掛載 aggroRange 與 lootTable
        break;

      case 'recruitable':
        // 可招募型：中立初始狀態，保留好感 / 招募狀態掛鉤
        npc.combatCollidable = false;
        npc.interactable     = true;
        npc.faction          = npc.faction ?? 'neutral';
        npc.recruitState     = 'pending'; // pending | recruited | rejected
        // TODO: 在 NpcInteraction 中檢查 recruitCondition 並更新 recruitState
        break;

      default:
        console.warn(`[EntityManager] 未知 category：${category}，套用 system 預設值`);
        npc.combatCollidable = false;
        npc.interactable     = true;
    }
  }

  // 為單一 NPC 建立 Pixi Sprite（暫用色塊佔位）
  _createSprite(npc) {
    const TILE_SIZE = 32; // 配合現有地圖 Tile 尺寸調整

    this._applyCategory(npc);

    // 依 category 決定佔位顏色：cyan=recruitable, red=hostile, yellow=system
    const colorMap = { recruitable: 0x00ccff, hostile: 0xff4444, system: 0xffcc00 };
    const fillColor = colorMap[npc.category] ?? 0xffcc00;

    // 暫用：以純色矩形作為 NPC 佔位 Sprite
    const gfx = new PIXI.Graphics();
    gfx.beginFill(fillColor);
    gfx.drawRect(0, 0, TILE_SIZE, TILE_SIZE);
    gfx.endFill();

    const texture = this.app.renderer.generateTexture(gfx);
    const sprite = new PIXI.Sprite(texture);

    sprite.x = npc.position.x * TILE_SIZE;
    sprite.y = npc.position.y * TILE_SIZE;
    sprite.npcId = npc.id;

    this.container.addChild(sprite);
    this.sprites.set(npc.id, sprite);
  }

  // 根據玩家座標，找出相鄰的 NPC
  getNpcAt(x, y) {
    return this.npcs.find(npc =>
      npc.position.x === x && npc.position.y === y
    ) ?? null;
  }

  // 清除當前地圖的所有 NPC Sprite
  clear() {
    if (this.container) {
      this.container.destroy({ children: true });
      this.container = null;
    }
    this.npcs = [];
    this.sprites.clear();
  }
}
