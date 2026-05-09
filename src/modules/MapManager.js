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

// ─── 程式繪製 Tile 調色盤（Noir 低飽和深色系）────────────────────────────────────
const TILE_PALETTE = {
  // ── Road (ground layer, IDs 1-5) ─────────────────────────────────────────
  1:  { base: 0x1c1c1c, hi: 0x242424, lo: 0x101010 }, // asphalt
  2:  { base: 0x161616, hi: 0x1c1c1c, lo: 0x080808 }, // cracked asphalt
  3:  { base: 0x1c1c1c, hi: 0x242424, lo: 0x101010 }, // asphalt + yellow center line
  4:  { base: 0x0c1018, hi: 0x141820, lo: 0x080c12 }, // asphalt + rain puddle
  5:  { base: 0x181818, hi: 0x202020, lo: 0x0c0c0c }, // asphalt + debris
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
    this.entityLayer  = new PIXI.Container(); // public，供 EntityManager
    this._fogLayer    = new PIXI.Container();

    this._root.addChild(
      this._groundLayer,
      this._objectLayer,
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
    this._texCache  = new Map();
    this._fogTex    = null;    // 霧用純黑貼圖

    // 轉場 Overlay（全螢幕淡黑遮罩）
    this._overlay   = null;
  }

  // ─── 工廠 ─────────────────────────────────────────────────────────────────

  static async create(app, gameLayer) {
    return new MapManager(app, gameLayer);
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

    console.log(`[MapManager] 載入 "${data.name}"  ${this._W}×${this._H}  tile=${this._tileSize}px  visionR=${this.visionRadius}`);

    this._buildTexCache();
    this._renderLayer(this._groundLayer, data.layers.ground,  'ground');
    this._renderLayer(this._objectLayer, data.layers.objects, 'object');
    this._buildFogLayer();
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
    if (!preserveEntities) this.entityLayer.removeChildren();
    this._fogLayer.removeChildren();

    this._texCache.forEach(t => t.destroy(true));
    this._texCache.clear();
    if (this._fogTex) { this._fogTex.destroy(true); this._fogTex = null; }

    this._fogState   = null;
    this._fogSprites = null;
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
      const gfx = this._drawTileGraphics(id, s);
      const tex = this._app.renderer.generateTexture({ target: gfx });
      this._texCache.set(id, tex);
      gfx.destroy();
    }

    // 霧用純黑貼圖
    const fogGfx = new PIXI.Graphics();
    fogGfx.rect(0, 0, s, s).fill({ color: 0x000000 });
    this._fogTex = this._app.renderer.generateTexture({ target: fogGfx });
    fogGfx.destroy();
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
      // ── Legacy interior (map_01 / map_neon_bar) ───────────────────────────
      case 6:  this._drawDumpster(gfx, s, pal);           break;
      case 7:  this._drawDoor(gfx, s, pal);               break;
      case 8:  this._drawGutter(gfx, s, pal);             break;
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

  // ─── 渲染層 ────────────────────────────────────────────────────────────────

  _renderLayer(container, tileArray, layerType) {
    container.removeChildren();
    const s = this._tileSize;

    for (let y = 0; y < this._H; y++) {
      for (let x = 0; x < this._W; x++) {
        const id = tileArray[y * this._W + x];
        if (id === 0) continue;

        const tex = this._texCache.get(id);
        if (!tex) continue;

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
   *
   * @param {number} gx
   * @param {number} gy
   */
  centerOn(gx, gy) {
    const s     = this._tileSize;
    const W     = this._app.screen.width;
    const H     = this._app.screen.height;
    const gameH = Math.floor(H * 0.66);

    // 玩家永遠置中於遊戲視野，不限制在地圖邊界內
    // 超出地圖範圍的區域顯示黑色（void tile / 霧視野遮蓋）
    this._root.x = W     / 2 - (gx + 0.5) * s;
    this._root.y = gameH / 2 - (gy + 0.5) * s;
  }

  // ─── Getter ────────────────────────────────────────────────────────────────

  get tileSize()      { return this._tileSize; }
  get rootX()         { return this._root.x; }
  get rootY()         { return this._root.y; }
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

    // 清除舊貼圖快取
    this._texCache.forEach(t => t.destroy(true));
    this._texCache.clear();
    if (this._fogTex) { this._fogTex.destroy(true); this._fogTex = null; }

    // 重建地板 / 物件層
    this._groundLayer.removeChildren();
    this._objectLayer.removeChildren();
    this._buildTexCache();
    this._renderLayer(this._groundLayer, this._mapData.layers.ground,  'ground');
    this._renderLayer(this._objectLayer, this._mapData.layers.objects, 'object');

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
}
