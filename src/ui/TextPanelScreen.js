/**
 * QU-DON | src/ui/TextPanelScreen.js
 * 通用文字面板（VFD 螢光綠風格）：備忘錄、隊伍人脈等「標題 + 多段文字」的全螢幕介面
 *
 * API：
 *   show({ title, subtitle?, sections: [{ heading, tag?, lines: [string] }], empty? })
 *   hide()
 *
 * 事件：
 *   'close' — Esc / Enter / 點「關閉」
 *
 * 操作：
 *   鍵盤 ↑↓ 捲動；滑鼠滾輪；手機上下拖曳
 */

const C = {
  bg:        0x000000,
  panel:     0x050F05,
  border:    0x00FF41,
  borderDim: 0x007A1E,
  text:      0x9CFFB4,
  heading:   0x00FF41,
  dim:       0x2A5C33,
  tag:       0xE6B200,
};

const FONT_MONO = '"VT323","Courier New",monospace';
const FONT_TC   = '"Noto Sans TC","Microsoft JhengHei",sans-serif';

export class TextPanelScreen extends PIXI.Container {

  /** @param {PIXI.Application} app */
  constructor(app) {
    super();
    this._app     = app;
    this._content = null;   // 目前顯示的資料
    this._scroll  = 0;
    this._maxScroll = 0;
    this.visible  = false;
    this.eventMode = 'static';

    this._bindKeyboard();
    this._bindResize();
  }

  // ─── 公開 API ──────────────────────────────────────────────────────────────

  show(content) {
    this._content = content;
    this._scroll  = 0;
    this._build();
    this.visible = true;
  }

  hide() {
    if (!this.visible) return;
    this.visible = false;
    this.emit('close');
  }

  // ─── 建置 ──────────────────────────────────────────────────────────────────

  _build() {
    for (const child of this.removeChildren()) child.destroy({ children: true });
    if (!this._content) return;

    const { width: W, height: H } = this._app.screen;
    const margin = Math.max(10, Math.floor(Math.min(W, H) * 0.04));
    const px = margin, py = margin;
    const pw = W - margin * 2;
    const ph = H - margin * 2;

    // 背景（吸收點擊，避免點到底下的地圖 / 面板）
    const bg = new PIXI.Graphics();
    bg.rect(0, 0, W, H).fill({ color: C.bg, alpha: 0.88 });
    bg.eventMode = 'static';
    this.addChild(bg);

    const frame = new PIXI.Graphics();
    frame.rect(px, py, pw, ph).fill({ color: C.panel });
    frame.rect(px, py, pw, ph).stroke({ color: C.border, width: 2 });
    frame.rect(px + 4, py + 4, pw - 8, ph - 8).stroke({ color: C.borderDim, width: 1 });
    this.addChild(frame);

    // 標題
    const titleSize = Math.max(16, Math.min(26, Math.floor(W * 0.05)));
    const title = new PIXI.Text({
      text: `-- ${this._content.title} --`,
      style: { fontFamily: FONT_TC, fontSize: titleSize, fontWeight: 'bold', fill: C.heading },
    });
    title.anchor.set(0.5, 0);
    title.x = W / 2;
    title.y = py + 14;
    this.addChild(title);

    let headerBottom = title.y + title.height + 6;
    if (this._content.subtitle) {
      const sub = new PIXI.Text({
        text: this._content.subtitle,
        style: { fontFamily: FONT_MONO, fontSize: Math.max(12, titleSize - 8), fill: C.dim },
      });
      sub.anchor.set(0.5, 0);
      sub.x = W / 2;
      sub.y = headerBottom;
      this.addChild(sub);
      headerBottom = sub.y + sub.height + 6;
    }

    // 關閉按鈕（底部）
    const btnH = Math.max(34, Math.floor(H * 0.06));
    const btnW = Math.min(pw - 24, 220);
    const btnX = (W - btnW) / 2;
    const btnY = py + ph - btnH - 12;
    this._buildCloseButton(btnX, btnY, btnW, btnH);

    // 內容區（可捲動、遮罩裁切）
    const areaX = px + 16;
    const areaY = headerBottom + 6;
    const areaW = pw - 32;
    const areaH = btnY - 10 - areaY;

    const body = new PIXI.Container();
    const fs   = Math.max(13, Math.min(17, Math.floor(W * 0.034)));
    let y = 0;

    const sections = this._content.sections ?? [];
    if (!sections.length) {
      const t = new PIXI.Text({
        text: this._content.empty ?? '（沒有內容）',
        style: { fontFamily: FONT_TC, fontSize: fs, fill: C.dim },
      });
      body.addChild(t);
      y = t.height;
    }

    for (const sec of sections) {
      const head = new PIXI.Text({
        text: `▌${sec.heading}`,
        style: { fontFamily: FONT_TC, fontSize: fs + 2, fontWeight: 'bold', fill: C.heading },
      });
      head.y = y;
      body.addChild(head);

      if (sec.tag) {
        const tag = new PIXI.Text({
          text: sec.tag,
          style: { fontFamily: FONT_TC, fontSize: fs - 2, fill: C.tag },
        });
        tag.anchor.set(1, 0);
        tag.x = areaW;
        tag.y = y + 3;
        body.addChild(tag);
      }
      y += head.height + 4;

      for (const line of sec.lines ?? []) {
        const t = new PIXI.Text({
          text: line,
          style: {
            fontFamily: FONT_TC, fontSize: fs, fill: C.text,
            wordWrap: true, wordWrapWidth: areaW - 14, breakWords: true, lineHeight: Math.floor(fs * 1.45),
          },
        });
        t.x = 14;
        t.y = y;
        body.addChild(t);
        y += t.height + 4;
      }
      y += Math.floor(fs * 0.9);
    }

    const mask = new PIXI.Graphics();
    mask.rect(areaX, areaY, areaW, areaH).fill({ color: 0xffffff });
    this.addChild(mask);
    body.mask = mask;
    body.x = areaX;
    this.addChild(body);

    this._body      = body;
    this._areaY     = areaY;
    this._maxScroll = Math.max(0, y - areaH);
    this._scroll    = Math.min(this._scroll, this._maxScroll);
    this._applyScroll();

    // 捲動提示
    if (this._maxScroll > 0) {
      const hint = new PIXI.Text({
        text: '↕',
        style: { fontFamily: FONT_MONO, fontSize: fs, fill: C.dim },
      });
      hint.anchor.set(1, 1);
      hint.x = px + pw - 10;
      hint.y = btnY - 4;
      this.addChild(hint);
    }

    this._bindDrag(bg, frame);
  }

  _buildCloseButton(x, y, w, h) {
    const btn = new PIXI.Container();
    btn.eventMode = 'static';
    btn.cursor    = 'pointer';
    btn.hitArea   = new PIXI.Rectangle(x - 4, y - 4, w + 8, h + 8);

    const g = new PIXI.Graphics();
    g.rect(x, y, w, h).fill({ color: 0x000000 });
    g.rect(x, y, w, h).stroke({ color: C.border, width: 1.5 });
    const t = new PIXI.Text({
      text: '✕  關閉',
      style: { fontFamily: FONT_TC, fontSize: Math.floor(h * 0.42), fill: C.heading },
    });
    t.anchor.set(0.5);
    t.x = x + w / 2;
    t.y = y + h / 2;
    btn.addChild(g, t);

    btn.on('pointerdown', (e) => e.stopPropagation());
    btn.on('pointertap',  () => this.hide());
    this.addChild(btn);
  }

  // ─── 捲動 ──────────────────────────────────────────────────────────────────

  _applyScroll() {
    if (this._body) this._body.y = this._areaY - this._scroll;
  }

  _scrollBy(dy) {
    this._scroll = Math.max(0, Math.min(this._maxScroll, this._scroll + dy));
    this._applyScroll();
  }

  _bindDrag(...targets) {
    let lastY = null;
    for (const t of targets) {
      t.eventMode = 'static';
      t.on('pointerdown', (e) => { lastY = e.global.y; });
      t.on('globalpointermove', (e) => {
        if (lastY === null) return;
        this._scrollBy(lastY - e.global.y);
        lastY = e.global.y;
      });
      t.on('pointerup',        () => { lastY = null; });
      t.on('pointerupoutside', () => { lastY = null; });
      t.on('wheel', (e) => this._scrollBy(e.deltaY * 0.5));
    }
  }

  // ─── 鍵盤 ──────────────────────────────────────────────────────────────────

  _bindKeyboard() {
    this._keyHandler = (e) => {
      if (!this.visible) return;
      const step = 40;
      switch (e.key) {
        case 'ArrowUp':   e.preventDefault(); this._scrollBy(-step); break;
        case 'ArrowDown': e.preventDefault(); this._scrollBy(step);  break;
        case 'Escape':
        case 'Enter':
          e.preventDefault();
          this.hide();
          break;
      }
    };
    window.addEventListener('keydown', this._keyHandler);
  }

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
