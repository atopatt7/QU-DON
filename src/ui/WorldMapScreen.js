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
    // 清除前一次的閃爍 ticker
    if (this._activeTickers) {
      this._activeTickers.forEach(t => this._app.ticker.remove(t));
      this._activeTickers = [];
    }
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

  // ── 地圖內容區 ───────────────────────────────────────────────────────────

  _buildMapArea(px, py, pw, ph) {
    const pad   = 12;
    const areaX = px + pad;
    const areaY = py + pad;
    const areaW = pw - pad * 2;
    const areaH = ph - pad * 2;

    // ── 底板 ──────────────────────────────────────────────────────────────
    const mapBg = new PIXI.Graphics();
    mapBg.roundRect(areaX, areaY, areaW, areaH, 3)
         .fill({ color: C.placeholder })
         .stroke({ color: C.borderDim, width: 1 });
    this.addChild(mapBg);

    // ── 格線 ──────────────────────────────────────────────────────────────
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

    // ── 角落裝飾 ──────────────────────────────────────────────────────────
    const corner = new PIXI.Graphics();
    const cs = 20;
    corner.moveTo(areaX + cs,           areaY + 2)           .lineTo(areaX + 2,           areaY + 2)           .lineTo(areaX + 2,           areaY + cs)           .stroke({ color: C.border, width: 1.5 });
    corner.moveTo(areaX + areaW - cs,   areaY + 2)           .lineTo(areaX + areaW - 2,   areaY + 2)           .lineTo(areaX + areaW - 2,   areaY + cs)           .stroke({ color: C.border, width: 1.5 });
    corner.moveTo(areaX + cs,           areaY + areaH - 2)   .lineTo(areaX + 2,           areaY + areaH - 2)   .lineTo(areaX + 2,           areaY + areaH - cs)   .stroke({ color: C.border, width: 1.5 });
    corner.moveTo(areaX + areaW - cs,   areaY + areaH - 2)   .lineTo(areaX + areaW - 2,   areaY + areaH - 2)   .lineTo(areaX + areaW - 2,   areaY + areaH - cs)   .stroke({ color: C.border, width: 1.5 });
    this.addChild(corner);

    // ── 地圖節點定義（西 → 東）────────────────────────────────────────────
    const mapNodes = [
      { id: 'map_hakka_street',           name: '哈卡街',     zone: 'ZONE-A' },
      { id: 'map_hakka_east_suburb',      name: '哈卡街東郊', zone: 'ZONE-B' },
      { id: 'map_black_rock_west_suburb', name: '黑石街西郊', zone: 'ZONE-C' },
      { id: 'map_black_rock_street',      name: '黑石街',     zone: 'ZONE-D' },
    ];
    const currentId = this._app.mapManager?.mapData?.id ?? null;

    // ── 節點佈局 ──────────────────────────────────────────────────────────
    const N      = mapNodes.length;
    const slotW  = areaW / N;
    const nodeW  = Math.min(120, Math.floor(slotW * 0.72));
    const nodeH  = Math.min(60,  Math.floor(areaH * 0.22));
    const nodeY  = areaY + Math.floor(areaH * 0.42);
    const lineY  = nodeY + Math.floor(nodeH / 2);
    const centers = mapNodes.map((_, i) =>
      areaX + Math.floor(slotW * i + slotW / 2)
    );

    // ── 連線 ──────────────────────────────────────────────────────────────
    const line = new PIXI.Graphics();
    line.moveTo(centers[0], lineY).lineTo(centers[N - 1], lineY)
        .stroke({ color: C.borderDim, width: 2 });
    this.addChild(line);

    // ── 節點 ──────────────────────────────────────────────────────────────
    const fs    = Math.max(10, Math.floor(Math.min(areaW, areaH) * 0.055));
    const fsSub = Math.max(8,  Math.floor(fs * 0.62));

    if (!this._activeTickers) this._activeTickers = [];

    for (let i = 0; i < N; i++) {
      const node   = mapNodes[i];
      const cx     = centers[i];
      const nx     = cx - Math.floor(nodeW / 2);
      const isHere = node.id === currentId;

      // 方框
      const box = new PIXI.Graphics();
      if (isHere) {
        box.roundRect(nx, nodeY, nodeW, nodeH, 3)
           .fill({ color: C.panel })
           .stroke({ color: C.border, width: 2 });
        // 緩慢呼吸閃爍
        let _t = 0;
        const ticker = (dt) => { _t += dt * 0.05; box.alpha = 0.72 + Math.sin(_t) * 0.28; };
        this._app.ticker.add(ticker);
        this._activeTickers.push(ticker);
      } else {
        box.roundRect(nx, nodeY, nodeW, nodeH, 3)
           .fill({ color: 0x020A02 })
           .stroke({ color: C.borderDim, width: 1 });
      }
      this.addChild(box);

      // ▼ 當前位置箭頭（節點上方）
      if (isHere) {
        const arrow = new PIXI.Text({
          text: '▼',
          style: new PIXI.TextStyle({ fontFamily: FONT_MONO, fontSize: fsSub, fill: C.border }),
        });
        arrow.anchor.set(0.5, 1);
        arrow.x = cx;
        arrow.y = nodeY - 4;
        this.addChild(arrow);
      }

      // 中文地名
      const nameTxt = new PIXI.Text({
        text: node.name,
        style: new PIXI.TextStyle({
          fontFamily: FONT_JP,
          fontSize: fs,
          fontWeight: isHere ? 'bold' : 'normal',
          fill: isHere ? C.title : C.borderDim,
        }),
      });
      nameTxt.anchor.set(0.5, 0.5);
      nameTxt.x = cx;
      nameTxt.y = nodeY + nodeH * 0.36;
      this.addChild(nameTxt);

      // Zone ID
      const zoneTxt = new PIXI.Text({
        text: node.zone,
        style: new PIXI.TextStyle({ fontFamily: FONT_MONO, fontSize: fsSub, fill: C.dim }),
      });
      zoneTxt.anchor.set(0.5, 0);
      zoneTxt.x = cx;
      zoneTxt.y = nodeY + nodeH * 0.62;
      this.addChild(zoneTxt);
    }

    // ── 座標裝飾（左下）──────────────────────────────────────────────────
    const coordTxt = new PIXI.Text({
      text: 'N 25°03\'  E 121°32\'',
      style: new PIXI.TextStyle({ fontFamily: FONT_MONO, fontSize: fsSub, fill: C.dim }),
    });
    coordTxt.x = areaX + 8;
    coordTxt.y = areaY + areaH - fsSub - 8;
    this.addChild(coordTxt);

    // ── SCAN 狀態（右下）─────────────────────────────────────────────────
    const activeNode = mapNodes.find(n => n.id === currentId);
    const scanTxt = new PIXI.Text({
      text: activeNode ? `SCAN: ${activeNode.zone} ACTIVE` : 'SCAN: OFFLINE',
      style: new PIXI.TextStyle({
        fontFamily: FONT_MONO,
        fontSize: fsSub,
        fill: activeNode ? C.border : C.dim,
      }),
    });
    scanTxt.anchor.set(1, 1);
    scanTxt.x = areaX + areaW - 8;
    scanTxt.y = areaY + areaH - 8;
    this.addChild(scanTxt);
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
    if (this._activeTickers) this._activeTickers.forEach(t => this._app.ticker.remove(t));
    if (this._keyHandler)    window.removeEventListener('keydown', this._keyHandler);
    if (this._rh)            this._app.stage.off('resize', this._rh);
    super.destroy(opts);
  }
}
