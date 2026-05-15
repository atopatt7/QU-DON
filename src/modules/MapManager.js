/**
 * QU-DON | src/modules/MapManager.js
 *
 * 地圖管理器 — 負責：
 *   1. 從 JSON 載入地圖資料
 *   2. 雙層渲染（地板 / 物件），使用 RenderTexture 快取提升效能
 *   3. isWalkable(gx, gy) 碰撞查詢
 *   4. Noir 霧視野（三態：隱藏 / 已探索 / 可見）
 *   5. Camera：centerOn(gx, gy) 自動限界捲動
 *   6. 提供 entityLayer 供 EntityManager 使用
 *
 * 渲染節點樹（加入 gameLayer）：
 *   _root
 *   ├── _groundLayer   地板 Sprite
 *   ├── _objectLayer   牆壁 / 障礙 Sprite
 *   ├── entityLayer    角色層（EntityManager 使用）
 *   └── _fogLayer      霧視野 Sprite
 *
 * 使用：
 *   const mm = await MapManager.create(app, gameLayer);
 *   await mm.loadMap('map_01');
 *   mm.updateFog(3, 2);   // 初始霧
 *   mm.centerOn(3, 2);    // 初始鏡頭
 */

// ─── 鄰近方向向量（供外部參考） ────────────────────────────────────────────────
export const DIR_DELTA = {
  up:    { dx:  0, dy: -1 },
  down:  { dx:  0, dy:  1 },
  left:  { dx: -1, dy:  0 },
  right: { dx:  1, dy:  0 },
};

// ─── 霧狀態常數 ────────────────────────────────────────────────────────────────
const FOG = { HIDDEN: 0, EXPLORED: 1, VISIBLE: 2 };

// ─── 霧視野透明度 ──────────────────────────────────────────────────────────────
const FOG_ALPHA = {
  [FOG.HIDDEN]:   0.94,
  [FOG.EXPLORED]: 0.58,
  [FOG.VISIBLE]:  0.00,
};

// ─── 位置變體快取：這些 tile 每格使用不同亂數種子，視覺多樣 ───────────────────────
const VARIANT_IDS   = new Set([1, 2, 4, 5, 10, 11, 40]);
const VARIANT_COUNT = 4;

// ─── 程式繪製 Tile 調色盤（Noir 低飽和深色系）────────────────────────────────────
const TILE_PALETTE = {
  // ── Road (ground layer, IDs 1-5) ─────────────────────────────────────────
  1:  { base: 0x1c1c1c, hi: 0x242424, lo: 0x101010 }, // asphalt
  2:  { base: 0x161616, hi: 0x1c1c1c, lo: 0x080808 }, // cracked asphalt
  3:  { base: 0x1c1c1c, hi: 0x242424, lo: 0x101010 }, // asphalt + vertical center line
  4:  { base: 0x0c1018, hi: 0x141820, lo: 0x080c12 }, // asphalt + rain puddle
  5:  { base: 0x181818, hi: 0x202020, lo: 0x0c0c0c }, // asphalt + debris
  9:  { base: 0x1c1c1c, hi: 0x242424, lo: 0x101010 }, // asphalt + horizontal center line
  // ── Corner centerlines (IDs 34-37) ───────────────────────────────────────
  34: { base: 0x1c1c1c, hi: 0x242424, lo: 0x101010 }, // corner TL
  35: { base: 0x1c1c1c, hi: 0x242424, lo: 0x101010 }, // corner TR
  36: { base: 0x1c1c1c, hi: 0x242424, lo: 0x101010 }, // corner BL
  37: { base: 0x1c1c1c, hi: 0x242424, lo: 0x101010 }, // corner BR
  // ── Sidewalk (ground layer, IDs 10-12) ───────────────────────────────────
  10: { base: 0x2a2620, hi: 0x322e28, lo: 0x1e1a16 }, // concrete sidewalk
  11: { base: 0x2a2620, hi: 0x322e28, lo: 0x1e1a16 }, // sidewalk + scattered trash
  12: { base: 0x1e1a12, hi: 0x28240e, lo: 0x12100a }, // sidewalk + lamp post (blocked)
  // ── Walls (objects layer, IDs 20-22) ─────────────────────────────────────
  20: { base: 0x28150e, hi: 0x321a12, lo: 0x180c08 }, // red brick wall
  21: { base: 0x1e1830, hi: 0x28203c, lo: 0x141024 }, // graffiti-covered wall
  22: { base: 0x1a2018, hi: 0x222820, lo: 0x0e1410 }, // corrugated metal gate
  // ── Warp (ID 30) ─────────────────────────────────────────────────────────
  30: { base: 0x1a1410, hi: 0x281c14, lo: 0x100e0a }, // warp door (glowing frame)
  // ── Legacy interior objects (map_01 / map_neon_bar) ───────────────────────
  6:  { base: 0x0e1a10, hi: 0x142018, lo: 0x080e0a }, // metal dumpster / bar counter
  7:  { base: 0x1c1408, hi: 0x241a0c, lo: 0x100e06 }, // interior door
  8:  { base: 0x0c0c0c, hi: 0x141414, lo: 0x040404 }, // storm gutter
  // ── Crosswalk (IDs 46-47) ─────────────────────────────────────────────────
  46: { base: 0x1c1c1c, hi: 0x242424, lo: 0x101010 }, // crosswalk: horizontal stripes
  47: { base: 0x1c1c1c, hi: 0x242424, lo: 0x101010 }, // crosswalk: vertical stripes
  // ── Indoor (IDs 40-44) — 瞿董的房間 ────────────────────────────────────────
  40: { base: 0x1a1610, hi: 0x221e16, lo: 0x100e08 }, // dirty carpet floor
  41: { base: 0x1a1820, hi: 0x24222c, lo: 0x100e14 }, // old bed
  42: { base: 0x1c1208, hi: 0x241a0c, lo: 0x100c04 }, // junk table with bottles
  43: { base: 0x0c0e14, hi: 0x14161e, lo: 0x06080e }, // old TV (faint blue)
  44: { base: 0x181c1c, hi: 0x202828, lo: 0x0e1414 }, // sink & mold
};

// ─── 確定性偽隨機（LCG，以 tile 位置為種子，保證重複渲染一致）─────────────────────
class TileRng {
  constructor(x, y) { this._s = (x * 73856093) ^ (y * 19349663); }
  next() {
    this._s = (Math.imul(this._s, 1664525) + 1013904223) | 0;
    return (this._s >>> 0) / 0xffffffff;
  }
}

// ─── MapManager ────────────────────────────────────────────────────────────────
export class MapManager {

  constructor(app, gameLayer) {
    this._app       = app;
    this._gameLayer = gameLayer;

    // Pixi 節點樹
    this._root        = new PIXI.Container();
    this._groundLayer = new PIXI.Container();
    this._objectLayer = new PIXI.Container();
    this._warpLayer   = new PIXI.Container(); // 自訂 warp 圖片疊加層
    this.entityLayer  = new PIXI.Container(); // public，供 EntityManager
    this._fogLayer    = new PIXI.Container();

    this._root.addChild(
      this._groundLayer,
      this._objectLayer,
      this._warpLayer,
      this.entityLayer,
      this._fogLayer,
    );
    this._gameLayer.addChild(this._root);

    // 地圖狀態
    this._mapData   = null;
    this._W         = 0;
    this._H         = 0;
    this._tileSize  = 48;

    // 霧視野
    this._fogState   = null;   // Uint8Array，每格 FOG.*
    this._fogSprites = null;   // Array[y][x] → PIXI.Sprite

    // 貼圖快取（每種 tileId 一張 RenderTexture）
    this._texCache    = new Map();
    this._fogTex      = null;  // 霧用純黑貼圖
    this._defaultTex  = null;  // 快取 miss 備援（預設深灰格）

    // 轉場 Overlay（全螢幕淡黑遮罩）
    this._overlay   = null;

    // 霧視野移動守衛（座標未變時跳過 updateFog）
    this._lastFogGx = -1;
    this._lastFogGy = -1;

    // NPC 系統（由 main.js 初始化後注入，預設 null）
    this.entityManager = null;

    // ── 渲染凍結旗標 ──────────────────────────────────────────────────────────
    // 僅在鏡頭確實需要移動時才為 true，render() 若偵測到 false 直接返回
    this._isDirty = true;
    this._camGx   = 0;
    this._camGy   = 0;
    this._camVx   = 0; // 視覺浮點相機座標（lerp 期間逐幀更新）
    this._camVy   = 0;
  }

  // ─── 工廠 ─────────────────────────────────────────────────────────────────

  static async create(app, gameLayer) {
    return new MapManager(app, gameLayer);
  }

  /** 由 main.js 在初始化完成後注入 EntityManager 實例。 */
  setEntityManager(entityManager) {
    this.entityManager = entityManager;
  }

  // ─── 載入地圖 ──────────────────────────────────────────────────────────────

  /**
   * @param {string}  mapId            對應 src/data/maps/{mapId}.json
   * @param {boolean} preserveEntities 保留 entityLayer（轉場時玩家精靈不重建）
   */
  async loadMap(mapId, preserveEntities = false) {
    // 清除舊地圖
    this._clearMap(preserveEntities);

    const resp = await fetch(`./src/data/maps/${mapId}.json`);
    if (!resp.ok) throw new Error(`[MapManager] 找不到地圖: ${mapId}.json`);
    const data = await resp.json();

    this._mapData  = data;
    this._W        = data.width;
    this._H        = data.height;
    this._tileSize = this._adaptTileSize(data.tileSize ?? 48);
    this._isDirty  = true; // 地圖切換後強制重新渲染鏡頭

    // 建立碰撞 Uint8Array（支援 collisions:[{gx,gy}] 與舊式 collision:[] 兩種格式）
    const total = this._W * this._H;
    const col   = new Uint8Array(total);
    if (Array.isArray(data.collisions)) {
      for (const { gx, gy } of data.collisions) col[gy * this._W + gx] = 1;
    } else if (Array.isArray(data.collision)) {
      for (let i = 0; i < data.collision.length; i++) col[i] = data.collision[i] ? 1 : 0;
    }
    data.collision = col; // isWalkable 讀取此欄位

    console.log(`[MapManager] 載入 "${data.name}"  ${this._W}×${this._H}  tile=${this._tileSize}px  visionR=${this.visionRadius}`);

    this._buildTexCache();
    this._renderLayer(this._groundLayer, data.layers.ground,  'ground');
    this._renderLayer(this._objectLayer, data.layers.objects, 'object');
    await this._preloadWarpSprites(data.warps);
    this._buildWarpOverlays();
    this._buildFogLayer();

    // 地圖切換完成後，通知 EntityManager 重新載入 NPC
    if (this.entityManager) {
      await this.entityManager.init(mapId, this.entityLayer);
    }
  }

  // ─── 自適應 Tile 大小 ──────────────────────────────────────────────────────

  _adaptTileSize(_mapSize) {
    const W     = this._app.screen.width;
    const H     = this._app.screen.height;
    const gameH = Math.floor(H * 0.66);
    // 11×11 tile 可視範圍（玩家四周各 5 格）
    // 取 W 與 gameH 較小值除以 11，確保兩個方向都能裝下 11 格
    return Math.max(16, Math.floor(Math.min(W, gameH) / 11));
  }

  // ─── 清除舊地圖 ────────────────────────────────────────────────────────────

  _clearMap(preserveEntities = false) {
    this._groundLayer.removeChildren();
    this._objectLayer.removeChildren();
    this._warpLayer.removeChildren();
    if (!preserveEntities) this.entityLayer.removeChildren();
    this._fogLayer.removeChildren();

    this._texCache.forEach(t => {
      if (Array.isArray(t)) t.forEach(v => v.destroy(true));
      else t.destroy(true);
    });
    this._texCache.clear();
    if (this._fogTex)     { this._fogTex.destroy(true);     this._fogTex     = null; }
    if (this._defaultTex) { this._defaultTex.destroy(true); this._defaultTex = null; }

    this._fogState   = null;
    this._fogSprites = null;
    this._lastFogGx  = -1;
    this._lastFogGy  = -1;
  }

  // ─── 貼圖快取建置 ─────────────────────────────────────────────────────────

  _buildTexCache() {
    const s = this._tileSize;

    // 掃描 ground + objects 兩層，收集所有非零 tile ID
    // （不依賴 map JSON 中的 tileset 欄位，兼容新舊地圖格式）
    const ids = new Set();
    for (const layer of [this._mapData.layers.ground, this._mapData.layers.objects]) {
      if (!layer) continue;
      for (const id of layer) {
        if (id !== 0) ids.add(id);
      }
    }

    for (const id of ids) {
      if (this._texCache.has(id)) continue;

      if (VARIANT_IDS.has(id)) {
        // 多變體：每個 variant 用不同種子，_renderLayer 依位置挑選
        const variants = [];
        for (let v = 0; v < VARIANT_COUNT; v++) {
          const gfx = this._drawTileVariant(id, s, v);
          variants.push(this._app.renderer.generateTexture({ target: gfx }));
          gfx.destroy();
        }
        this._texCache.set(id, variants);
      } else {
        const gfx = this._drawTileGraphics(id, s);
        this._texCache.set(id, this._app.renderer.generateTexture({ target: gfx }));
        gfx.destroy();
      }
    }

    // 霧用純黑貼圖
    const fogGfx = new PIXI.Graphics();
    fogGfx.rect(0, 0, s, s).fill({ color: 0x000000 });
    this._fogTex = this._app.renderer.generateTexture({ target: fogGfx });
    fogGfx.destroy();

    // ── 預設材質（快取 miss 時的安全備援，永不在每幀動態生成）─────────────────
    const defGfx = new PIXI.Graphics();
    defGfx.rect(0, 0, s, s).fill({ color: 0x1a1a1a });
    this._defaultTex = this._app.renderer.generateTexture({ target: defGfx });
    defGfx.destroy();
  }

  /** 以指定 variant 種子繪製同一 tile ID 的另一個隨機圖案。 */
  _drawTileVariant(id, s, variant) {
    const gfx = new PIXI.Graphics();
    const pal = TILE_PALETTE[id] ?? { base: 0x202020, hi: 0x303030, lo: 0x101010 };
    const rng = new TileRng(id + variant * 9973, id * 31 + variant * 7919);
    switch (id) {
      case 1:  this._drawAsphalt(gfx, s, pal, rng);       break;
      case 2:  this._drawCracked(gfx, s, pal, rng);       break;
      case 4:  this._drawPuddle(gfx, s, pal, rng);        break;
      case 5:  this._drawDebris(gfx, s, pal, rng);        break;
      case 10: this._drawSidewalk(gfx, s, pal, rng);      break;
      case 11: this._drawSidewalkTrash(gfx, s, pal, rng); break;
      case 40: this._drawIndoorFloor(gfx, s, pal, rng);   break;
      default: gfx.rect(0, 0, s, s).fill({ color: pal.base });
    }
    return gfx;
  }

  // ─── 程式繪製 Tile 圖形 ────────────────────────────────────────────────────

  _drawTileGraphics(id, s) {
    const gfx = new PIXI.Graphics();
    const pal = TILE_PALETTE[id] ?? { base: 0x202020, hi: 0x303030, lo: 0x101010 };
    const rng = new TileRng(id, id * 31); // 使用 id 為種子（快取：每種 id 固定圖案）

    switch (id) {
      // ── Road ──────────────────────────────────────────────────────────────
      case 1:  this._drawAsphalt(gfx, s, pal, rng);      break;
      case 2:  this._drawCracked(gfx, s, pal, rng);      break;
      case 3:  this._drawCenterLine(gfx, s, pal, rng);   break;
      case 4:  this._drawPuddle(gfx, s, pal, rng);       break;
      case 5:  this._drawDebris(gfx, s, pal, rng);       break;
      case 9:  this._drawHorizontalLine(gfx, s, pal, rng); break;
      // ── Corner centerlines ────────────────────────────────────────────────
      case 34: this._drawCornerLine(gfx, s, 'TL', pal, rng); break;
      case 35: this._drawCornerLine(gfx, s, 'TR', pal, rng); break;
      case 36: this._drawCornerLine(gfx, s, 'BL', pal, rng); break;
      case 37: this._drawCornerLine(gfx, s, 'BR', pal, rng); break;
      // ── Sidewalk ──────────────────────────────────────────────────────────
      case 10: this._drawSidewalk(gfx, s, pal, rng);     break;
      case 11: this._drawSidewalkTrash(gfx, s, pal, rng); break;
      case 12: this._drawLampPost(gfx, s, pal);           break;
      // ── Walls ─────────────────────────────────────────────────────────────
      case 20: this._drawBrickWall(gfx, s, pal, rng);    break;
      case 21: this._drawGraffiti(gfx, s, pal, rng);     break;
      case 22: this._drawMetalGate(gfx, s, pal);          break;
      // ── Warp ──────────────────────────────────────────────────────────────
      case 30: this._drawWarpDoor(gfx, s, pal);           break;
      // ── Crosswalk (IDs 46-47) ─────────────────────────────────────────────
      case 46: this._drawCrosswalkH(gfx, s, pal, rng);   break;
      case 47: this._drawCrosswalkV(gfx, s, pal, rng);   break;
      // ── Legacy interior (map_01 / map_neon_bar) ───────────────────────────
      case 6:  this._drawDumpster(gfx, s, pal);           break;
      case 7:  this._drawDoor(gfx, s, pal);               break;
      case 8:  this._drawGutter(gfx, s, pal);             break;
      // ── Indoor (map_qu_don_room) ───────────────────────────────────────────
      case 40: this._drawIndoorFloor(gfx, s, pal, rng);  break;
      case 41: this._drawIndoorBed(gfx, s, pal, rng);    break;
      case 42: this._drawIndoorTable(gfx, s, pal, rng);  break;
      case 43: this._drawIndoorTV(gfx, s, pal);           break;
      case 44: this._drawIndoorSink(gfx, s, pal);         break;
      default:
        gfx.rect(0, 0, s, s).fill({ color: pal.base });
    }
    return gfx;
  }

  // ── 柏油路 ─────────────────────────────────────────────────────────────────
  _drawAsphalt(gfx, s, pal, rng) {
    gfx.rect(0, 0, s, s).fill({ color: pal.base });
    // 骨材紋理（隨機亮點）
    for (let i = 0; i < 10; i++) {
      const px = rng.next() * s, py = rng.next() * s;
      gfx.circle(px, py, 0.8 + rng.next() * 1.2).fill({ color: pal.hi, alpha: 0.55 });
    }
    // 油漬斑（偶爾）
    gfx.circle(rng.next() * s * 0.6 + s * 0.2, rng.next() * s * 0.6 + s * 0.2, 3 + rng.next() * 4)
      .fill({ color: 0x0a0a14, alpha: 0.35 });
    // 邊緣陰影線
    gfx.rect(0, 0, s, 1).fill({ color: pal.lo, alpha: 0.4 });
    gfx.rect(0, 0, 1, s).fill({ color: pal.lo, alpha: 0.4 });
  }

  // ── 龜裂柏油 ───────────────────────────────────────────────────────────────
  _drawCracked(gfx, s, pal, rng) {
    this._drawAsphalt(gfx, s, pal, rng);
    // 主裂縫（2 條折線）
    const crackSegs = [
      [[s*0.15, s*0.05], [s*0.45, s*0.38], [s*0.72, s*0.85]],
      [[s*0.62, s*0.10], [s*0.50, s*0.42], [s*0.30, s*0.75]],
    ];
    crackSegs.forEach(pts => {
      gfx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) gfx.lineTo(pts[i][0], pts[i][1]);
      gfx.stroke({ color: pal.lo, width: 1.5, alpha: 0.85 });
    });
    // 細裂支線
    gfx.moveTo(s*0.45, s*0.38).lineTo(s*0.62, s*0.48)
      .stroke({ color: pal.lo, width: 0.8, alpha: 0.6 });
    // 凹陷坑洞
    gfx.circle(s*0.68, s*0.22, 3).fill({ color: pal.lo, alpha: 0.7 });
  }

  // ── 磚牆 ───────────────────────────────────────────────────────────────────
  _drawBrickWall(gfx, s, pal, rng) {
    // 灰泥底色
    gfx.rect(0, 0, s, s).fill({ color: 0x180e08 });
    const bH = Math.floor(s / 4);
    const bW = Math.floor(s / 2);
    for (let row = 0; row < 5; row++) {
      const offset = row % 2 === 0 ? 0 : Math.floor(bW / 2);
      const bc = row % 2 === 0 ? pal.base : pal.hi;
      for (let col = -1; col <= 3; col++) {
        const bx = offset + col * bW + 1;
        const by = row * bH + 1;
        if (bx + bW - 2 <= 0 || bx >= s) continue;
        gfx.rect(
          Math.max(0, bx), by,
          Math.min(bW - 2, s - Math.max(0, bx)), bH - 2
        ).fill({ color: bc });
        // 磚塊高光（模擬浮雕）
        gfx.rect(Math.max(0, bx), by, Math.min(bW - 2, s - Math.max(0, bx)), 1)
          .fill({ color: pal.hi, alpha: 0.3 });
      }
    }
    // 頂部暗影（牆頂壓暗）
    gfx.rect(0, 0, s, 3).fill({ color: 0x000000, alpha: 0.5 });
  }

  // ── 路面殘骸 / 碎玻璃（tile 5）────────────────────────────────────────────
  _drawDebris(gfx, s, pal, rng) {
    this._drawAsphalt(gfx, s, pal, rng);
    // 碎玻璃菱形碎片
    const count = 4 + Math.floor(rng.next() * 5);
    for (let i = 0; i < count; i++) {
      const dx = s * 0.1 + rng.next() * s * 0.8;
      const dy = s * 0.1 + rng.next() * s * 0.8;
      const sz = 1.5 + rng.next() * 2.5;
      gfx.moveTo(dx, dy - sz)
        .lineTo(dx + sz * 0.5, dy)
        .lineTo(dx, dy + sz * 0.8)
        .lineTo(dx - sz * 0.5, dy)
        .closePath()
        .fill({ color: 0xc0d8e8, alpha: 0.45 + rng.next() * 0.35 });
    }
    // 殘骸暗斑
    gfx.circle(s * 0.55, s * 0.38, 2 + rng.next() * 2)
      .fill({ color: 0x0a0a0a, alpha: 0.5 });
  }

  // ── 垃圾桶 ─────────────────────────────────────────────────────────────────
  _drawDumpster(gfx, s, pal) {
    // 桶身
    gfx.rect(2, 5, s - 4, s - 7).fill({ color: pal.base });
    // 金屬橫肋
    for (let i = 0; i < 3; i++) {
      const y = 5 + (i + 1) * Math.floor((s - 12) / 4);
      gfx.rect(2, y, s - 4, 2).fill({ color: pal.hi, alpha: 0.7 });
    }
    // 鏽斑
    gfx.circle(s * 0.25, s * 0.45, 3).fill({ color: 0x1a0e06, alpha: 0.6 });
    gfx.circle(s * 0.70, s * 0.62, 2).fill({ color: 0x1a0e06, alpha: 0.5 });
    // 蓋子
    gfx.rect(1, 0, s - 2, 7).fill({ color: pal.hi });
    gfx.rect(1, 0, s - 2, 1).fill({ color: 0x203020, alpha: 0.6 }); // 蓋子高光
    // 側面陰影
    gfx.rect(s - 4, 5, 2, s - 7).fill({ color: pal.lo, alpha: 0.6 });
  }

  // ── 門 ─────────────────────────────────────────────────────────────────────
  _drawDoor(gfx, s, pal) {
    // 門框
    gfx.rect(0, 0, s, s).fill({ color: pal.lo });
    // 門板
    gfx.rect(3, 2, s - 6, s - 4).fill({ color: pal.base });
    // 門板嵌板（上）
    gfx.rect(5, 4, s - 10, Math.floor((s - 8) * 0.45))
      .stroke({ color: pal.hi, width: 1 });
    // 門板嵌板（下）
    gfx.rect(5, 4 + Math.floor((s - 8) * 0.45) + 3,
              s - 10, Math.floor((s - 8) * 0.45))
      .stroke({ color: pal.hi, width: 1 });
    // 門把
    gfx.circle(s * 0.72, s * 0.52, 3).fill({ color: 0x3a2e1a });
    gfx.circle(s * 0.72, s * 0.52, 3).stroke({ color: 0x4a3e2a, width: 0.8 });
    // 縫隙高光
    gfx.rect(3, 2, 1, s - 4).fill({ color: pal.hi, alpha: 0.25 });
  }

  // ── 水溝 ───────────────────────────────────────────────────────────────────
  _drawGutter(gfx, s, pal) {
    gfx.rect(0, 0, s, s).fill({ color: pal.base });
    // 格柵線
    const step = Math.floor(s / 4);
    for (let i = 1; i < 4; i++) {
      gfx.moveTo(i * step, 0).lineTo(i * step, s).stroke({ color: pal.lo, width: 1 });
      gfx.moveTo(0, i * step).lineTo(s, i * step).stroke({ color: pal.lo, width: 1 });
    }
    // 中央排水孔
    gfx.circle(s / 2, s / 2, s * 0.14).fill({ color: pal.lo });
    gfx.circle(s / 2, s / 2, s * 0.08).fill({ color: 0x020202 });
    // 高光框
    gfx.rect(0, 0, s, 1).fill({ color: pal.hi, alpha: 0.3 });
  }

  // ── 黃色雙中心線（雙向行車分道）──────────────────────────────────────────
  _drawCenterLine(gfx, s, pal, rng) {
    this._drawAsphalt(gfx, s, pal, rng);
    // 雙黃線，間距約 8% tile 寬
    const cx  = Math.floor(s / 2);
    const gap = Math.max(2, Math.floor(s * 0.08));
    const lw  = Math.max(1, Math.floor(s * 0.045));
    gfx.rect(cx - gap - lw, 0, lw, s).fill({ color: 0xc8a000, alpha: 0.88 });
    gfx.rect(cx + gap,      0, lw, s).fill({ color: 0xc8a000, alpha: 0.88 });
    // 磨損褪色（隨機短缺口）
    const skipY = Math.floor(rng.next() * s * 0.5);
    gfx.rect(cx - gap - lw, skipY, lw, Math.floor(s * 0.12))
      .fill({ color: pal.base, alpha: 0.55 });
  }

  // ── 水平雙黃線（東西向行車分道）────────────────────────────────────────────
  _drawHorizontalLine(gfx, s, pal, rng) {
    this._drawAsphalt(gfx, s, pal, rng);
    const cy  = Math.floor(s / 2);
    const gap = Math.max(2, Math.floor(s * 0.08));
    const lw  = Math.max(1, Math.floor(s * 0.045));
    gfx.rect(0, cy - gap - lw, s, lw).fill({ color: 0xc8a000, alpha: 0.88 });
    gfx.rect(0, cy + gap,      s, lw).fill({ color: 0xc8a000, alpha: 0.88 });
    // 磨損缺口（隨機短段褪色）
    const skipX = Math.floor(rng.next() * s * 0.5);
    gfx.rect(skipX, cy - gap - lw, Math.floor(s * 0.12), lw)
       .fill({ color: pal.base, alpha: 0.55 });
  }

  // ── 斑馬線：橫向白條（ID 46，供左右向行人穿越）────────────────────────────
  // 白條垂直於移動方向，tile 水平擺開形成一整條通道
  _drawCrosswalkH(gfx, s, pal, rng) {
    this._drawAsphalt(gfx, s, pal, rng);
    const stripeW = Math.max(2, Math.floor(s * 0.14));
    const stripeH = Math.max(1, Math.floor(s * 0.10));
    const count   = 4;
    const gap     = Math.floor((s - count * stripeH) / (count + 1));
    for (let i = 0; i < count; i++) {
      const y = gap + i * (stripeH + gap);
      gfx.rect(Math.floor(s * 0.08), y, s - Math.floor(s * 0.16), stripeH)
         .fill({ color: 0xd0d0c8, alpha: 0.82 });
    }
  }

  // ── 斑馬線：縱向白條（ID 47，供上下向行人穿越）────────────────────────────
  // 白條垂直於移動方向，tile 縱向擺開形成一整條通道
  _drawCrosswalkV(gfx, s, pal, rng) {
    this._drawAsphalt(gfx, s, pal, rng);
    const stripeH = Math.max(2, Math.floor(s * 0.14));
    const stripeW = Math.max(1, Math.floor(s * 0.10));
    const count   = 4;
    const gap     = Math.floor((s - count * stripeW) / (count + 1));
    for (let i = 0; i < count; i++) {
      const x = gap + i * (stripeW + gap);
      gfx.rect(x, Math.floor(s * 0.08), stripeW, s - Math.floor(s * 0.16))
         .fill({ color: 0xd0d0c8, alpha: 0.82 });
    }
  }

  // ── 路口轉角雙黃線 ────────────────────────────────────────────────────────
  /**
   * type: 'TL' | 'TR' | 'BL' | 'BR'
   * 命名邏輯：垂直道路（上或下）與水平道路（左或右）相接的那個象限。
   *   TL = 垂直從上接、水平往左出 （曲線曲率中心在右下）
   *   TR = 垂直從上接、水平往右出 （曲率中心在左下）
   *   BL = 垂直從下接、水平往左出 （曲率中心在右上）
   *   BR = 垂直從下接、水平往右出 （曲率中心在左上）
   *
   * 實作採「兩個 L 形矩形對」，間距與直線一致，
   * 每對的端點因矩形重疊而自然形成 90° 銳角接頭。
   */
  _drawCornerLine(gfx, s, type, pal, rng) {
    this._drawAsphalt(gfx, s, pal, rng);

    const cx  = Math.floor(s / 2);
    const cy  = Math.floor(s / 2);
    const gap = Math.max(2, Math.floor(s * 0.08));
    const lw  = Math.max(1, Math.floor(s * 0.045));
    const col = 0xc8a000;
    const alp = 0.88;

    // 每個角落由兩對矩形組成：
    //   A = 內弧那條線 (半徑較小的那側，需要角落填方)
    //   B = 外弧那條線 (自然 L 接頭)
    switch (type) {
      case 'TL': {
        // A: 上半垂直(左) + 左半水平(上)  ← 內弧
        gfx.rect(0,           cy - gap - lw, cx - gap,       lw  ).fill({ color: col, alpha: alp });
        gfx.rect(cx - gap - lw, 0,           lw,             cy - gap).fill({ color: col, alpha: alp });
        // B: 上半垂直(右) + 左半水平(下)  ← 外弧（自然 L）
        gfx.rect(0,           cy + gap,       cx + gap + lw, lw  ).fill({ color: col, alpha: alp });
        gfx.rect(cx + gap,    0,              lw,            cy + gap + lw).fill({ color: col, alpha: alp });
        break;
      }
      case 'TR': {
        // A: 上半垂直(右) + 右半水平(上)
        gfx.rect(cx + gap,    cy - gap - lw, s - (cx + gap),     lw  ).fill({ color: col, alpha: alp });
        gfx.rect(cx + gap,    0,             lw,                cy - gap).fill({ color: col, alpha: alp });
        // B: 上半垂直(左) + 右半水平(下)（自然 L）
        gfx.rect(cx - gap - lw, cy + gap,   s - (cx - gap - lw), lw  ).fill({ color: col, alpha: alp });
        gfx.rect(cx - gap - lw, 0,          lw,                cy + gap + lw).fill({ color: col, alpha: alp });
        break;
      }
      case 'BL': {
        // A: 下半垂直(左) + 左半水平(下)
        gfx.rect(0,           cy + gap,       cx - gap,       lw  ).fill({ color: col, alpha: alp });
        gfx.rect(cx - gap - lw, cy + gap,     lw,             s - (cy + gap)).fill({ color: col, alpha: alp });
        // B: 下半垂直(右) + 左半水平(上)（自然 L）
        gfx.rect(0,           cy - gap - lw, cx + gap + lw,  lw  ).fill({ color: col, alpha: alp });
        gfx.rect(cx + gap,    cy - gap - lw, lw,             s - (cy - gap - lw)).fill({ color: col, alpha: alp });
        break;
      }
      case 'BR': {
        // A: 下半垂直(右) + 右半水平(下)
        gfx.rect(cx + gap,    cy + gap,       s - (cx + gap),      lw  ).fill({ color: col, alpha: alp });
        gfx.rect(cx + gap,    cy + gap,       lw,                  s - (cy + gap)).fill({ color: col, alpha: alp });
        // B: 下半垂直(左) + 右半水平(上)（自然 L）
        gfx.rect(cx - gap - lw, cy - gap - lw, s - (cx - gap - lw), lw  ).fill({ color: col, alpha: alp });
        gfx.rect(cx - gap - lw, cy - gap - lw, lw,                  s - (cy - gap - lw)).fill({ color: col, alpha: alp });
        break;
      }
    }
  }

  // ── 積水路面（反射霓虹燈光）──────────────────────────────────────────────
  _drawPuddle(gfx, s, pal, rng) {
    gfx.rect(0, 0, s, s).fill({ color: pal.base });
    // 水面橢圓（深藍基調）
    const cx = s * (0.28 + rng.next() * 0.44);
    const cy = s * (0.28 + rng.next() * 0.44);
    const rx = s * (0.18 + rng.next() * 0.15);
    const ry = s * (0.10 + rng.next() * 0.08);
    gfx.ellipse(cx, cy, rx, ry).fill({ color: 0x08122a, alpha: 0.88 });
    // 霓虹反射光帶（品紅）
    gfx.ellipse(cx - rx * 0.15, cy - ry * 0.25, rx * 0.5, ry * 0.38)
      .fill({ color: 0xff0066, alpha: 0.22 });
    // 霓虹反射光帶（青色）
    gfx.ellipse(cx + rx * 0.22, cy + ry * 0.12, rx * 0.38, ry * 0.28)
      .fill({ color: 0x00ccff, alpha: 0.18 });
    // 水面高光（白色細線）
    gfx.moveTo(cx - rx * 0.6, cy - ry * 0.1)
      .lineTo(cx + rx * 0.4, cy - ry * 0.2)
      .stroke({ color: 0xffffff, width: 0.6, alpha: 0.18 });
    // 路面骨材（積水邊緣可見）
    for (let i = 0; i < 5; i++) {
      gfx.circle(rng.next() * s, rng.next() * s, 0.5 + rng.next())
        .fill({ color: pal.hi, alpha: 0.3 });
    }
  }

  // ── 混凝土人行道 ───────────────────────────────────────────────────────────
  _drawSidewalk(gfx, s, pal, rng) {
    gfx.rect(0, 0, s, s).fill({ color: pal.base });
    // 混凝土骨材細點
    for (let i = 0; i < 10; i++) {
      gfx.circle(rng.next() * s, rng.next() * s, 0.6 + rng.next() * 0.9)
        .fill({ color: pal.hi, alpha: 0.38 });
    }
    // 板縫（水平 + 垂直）
    const seam = Math.floor(s * 0.5);
    gfx.rect(0,    seam, s,    1).fill({ color: pal.lo, alpha: 0.65 });
    gfx.rect(seam, 0,    1,    s).fill({ color: pal.lo, alpha: 0.65 });
    // 路沿高光（北 + 西邊）
    gfx.rect(0, 0, s, 1).fill({ color: pal.hi, alpha: 0.48 });
    gfx.rect(0, 0, 1, s).fill({ color: pal.hi, alpha: 0.48 });
    // 路沿陰影（南 + 東邊）
    gfx.rect(0, s - 1, s, 1).fill({ color: pal.lo, alpha: 0.55 });
    gfx.rect(s - 1, 0, 1, s).fill({ color: pal.lo, alpha: 0.55 });
  }

  // ── 人行道 + 散落垃圾 ───────────────────────────────────────────────────
  _drawSidewalkTrash(gfx, s, pal, rng) {
    this._drawSidewalk(gfx, s, pal, rng);
    // 垃圾袋（深綠橢圓）
    const bx = s * 0.15 + rng.next() * s * 0.35;
    const by = s * 0.25 + rng.next() * s * 0.35;
    gfx.ellipse(bx, by, s * 0.20, s * 0.14).fill({ color: 0x0a160a, alpha: 0.88 });
    // 垃圾袋光澤高光
    gfx.ellipse(bx - s * 0.05, by - s * 0.04, s * 0.07, s * 0.04)
      .fill({ color: 0x182818, alpha: 0.6 });
    // 廢紙（矩形碎屑）
    for (let i = 0; i < 4; i++) {
      const px = s * 0.1 + rng.next() * s * 0.8;
      const py = s * 0.1 + rng.next() * s * 0.8;
      gfx.rect(px, py, 3 + rng.next() * 5, 1.5 + rng.next() * 3)
        .fill({ color: 0x1a1810, alpha: 0.55 + rng.next() * 0.25 });
    }
  }

  // ── 路燈柱（人行道 + 阻擋）─────────────────────────────────────────────
  _drawLampPost(gfx, s, pal) {
    // 人行道底 + 板縫
    gfx.rect(0, 0, s, s).fill({ color: pal.base });
    gfx.rect(0, Math.floor(s * 0.5), s, 1).fill({ color: pal.lo, alpha: 0.5 });
    gfx.rect(Math.floor(s * 0.5), 0, 1, s).fill({ color: pal.lo, alpha: 0.5 });
    // 燈柱桿（深灰金屬）
    const pw = Math.max(2, Math.floor(s * 0.10));
    const px = Math.floor((s - pw) / 2);
    gfx.rect(px, 0, pw, Math.floor(s * 0.78)).fill({ color: 0x28261e });
    // 燈頭（橫向梯形）
    const lw = Math.floor(s * 0.58);
    const lx = Math.floor((s - lw) / 2);
    const lh = Math.floor(s * 0.16);
    gfx.rect(lx, 0, lw, lh).fill({ color: 0x1c1a0c });
    // 燈光凸面玻璃
    gfx.ellipse(s * 0.5, lh * 0.7, lw * 0.38, lh * 0.45)
      .fill({ color: 0xffee88, alpha: 0.55 });
    // 燈暈（大半徑低 alpha 暖黃）
    gfx.circle(s * 0.5, lh * 0.5, s * 0.30)
      .fill({ color: 0xffaa44, alpha: 0.14 });
    // 燈柱底座
    const bw = Math.floor(s * 0.30);
    const bx = Math.floor((s - bw) / 2);
    gfx.rect(bx, Math.floor(s * 0.74), bw, Math.floor(s * 0.26))
      .fill({ color: 0x201e16 });
  }

  // ── 塗鴉牆 ────────────────────────────────────────────────────────────────
  _drawGraffiti(gfx, s, pal, rng) {
    // 磚牆底（偏深紫色調）
    gfx.rect(0, 0, s, s).fill({ color: 0x0e0a16 });
    // 磚縫紋理（低對比）
    const bH = Math.floor(s / 4);
    const bW = Math.floor(s / 2);
    for (let row = 0; row < 5; row++) {
      const offset = row % 2 === 0 ? 0 : Math.floor(bW / 2);
      for (let col = -1; col <= 3; col++) {
        const bx = offset + col * bW + 1;
        const by = row * bH + 1;
        if (bx + bW - 2 <= 0 || bx >= s) continue;
        gfx.rect(
          Math.max(0, bx), by,
          Math.min(bW - 2, s - Math.max(0, bx)), bH - 2
        ).fill({ color: pal.base, alpha: 0.9 });
      }
    }
    // 噴漆塗鴉色塊
    const SPRAY_COLORS = [0xff0066, 0x00ccff, 0xffcc00, 0x00ff88, 0xff6600, 0xcc00ff];
    const numTags = 2 + Math.floor(rng.next() * 3);
    for (let i = 0; i < numTags; i++) {
      const gx_   = s * 0.05 + rng.next() * s * 0.65;
      const gy_   = s * 0.08 + rng.next() * s * 0.55;
      const gcol  = SPRAY_COLORS[Math.floor(rng.next() * SPRAY_COLORS.length)];
      const alpha = 0.65 + rng.next() * 0.30;
      // 主橫筆畫（字母橫槓感）
      gfx.rect(gx_, gy_, s * 0.12 + rng.next() * s * 0.22, 2 + rng.next() * 3)
        .fill({ color: gcol, alpha });
      // 垂直筆畫
      gfx.rect(gx_ + rng.next() * s * 0.06, gy_ - s * 0.07,
               1.5, s * 0.10 + rng.next() * s * 0.12)
        .fill({ color: gcol, alpha: alpha - 0.1 });
      // 噴漆飛濺（小圓點群）
      for (let j = 0; j < 3; j++) {
        gfx.circle(gx_ + rng.next() * s * 0.25, gy_ + rng.next() * s * 0.18, 0.8)
          .fill({ color: gcol, alpha: alpha * 0.6 });
      }
    }
    // 頂部壓暗
    gfx.rect(0, 0, s, 3).fill({ color: 0x000000, alpha: 0.45 });
  }

  // ── 金屬捲門 ────────────────────────────────────────────────────────────
  _drawMetalGate(gfx, s, pal) {
    gfx.rect(0, 0, s, s).fill({ color: pal.base });
    // 水平波浪鋼板肋條
    const ribH = Math.max(2, Math.floor(s / 6));
    for (let i = 0; i < 7; i++) {
      const ry = i * ribH;
      gfx.rect(0, ry, s, ribH - 1).fill({
        color: i % 2 === 0 ? pal.hi : pal.lo,
        alpha: 0.50,
      });
    }
    // 垂直邊框槽
    gfx.rect(0,     0, 3, s).fill({ color: pal.lo, alpha: 0.70 });
    gfx.rect(s - 3, 0, 3, s).fill({ color: pal.lo, alpha: 0.70 });
    // 門鎖孔（中央）
    gfx.circle(s * 0.5, s * 0.5, Math.floor(s * 0.08))
      .fill({ color: 0x060808 });
    gfx.circle(s * 0.5, s * 0.5, Math.floor(s * 0.045))
      .fill({ color: 0x181c18 });
    // 鏽蝕斑點
    gfx.circle(s * 0.22, s * 0.33, 2).fill({ color: 0x2a1006, alpha: 0.65 });
    gfx.circle(s * 0.74, s * 0.65, 1.5).fill({ color: 0x2a1006, alpha: 0.50 });
    gfx.circle(s * 0.46, s * 0.78, 1.8).fill({ color: 0x2a1006, alpha: 0.55 });
    // 頂部暗影
    gfx.rect(0, 0, s, 2).fill({ color: 0x000000, alpha: 0.55 });
  }

  // ── 傳送門（發光青色邊框）────────────────────────────────────────────────
  _drawWarpDoor(gfx, s, pal) {
    // 門框（深木色）
    gfx.rect(0, 0, s, s).fill({ color: pal.lo });
    // 門板
    const inset = 3;
    gfx.rect(inset, inset, s - inset * 2, s - inset).fill({ color: pal.base });
    // 門板嵌板（上下兩格）
    const panelW = s - inset * 2 - 6;
    const panelH = Math.floor((s - inset - 6) * 0.42);
    gfx.rect(inset + 3, inset + 3, panelW, panelH)
      .stroke({ color: 0x241c10, width: 1 });
    gfx.rect(inset + 3, inset + 3 + panelH + 4, panelW, panelH)
      .stroke({ color: 0x241c10, width: 1 });
    // 發光邊框（青色 #00ffcc）
    const G = 0x00ffcc;
    gfx.rect(inset,         inset,     s - inset * 2, 2).fill({ color: G, alpha: 0.75 });
    gfx.rect(inset,         s - 3,     s - inset * 2, 2).fill({ color: G, alpha: 0.55 });
    gfx.rect(inset,         inset,     2, s - inset   ).fill({ color: G, alpha: 0.65 });
    gfx.rect(s - inset - 2, inset,     2, s - inset   ).fill({ color: G, alpha: 0.65 });
    // 中央符文光點
    gfx.circle(s * 0.5, s * 0.46, s * 0.13).fill({ color: G, alpha: 0.12 });
    gfx.circle(s * 0.5, s * 0.46, s * 0.06).fill({ color: G, alpha: 0.28 });
    // 門把（金色）
    gfx.circle(s * 0.74, s * 0.50, 3).fill({ color: 0xb89040 });
    gfx.circle(s * 0.74, s * 0.50, 3).stroke({ color: 0xdbb050, width: 0.8 });
  }

  // ── 室內地板（髒污地毯）─────────────────────────────────────────────────
  _drawIndoorFloor(gfx, s, pal, rng) {
    // 基底地毯色
    gfx.rect(0, 0, s, s).fill({ color: pal.base });
    // 細紋（橫向纖維感）
    for (let y = 2; y < s; y += 4) {
      gfx.rect(0, y, s, 1).fill({ color: pal.lo, alpha: 0.18 });
    }
    // 污漬 / 菸頭燙痕（3–5 個隨機深色斑點）
    const spots = 3 + Math.floor(rng.next() * 3);
    for (let i = 0; i < spots; i++) {
      const sx = Math.floor(rng.next() * (s - 4)) + 2;
      const sy = Math.floor(rng.next() * (s - 4)) + 2;
      const sr = 1 + rng.next() * 2.5;
      gfx.circle(sx, sy, sr).fill({ color: 0x080604, alpha: 0.45 + rng.next() * 0.3 });
    }
    // 邊緣暗影
    gfx.rect(0, 0, s, 1).fill({ color: 0x000000, alpha: 0.25 });
    gfx.rect(0, 0, 1, s).fill({ color: 0x000000, alpha: 0.20 });
  }

  // ── 破舊的床 ─────────────────────────────────────────────────────────────
  _drawIndoorBed(gfx, s, pal, rng) {
    // 床框（深木色）
    gfx.rect(0, 0, s, s).fill({ color: 0x120e08 });
    // 床墊
    const mx = 4, my = 4, mw = s - 8, mh = s - 8;
    gfx.rect(mx, my, mw, mh).fill({ color: pal.base });
    // 皺折線（橫向 2 條）
    const lineY1 = my + Math.floor(mh * 0.35);
    const lineY2 = my + Math.floor(mh * 0.65);
    gfx.moveTo(mx + 4, lineY1).lineTo(mx + mw - 4, lineY1 + 2)
       .stroke({ color: pal.lo, width: 1.2, alpha: 0.55 });
    gfx.moveTo(mx + 4, lineY2).lineTo(mx + mw - 4, lineY2 - 1)
       .stroke({ color: pal.lo, width: 1.2, alpha: 0.45 });
    // 枕頭（淡灰色矩形，上方）
    const pw = Math.floor(mw * 0.72), ph = Math.floor(mh * 0.28);
    const px = mx + Math.floor((mw - pw) / 2);
    gfx.rect(px, my + 2, pw, ph).fill({ color: 0x2a2830 });
    gfx.rect(px, my + 2, pw, ph).stroke({ color: 0x181620, width: 1 });
    // 污漬
    gfx.circle(mx + mw * 0.3, my + mh * 0.6, 3).fill({ color: 0x0a0806, alpha: 0.4 });
  }

  // ── 雜物桌（酒瓶堆）─────────────────────────────────────────────────────
  _drawIndoorTable(gfx, s, pal, rng) {
    // 桌面
    gfx.rect(0, 0, s, s).fill({ color: pal.lo });
    const tw = s - 6, th = Math.floor(s * 0.55);
    gfx.rect(3, Math.floor(s * 0.3), tw, th).fill({ color: pal.base });
    gfx.rect(3, Math.floor(s * 0.3), tw, th).stroke({ color: pal.lo, width: 1 });
    // 桌腳（左右下角）
    gfx.rect(5, s - 10, 4, 10).fill({ color: 0x0e0c06 });
    gfx.rect(s - 9, s - 10, 4, 10).fill({ color: 0x0e0c06 });
    // 酒瓶（3 個細長矩形 + 圓頂）
    const bottles = [
      { x: s * 0.22, c: 0x1a3010 },
      { x: s * 0.45, c: 0x2a1808 },
      { x: s * 0.68, c: 0x102818 },
    ];
    bottles.forEach(({ x, c }) => {
      const bx = Math.floor(x);
      const by = Math.floor(s * 0.08);
      const bw = Math.floor(s * 0.12);
      const bh = Math.floor(s * 0.30);
      gfx.rect(bx, by, bw, bh).fill({ color: c });
      gfx.circle(bx + bw / 2, by, bw * 0.4).fill({ color: c });
      // 高光
      gfx.rect(bx + 1, by + 2, 2, bh - 4).fill({ color: 0xffffff, alpha: 0.07 });
    });
  }

  // ── 老電視（微弱藍光）───────────────────────────────────────────────────
  _drawIndoorTV(gfx, s, pal) {
    // 電視外殼（深灰）
    gfx.rect(0, 0, s, s).fill({ color: pal.lo });
    const ox = 4, oy = 6, ow = s - 8, oh = Math.floor(s * 0.62);
    gfx.rect(ox, oy, ow, oh).fill({ color: 0x181820 });
    gfx.rect(ox, oy, ow, oh).stroke({ color: 0x080810, width: 2 });
    // 螢幕（藍色靜態雜訊感）
    const sx2 = ox + 4, sy2 = oy + 4, sw = ow - 8, sh = oh - 8;
    gfx.rect(sx2, sy2, sw, sh).fill({ color: 0x0c1428 });
    // 靜態線條
    for (let ly = sy2 + 2; ly < sy2 + sh - 2; ly += 3) {
      const alpha = 0.05 + (Math.sin(ly * 0.8) * 0.5 + 0.5) * 0.12;
      gfx.rect(sx2 + 2, ly, sw - 4, 1).fill({ color: 0x4466cc, alpha });
    }
    // 中央微弱發光點
    gfx.circle(sx2 + sw / 2, sy2 + sh / 2, sw * 0.25)
       .fill({ color: 0x2244aa, alpha: 0.25 });
    // 控制旋鈕（右側）
    const kx = ox + ow - 6;
    gfx.circle(kx, oy + oh * 0.35, 3).fill({ color: 0x2a2a2a });
    gfx.circle(kx, oy + oh * 0.65, 3).fill({ color: 0x2a2a2a });
    // 底座
    const stW = Math.floor(ow * 0.5);
    gfx.rect(ox + (ow - stW) / 2, oy + oh, stW, Math.floor(s * 0.12))
       .fill({ color: 0x141414 });
  }

  // ── 洗手台（發霉牆角）───────────────────────────────────────────────────
  _drawIndoorSink(gfx, s, pal) {
    // 牆角瓷磚底
    gfx.rect(0, 0, s, s).fill({ color: pal.lo });
    // 發霉污漬（深綠色斑塊）
    gfx.circle(s * 0.15, s * 0.2,  s * 0.12).fill({ color: 0x0a1008, alpha: 0.55 });
    gfx.circle(s * 0.28, s * 0.1,  s * 0.08).fill({ color: 0x0c1408, alpha: 0.45 });
    gfx.circle(s * 0.1,  s * 0.38, s * 0.10).fill({ color: 0x081208, alpha: 0.50 });
    // 洗手台盆（白瓷，偏黃）
    const bx = Math.floor(s * 0.08), by = Math.floor(s * 0.38);
    const bw = Math.floor(s * 0.84), bh = Math.floor(s * 0.46);
    gfx.rect(bx, by, bw, bh).fill({ color: 0x282420 });
    gfx.rect(bx, by, bw, bh).stroke({ color: 0x1a1610, width: 1.5 });
    // 盆內（空洞）
    const ix = bx + 6, iy = by + 6, iw = bw - 12, ih = bh - 12;
    gfx.rect(ix, iy, iw, ih).fill({ color: 0x141010 });
    // 排水孔
    gfx.circle(ix + iw / 2, iy + ih / 2, 3).fill({ color: 0x0a0808 });
    // 水龍頭
    const fx = Math.floor(s * 0.5);
    gfx.rect(fx - 3, by - 8, 6, 10).fill({ color: 0x242220 });
    gfx.rect(fx - 7, by - 9, 14, 3).fill({ color: 0x242220 });
    // 水垢痕跡
    gfx.rect(ix + iw / 2 - 1, iy + 2, 2, ih - 4).fill({ color: 0x1c1614, alpha: 0.4 });
  }

  // ─── 自訂 Warp 圖片疊加 ───────────────────────────────────────────────────

  /**
   * 預載所有帶有 `sprite` 屬性的 warp 圖片，確保 _buildWarpOverlays 能同步取得貼圖尺寸。
   * 載入失敗的項目會靜默降級（_buildWarpOverlays 會用 tile-30 取代）。
   */
  async _preloadWarpSprites(warps) {
    if (!warps?.length) return;
    const urls = warps
      .filter(w => w.sprite)
      .map(w => 'assets/ui/' + w.sprite);
    if (urls.length === 0) return;
    try {
      await PIXI.Assets.load(urls);
    } catch (e) {
      console.warn('[MapManager] 部分 warp sprite 載入失敗，降級為預設圖形', e);
    }
  }

  /**
   * 為帶有 `sprite` 屬性的 warp 建立自訂圖片疊加（覆蓋 tile-30 預設圖形）。
   * 沒有 `sprite` 的 warp 由 objects layer 的 tile-30 顯示（_drawWarpDoor）。
   *
   * warp JSON 欄位：
   *   sprite   {string}  相對於 assets/ui/ 的路徑（例如 "interface/warp_arrow_base.png"）
   *   rotation {number}  旋轉角度（度數，選填，例如 90 / -90 / 180）
   */
  _buildWarpOverlays() {
    this._warpLayer.removeChildren();
    if (!this._mapData?.warps) return;

    const s = this._tileSize;

    for (const warp of this._mapData.warps) {
      // 無 sprite 也無 label 則完全跳過（tile-30 已在 object layer 顯示）
      if (!warp.sprite && !warp.label) continue;

      const cx = warp.gx * s + s / 2;
      const cy = warp.gy * s + s / 2;

      // ── 箭頭 Sprite（帶旋轉） ─────────────────────────────────────────────
      if (warp.sprite) {
        const url = 'assets/ui/' + warp.sprite;
        const tex = PIXI.Assets.cache.get(url);

        if (!tex) {
          console.warn(`[MapManager] warp "${warp.id}" sprite 未找到，使用預設圖形`);
          // sprite 缺失時不跳過，仍繼續渲染文字標籤
        } else {
          const spr    = new PIXI.Sprite(tex);
          spr.anchor.set(0.5);
          spr.x        = cx;
          spr.y        = cy;
          spr.width    = s;
          spr.height   = s;
          if (warp.rotation != null) {
            spr.rotation = warp.rotation * (Math.PI / 180);
          }
          this._warpLayer.addChild(spr);
        }
      }

      // ── 文字標籤（永遠正向，rotation 強制 0） ─────────────────────────────
      // 文字與 sprite 是同一 Container（_warpLayer）的兄弟節點，
      // 因此 sprite 的旋轉完全不影響文字方向。
      if (warp.label) {
        const fontSize = Math.max(10, Math.floor(s * 0.30));
        const txt = new PIXI.Text({
          text: warp.label,
          style: new PIXI.TextStyle({
            fontFamily:  '"Noto Sans TC","Microsoft JhengHei",sans-serif',
            fontSize,
            fontWeight:  'bold',
            fill:        0x00FF41,
            dropShadow:  { color: 0x000000, blur: 3, distance: 1, alpha: 0.9 },
          }),
        });
        // 水平置中、底部對齊格子底緣（文字壓在箭頭下方，不遮擋箭身）
        txt.anchor.set(0.5, 1);
        txt.x        = cx;
        txt.y        = warp.gy * s + s - 2;
        txt.rotation = 0;   // ← 關鍵：無論箭頭旋轉幾度，文字永遠水平可讀
        this._warpLayer.addChild(txt);
      }
    }
  }

  // ─── 渲染層 ────────────────────────────────────────────────────────────────

  // ⚠️  此方法只在 loadMap / onResize 期間呼叫，絕對不在每幀執行。
  //     所有貼圖均來自 _texCache（loadMap 預先生成），
  //     快取 miss 時使用 _defaultTex 備援，永不在此處呼叫 generateTexture。
  _renderLayer(container, tileArray, layerType) {
    container.removeChildren();
    const s = this._tileSize;

    for (let y = 0; y < this._H; y++) {
      for (let x = 0; x < this._W; x++) {
        const id = tileArray[y * this._W + x];
        if (id === 0) continue;

        // 快取查詢：miss 時使用預設材質（絕不在此 generateTexture）
        const cached = this._texCache.get(id) ?? this._defaultTex;
        if (!cached) continue;  // 極端情況：連 defaultTex 都未建置時跳過

        // 陣列 = 多變體，依格子座標穩定挑選
        const tex = Array.isArray(cached)
          ? cached[(x * 31 + y * 17) % cached.length]
          : cached;

        const spr = new PIXI.Sprite(tex);
        spr.x = x * s;
        spr.y = y * s;
        container.addChild(spr);
      }
    }
  }

  // ─── 霧視野層 ─────────────────────────────────────────────────────────────

  _buildFogLayer() {
    this._fogLayer.removeChildren();
    const s     = this._tileSize;
    const total = this._W * this._H;

    this._fogState   = new Uint8Array(total); // 全 HIDDEN = 0
    this._fogSprites = [];

    for (let y = 0; y < this._H; y++) {
      const row = [];
      for (let x = 0; x < this._W; x++) {
        const spr  = new PIXI.Sprite(this._fogTex);
        spr.x      = x * s;
        spr.y      = y * s;
        spr.width  = s;
        spr.height = s;
        spr.alpha  = FOG_ALPHA[FOG.HIDDEN];
        this._fogLayer.addChild(spr);
        row.push(spr);
      }
      this._fogSprites.push(row);
    }
  }

  // ─── 公開 API ─────────────────────────────────────────────────────────────

  /**
   * 查詢格子是否可走。
   * @param {number} gx
   * @param {number} gy
   * @returns {boolean}
   */
  isWalkable(gx, gy) {
    if (!this._mapData) return false;
    if (gx < 0 || gy < 0 || gx >= this._W || gy >= this._H) return false;
    return this._mapData.collision[gy * this._W + gx] === 0;
  }

  /**
   * 更新霧視野（玩家移動後呼叫）。
   * 三態：HIDDEN → EXPLORED → VISIBLE
   *
   * @param {number} playerGx
   * @param {number} playerGy
   * @param {number} [range=5]  可見格子半徑
   */
  updateFog(playerGx, playerGy, range = 5) {
    if (!this._fogSprites) return;
    // 玩家格子座標未變化時跳過（省去每幀 W×H 次遍歷）
    if (playerGx === this._lastFogGx && playerGy === this._lastFogGy) return;
    this._lastFogGx = playerGx;
    this._lastFogGy = playerGy;

    for (let y = 0; y < this._H; y++) {
      for (let x = 0; x < this._W; x++) {
        const dist = Math.hypot(x - playerGx, y - playerGy);
        const idx  = y * this._W + x;
        const spr  = this._fogSprites[y][x];

        if (dist <= range) {
          // 視野內 → VISIBLE
          if (this._fogState[idx] !== FOG.VISIBLE) {
            this._fogState[idx] = FOG.VISIBLE;
            spr.alpha   = FOG_ALPHA[FOG.VISIBLE];
            spr.visible = false;  // alpha=0 等同，但 visible=false 更省繪製
          }
        } else if (this._fogState[idx] === FOG.VISIBLE) {
          // 剛離開視野 → EXPLORED（暗色保留記憶）
          this._fogState[idx] = FOG.EXPLORED;
          spr.visible = true;
          spr.alpha   = FOG_ALPHA[FOG.EXPLORED];
        }
        // HIDDEN 維持原樣（alpha 0.94，visible=true）
      }
    }
  }

  /**
   * 查詢指定格是否有觸發點。
   * @returns {object|null}
   */
  getTriggerAt(gx, gy) {
    if (!this._mapData) return null;
    return this._mapData.triggers.find(t => t.gx === gx && t.gy === gy && t.active) ?? null;
  }

  /**
   * 查詢指定格是否有傳送點（warps 陣列）。
   * @param {number} gx
   * @param {number} gy
   * @returns {{ id, gx, gy, targetMap, targetGx, targetGy, direction, label }|null}
   */
  checkWarp(gx, gy) {
    if (!this._mapData?.warps) return null;
    return this._mapData.warps.find(
      w => w.gx === gx && w.gy === gy && w.active !== false
    ) ?? null;
  }

  /**
   * Grid 座標 → Canvas 中心像素座標（相對 _root）
   */
  gridToPixel(gx, gy) {
    const s = this._tileSize;
    return { x: gx * s + s / 2, y: gy * s + s / 2 };
  }

  /**
   * Canvas 像素座標（相對 _root）→ Grid 座標
   */
  pixelToGrid(px, py) {
    const s = this._tileSize;
    return { gx: Math.floor(px / s), gy: Math.floor(py / s) };
  }

  /**
   * 將鏡頭置中到指定格，並限制在地圖邊界內（不留黑邊）。
   * 呼叫後必須同步更新 InputManager.setGridConfig()。
   * ⚡ 僅記錄目標座標 + 標記 dirty，實際位移在 render() 執行。
   *
   * @param {number} gx
   * @param {number} gy
   */
  centerOn(gx, gy) {
    // ⚡ 初始化 / resize / 傳送 — 直接對齊視覺座標（強制 snap）
    if (this._camGx === gx && this._camGy === gy &&
        this._camVx === gx && this._camVy === gy) return;
    this._camGx   = gx;
    this._camGy   = gy;
    this._camVx   = gx; // snap 視覺座標到邏輯座標
    this._camVy   = gy;
    this._isDirty = true;
  }

  /**
   * 由 main.js lerp 迴圈每幀呼叫，傳入玩家的浮點視覺座標。
   * 相機位置從此同步，確保地圖移動與精靈完全同步。
   * @param {number} vx  player.vx
   * @param {number} vy  player.vy
   */
  setCameraVisual(vx, vy) {
    this._camVx   = vx;
    this._camVy   = vy;
    this._isDirty = true;
  }

  /**
   * 由 main.js 主動呼叫（lerp 每幀 or init/resize/warp 後）。
   * 若 _isDirty 為 false，直接返回，不修改任何 Pixi 物件。
   *
   * ⚠️  此方法內絕對不能呼叫 generateTexture 或 removeChildren/addChild。
   */
  render() {
    if (!this._isDirty) return;
    this._isDirty = false;

    const s     = this._tileSize;
    const W     = this._app.screen.width;
    const H     = this._app.screen.height;
    const gameH = Math.floor(H * 0.66);

    // 使用視覺浮點座標 (_camVx/_camVy)：lerp 期間平滑，snap 時與邏輯座標相同
    this._root.x = W     / 2 - (this._camVx + 0.5) * s;
    this._root.y = gameH / 2 - (this._camVy + 0.5) * s;
  }

  // ─── Getter ────────────────────────────────────────────────────────────────

  get tileSize()      { return this._tileSize; }
  // rootX/Y 從視覺浮點座標計算，確保 lerp 期間 input.setGridConfig 也正確
  get rootX() {
    const s = this._tileSize;
    return this._app.screen.width  / 2 - (this._camVx + 0.5) * s;
  }
  get rootY() {
    const s     = this._tileSize;
    const gameH = Math.floor(this._app.screen.height * 0.66);
    return gameH / 2 - (this._camVy + 0.5) * s;
  }
  get mapWidth()      { return this._W; }
  get mapHeight()     { return this._H; }
  get mapData()       { return this._mapData; }
  /** 本地圖的可見半徑（格數），預設 5；室內地圖可設 3。 */
  get visionRadius()  { return this._mapData?.visionRadius ?? 5; }

  // ─── 地圖轉場系統 ──────────────────────────────────────────────────────────

  /**
   * 執行地圖切換：淡出 → 載入新地圖 → 呼叫 onMidpoint → CRT 閃爍淡入。
   *
   * 使用範例（main.js）：
   *   input.lock();
   *   await mapManager.transitionTo(warp.targetMap, () => {
   *     player.gx = warp.targetGx;
   *     player.gy = warp.targetGy;
   *     mapManager.entityLayer.addChild(playerSpr);  // 必須重新掛上精靈
   *     syncPlayer();
   *     mapManager.updateFog(player.gx, player.gy, mapManager.visionRadius);
   *   });
   *   input.unlock();
   *
   * @param {string}   targetMapId  目標地圖 ID
   * @param {Function} onMidpoint   黑畫面期間更新玩家位置的 callback
   */
  async transitionTo(targetMapId, onMidpoint) {
    // ── Phase 1: 淡出 400ms ─────────────────────────────────────────────────
    await this._fadeOut(400);

    // ── Phase 2: 黑畫面 — 卸載 + 載入地圖 ──────────────────────────────────
    // 🔊 [SOUND HOOK] 在此播放門聲 / 腳步聲，例如：
    //    audioCtx.playSfx?.('door_open');
    await this.loadMap(targetMapId, true); // preserveEntities = true

    // ── 更新玩家位置（由外部注入） ──────────────────────────────────────────
    if (typeof onMidpoint === 'function') onMidpoint();

    // ── 強制渲染一次：確保相機在淡入前已正確定位 ─────────────────────────────
    // onMidpoint 呼叫 syncPlayer() → centerOn() 已標記 dirty，
    // 但若 ticker 曾消費 _isDirty，這裡補刷保險，防止黑畫面殘留。
    this._isDirty = true;
    this.render();

    // ── Phase 3: CRT 電源開機閃爍 + 淡入 600ms ──────────────────────────────
    await this._fadeIn(600);
  }

  /** 確保全螢幕黑色覆蓋層存在並置頂。 */
  _ensureOverlay() {
    if (!this._overlay) {
      this._overlay = new PIXI.Graphics();
      this._overlay.eventMode = 'static'; // 吸收所有 pointer 事件
      this._overlay.label     = 'transitionOverlay';
    }
    const W = this._app.screen.width;
    const H = this._app.screen.height;
    this._overlay.clear();
    this._overlay.rect(0, 0, W, H).fill({ color: 0x000000 });
    // 確保在最頂層
    if (!this._app.stage.children.includes(this._overlay)) {
      this._app.stage.addChild(this._overlay);
    } else {
      this._app.stage.setChildIndex(this._overlay, this._app.stage.children.length - 1);
    }
    return this._overlay;
  }

  /**
   * 以 Ticker 驅動的補間（Promise）。
   * @param {number}   durationMs  持續毫秒
   * @param {Function} onProgress  (t: 0→1) → void
   */
  _promiseTick(durationMs, onProgress) {
    return new Promise(resolve => {
      const start = performance.now();
      const handler = () => {
        const t = Math.min((performance.now() - start) / durationMs, 1);
        onProgress(t);
        if (t >= 1) {
          this._app.ticker.remove(handler);
          resolve();
        }
      };
      this._app.ticker.add(handler);
    });
  }

  /** 平滑淡出至全黑。 */
  async _fadeOut(duration = 400) {
    const ov = this._ensureOverlay();
    ov.alpha   = 0;
    ov.visible = true;
    await this._promiseTick(duration, t => { ov.alpha = t; });
    ov.alpha = 1;
  }

  /**
   * CRT 開機閃爍 + 平滑淡入。
   * 閃爍模擬陰極射線管通電瞬間的白光脈衝。
   */
  async _fadeIn(duration = 600) {
    const ov = this._ensureOverlay();
    ov.alpha = 1;

    // ── CRT 電源脈衝序列 ────────────────────────────────────────────────────
    // [alpha, 持續ms]：模擬 CRT 掃描線從無到有的不穩定閃爍
    const pulses = [
      [0.55, 30],  // 第一道掃描線（微亮）
      [0.95, 22],  // 退回黑暗
      [0.30, 28],  // 更強閃光
      [0.88, 20],  // 回暗
      [0.15, 35],  // 畫面漸穩
      [0.72, 18],  // 最後一次抖動
    ];
    for (const [alpha, ms] of pulses) {
      ov.alpha = alpha;
      await new Promise(r => setTimeout(r, ms));
    }

    // ── 平滑淡入（剩餘時間）──────────────────────────────────────────────────
    const flickerMs  = pulses.reduce((s, [, ms]) => s + ms, 0);
    const smoothMs   = Math.max(200, duration - flickerMs);
    const startAlpha = ov.alpha;
    await this._promiseTick(smoothMs, t => {
      ov.alpha = startAlpha * (1 - t);
    });
    ov.alpha   = 0;
    ov.visible = false;
  }

  // ─── 視窗縮放：重建視覺層（保留霧狀態）────────────────────────────────────

  /**
   * 視窗大小改變時呼叫。
   * 重新計算 tileSize → 清除並重建貼圖快取 + 渲染層 + 霧精靈（保留探索狀態）。
   * @param {number} playerGx  玩家當前格 X
   * @param {number} playerGy  玩家當前格 Y
   */
  onResize(playerGx, playerGy) {
    if (!this._mapData) return;

    const newSize = this._adaptTileSize(0);
    if (newSize === this._tileSize) return;   // 大小未變，不重建

    this._tileSize = newSize;
    this._isDirty  = true; // tileSize 改變，強制鏡頭重算（即使 camGx/Gy 未變）

    // 清除舊貼圖快取（支援單一貼圖與變體陣列）
    this._texCache.forEach(t => {
      if (Array.isArray(t)) t.forEach(v => v.destroy(true));
      else t.destroy(true);
    });
    this._texCache.clear();
    if (this._fogTex) { this._fogTex.destroy(true); this._fogTex = null; }

    // 重建地板 / 物件層
    this._groundLayer.removeChildren();
    this._objectLayer.removeChildren();
    this._buildTexCache();
    this._renderLayer(this._groundLayer, this._mapData.layers.ground,  'ground');
    this._renderLayer(this._objectLayer, this._mapData.layers.objects, 'object');
    this._buildWarpOverlays(); // 貼圖已快取，同步呼叫即可

    // 重建霧精靈（保留已探索狀態）
    this._rebuildFogSprites();

    // 重新置中
    this.centerOn(playerGx, playerGy);
  }

  /**
   * 依目前 _tileSize 重建霧精靈，並還原既有的 fog 狀態（HIDDEN / EXPLORED / VISIBLE）。
   */
  _rebuildFogSprites() {
    // 備份狀態
    const savedState = this._fogState ? new Uint8Array(this._fogState) : null;

    this._fogLayer.removeChildren();
    this._fogSprites = [];
    const s = this._tileSize;

    for (let y = 0; y < this._H; y++) {
      const row = [];
      for (let x = 0; x < this._W; x++) {
        const spr    = new PIXI.Sprite(this._fogTex);
        spr.x        = x * s;
        spr.y        = y * s;
        spr.width    = s;
        spr.height   = s;

        const state  = savedState ? savedState[y * this._W + x] : FOG.HIDDEN;
        spr.alpha    = FOG_ALPHA[state];
        spr.visible  = state !== FOG.VISIBLE;

        this._fogLayer.addChild(spr);
        row.push(spr);
      }
      this._fogSprites.push(row);
    }

    // 還原狀態陣列
    if (savedState) this._fogState = savedState;
  }

  // ─── 生命週期 ─────────────────────────────────────────────────────────────

  destroy() {
    this._clearMap();
    this._root.destroy({ children: true });
  }

  // ─── Static: 實體精靈工廠 ─────────────────────────────────────────────────

  /**
   * 根據 visuals.mapSprites[direction] 建立對應的精靈物件。
   *   - string[]（≥3 項）→ PIXI.AnimatedSprite，預設停在站立幀 [1]
   *   - string            → PIXI.Sprite
   * 貼圖必須已在 PIXI.Assets 快取中（先完成 PIXI.Assets.load）。
   *
   * @param {Object}  mapSprites  visuals.mapSprites 物件
   * @param {string}  direction   起始方向 'down'|'up'|'left'|'right'
   * @param {number}  tileSize    地圖 tile 大小（px）
   * @returns {PIXI.Sprite|PIXI.AnimatedSprite|null}
   */
  static createActorSprite(mapSprites, direction, tileSize) {
    const src = mapSprites?.[direction] ?? mapSprites?.down ?? null;
    if (!src) return null;

    const dispH = Math.floor(tileSize * 1.7);
    let spr;

    if (Array.isArray(src) && src.length >= 3) {
      const textures = src.map(p => PIXI.Assets.cache.get(p) ?? PIXI.Texture.WHITE);
      // 0 → 1 → 2 → 1 的循環幀序列
      spr = new PIXI.AnimatedSprite([textures[0], textures[1], textures[2], textures[1]]);
      spr.animationSpeed = 0.12;
      spr.loop           = true;
      spr.gotoAndStop(1); // 預設停在站立幀（index 1）
    } else {
      const path = Array.isArray(src) ? src[0] : src;
      spr = new PIXI.Sprite(PIXI.Assets.cache.get(path) ?? PIXI.Texture.WHITE);
    }

    // 以站立幀（index 1）高度為基準，用均等縮放保留各幀原始寬度
    const refTex = spr.textures ? spr.textures[1] : spr.texture;
    const scl    = refTex?.height ? (tileSize * 1.7) / refTex.height : 1;
    spr.scale.set(scl);
    spr.anchor.set(0.5, 1.0);
    return spr;
  }

  /**
   * 角色開始移動時呼叫：AnimatedSprite 開始播放行走動畫。
   * @param {PIXI.Sprite|PIXI.AnimatedSprite} sprite
   */
  static onActorMoveStart(sprite) {
    if (sprite instanceof PIXI.AnimatedSprite && !sprite.playing) {
      sprite.play();
    }
  }

  /**
   * 角色停止移動時呼叫：停止動畫並強制回到站立幀（index 1）。
   * @param {PIXI.Sprite|PIXI.AnimatedSprite} sprite
   */
  static onActorMoveEnd(sprite) {
    if (sprite instanceof PIXI.AnimatedSprite) {
      sprite.gotoAndStop(1);
    }
  }
}
