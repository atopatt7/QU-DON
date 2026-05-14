/**
 * QU-DON | src/ui/BulletMenuOverlay.js
 * 暫停主選單 — 彈匣 + 子彈影像合成（RWD 動態縮放版）
 *
 * 素材（由 main.js 預載）：
 *   assets/ui/mag_base.png      彈匣外殼（含第一顆裝飾子彈）
 *   assets/ui/bullet_single.png 單顆子彈
 *
 * 發出的具名事件：
 *   'resume'    繼續遊戲
 *   'status'    狀態與專長
 *   'inventory' 隨身物資
 *   'crew'      隊伍人脈
 *   'journal'   備忘錄
 *   'settings'  系統設定
 *   'save'      儲存進度
 *   'quit'      放棄生存
 *   'select'    所有確認動作的通用事件 ({ index, label, event })
 *   'close'     Escape 關閉
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
// ║  調校常數區 — 只改這裡，不需動其他程式碼                                 ║
// ║                                                                          ║
// ║  MAG_HEIGHT_RATIO  彈匣高度佔螢幕高度的比例（0.85 = 85%）               ║
// ║  MAX_BULLETS       彈匣總顯示子彈數（含裝飾彈，微調以填滿底部）          ║
// ║  START_Y_OFFSET    第一顆互動子彈距彈匣頂端 Y（原生 px，未縮放）         ║
// ║                    → 增大可讓起點更低，避開圖上自帶的第一顆子彈          ║
// ║  BULLET_INNER_X    子彈 X 插入彈匣的深度（彈匣原生寬度的比例）           ║
// ║  BULLET_GAP        子彈之間的垂直間距（原生 px，未縮放）                 ║
// ║  BULLET_FONT_SIZE  鋼印文字大小（固定 px，不受 targetScale 縮放）        ║
// ║  TEXT_X_RATIO      文字 X 起始位置（子彈縮放後寬度的比例）               ║
// ║                    → 0.30 落在黃銅彈殼區，避開彈頭                       ║
// ║  PRESS_OFFSET      按壓時的 XY 位移（原生 px，最終乘 targetScale 套用）  ║
// ╚══════════════════════════════════════════════════════════════════════════╝
const MAG_HEIGHT_RATIO = 0.85;
const MAX_BULLETS      = 12;
const START_Y_OFFSET   = 180;
const BULLET_INNER_X   = 0.08;
const BULLET_GAP       = 10;
const BULLET_FONT_SIZE = 16;
const TEXT_X_RATIO     = 0.30;
const PRESS_OFFSET     = 2;

export class BulletMenuOverlay extends PIXI.Container {

  /**
   * 素材須由 main.js 以 PIXI.Assets.load() 預載後再呼叫。
   * @param {PIXI.Application} app
   */
  static create(app) {
    return new BulletMenuOverlay(app);
  }

  /** @param {PIXI.Application} app */
  constructor(app) {
    super();
    this._app         = app;
    this._items       = [];   // [{ container, sprite, baseX, baseY }]
    this._cursor      = 0;
    this._targetScale = 1;    // 最新 targetScale，供 _applyPress 使用
    this._keyHandler  = null;

    this._build();
    this._bindResize();
    this._bindKeyboard();
  }

  // ─── 建置 ─────────────────────────────────────────────────────────────────

  _build() {
    const { width: W, height: H } = this._app.screen;
    this.removeChildren();
    this._items = [];

    this._buildDim(W, H);

    // ── 全域動態縮放：讓彈匣高度恰好佔螢幕 MAG_HEIGHT_RATIO ──────────────
    const magTex     = PIXI.Assets.get('assets/ui/mag_base.png') ?? null;
    const nativeMagW = magTex ? magTex.width  : 90;
    const nativeMagH = magTex ? magTex.height : Math.floor(H / MAG_HEIGHT_RATIO);

    const targetScale    = (H * MAG_HEIGHT_RATIO) / nativeMagH;
    this._targetScale    = targetScale;  // 存入實例，_applyPress 直接取用

    const scaledMagW = nativeMagW * targetScale;
    const scaledMagH = nativeMagH * targetScale;

    // 彈匣水平置中、垂直置中
    const magX = Math.floor((W - scaledMagW) / 2);
    const magY = Math.floor((H - scaledMagH) / 2);

    this._buildMag(magTex, magX, magY, targetScale, scaledMagW, scaledMagH);
    this._buildBullets(magX, magY, targetScale, nativeMagW);

    this._applyCursor(0);
  }

  // ── 半透明遮罩 ────────────────────────────────────────────────────────────

  _buildDim(W, H) {
    const dim = new PIXI.Graphics();
    dim.rect(0, 0, W, H).fill({ color: 0x000000, alpha: 0.7 });
    dim.eventMode = 'static';   // 攔截背景點擊，防止穿透
    this.addChild(dim);
  }

  // ── 彈匣 Sprite ───────────────────────────────────────────────────────────

  _buildMag(magTex, magX, magY, targetScale, scaledW, scaledH) {
    let magSprite;
    if (magTex) {
      magSprite = new PIXI.Sprite(magTex);
      magSprite.scale.set(targetScale);
    } else {
      // 素材缺失：繪製佔位色塊
      const ph = new PIXI.Graphics();
      ph.roundRect(0, 0, scaledW, scaledH, 10)
        .fill({ color: 0x1E1E1E })
        .stroke({ color: 0x555555, width: 2 });
      magSprite = ph;
    }
    magSprite.x = magX;
    magSprite.y = magY;
    this.addChild(magSprite);
    return magSprite;
  }

  // ── 子彈列（互動 + 裝飾填充）─────────────────────────────────────────────

  /**
   * @param {number} magX        彈匣縮放後 X 起點（世界座標）
   * @param {number} magY        彈匣縮放後 Y 起點（世界座標）
   * @param {number} targetScale 全域縮放倍率
   * @param {number} nativeMagW  彈匣原生寬度（px）
   */
  _buildBullets(magX, magY, targetScale, nativeMagW) {
    const bulletTex = PIXI.Assets.get('assets/ui/bullet_single.png') ?? null;
    const nativeBW  = bulletTex ? bulletTex.width  : 130;
    const nativeBH  = bulletTex ? bulletTex.height : 24;

    // 縮放後的子彈尺寸
    const scaledBW = nativeBW * targetScale;
    const scaledBH = nativeBH * targetScale;

    // X：彈匣原生寬度的 BULLET_INNER_X 比例，乘 targetScale → 世界座標
    const originX = magX + (nativeMagW * BULLET_INNER_X * targetScale);

    // Y：START_Y_OFFSET 原生 px × targetScale
    let originY = magY + (START_Y_OFFSET * targetScale);

    for (let i = 0; i < MAX_BULLETS; i++) {
      // 中心點：pivot 定位與 press 動畫的基準
      const centerX = originX + scaledBW / 2;
      const centerY = originY + scaledBH / 2;

      if (i < MENU_ITEMS.length) {
        // ── 互動子彈：帶彈體刻字、hover / press 動畫 ──────────────────
        const { container: c, sprite } = this._makeBulletItem(
          MENU_ITEMS[i], i,
          bulletTex, nativeBW, nativeBH, scaledBW, scaledBH,
          targetScale, centerX, centerY,
        );
        this._items.push({ container: c, sprite, baseX: centerX, baseY: centerY });
        this.addChild(c);
      } else if (bulletTex) {
        // ── 裝飾子彈：純視覺填充彈匣空間，不可互動 ────────────────────
        const deco     = new PIXI.Sprite(bulletTex);
        deco.scale.set(targetScale);
        deco.x         = originX;
        deco.y         = originY;
        deco.alpha     = 0.38;
        deco.tint      = 0x777777;
        deco.eventMode = 'none';
        this.addChild(deco);
      }

      originY += scaledBH + (BULLET_GAP * targetScale);
    }
  }

  // ── 單顆互動子彈 Container ────────────────────────────────────────────────

  /**
   * Container 結構：
   *   c（pivot 設縮放後中心 → press 以中心為軸，不產生位置跳動）
   *   ├── bulletSprite（scale.set(targetScale)，只縮圖片，保護文字解析度）
   *   └── txt（固定 BULLET_FONT_SIZE px，不受 targetScale 縮放）
   */
  _makeBulletItem(
    item, index,
    bulletTex, nativeW, nativeH, scaledW, scaledH,
    targetScale, centerX, centerY,
  ) {
    const c = new PIXI.Container();

    // pivot 設縮放後中心：scale(0.96) 時以中心點收縮，不偏移
    c.pivot.set(scaledW / 2, scaledH / 2);
    c.x = centerX;
    c.y = centerY;

    c.eventMode = 'static';
    c.cursor    = 'pointer';

    // ── 子彈圖片（個別縮放，保護 txt 尺寸）────────────────────────────
    let bulletSprite = null;
    if (bulletTex) {
      bulletSprite = new PIXI.Sprite(bulletTex);
      bulletSprite.scale.set(targetScale);
      c.addChild(bulletSprite);
    } else {
      // 素材缺失佔位
      const ph = new PIXI.Graphics();
      ph.roundRect(0, 0, scaledW, scaledH, 4)
        .fill({ color: 0x7A6040 })
        .stroke({ color: 0xC4A55A, width: 1 });
      c.addChild(ph);
    }

    // ── 彈體刻字（鋼印效果）────────────────────────────────────────────
    const txt = new PIXI.Text({
      text: item.label,
      style: new PIXI.TextStyle({
        fontFamily:    '"Courier New", Courier, monospace',
        fontSize:      BULLET_FONT_SIZE,   // 固定 px，不受 targetScale 影響
        fontWeight:    'bold',
        fill:          0x2e2013,           // 深棕 — 金屬鋼印色
        letterSpacing: 1.5,
      }),
    });
    txt.anchor.set(0, 0.5);             // 水平靠左，垂直以中線為基準
    txt.x = scaledW * TEXT_X_RATIO;     // 黃銅彈殼區（30%），避開彈頭
    txt.y = scaledH / 2;                // 對齊子彈縱向中線
    txt.alpha = 0.85;
    c.addChild(txt);

    // 預設微暗（非選中狀態）
    c.alpha = 0.75;
    if (bulletSprite) bulletSprite.tint = 0xAAAAAA;

    // ── 互動事件 ──────────────────────────────────────────────────────
    c.on('pointerover',      () => this._applyHover(index, true));
    c.on('pointerout',       () => { if (this._cursor !== index) this._applyHover(index, false); });
    c.on('pointerdown',      (e) => { e.stopPropagation(); this._applyPress(index, true); });
    c.on('pointerup',        () => { this._applyPress(index, false); this._select(index); });
    c.on('pointerupoutside', () => this._applyPress(index, false));
    c.on('pointercancel',    () => this._applyPress(index, false));

    return { container: c, sprite: bulletSprite };
  }

  // ─── 特效 ─────────────────────────────────────────────────────────────────

  /**
   * 懸停增亮：alpha 0.75 → 1.0 ＋ Sprite tint 0xAAAAAA → 0xFFFFFF
   * 雙管齊下，無需 ColorMatrixFilter，不增加 GPU pass
   */
  _applyHover(index, on) {
    const entry = this._items[index];
    if (!entry) return;
    const { container: c, sprite } = entry;
    c.alpha = on ? 1.0 : 0.75;
    if (sprite) sprite.tint = on ? 0xFFFFFF : 0xAAAAAA;
  }

  /**
   * Z 軸按壓感：
   *   scale(0.96)：pivot 在中心，縮放不產生位置偏移
   *   x / y += PRESS_OFFSET * targetScale：右下位移模擬實體鍵陷入感
   */
  _applyPress(index, down) {
    const entry = this._items[index];
    if (!entry) return;
    const { container: c, baseX, baseY } = entry;
    const offset = PRESS_OFFSET * this._targetScale;
    if (down) {
      c.scale.set(0.96);
      c.x = baseX + offset;
      c.y = baseY + offset;
    } else {
      c.scale.set(1.0);
      c.x = baseX;
      c.y = baseY;
    }
  }

  // ─── 游標管理 ─────────────────────────────────────────────────────────────

  _applyCursor(index) {
    this._applyHover(this._cursor, false);
    this._cursor = index;
    this._applyHover(index, true);
  }

  /**
   * 發出具名事件（如 'resume'）以及通用 'select' 事件。
   * main.js 可同時監聽具名事件與 'select'。
   */
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

  /** 顯示選單並重置游標至第一項 */
  show() {
    this.visible = true;
    this._applyCursor(0);
  }

  /** 隱藏選單 */
  hide() {
    this.visible = false;
  }

  destroy(opts) {
    if (this._keyHandler) window.removeEventListener('keydown', this._keyHandler);
    if (this._rh)         this._app.stage.off('resize', this._rh);
    super.destroy(opts);
  }
}
