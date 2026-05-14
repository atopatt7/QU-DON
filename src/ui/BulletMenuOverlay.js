/**
 * QU-DON | src/ui/BulletMenuOverlay.js
 * 暫停主選單 — 彈匣 + 子彈影像合成（RWD 動態縮放版）
 *
 * 素材（由 main.js 預載）：
 *   assets/ui/mag_base.png      彈匣外殼（背景含 9 顆子彈刻槽，第 1 顆為裝飾）
 *   assets/ui/bullet_single.png 單顆子彈（疊加在刻槽 2–9）
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
// ║  START_Y_OFFSET    第 1 顆互動子彈「中心點」距彈匣頂端的 Y（原生 px）    ║
// ║                    → 向下加大以對齊背景圖第 2 顆刻槽中心                  ║
// ║  BULLET_GAP_Y      相鄰子彈「中心點」之間的 Y 間距（原生 px）            ║
// ║                    → 含子彈高度 + 縫隙，需與背景圖刻槽間距一致           ║
// ║  BULLET_INNER_X    子彈 X 中心距彈匣左邊界的比例（彈匣原生寬度）         ║
// ╚══════════════════════════════════════════════════════════════════════════╝
const MAG_HEIGHT_RATIO = 0.85;  // 彈匣高度佔螢幕高度的比例
const START_Y_OFFSET   = 180;   // 第 1 顆互動子彈中心距彈匣頂端 Y（原生 px）
const BULLET_GAP_Y     = 65;    // 相鄰子彈中心點的 Y 間距（原生 px，含子彈高度）
const BULLET_INNER_X   = 0.50;  // 子彈 X 中心位於彈匣寬度的比例（0.5 = 置中）

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
    this._app        = app;
    this._items      = [];   // [{ btn, sprite }]
    this._cursor     = 0;
    this._keyHandler = null;

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

    // targetScale：統一縮放倍率，讓整組 UI 在任何解析度下等比縮放
    const targetScale = (H * MAG_HEIGHT_RATIO) / nativeMagH;

    const scaledMagW = nativeMagW * targetScale;
    const scaledMagH = nativeMagH * targetScale;

    // 彈匣水平 & 垂直置中
    const magX = Math.floor((W - scaledMagW) / 2);
    const magY = Math.floor((H - scaledMagH) / 2);

    this._buildMag(magTex, magX, magY, targetScale, scaledMagW, scaledMagH);
    this._buildBullets(magTex, magX, magY, targetScale, nativeMagW);

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

  // ── 8 顆互動子彈（疊加於背景刻槽 2–9）───────────────────────────────────

  /**
   * 座標系說明：
   *   btn.x / btn.y = 子彈「中心點」在世界座標的位置
   *   bulletSprite.anchor.set(0.5) → 圖片中心對齊 btn(0,0)
   *   text.anchor.set(0, 0.5)      → 文字垂直中線對齊 btn(0,0)
   *   text.x = 負值               → 往左偏移，對齊黃銅彈殼區
   *
   * @param {PIXI.Texture|null} magTex
   * @param {number} magX        彈匣縮放後 X 起點（世界座標）
   * @param {number} magY        彈匣縮放後 Y 起點（世界座標）
   * @param {number} targetScale 全域縮放倍率
   * @param {number} nativeMagW  彈匣原生寬度（px）
   */
  _buildBullets(magTex, magX, magY, targetScale, nativeMagW) {
    const bulletTex = PIXI.Assets.get('assets/ui/bullet_single.png') ?? null;

    MENU_ITEMS.forEach((item, index) => {
      // ── 計算子彈中心點（世界座標）──────────────────────────────────────
      // X：彈匣左邊界 + 彈匣寬度 × BULLET_INNER_X（比例）× targetScale
      const btnX = magX + (nativeMagW * BULLET_INNER_X * targetScale);

      // Y：彈匣頂端 + START_Y_OFFSET（原生 px）× targetScale
      //    + index × BULLET_GAP_Y（原生 px）× targetScale
      const btnY = magY
        + (START_Y_OFFSET * targetScale)
        + (index * BULLET_GAP_Y * targetScale);

      const { btn, sprite } = this._makeBulletItem(
        item, index, bulletTex, targetScale, btnX, btnY,
      );

      this._items.push({ btn, sprite });
      this.addChild(btn);
    });
  }

  // ── 單顆互動子彈 Container ────────────────────────────────────────────────

  /**
   * Container 結構（原點 = 子彈中心）：
   *   btn
   *   ├── bulletSprite  anchor(0.5)     → 圖片以中心點對齊原點，scale 縮放不偏移
   *   └── txt           anchor(0, 0.5)  → 文字垂直置中，水平從 text.x 起算
   *
   * Press 動畫：btn.scale.set(0.95) 以原點（子彈中心）為基準收縮
   *             → 不需要 pivot、不需要手動校正座標
   */
  _makeBulletItem(item, index, bulletTex, targetScale, btnX, btnY) {
    const btn = new PIXI.Container();

    // btn 的絕對位置 = 子彈中心點（世界座標）
    btn.x = btnX;
    btn.y = btnY;

    btn.eventMode = 'static';
    btn.cursor    = 'pointer';

    // ── 子彈圖片（anchor 0.5 → 中心對齊 btn 原點）────────────────────
    let sprite = null;
    if (bulletTex) {
      sprite = new PIXI.Sprite(bulletTex);
      sprite.anchor.set(0.5);         // 圖片中心 = btn(0,0)
      sprite.scale.set(targetScale);  // RWD 縮放
      btn.addChild(sprite);
    } else {
      // 素材缺失佔位（維持相同中心對齊）
      const nativeW = 130;
      const nativeH = 24;
      const ph = new PIXI.Graphics();
      ph.roundRect(
        -(nativeW * targetScale) / 2,
        -(nativeH * targetScale) / 2,
        nativeW * targetScale,
        nativeH * targetScale,
        4,
      ).fill({ color: 0x7A6040 }).stroke({ color: 0xC4A55A, width: 1 });
      btn.addChild(ph);
    }

    // ── 彈體刻字（鋼印效果）────────────────────────────────────────────
    // 因為 bulletSprite 中心在 (0,0)，左邊界在 -(nativeW/2 * targetScale)。
    // text.x = -(bulletTex.width / 2) * targetScale * 0.4
    //        = 左邊界往右移 60%（40% 留給彈頭，60% 開始是黃銅彈殼）
    const nativeW   = bulletTex ? bulletTex.width : 130;
    const fontSize  = Math.max(14, Math.round(20 * targetScale));  // RWD 字體

    const txt = new PIXI.Text({
      text: item.label,
      style: new PIXI.TextStyle({
        fontFamily:    '"Courier New", Courier, monospace',
        fontSize,                  // 隨 targetScale 縮放，確保任何解析度可讀
        fontWeight:    'bold',
        fill:          0x2e2013,   // 深棕 — 金屬鋼印色
        letterSpacing: 1,
      }),
    });
    txt.anchor.set(0, 0.5);                                  // 垂直置中，水平靠左
    txt.x = -((nativeW / 2) * targetScale) * 0.4;           // 對齊黃銅彈殼區
    txt.y = 0;                                               // 與子彈縱向中線齊平
    txt.alpha = 0.85;
    btn.addChild(txt);

    // 預設微暗（非選中狀態）
    btn.alpha = 0.75;
    if (sprite) sprite.tint = 0xAAAAAA;

    // ── 互動事件 ──────────────────────────────────────────────────────
    btn.on('pointerover',      () => this._applyHover(index, true));
    btn.on('pointerout',       () => { if (this._cursor !== index) this._applyHover(index, false); });
    btn.on('pointerdown',      (e) => { e.stopPropagation(); this._applyPress(index, true); });
    btn.on('pointerup',        () => { this._applyPress(index, false); this._select(index); });
    btn.on('pointerupoutside', () => this._applyPress(index, false));
    btn.on('pointercancel',    () => this._applyPress(index, false));

    return { btn, sprite };
  }

  // ─── 特效 ─────────────────────────────────────────────────────────────────

  /**
   * 懸停增亮：
   *   btn.alpha 0.75 → 1.0（整體透明度）
   *   sprite.tint 0xAAAAAA → 0xFFFFFF（子彈圖片亮度，無額外 GPU pass）
   */
  _applyHover(index, on) {
    const entry = this._items[index];
    if (!entry) return;
    entry.btn.alpha = on ? 1.0 : 0.75;
    if (entry.sprite) entry.sprite.tint = on ? 0xFFFFFF : 0xAAAAAA;
  }

  /**
   * Z 軸按壓感：
   *   btn.scale.set(0.95) — 以 btn 原點（子彈中心）為基準均勻收縮
   *   不需要手動校正 x / y，因為所有子物件皆以中心對齊原點
   */
  _applyPress(index, down) {
    const entry = this._items[index];
    if (!entry) return;
    entry.btn.scale.set(down ? 0.95 : 1.0);
  }

  // ─── 游標管理 ─────────────────────────────────────────────────────────────

  _applyCursor(index) {
    this._applyHover(this._cursor, false);
    this._cursor = index;
    this._applyHover(index, true);
  }

  /**
   * 發出具名事件（如 'resume'）+ 通用 'select' 事件。
   * main.js 可分別監聽各功能，也可統一用 'select' 處理。
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
