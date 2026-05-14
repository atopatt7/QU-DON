/**
 * QU-DON | src/ui/WorldMapScreen.js
 * 城市區域地圖 — 大地圖顯示框架（VFD 螢光綠風格）
 *
 * 事件：
 *   'close'  — 按 Escape、點擊關閉按鈕
 *
 * API：
 *   show() / hide()
 */

const C = {
  bg:       0x000000,
  panel:    0x050F05,
  border:   0x00FF41,
  borderDim:0x007A1E,
  title:    0x00FF41,
  dim:      0x2A5C33,
  scanline: 0x000000,
  placeholder: 0x1A3320,
};

const FONT_MONO = '"VT323","Courier New",monospace';
const FONT_JP   = '"Noto Sans TC","Microsoft JhengHei",sans-serif';

export class WorldMapScreen extends PIXI.Container {

  /** @param {PIXI.Application} app */
  constructor(app) {
    super();
    this._app        = app;
    this._keyHandler = null;

    this._build();
    this._bindResize();
    this._bindKeyboard();

    this.visible = false;
  }

  // ─── 公開 API ──────────────────────────────────────────────────────────────

  show() {
    this._build();
    this.visible = true;
  }

  hide() {
    this.visible = false;
    this.emit('close');
  }

  // ─── 建置（resize 時重建）────────────────────────────────────────────────

  _build() {
    const { width: W, height: H } = this._app.screen;
    this.removeChildren();

    this._buildDim(W, H);
    this._buildPanel(W, H);
  }

  // ── 全螢幕黑色半透明遮罩 ─────────────────────────────────────────────────

  _buildDim(W, H) {
    const dim = new PIXI.Graphics();
    dim.rect(0, 0, W, H).fill({ color: C.bg, alpha: 0.88 });
    dim.eventMode = 'static';
    this.addChild(dim);
  }

  // ── 主面板 ────────────────────────────────────────────────────────────────

  _buildPanel(W, H) {
    const panW = Math.min(W * 0.96, 820);
    const panH = Math.min(H * 0.92, 640);
    const panX = Math.floor((W - panW) / 2);
    const panY = Math.floor((H - panH) / 2);

    // ── 面板底色 + 雙邊框（外框螢光綠，內框暗綠）──────────────────────────
    const panel = new PIXI.Graphics();
    panel.roundRect(panX, panY, panW, panH, 4).fill({ color: C.panel });
    panel.roundRect(panX + 3, panY + 3, panW - 6, panH - 6, 3)
         .stroke({ color: C.borderDim, width: 1 });
    panel.roundRect(panX, panY, panW, panH, 4)
         .stroke({ color: C.border, width: 1.5 });

    // 掃描線
    for (let y = panY + 4; y < panY + panH - 4; y += 3) {
      panel.moveTo(panX + 4, y).lineTo(panX + panW - 4, y)
           .stroke({ color: C.scanline, width: 1, alpha: 0.08 });
    }
    this.addChild(panel);

    const titleH = Math.floor(panH * 0.09);
    this._buildTitleBar(panX, panY, panW, titleH);
    this._buildMapArea(panX, panY + titleH, panW, panH - titleH);
  }

  // ── 標題列（含關閉按鈕）──────────────────────────────────────────────────

  _buildTitleBar(px, py, pw, th) {
    const bar = new PIXI.Graphics();
    bar.rect(px, py, pw, th).fill({ color: 0x001A05 });
    bar.moveTo(px, py + th).lineTo(px + pw, py + th)
       .stroke({ color: C.border, width: 1 });
    this.addChild(bar);

    const fs = Math.max(11, Math.floor(th * 0.45));

    // 標題
    const title = new PIXI.Text({
      text: '-- 城市區域掃描 (CITY MAP) --',
      style: new PIXI.TextStyle({
        fontFamily: FONT_MONO,
        fontSize: fs, fontWeight: 'bold', fill: C.title,
      }),
    });
    title.anchor.set(0.5, 0.5);
    title.x = px + pw / 2;
    title.y = py + th / 2;
    this.addChild(title);

    // ── 關閉按鈕（手機觸控 + ESC 雙重支援）────────────────────────────────
    const btnW = Math.max(64, Math.floor(pw * 0.13));
    const btnH = Math.floor(th * 0.70);
    const btnX = px + pw - btnW - 8;
    const btnY = py + Math.floor((th - btnH) / 2);

    const btnBg = new PIXI.Graphics();
    btnBg.roundRect(btnX, btnY, btnW, btnH, 3)
         .fill({ color: 0x001A05 })
         .stroke({ color: C.borderDim, width: 1 });
    this.addChild(btnBg);

    const btnTxt = new PIXI.Text({
      text: '✕  關閉',
      style: new PIXI.TextStyle({
        fontFamily: FONT_MONO,
        fontSize: Math.max(9, Math.floor(btnH * 0.52)),
        fill: C.dim,
      }),
    });
    btnTxt.anchor.set(0.5, 0.5);
    btnTxt.x = btnX + btnW / 2;
    btnTxt.y = btnY + btnH / 2;
    this.addChild(btnTxt);

    const hitArea = new PIXI.Container();
    hitArea.eventMode = 'static';
    hitArea.cursor    = 'pointer';
    hitArea.hitArea   = new PIXI.Rectangle(btnX - 4, btnY - 4, btnW + 8, btnH + 8);
    hitArea.on('pointerover',  () => { btnBg.tint = 0x00FF41; btnTxt.tint = 0x00FF41; });
    hitArea.on('pointerout',   () => { btnBg.tint = 0xffffff; btnTxt.tint = 0xffffff; });
    hitArea.on('pointerdown',  (e) => e.stopPropagation());
    hitArea.on('pointerup',    () => this.hide());
    hitArea.on('pointertap',   () => this.hide());
    this.addChild(hitArea);
  }

  // ── 地圖內容區（目前為預留框架）─────────────────────────────────────────

  _buildMapArea(px, py, pw, ph) {
    const pad = 12;
    const areaX = px + pad;
    const areaY = py + pad;
    const areaW = pw - pad * 2;
    const areaH = ph - pad * 2;

    // 地圖底板
    const mapBg = new PIXI.Graphics();
    mapBg.roundRect(areaX, areaY, areaW, areaH, 3)
         .fill({ color: C.placeholder })
         .stroke({ color: C.borderDim, width: 1 });
    this.addChild(mapBg);

    // 格線（模擬地圖網格）
    const gridStep = Math.floor(Math.min(areaW, areaH) / 16);
    const grid = new PIXI.Graphics();
    for (let x = areaX; x <= areaX + areaW; x += gridStep) {
      grid.moveTo(x, areaY).lineTo(x, areaY + areaH)
          .stroke({ color: C.borderDim, width: 0.5, alpha: 0.3 });
    }
    for (let y = areaY; y <= areaY + areaH; y += gridStep) {
      grid.moveTo(areaX, y).lineTo(areaX + areaW, y)
          .stroke({ color: C.borderDim, width: 0.5, alpha: 0.3 });
    }
    this.addChild(grid);

    // 角落掃描光圈（裝飾）
    const corner = new PIXI.Graphics();
    const cs = 20;
    // 左上
    corner.moveTo(areaX + cs, areaY + 2).lineTo(areaX + 2, areaY + 2).lineTo(areaX + 2, areaY + cs)
          .stroke({ color: C.border, width: 1.5 });
    // 右上
    corner.moveTo(areaX + areaW - cs, areaY + 2).lineTo(areaX + areaW - 2, areaY + 2).lineTo(areaX + areaW - 2, areaY + cs)
          .stroke({ color: C.border, width: 1.5 });
    // 左下
    corner.moveTo(areaX + cs, areaY + areaH - 2).lineTo(areaX + 2, areaY + areaH - 2).lineTo(areaX + 2, areaY + areaH - cs)
          .stroke({ color: C.border, width: 1.5 });
    // 右下
    corner.moveTo(areaX + areaW - cs, areaY + areaH - 2).lineTo(areaX + areaW - 2, areaY + areaH - 2).lineTo(areaX + areaW - 2, areaY + areaH - cs)
          .stroke({ color: C.border, width: 1.5 });
    this.addChild(corner);

    // 預留文字
    const fs = Math.max(12, Math.floor(Math.min(areaW, areaH) * 0.06));
    const placeholder = new PIXI.Text({
      text: '[ 地圖系統建構中... ]',
      style: new PIXI.TextStyle({
        fontFamily: FONT_MONO,
        fontSize: fs, fill: C.border, alpha: 0.55,
      }),
    });
    placeholder.anchor.set(0.5, 0.5);
    placeholder.x = areaX + areaW / 2;
    placeholder.y = areaY + areaH / 2;
    placeholder.alpha = 0.45;
    this.addChild(placeholder);

    // 座標標示（左下角）
    const coordTxt = new PIXI.Text({
      text: 'N 25°03\'  E 121°32\'',
      style: new PIXI.TextStyle({
        fontFamily: FONT_MONO,
        fontSize: Math.max(9, Math.floor(fs * 0.62)),
        fill: C.dim,
      }),
    });
    coordTxt.x = areaX + 8;
    coordTxt.y = areaY + areaH - coordTxt.style.fontSize - 8;
    this.addChild(coordTxt);

    // 掃描狀態標示（右下角）
    const statusTxt = new PIXI.Text({
      text: 'SCAN: PENDING',
      style: new PIXI.TextStyle({
        fontFamily: FONT_MONO,
        fontSize: Math.max(9, Math.floor(fs * 0.62)),
        fill: C.dim,
      }),
    });
    statusTxt.anchor.set(1, 1);
    statusTxt.x = areaX + areaW - 8;
    statusTxt.y = areaY + areaH - 8;
    this.addChild(statusTxt);
  }

  // ─── 鍵盤 ─────────────────────────────────────────────────────────────────

  _bindKeyboard() {
    this._keyHandler = (e) => {
      if (!this.visible) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        this.hide();
      }
    };
    window.addEventListener('keydown', this._keyHandler);
  }

  // ─── Resize ───────────────────────────────────────────────────────────────

  _bindResize() {
    this._rh = () => { if (this.visible) this._build(); };
    this._app.stage.on('resize', this._rh);
  }

  destroy(opts) {
    if (this._keyHandler) window.removeEventListener('keydown', this._keyHandler);
    if (this._rh)         this._app.stage.off('resize', this._rh);
    super.destroy(opts);
  }
}
