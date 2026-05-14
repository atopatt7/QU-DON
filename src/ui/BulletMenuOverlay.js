/**
 * QU-DON | src/ui/BulletMenuOverlay.js
 * 暫停主選單 — 彈匣 + 子彈影像合成（RWD 動態縮放版）
 *
 * 素材（由 main.js 預載）：
 *   assets/ui/mag_base.png      彈匣外殼（背景含 9 顆子彈刻槽，第 1 顆為裝飾）
 *   assets/ui/bullet_single.png 單顆子彈（疊加在刻槽 2–9）
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
// ║  調校常數區 — 只改這裡，不需動其他程式碼                                 ║
// ║                                                                          ║
// ║  MAG_HEIGHT_RATIO  彈匣高度佔螢幕高度的比例（0.85 = 85%）               ║
// ║                                                                          ║
// ║  START_Y_OFFSET    第 1 顆子彈中心距彈匣頂端的偏移（原生 px）            ║
// ║  ★ 方向規則：「負值 = 往彈匣內部向下」                                   ║
// ║    公式：btnY = magY − (START_Y_OFFSET × targetScale)                   ║
// ║    -200 → 彈匣頂端往下 200 原生 px                                       ║
// ║    -350 → 再往下移（往彈匣底部靠近）                                     ║
// ║    0    → 緊貼彈匣頂端                                                   ║
// ║    正值 → 會跑到彈匣上方（錯誤方向）                                     ║
// ║                                                                          ║
// ║  BULLET_GAP_EXTRA  子彈之間的額外間距（縮放後 px，不含子彈本身高度）     ║
// ║                    → 間距 = 子彈實際高度 + BULLET_GAP_EXTRA              ║
// ║                    → 設為 0 時緊密排列（無縫隙）                          ║
// ║                                                                          ║
// ║  BULLET_INNER_X    子彈 X 中心位於彈匣寬度的比例（0.5 = 水平置中）       ║
// ║                                                                          ║
// ║  BULLET_SCALE      子彈相對於 targetScale 的縮放倍率（0.8 = 原尺寸 80%） ║
// ║                                                                          ║
// ║  TEXT_START_RATIO  文字 X 起始位置（從子彈左邊界算起的比例）              ║
// ║                    0.28 = 子彈寬度 28% 處（黃銅彈殼入口）                ║
// ╚══════════════════════════════════════════════════════════════════════════╝
const MAG_HEIGHT_RATIO  = 0.85;
const START_Y_OFFSET    = -200;   // 負值 = 從彈匣頂端往下（加大絕對值往下移）
const BULLET_GAP_EXTRA  = 8;      // 子彈之間的額外間距（縮放後 px）
const BULLET_INNER_X    = 0.50;   // 子彈 X 中心（彈匣寬度比例）
const BULLET_SCALE      = 0.8;    // 子彈縮放倍率（相對於 targetScale）
const TEXT_START_RATIO  = 0.28;   // 文字 X 起始（子彈左邊界算起的比例）

export class BulletMenuOverlay extends PIXI.Container {

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

    const magTex     = PIXI.Assets.get('assets/ui/mag_base.png') ?? null;
    const nativeMagW = magTex ? magTex.width  : 90;
    const nativeMagH = magTex ? magTex.height : Math.floor(H / MAG_HEIGHT_RATIO);

    // targetScale：讓彈匣高度恰好佔螢幕 MAG_HEIGHT_RATIO
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
   * ★ Y 軸方向規則（與 START_Y_OFFSET 一致）：
   *   btnY = magY − (START_Y_OFFSET × targetScale)
   *
   *   START_Y_OFFSET 為負值時：
   *     − (負數) = + 正數 → magY 往「下」位移 → 進入彈匣內部 ✓
   *
   * ★ stepY 由子彈實際縮放高度動態計算，確保不重疊：
   *   stepY = 子彈縮放後高度 + BULLET_GAP_EXTRA
   */
  _buildBullets(magTex, magX, magY, targetScale, nativeMagW) {
    const bulletTex   = PIXI.Assets.get('assets/ui/bullet_single.png') ?? null;
    const nativeBW    = bulletTex ? bulletTex.width  : 130;
    const nativeBH    = bulletTex ? bulletTex.height : 50;

    // 子彈縮放 = targetScale × BULLET_SCALE
    const bulletScale = targetScale * BULLET_SCALE;
    const scaledBW    = nativeBW * bulletScale;
    const scaledBH    = nativeBH * bulletScale;

    // 間距 = 子彈實際高度 + 額外縫隙（確保不重疊）
    const stepY = scaledBH + BULLET_GAP_EXTRA;

    // X：彈匣左邊界 + 彈匣寬度 × BULLET_INNER_X × targetScale
    const btnX = magX + (nativeMagW * BULLET_INNER_X * targetScale);

    // Y 起點：負號讓 START_Y_OFFSET 負值 = 往彈匣內部向下
    //   magY − (START_Y_OFFSET × targetScale)
    //   = magY − (負數 × ts)
    //   = magY + 正數 → 往下進入彈匣 ✓
    const btnYBase = magY - (START_Y_OFFSET * targetScale);

    MENU_ITEMS.forEach((item, index) => {
      const btnY = btnYBase + (index * stepY);

      const { btn, sprite } = this._makeBulletItem(
        item, index,
        bulletTex, nativeBW, nativeBH, scaledBW, scaledBH,
        bulletScale, btnX, btnY,
      );

      this._items.push({ btn, sprite });
      this.addChild(btn);
    });
  }

  // ── 單顆互動子彈 Container ────────────────────────────────────────────────

  /**
   * 座標系（以子彈中心為原點）：
   *   bulletSprite.anchor(0.5)    → 圖片中心 = btn(0,0)
   *   txt.anchor(0, 0.5)          → 文字垂直置中，水平從 txt.x 開始
   *   txt.x = -(scaledBW/2) + scaledBW × TEXT_START_RATIO
   *          = 從子彈左邊界往右推 TEXT_START_RATIO（避開彈頭，進入彈殼區）
   *
   * Press：btn.scale.set(0.95) 以 btn 原點（子彈中心）均勻收縮，不產生位移
   */
  _makeBulletItem(
    item, index,
    bulletTex, nativeBW, nativeBH, scaledBW, scaledBH,
    bulletScale, btnX, btnY,
  ) {
    const btn = new PIXI.Container();
    btn.x = btnX;
    btn.y = btnY;
    btn.eventMode = 'static';
    btn.cursor    = 'pointer';

    // ── 子彈圖片 ──────────────────────────────────────────────────────────
    let sprite = null;
    if (bulletTex) {
      sprite = new PIXI.Sprite(bulletTex);
      sprite.anchor.set(0.5);          // 圖片中心 = btn(0,0)
      sprite.scale.set(bulletScale);   // targetScale × 0.8
      btn.addChild(sprite);
    } else {
      // 素材缺失佔位（維持相同中心對齊）
      const ph = new PIXI.Graphics();
      ph.roundRect(-scaledBW / 2, -scaledBH / 2, scaledBW, scaledBH, 4)
        .fill({ color: 0x7A6040 })
        .stroke({ color: 0xC4A55A, width: 1 });
      btn.addChild(ph);
    }

    // ── 彈體刻字 ──────────────────────────────────────────────────────────
    // 字體大小隨 bulletScale 縮放，確保 RWD 下清晰可讀
    const fontSize = Math.max(12, Math.round(18 * bulletScale));

    const txt = new PIXI.Text({
      text: item.label,
      style: new PIXI.TextStyle({
        fontFamily:    '"Courier New", Courier, monospace',
        fontSize,
        fontWeight:    'bold',
        fill:          0x2e2013,   // 深棕 — 金屬鋼印色
        letterSpacing: 1,
      }),
    });

    // 從子彈左邊界算起 TEXT_START_RATIO（避開彈頭，對齊黃銅彈殼）
    // sprite 以中心對齊，左邊界在 -(scaledBW/2)
    txt.anchor.set(0, 0.5);                          // 水平靠左，垂直置中
    txt.x = -(scaledBW / 2) + scaledBW * TEXT_START_RATIO;
    txt.y = 0;                                        // 與子彈中線齊平
    txt.alpha = 0.85;
    btn.addChild(txt);

    // 預設微暗（非選中狀態）
    btn.alpha = 0.75;
    if (sprite) sprite.tint = 0xAAAAAA;

    // ── 互動事件 ──────────────────────────────────────────────────────────
    btn.on('pointerover',      () => this._applyHover(index, true));
    btn.on('pointerout',       () => { if (this._cursor !== index) this._applyHover(index, false); });
    btn.on('pointerdown',      (e) => { e.stopPropagation(); this._applyPress(index, true); });
    btn.on('pointerup',        () => { this._applyPress(index, false); this._select(index); });
    btn.on('pointerupoutside', () => this._applyPress(index, false));
    btn.on('pointercancel',    () => this._applyPress(index, false));

    return { btn, sprite };
  }

  // ─── 特效 ─────────────────────────────────────────────────────────────────

  _applyHover(index, on) {
    const entry = this._items[index];
    if (!entry) return;
    entry.btn.alpha = on ? 1.0 : 0.75;
    if (entry.sprite) entry.sprite.tint = on ? 0xFFFFFF : 0xAAAAAA;
  }

  // btn 內部所有物件以中心對齊原點，scale 縮放不產生位移
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
