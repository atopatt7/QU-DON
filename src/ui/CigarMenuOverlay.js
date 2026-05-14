/**
 * QU-DON | src/ui/CigarMenuOverlay.js
 * 主選單 — 雪茄盒 + 雪茄影像合成（RWD 動態縮放版）
 *
 * 素材（由 main.js 預載）：
 *   assets/ui/cigar_box.png     雪茄盒外殼（背景）
 *   assets/ui/cigar_single.png  單支雪茄（疊加於盒內刻槽）
 *
 * 發出的具名事件：
 *   'resume' | 'status' | 'inventory' | 'crew'
 *   'journal' | 'settings' | 'save' | 'quit'
 *   'select'  通用事件 ({ index, label, event })
 *   'close'   Escape 關閉
 */

// ── 選單項目定義 ───────────────────────────────────────────────────────────────
const MENU_ITEMS = [
  { label: '繼續遊戲', event: 'resume'    },
  { label: '狀態與專長', event: 'status'    },
  { label: '隨身物資', event: 'inventory' },
  { label: '隊伍人脈', event: 'crew'      },
  { label: '備忘錄',   event: 'journal'   },
  { label: '系統設定', event: 'settings'  },
  { label: '儲存進度', event: 'save'      },
  { label: '放棄生存', event: 'quit'      },
];

// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  美術提供的精確幾何常數 — 對應 cigar_box.png 內框尺寸                    ║
// ║                                                                          ║
// ║  BOX_INNER_OFFSET_X   盒子左邊界到第一支雪茄左緣的內縮距離（原生 px）    ║
// ║  BOX_INNER_OFFSET_Y   盒子上邊界到第一支雪茄上緣的內縮距離（原生 px）    ║
// ║  BOX_INNER_WIDTH      盒子內部可排列雪茄的總寬度（原生 px）               ║
// ║  CIGAR_NATIVE_WIDTH   cigar_single.png 的原生寬度（px）                  ║
// ║  CIGAR_NATIVE_HEIGHT  cigar_single.png 的原生高度（px）                  ║
// ║                                                                          ║
// ║  BOX_HEIGHT_RATIO     雪茄盒高度佔螢幕高度的比例（0.85 = 85%）           ║
// ╚══════════════════════════════════════════════════════════════════════════╝
const BOX_INNER_OFFSET_X  = 50;
const BOX_INNER_OFFSET_Y  = 60;
const BOX_INNER_WIDTH     = 789;
const CIGAR_NATIVE_WIDTH  = 1887;
const CIGAR_NATIVE_HEIGHT = 294;

const BOX_HEIGHT_RATIO    = 0.85;

// 10 支雪茄：前 8 支互動，後 2 支純裝飾（填滿盒底）
const TOTAL_CIGARS  = 10;
const ACTIVE_CIGARS = MENU_ITEMS.length; // 8

// 雪茄高度壓縮比（寬度不變，高度乘以此值讓 10 支剛好塞進盒內）
const CIGAR_HEIGHT_SQUEEZE = 0.9;

const PRESS_SCALE     = 0.96;       // Z 軸下沉按壓深度
const HOVER_TINT      = 0xffe8b0;   // 暖金高光
const DEFAULT_TINT    = 0xffffff;
const DECO_TINT       = 0xb8956a;   // 裝飾雪茄的暗棕色
const TEXT_COLOR_GOLD = 0xd4af37;   // 茄標金色
const TEXT_X_RATIO    = -0.18;      // 文字中心距雪茄中心的 X 偏移（負 = 向左偏，對準茄標位置）

export class CigarMenuOverlay extends PIXI.Container {

  static create(app) {
    return new CigarMenuOverlay(app);
  }

  /** @param {PIXI.Application} app */
  constructor(app) {
    super();
    this._app        = app;
    this._items      = [];  // [{ btn, cigar }]
    this._cursor     = 0;
    this._keyHandler = null;

    this._build();
    this._bindResize();
    this._bindKeyboard();
  }

  // ─── 建置（resize 時重建）────────────────────────────────────────────────

  _build() {
    const { width: W, height: H } = this._app.screen;
    this.removeChildren();
    this._items = [];

    this._buildDim(W, H);

    const boxTex   = PIXI.Assets.get('assets/ui/cigar_box.png')    ?? null;
    const cigarTex = PIXI.Assets.get('assets/ui/cigar_single.png') ?? null;

    // ── 全域縮放：讓盒子高度佔螢幕 BOX_HEIGHT_RATIO ──────────────────────────
    const boxNativeW = boxTex ? boxTex.width  : 900;
    const boxNativeH = boxTex ? boxTex.height : Math.floor(H / BOX_HEIGHT_RATIO);
    const boxScale   = (H * BOX_HEIGHT_RATIO) / boxNativeH;

    // 盒子以螢幕左上角定位（與彈匣版邏輯一致，非置中 anchor）
    const scaledBoxW = boxNativeW * boxScale;
    const scaledBoxH = boxNativeH * boxScale;
    const boxX = Math.floor((W - scaledBoxW) / 2);  // 盒子左上角 X
    const boxY = Math.floor((H - scaledBoxH) / 2);  // 盒子左上角 Y

    this._buildBox(boxTex, boxX, boxY, boxScale, scaledBoxW, scaledBoxH);
    this._buildCigars(cigarTex, boxX, boxY, boxScale);
    this._applyCursor(0);
  }

  // ── 半透明遮罩 ────────────────────────────────────────────────────────────

  _buildDim(W, H) {
    const dim = new PIXI.Graphics();
    dim.rect(0, 0, W, H).fill({ color: 0x000000, alpha: 0.75 });
    dim.eventMode = 'static';
    this.addChild(dim);
  }

  // ── 雪茄盒 Sprite ─────────────────────────────────────────────────────────

  _buildBox(boxTex, boxX, boxY, boxScale, scaledW, scaledH) {
    let boxSprite;
    if (boxTex) {
      boxSprite = new PIXI.Sprite(boxTex);
      boxSprite.scale.set(boxScale);
    } else {
      // 素材缺失佔位
      const ph = new PIXI.Graphics();
      ph.roundRect(0, 0, scaledW, scaledH, 14)
        .fill({ color: 0x2a1a0a })
        .stroke({ color: 0x8b6914, width: 3 });
      boxSprite = ph;
    }
    boxSprite.x = boxX;
    boxSprite.y = boxY;
    this.addChild(boxSprite);
    return boxSprite;
  }

  // ── 雪茄迴圈（8 互動 + 2 裝飾）────────────────────────────────────────────

  /**
   * 精確排版公式（嚴格依美術常數）：
   *
   *   cigarLocalScale = BOX_INNER_WIDTH / CIGAR_NATIVE_WIDTH
   *                   → 雪茄寬度剛好塞滿盒子內框
   *
   *   finalCigarScale = cigarLocalScale × boxScale
   *                   → 隨全域縮放同步
   *
   *   startX = boxX + BOX_INNER_OFFSET_X×boxScale + (CIGAR_NATIVE_WIDTH×finalCigarScale)/2
   *          → 盒左邊界 + 內縮 + 雪茄半寬（anchor.set(0.5) 需補回中心）
   *
   *   startY = boxY + BOX_INNER_OFFSET_Y×boxScale + (CIGAR_NATIVE_HEIGHT×finalCigarScale)/2
   *   stepY  = CIGAR_NATIVE_HEIGHT × finalCigarScale
   *          → Y 間距剛好等於原生高度（緊密堆疊，無間隙）
   */
  _buildCigars(cigarTex, boxX, boxY, boxScale) {
    const cigarLocalScale = BOX_INNER_WIDTH / CIGAR_NATIVE_WIDTH;
    const finalCigarScale = cigarLocalScale * boxScale;

    const startX = boxX
                 + (BOX_INNER_OFFSET_X  * boxScale)
                 + (CIGAR_NATIVE_WIDTH  * finalCigarScale) / 2;

    // 高度乘上壓縮比，startY 的半高與 stepY 同步縮小
    const startY = boxY
                 + (BOX_INNER_OFFSET_Y  * boxScale)
                 + (CIGAR_NATIVE_HEIGHT * finalCigarScale * CIGAR_HEIGHT_SQUEEZE) / 2;

    const stepY = CIGAR_NATIVE_HEIGHT * finalCigarScale * CIGAR_HEIGHT_SQUEEZE;

    for (let i = 0; i < TOTAL_CIGARS; i++) {
      const isActive = i < ACTIVE_CIGARS;
      const item     = MENU_ITEMS[i] ?? null;

      const { btn, cigar } = this._makeCigarItem(
        item, i, isActive,
        cigarTex, finalCigarScale,
      );

      btn.x = startX;
      btn.y = startY + i * stepY;

      if (isActive) {
        this._items.push({ btn, cigar });
      }
      this.addChild(btn);
    }
  }

  // ── 單支雪茄 Container ────────────────────────────────────────────────────

  /**
   * 座標系（以雪茄中心為原點，anchor.set(0.5)）：
   *   cigar.anchor(0.5)     → 圖片中心 = btn(0, 0)
   *   txt.anchor(0.5, 0.5)  → 文字垂直水平置中，再以 TEXT_X_RATIO 偏向茄標
   *   Press：btn.scale.set(PRESS_SCALE) 從中心均勻收縮，不產生位移
   */
  _makeCigarItem(item, index, isActive, cigarTex, finalCigarScale) {
    const btn = new PIXI.Container();
    btn.eventMode = isActive ? 'static' : 'none';
    btn.cursor    = isActive ? 'pointer' : 'default';

    // ── 雪茄圖片 ──────────────────────────────────────────────────────────
    let cigar = null;
    if (cigarTex) {
      cigar = new PIXI.Sprite(cigarTex);
      cigar.anchor.set(0.5);
      cigar.scale.set(finalCigarScale, finalCigarScale * CIGAR_HEIGHT_SQUEEZE);
      btn.addChild(cigar);
    } else {
      // 素材缺失佔位（中心對齊）
      const scaledW = CIGAR_NATIVE_WIDTH  * finalCigarScale;
      const scaledH = CIGAR_NATIVE_HEIGHT * finalCigarScale * CIGAR_HEIGHT_SQUEEZE;
      const ph = new PIXI.Graphics();
      ph.roundRect(-scaledW / 2, -scaledH / 2, scaledW, scaledH, scaledH * 0.45)
        .fill({ color: 0x7a5c2e })
        .stroke({ color: 0xc49a38, width: 1.5 });
      cigar = ph;
      btn.addChild(ph);
    }

    // 裝飾雪茄：暗棕調、半透明，無文字
    if (!isActive) {
      if (cigar.tint !== undefined) cigar.tint = DECO_TINT;
      cigar.alpha = 0.55;
      return { btn, cigar };
    }

    // ── 茄標刻字 ──────────────────────────────────────────────────────────
    const scaledCigarH = CIGAR_NATIVE_HEIGHT * finalCigarScale * CIGAR_HEIGHT_SQUEEZE;
    const scaledCigarW = CIGAR_NATIVE_WIDTH  * finalCigarScale;
    const fontSize = Math.max(11, Math.round(scaledCigarH * 0.46));
    // Courier New 等寬字元寬 ≈ fontSize × 0.6，整體右移 4 個字元寬避開茄標圖案
    const charWidth = fontSize * 0.6;

    const txt = new PIXI.Text({
      text: item.label,
      style: new PIXI.TextStyle({
        fontFamily:    '"Courier New", Courier, monospace',
        fontSize,
        fontWeight:    'bold',
        fill:          TEXT_COLOR_GOLD,
        dropShadow:    true,
        dropShadowColor:    0x3b1a08,
        dropShadowDistance: 1.5,
        dropShadowAngle:    Math.PI / 4,
        dropShadowBlur:     2,
        letterSpacing: 2,
      }),
    });

    // 文字中心對準雪茄中心，再向左偏 TEXT_X_RATIO（對準茄標印刷區），並右移 4 字寬避開標籤
    txt.anchor.set(0.5, 0.5);
    txt.x = scaledCigarW * TEXT_X_RATIO + charWidth * 4;
    txt.y = 0;
    txt.alpha = 0.92;
    btn.addChild(txt);

    // 預設微暗（非游標狀態）
    btn.alpha = 0.72;
    if (cigar.tint !== undefined) cigar.tint = 0xbbbbbb;

    // ── 互動事件 ──────────────────────────────────────────────────────────
    btn.on('pointerover',      () => this._applyHover(index, true));
    btn.on('pointerout',       () => { if (this._cursor !== index) this._applyHover(index, false); });
    btn.on('pointerdown',      (e) => { e.stopPropagation(); this._applyPress(index, true); });
    btn.on('pointerup',        () => { this._applyPress(index, false); this._select(index); });
    btn.on('pointerupoutside', () => this._applyPress(index, false));
    btn.on('pointercancel',    () => this._applyPress(index, false));

    return { btn, cigar };
  }

  // ─── 特效 ─────────────────────────────────────────────────────────────────

  _applyHover(index, on) {
    const entry = this._items[index];
    if (!entry) return;
    entry.btn.alpha = on ? 1.0 : 0.72;
    if (entry.cigar?.tint !== undefined) {
      entry.cigar.tint = on ? HOVER_TINT : 0xbbbbbb;
    }
  }

  // btn 以雪茄中心為原點，scale 收縮不產生位移 → Z 軸下沉感
  _applyPress(index, down) {
    const entry = this._items[index];
    if (!entry) return;
    entry.btn.scale.set(down ? PRESS_SCALE : 1.0);
  }

  // ─── 游標管理 ─────────────────────────────────────────────────────────────

  _applyCursor(index) {
    this._applyHover(this._cursor, false);
    this._cursor = index;
    this._applyHover(index, true);
  }

  _select(index) {
    const item = MENU_ITEMS[index];
    if (!item) return;
    this.emit(item.event, { index, label: item.label });
    this.emit('select',   { index, label: item.label, event: item.event });
  }

  // ─── 鍵盤 ─────────────────────────────────────────────────────────────────

  _bindKeyboard() {
    this._keyHandler = (e) => {
      if (!this.visible) return;
      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault();
          this._applyCursor((this._cursor - 1 + MENU_ITEMS.length) % MENU_ITEMS.length);
          break;
        case 'ArrowDown':
          e.preventDefault();
          this._applyCursor((this._cursor + 1) % MENU_ITEMS.length);
          break;
        case 'Enter': {
          e.preventDefault();
          const idx = this._cursor;
          this._applyPress(idx, true);
          setTimeout(() => {
            this._applyPress(idx, false);
            this._select(idx);
          }, 120);
          break;
        }
        case 'Escape':
          e.preventDefault();
          this.emit('close');
          break;
      }
    };
    window.addEventListener('keydown', this._keyHandler);
  }

  // ─── Resize ───────────────────────────────────────────────────────────────

  _bindResize() {
    this._rh = () => this._build();
    this._app.stage.on('resize', this._rh);
  }

  // ─── 公開 API ─────────────────────────────────────────────────────────────

  show() {
    this.visible = true;
    this._applyCursor(0);
  }

  hide() {
    this.visible = false;
  }

  destroy(opts) {
    if (this._keyHandler) window.removeEventListener('keydown', this._keyHandler);
    if (this._rh)         this._app.stage.off('resize', this._rh);
    super.destroy(opts);
  }
}
