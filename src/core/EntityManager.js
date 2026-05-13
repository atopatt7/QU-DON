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

  // 為單一 NPC 建立 Pixi Sprite（暫用色塊佔位）
  _createSprite(npc) {
    const TILE_SIZE = 32; // 配合現有地圖 Tile 尺寸調整

    // 暫用：以純色矩形作為 NPC 佔位 Sprite
    const gfx = new PIXI.Graphics();
    gfx.beginFill(npc.recruitable ? 0x00ccff : 0xffcc00);
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
