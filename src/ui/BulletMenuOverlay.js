/**
 * QU-DON | src/ui/BulletMenuOverlay.js
 * 暫停主選單 — 彈匣 + 子彈影像合成
 *
 * 素材：
 *   mag_base     彈匣外殼（含第一顆裝飾子彈）
 *   bullet_single 單顆子彈（每個選項各一張）
 *
 * 事件：
 *   'select'  ({ index, label })  選項被確認
 *   'close'                       Escape 關閉
 *
 * 使用：
 *   const menu = await BulletMenuOverlay.create(app);
 *   app.stage.addChild(menu);
 *   menu.on('select', ({ index, label }) => { ... });
 *   menu.on('close',  () => menu.hide());
 *   menu.show();
 */

// ── 選單選項 ──────────────────────────────────────────────────────────────
const MENU_LABELS = [
  '繼續生存', '狀態與專長', '隨身物資', '隊伍人脈',
  '備忘錄',   '系統設定',   '儲存進度', '放棄生存',
];

// ── 調校常數（對齊與尺寸微調區，改這裡即可）──────────────────────────────
const MAG_X_RATIO     = 0.62;  // 彈匣左邊緣佔螢幕寬的比例
const MAG_Y_RATIO     = 0.05;  // 彈匣頂端佔螢幕高的比例
const MAG_SCALE       = 1.0;   // 彈匣整體縮放（1.0 = 原始尺寸）
const START_Y_OFFSET  = 80;    // 第一顆互動子彈距彈匣頂端的 Y (px)
const BULLET_INNER_X  = 0.08;  // 子彈相對彈匣寬度的 X 偏移比例
const BULLET_GAP      = 4;     // 子彈之間的垂直間距 (px)
const BULLET_TEXT_X   = 14;    // 文字距子彈 Container 左側 (px)
const BULLET_FONT_SIZE = 11;   // 鋼印文字大小
// ─────────────────────────────────────────────────────────────────────────

export class BulletMenuOverlay extends PIXI.Container {

  /**
   * 素材須由呼叫端以 PIXI.Assets.load() 預載後再呼叫此方法。
   * 同步建立實例，從 PIXI 資源快取中取回已載入的紋理。
   * @param {PIXI.Application} app
   */
  static create(app) {
    return new BulletMenuOverlay(app);
  }

  /** @param {PIXI.Application} app */
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

    const { magSprite, magX, magY } = this._buildMag(W, H);
    const magW = magSprite.width;

    this._buildBullets(magX, magY, magW);

    // 預設游標在第一項
    this._applyCursor(0);
  }

  // ── 半透明遮罩 ──────────────────────────────────────────────────────────

  _buildDim(W, H) {
    const dim = new PIXI.Graphics();
    dim.rect(0, 0, W, H).fill({ color: 0x000000, alpha: 0.7 });
    dim.eventMode = 'static'; // 攔截背景點擊，避免穿透
    this.addChild(dim);
  }

  // ── 彈匣 Sprite ────────────────────────────────────────────────────────

  _buildMag(W, H) {
    const magX   = Math.floor(W * MAG_X_RATIO);
    const magY   = Math.floor(H * MAG_Y_RATIO);
    // PIXI.Assets.get() 同步取回已預載的紋理；未載入時回傳 undefined
    const magTex = PIXI.Assets.get('assets/ui/mag_base.png') ?? null;

    let magSprite;
    if (magTex) {
      magSprite = new PIXI.Sprite(magTex);
      magSprite.scale.set(MAG_SCALE);
    } else {
      // 素材缺失時的佔位色塊
      const ph = new PIXI.Graphics();
      ph.roundRect(0, 0, 90, Math.floor(H * 0.88), 10)
        .fill({ color: 0x1E1E1E })
        .stroke({ color: 0x555555, width: 2 });
      magSprite = ph;
    }

    magSprite.x = magX;
    magSprite.y = magY;
    this.addChild(magSprite);

    return { magSprite, magX, magY };
  }

  // ── 子彈選項列 ──────────────────────────────────────────────────────────

  _buildBullets(magX, magY, magW) {
    const bulletTex = PIXI.Assets.get('assets/ui/bullet_single.png') ?? null;
    const bulletW   = bulletTex ? bulletTex.width  : 130;
    const bulletH   = bulletTex ? bulletTex.height : 24;

    // X 定位：彈匣內側對齊（BULLET_INNER_X 比例處）
    const originX = magX + Math.floor(magW * BULLET_INNER_X);
    // Y 起點：跳過第一顆裝飾子彈
    let   originY = magY + START_Y_OFFSET;

    MENU_LABELS.forEach((label, i) => {
      // pivot 補償後的中心座標（_applyPress 直接操作這組值）
      const centerX = originX + bulletW / 2;
      const centerY = originY + bulletH / 2;

      const { container: c, sprite } =
        this._makeBulletItem(label, i, bulletTex, bulletW, bulletH, centerX, centerY);

      this._items.push({ container: c, sprite, baseX: centerX, baseY: centerY });
      this.addChild(c);

      originY += bulletH + BULLET_GAP;
    });
  }

  // ── 單顆子彈 Container ─────────────────────────────────────────────────

  _makeBulletItem(label, index, bulletTex, bulletW, bulletH, centerX, centerY) {
    const c = new PIXI.Container();

    // ★ pivot 設中心：確保 scale(0.95) 以中心為基準縮放
    c.pivot.set(bulletW / 2, bulletH / 2);
    c.x = centerX;
    c.y = centerY;

    c.eventMode = 'static';
    c.cursor    = 'pointer';

    // 子彈圖片 or 佔位；保留 Sprite 引用供 tint 特效使用
    let bulletSprite = null;
    if (bulletTex) {
      bulletSprite = new PIXI.Sprite(bulletTex);
      c.addChild(bulletSprite);
    } else {
      const ph = new PIXI.Graphics();
      ph.roundRect(0, 0, bulletW, bulletH, 4)
        .fill({ color: 0x7A6040 })
        .stroke({ color: 0xC4A55A, width: 1 });
      c.addChild(ph);
    }

    // 鋼印文字：Courier New + 深棕色，模擬金屬壓印
    const txt = new PIXI.Text({
      text: label,
      style: new PIXI.TextStyle({
        fontFamily:    '"Courier New", Courier, monospace',
        fontSize:      BULLET_FONT_SIZE,
        fontWeight:    'bold',
        fill:          0x2C1808,   // 深棕 — 鋼印感
        letterSpacing: 1.5,
      }),
    });
    txt.x = BULLET_TEXT_X;
    txt.y = Math.floor((bulletH - BULLET_FONT_SIZE) / 2);  // 垂直置中
    c.addChild(txt);

    // 預設微暗（非游標選中狀態）
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

  /**
   * 懸停增亮：
   *   Container alpha 0.75 → 1.0（整體透明度）
   *   Sprite tint  0xAAAAAA → 0xFFFFFF（色彩乘算，達金屬反光感）
   * 雙管齊下：不需要 ColorMatrixFilter，無額外 GPU pass
   */
  _applyHover(index, on) {
    const entry = this._items[index];
    if (!entry) return;
    const { container: c, sprite } = entry;
    c.alpha = on ? 1.0 : 0.75;
    if (sprite) sprite.tint = on ? 0xFFFFFF : 0xAAAAAA;
  }

  /**
   * 按壓下沉感：scale(0.95) + 右下位移 2px，模擬 Z 軸向內按壓
   * pivot 已設為中心，scale 不會偏向角落
   */
  _applyPress(index, down) {
    const entry = this._items[index];
    if (!entry) return;
    const { container: c, baseX, baseY } = entry;
    if (down) {
      c.scale.set(0.95);
      c.x = baseX + 2;  // 右偏（按壓感）
      c.y = baseY + 2;  // 下偏（按壓感）
    } else {
      c.scale.set(1.0);
      c.x = baseX;
      c.y = baseY;
    }
  }

  // ─── 游標管理 ─────────────────────────────────────────────────────────────

  _applyCursor(index) {
    // 清除前一游標的 hover 狀態
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
          // 短暫壓下動畫後觸發選中
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
