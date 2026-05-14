/**
 * QU-DON | src/ui/BulletMenuOverlay.js
 * 暫停主選單 — 彈匣 + 子彈影像合成（RWD 動態縮放版）
 *
 * 素材：
 *   assets/ui/mag_base.png      彈匣外殼（含第一顆裝飾子彈）
 *   assets/ui/bullet_single.png 單顆子彈（每個選項各一張）
 *
 * 事件：
 *   'select'  ({ index, label })  選項被確認
 *   'close'                       Escape 關閉
 */

// ── 選單選項 ──────────────────────────────────────────────────────────────────
const MENU_LABELS = [
  '繼續生存', '狀態與專長', '隨身物資', '隊伍人脈',
  '備忘錄',   '系統設定',   '儲存進度', '放棄生存',
];

// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  調校常數區 — 只需改這裡，不用動其他程式碼                              ║
// ║                                                                          ║
// ║  MAG_HEIGHT_RATIO  彈匣高度佔螢幕高度的比例（0.85 = 85%）               ║
// ║  START_Y_OFFSET    第一顆互動子彈距彈匣頂端的 Y（原生像素，未縮放）      ║
// ║                    → 向下加大此值可讓子彈起點更低                        ║
// ║  BULLET_INNER_X    子彈 X 軸插入彈匣的深度                              ║
// ║                    （彈匣原生寬度的比例，0.08 = 從左 8% 處開始）         ║
// ║  BULLET_GAP        子彈之間的垂直間距（原生像素，未縮放）                ║
// ║  BULLET_TEXT_X     文字距子彈左側的 X（原生像素，未縮放）               ║
// ║  BULLET_FONT_SIZE  鋼印文字大小（固定 px，不隨 scale 縮放）             ║
// ╚══════════════════════════════════════════════════════════════════════════╝
const MAG_HEIGHT_RATIO  = 0.85;  // 彈匣高度佔螢幕高度的比例
const START_Y_OFFSET    = 120;   // 第一顆子彈距彈匣頂端 Y（原生 px）
const BULLET_INNER_X    = 0.08;  // 子彈插入彈匣的 X 比例
const BULLET_GAP        = 6;     // 子彈間距（原生 px）
const BULLET_TEXT_X     = 14;    // 文字距子彈左側 X（原生 px）
const BULLET_FONT_SIZE  = 16;    // 鋼印文字固定大小（px）

export class BulletMenuOverlay extends PIXI.Container {

  static create(app) {
    return new BulletMenuOverlay(app);
  }

  constructor(app) {
    super();
    this._app        = app;
    this._items      = [];   // [{ container, sprite, baseX, baseY }]
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

    // ── 計算全域動態縮放 ──────────────────────────────────────────────────
    const magTex     = PIXI.Assets.get('assets/ui/mag_base.png') ?? null;
    const nativeMagW = magTex ? magTex.width  : 90;
    const nativeMagH = magTex ? magTex.height : Math.floor(H / MAG_HEIGHT_RATIO);

    // targetScale：讓彈匣高度恰好佔螢幕 MAG_HEIGHT_RATIO，手機 / PC 通用
    const targetScale = (H * MAG_HEIGHT_RATIO) / nativeMagH;

    const scaledMagW = nativeMagW * targetScale;
    const scaledMagH = nativeMagH * targetScale;

    // 彈匣置中對齊
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
    dim.eventMode = 'static';
    this.addChild(dim);
  }

  // ── 彈匣 Sprite ───────────────────────────────────────────────────────────

  _buildMag(magTex, magX, magY, targetScale, scaledW, scaledH) {
    let magSprite;
    if (magTex) {
      magSprite = new PIXI.Sprite(magTex);
      magSprite.scale.set(targetScale);
    } else {
      // 素材缺失：繪製佔位色塊（以縮放後尺寸填入）
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

  // ── 子彈選項列 ────────────────────────────────────────────────────────────

  /**
   * @param {PIXI.Texture|null} magTex
   * @param {number} magX       彈匣縮放後的 X 起點（世界座標）
   * @param {number} magY       彈匣縮放後的 Y 起點（世界座標）
   * @param {number} targetScale 全域縮放倍率
   * @param {number} nativeMagW  彈匣原生寬度（px）
   */
  _buildBullets(magTex, magX, magY, targetScale, nativeMagW) {
    const bulletTex  = PIXI.Assets.get('assets/ui/bullet_single.png') ?? null;
    const nativeBW   = bulletTex ? bulletTex.width  : 130;
    const nativeBH   = bulletTex ? bulletTex.height : 24;

    // 縮放後的子彈尺寸
    const scaledBW = nativeBW * targetScale;
    const scaledBH = nativeBH * targetScale;

    // X：彈匣原生寬度的 BULLET_INNER_X 比例處（乘 targetScale 轉成世界座標）
    const originX = magX + (nativeMagW * BULLET_INNER_X * targetScale);

    // Y：START_Y_OFFSET 為原生像素，乘 targetScale 轉成世界座標
    let originY = magY + (START_Y_OFFSET * targetScale);

    MENU_LABELS.forEach((label, i) => {
      // 中心點：用於 pivot 定位與 press 動畫基準
      const centerX = originX + scaledBW / 2;
      const centerY = originY + scaledBH / 2;

      const { container: c, sprite } = this._makeBulletItem(
        label, i, bulletTex,
        nativeBW, nativeBH, scaledBW, scaledBH,
        targetScale, centerX, centerY,
      );

      this._items.push({ container: c, sprite, baseX: centerX, baseY: centerY });
      this.addChild(c);

      // BULLET_GAP 同樣以原生像素定義，乘 targetScale
      originY += scaledBH + (BULLET_GAP * targetScale);
    });
  }

  // ── 單顆子彈 Container ────────────────────────────────────────────────────

  /**
   * 架構：
   *   c（Container，pivot 設縮放後中心）
   *   ├── bulletSprite（scale.set(targetScale)，圖片個別縮放）
   *   └── txt（固定 fontSize，不隨 scale 變動，確保清晰可讀）
   *
   * press 動畫：c.scale.set(0.95)，pivot 在中心，不會產生位置偏移。
   */
  _makeBulletItem(
    label, index, bulletTex,
    nativeW, nativeH, scaledW, scaledH,
    targetScale, centerX, centerY,
  ) {
    const c = new PIXI.Container();

    // pivot 設為縮放後尺寸的中心 → scale(0.95) 以中心為軸，不偏移
    c.pivot.set(scaledW / 2, scaledH / 2);
    c.x = centerX;
    c.y = centerY;

    c.eventMode = 'static';
    c.cursor    = 'pointer';

    // ── 子彈圖片（個別縮放，不縮整個 Container 以保護文字尺寸）──────────
    let bulletSprite = null;
    if (bulletTex) {
      bulletSprite = new PIXI.Sprite(bulletTex);
      bulletSprite.scale.set(targetScale);  // 只縮圖片
      c.addChild(bulletSprite);
    } else {
      const ph = new PIXI.Graphics();
      ph.roundRect(0, 0, scaledW, scaledH, 4)
        .fill({ color: 0x7A6040 })
        .stroke({ color: 0xC4A55A, width: 1 });
      c.addChild(ph);
    }

    // ── 鋼印文字（固定 px，螢幕大小無論如何都清晰可讀）─────────────────
    const txt = new PIXI.Text({
      text: label,
      style: new PIXI.TextStyle({
        fontFamily:    '"Courier New", Courier, monospace',
        fontSize:      BULLET_FONT_SIZE,   // 固定，不受 targetScale 影響
        fontWeight:    'bold',
        fill:          0x2C1808,           // 深棕 — 鋼印感
        letterSpacing: 1.5,
      }),
    });
    // X：原生偏移量 × targetScale，對齊縮放後的彈殼位置
    txt.x = BULLET_TEXT_X * targetScale;
    // Y：縮放後子彈高度內垂直置中
    txt.y = Math.floor((scaledH - BULLET_FONT_SIZE) / 2);
    c.addChild(txt);

    // 預設微暗
    c.alpha = 0.75;
    if (bulletSprite) bulletSprite.tint = 0xAAAAAA;

    // ── 互動事件 ──────────────────────────────────────────────────────────
    c.on('pointerover',      () => this._applyHover(index, true));
    c.on('pointerout',       () => { if (this._cursor !== index) this._applyHover(index, false); });
    c.on('pointerdown',      (e) => { e.stopPropagation(); this._applyPress(index, true); });
    c.on('pointerup',        () => { this._applyPress(index, false); this._select(index); });
    c.on('pointerupoutside', () => this._applyPress(index, false));
    c.on('pointercancel',    () => this._applyPress(index, false));

    return { container: c, sprite: bulletSprite };
  }

  // ─── 特效 ─────────────────────────────────────────────────────────────────

  _applyHover(index, on) {
    const entry = this._items[index];
    if (!entry) return;
    const { container: c, sprite } = entry;
    c.alpha = on ? 1.0 : 0.75;
    if (sprite) sprite.tint = on ? 0xFFFFFF : 0xAAAAAA;
  }

  /**
   * 按壓動畫：scale(0.95) 以 pivot（中心）為基準縮放，無需位移補償。
   * 移除舊版的 +2px offset（pivot 中心化後不需要）。
   */
  _applyPress(index, down) {
    const entry = this._items[index];
    if (!entry) return;
    entry.container.scale.set(down ? 0.95 : 1.0);
  }

  // ─── 游標管理 ─────────────────────────────────────────────────────────────

  _applyCursor(index) {
    this._applyHover(this._cursor, false);
    this._cursor = index;
    this._applyHover(index, true);
  }

  _select(index) {
    this.emit('select', { index, label: MENU_LABELS[index] });
  }

  // ─── 鍵盤 ─────────────────────────────────────────────────────────────────

  _bindKeyboard() {
    this._keyHandler = (e) => {
      if (!this.visible) return;
      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault();
          this._applyCursor((this._cursor - 1 + MENU_LABELS.length) % MENU_LABELS.length);
          break;
        case 'ArrowDown':
          e.preventDefault();
          this._applyCursor((this._cursor + 1) % MENU_LABELS.length);
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
