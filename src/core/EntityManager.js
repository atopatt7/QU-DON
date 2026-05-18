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

  // ─── 從 registry → entity JSON → 載入貼圖 → 建立精靈 ─────────────────────
  // 支援兩種格式：
  //   新格式：visuals.spriteSheet — 4×N HD-2D 矩陣，Canvas 2D 裁切
  //             X軸(欄, fw)=方向：0=down 1=up 2=left 3=right
  //             Y軸(列, fh)=動作：0=idle 1=walkA 2=walkB
  //   舊格式：visuals.mapSprites  — 逐檔載入（向下相容）
  // 回傳 { sprite, entityData }
  async _buildEntitySprite(entityRef, direction, tileSize) {
    try {
      const regRes     = await fetch('./src/data/entities/registry.json');
      const registry   = await regRes.json();
      const entityPath = registry[entityRef];
      if (!entityPath) return { sprite: null, entityData: null };

      const entRes  = await fetch(`./src/data/entities/${entityPath}`);
      const entData = await entRes.json();
      const vis     = entData?.visuals ?? {};
      // 支援 visuals.heightInTiles（新）與 visual.heightInTiles（舊，typo 相容）
      const heightInTiles = vis.heightInTiles ?? entData?.visual?.heightInTiles ?? 1.7;

      // ── 新格式：spriteSheet（Canvas 2D 裁切，與主角系統相同原則）──────────
      if (vis.spriteSheet) {
        const sheet = await PIXI.Assets.load(`./${vis.spriteSheet}`);
        const src   = sheet.source;
        const img   = src?.resource ?? src?.htmlElement ?? src?.bitmap ?? src;
        const fw    = vis.frameWidth  ?? 128;
        const fh    = vis.frameHeight ?? 256;

        if (!img || !(img.width > 0 || img.naturalWidth > 0)) {
          return { sprite: null, entityData: entData };
        }

        // 4×N 矩陣裁切：外層迴圈=方向欄，內層迴圈=動作列
        const DIR_COLS   = { down: 0, up: 1, left: 2, right: 3 };
        const FRAME_ROWS = 3; // 0=idle  1=walkA  2=walkB
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
          texMap[dir] = frames; // [idle, walkA, walkB]
        }

        const base = texMap[direction] ?? texMap.down;
        // 播放序：walkA→walkB→walkA→idle；停止時 gotoAndStop(3)=idle
        const spr  = new PIXI.AnimatedSprite([base[1], base[2], base[1], base[0]]);
        spr.animationSpeed = 0.1;
        spr.loop           = true;
        spr.gotoAndStop(3);

        spr.scale.set((tileSize * heightInTiles) / fh);
        spr.anchor.set(0.5, 1.0);

        // setDir：切換方向時重建幀列表，保持播放狀態不變
        spr.setDir = (dir) => {
          const t = texMap[dir] ?? texMap.down ?? base;
          const wasPlaying = spr.playing;
          spr.textures = [t[1], t[2], t[1], t[0]];
          if (wasPlaying) spr.play(); else spr.gotoAndStop(3);
        };

        return { sprite: spr, entityData: entData };
      }

      // ── 舊格式：mapSprites（向下相容，逐檔載入）────────────────────────────
      const mapSprites = vis.mapSprites;
      if (!mapSprites) return { sprite: null, entityData: entData };

      // 載入所有方向貼圖，直接收集 Texture / Texture[] 物件
      const texMap = {};
      await Promise.allSettled(
        Object.entries(mapSprites).map(async ([dir, src]) => {
          try {
            texMap[dir] = Array.isArray(src)
              ? await Promise.all(src.map(p => PIXI.Assets.load(p)))
              : await PIXI.Assets.load(src);
          } catch {}
        })
      );

      const baseSrc    = texMap[direction] ?? texMap.down ?? Object.values(texMap)[0] ?? null;
      if (!baseSrc) return { sprite: null, entityData: entData };
      const isAnimated = Array.isArray(baseSrc) && baseSrc.length >= 3;

      const refTex = isAnimated ? baseSrc[1] : baseSrc;
      let spr;
      if (isAnimated) {
        spr = new PIXI.AnimatedSprite([baseSrc[0], baseSrc[1], baseSrc[2], baseSrc[1]]);
        spr.animationSpeed = 0.12;
        spr.loop           = true;
        spr.gotoAndStop(1);
      } else {
        spr = new PIXI.Sprite(baseSrc);
      }

      const scl = refTex?.height ? (tileSize * heightInTiles) / refTex.height : 1;
      spr.scale.set(scl);
      spr.anchor.set(0.5, 1.0);
      return { sprite: spr, entityData: entData };

    } catch {
      return { sprite: null, entityData: null };
    }
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
