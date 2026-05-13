/**
 * QU-DON | src/ui/DialogueOverlay.js
 * 劇情對話系統 — 對應 Figma Screen 4
 *
 * 位置：螢幕下 1/3（疊在地圖上）
 * 包含：工業塑料框 + 四角螺絲 + 頭像框 + 打字機效果文字 + 選項列
 *
 * 事件：
 *   'next'          對話推進（打字機完成後點擊）
 *   'choice' (i)    選項被選擇
 */
export class DialogueOverlay extends PIXI.Container {
  /**
   * @param {PIXI.Application} app
   * @param {object}           opts
   *   { speaker: string,
   *     text:    string,
   *     choices: [{label: string}] }
   */
  constructor(app, opts = {}) {
    super();
    this._app       = app;
    this._opts      = opts;
    this._charIdx   = 0;
    this._typing    = false;
    this._ticker    = null;       // 保留欄位，destroy() 時清除舊訂閱
    this._typeTimer  = null;       // setTimeout handle（取代 ticker 打字機）
    this._isFrozen   = false;      // ⚡ 防護：cacheAsBitmap = true 只執行一次
    this._build();
    this._bindResize();
  }

  // ─── 建置 ──────────────────────────────────────────────────────────────────

  _build() {
    const { width: W, height: H } = this._app.screen;
    this.removeChildren();

    // ── 重置舊打字機 ──────────────────────────────────────────────────────────
    if (this._typeTimer) { clearTimeout(this._typeTimer); this._typeTimer = null; }
    if (this._ticker)    { this._ticker.destroy(); this._ticker = null; }

    // ── 解除 bitmap 快取（rebuild 期間容器內容會變動）───────────────────────
    this._isFrozen     = false;  // 重置凍結旗標
    this.cacheAsBitmap = false;

    const boxH  = Math.floor(H * 0.31);
    const boxY  = H - boxH - Math.floor(H * 0.018);
    const pad   = 12;
    const inner = W - pad * 2;   // frame 內寬

    // ── 暗化遮罩 ─────────────────────────────────────────────────────────
    const dim = new PIXI.Graphics();
    dim.rect(0, boxY - Math.floor(H * 0.04), W, H - (boxY - Math.floor(H * 0.04)))
       .fill({ color: 0x000000, alpha: 0.72 });
    this.addChild(dim);

    // ── 外框（工業塑料）────────────────────────────────────────────────────
    const frame = new PIXI.Graphics();
    frame.roundRect(pad, boxY, inner, boxH, 4).fill({ color: 0x111111 });
    frame.roundRect(pad, boxY, inner, boxH, 4).stroke({ color: 0x353535, width: 3 });
    frame.moveTo(pad + 4, boxY + 1.5).lineTo(W - pad - 4, boxY + 1.5)
         .stroke({ color: 0xFFFFFF, width: 0.8, alpha: 0.06 });
    this.addChild(frame);

    // ── 四角螺絲 ───────────────────────────────────────────────────────────
    [
      [pad + 10, boxY + 10],
      [W - pad - 10, boxY + 10],
      [pad + 10, boxY + boxH - 10],
      [W - pad - 10, boxY + boxH - 10],
    ].forEach(([sx, sy]) => {
      const s = new PIXI.Graphics();
      s.circle(sx, sy, 5).fill({ color: 0x282828 });
      s.circle(sx, sy, 5).stroke({ color: 0x1A1A1A, width: 1 });
      s.moveTo(sx - 3, sy).lineTo(sx + 3, sy).stroke({ color: 0x404040, width: 1 });
      s.moveTo(sx, sy - 3).lineTo(sx, sy + 3).stroke({ color: 0x404040, width: 1 });
      this.addChild(s);
    });

    // ── 頭像框 ─────────────────────────────────────────────────────────────
    const pSize = Math.min(Math.floor(boxH * 0.38), 78);
    const px    = pad + 16;
    const py    = boxY + 16;

    const pFrame = new PIXI.Graphics();
    pFrame.roundRect(px, py, pSize, pSize, 2).fill({ color: 0x1A1208 });
    pFrame.roundRect(px, py, pSize, pSize, 2).stroke({ color: 0x6B5020, width: 2 });
    this.addChild(pFrame);

    // 頭像佔位文字
    const pLabel = new PIXI.Text({
      text: '肖像',
      style: new PIXI.TextStyle({ fontFamily: '"Noto Sans TC","Microsoft JhengHei",sans-serif', fontSize: 9, fill: 0x6B5020 }),
    });
    pLabel.anchor.set(0.5);
    pLabel.x = px + pSize / 2;
    pLabel.y = py + pSize / 2;
    pLabel.alpha = 0.5;
    this.addChild(pLabel);

    // ── 說話者名稱標籤 ─────────────────────────────────────────────────────
    const speaker = this._opts.speaker ?? '???';
    const nameBg  = new PIXI.Graphics();
    nameBg.roundRect(px, py + pSize + 4, pSize, 22, 2)
          .fill({ color: 0x221A05 });
    nameBg.roundRect(px, py + pSize + 4, pSize, 22, 2)
          .stroke({ color: 0xE6B200, width: 1 });
    this.addChild(nameBg);

    const nameTxt = new PIXI.Text({
      text: speaker,
      style: new PIXI.TextStyle({
        fontFamily: '"Noto Sans TC","Microsoft JhengHei",sans-serif',
        fontSize: 12, fontWeight: 'bold', fill: 0xE6B200,
      }),
    });
    nameTxt.anchor.set(0.5);
    nameTxt.x = px + pSize / 2;
    nameTxt.y = py + pSize + 4 + 11;
    this.addChild(nameTxt);

    // ── 文字區 ─────────────────────────────────────────────────────────────
    const choices  = this._opts.choices ?? [];
    const hasChoice = choices.length > 0;
    const txX  = px + pSize + 12;
    const txW  = inner - pSize - 26;
    const txY  = boxY + 14;
    const txH  = hasChoice
      ? Math.floor(boxH * 0.45)
      : Math.floor(boxH * 0.60);

    const textBg = new PIXI.Graphics();
    textBg.roundRect(txX, txY, txW, txH, 2).fill({ color: 0x070707 });
    textBg.roundRect(txX, txY, txW, txH, 2).stroke({ color: 0x282828, width: 1 });
    this.addChild(textBg);

    this._textFull = this._opts.text ?? '……';
    this._charIdx  = 0;

    this._textNode = new PIXI.Text({
      text: '',
      style: new PIXI.TextStyle({
        fontFamily:    '"Noto Sans TC","Microsoft JhengHei",sans-serif',
        fontSize:      Math.min(Math.floor(W * 0.031), 12),
        fill:          0xDEDEDE,
        wordWrap:      true,
        wordWrapWidth: txW - 20,
        lineHeight:    20,
      }),
    });
    this._textNode.x = txX + 10;
    this._textNode.y = txY + 10;
    this.addChild(this._textNode);

    // ── 繼續提示 ▼ ───────────────────────────────────────────────────────
    this._prompt = new PIXI.Text({
      text: '▼',
      style: new PIXI.TextStyle({
        fontFamily: '"VT323","Courier New",monospace', fontSize: 14, fill: 0x00FF41,
      }),
    });
    this._prompt.x = W - pad - 20;
    this._prompt.y = txY + txH - 20;
    this._prompt.alpha = 0;
    this.addChild(this._prompt);

    // ── 選項列 ─────────────────────────────────────────────────────────────
    if (hasChoice) {
      const choiceStartY = boxY + txH + 28;
      const choiceBtnH   = Math.floor((boxH - txH - 38) / choices.length);

      choices.forEach((ch, i) => {
        const cb = this._makeChoice(ch.label, inner - 14, Math.max(choiceBtnH, 30), i === 0);
        cb.x = pad + 7;
        cb.y = choiceStartY + i * (Math.max(choiceBtnH, 30) + 4);
        cb.on('_tap', () => this.emit('choice', i));
        this.addChild(cb);
      });
    }

    // ── 全螢幕點擊區（打字機跳過） ────────────────────────────────────────
    this.eventMode = 'static';
    this.hitArea   = new PIXI.Rectangle(0, 0, W, H);
    this.once('pointerdown', () => this._skipOrNext());

    this._startTypewriter();
  }

  // ─── 打字機（setTimeout 版）─────────────────────────────────────────────────
  //
  //  ⚡ 效能重點：
  //    - 不再掛入 app.ticker（告別每幀 callback）
  //    - 改用 setTimeout，每 67ms 觸發一次（≤ 15 次/秒）
  //    - 每次推進 2 個字元，維持與原版（40ms/字）相近的閱讀速度
  //    - 打字完成後設 cacheAsBitmap = true，Pixi 將整個容器烘成一張靜態貼圖

  _startTypewriter() {
    this._charIdx = 0;
    this._typing  = true;

    const UPDATE_MS   = 67;   // ≈ 15 updates/sec 上限
    const CHARS_BATCH = 2;    // 每次推進字元數，感知速度 ≈ 30 字/秒

    const tick = () => {
      if (!this._typing || !this._textNode) return;

      const next = Math.min(this._charIdx + CHARS_BATCH, this._textFull.length);
      this._charIdx = next;
      this._textNode.text = this._textFull.slice(0, next);

      if (next < this._textFull.length) {
        // 繼續：排程下次更新
        this._typeTimer = setTimeout(tick, UPDATE_MS);
      } else {
        // 打字完成
        this._typing    = false;
        this._typeTimer = null;
        if (this._prompt) this._prompt.alpha = 1;
        // ★ 凍結：只執行一次（_isFrozen 防止重複設定）
        if (!this._isFrozen) {
          this._isFrozen     = true;
          this.cacheAsBitmap = true;
        }
      }
    };

    this._typeTimer = setTimeout(tick, UPDATE_MS);
  }

  _skipOrNext() {
    if (this._typing) {
      // 跳過打字機：立即顯示全文
      if (this._typeTimer) { clearTimeout(this._typeTimer); this._typeTimer = null; }
      this._typing = false;
      if (this._textNode) this._textNode.text = this._textFull;
      if (this._prompt)   this._prompt.alpha  = 1;
      // ★ 凍結（同樣只執行一次）
      if (!this._isFrozen) {
        this._isFrozen     = true;
        this.cacheAsBitmap = true;
      }
      // 再次綁定點擊（等待 next）
      this.eventMode = 'static';
      this.once('pointerdown', () => this._skipOrNext());
    } else {
      this.emit('next');
    }
  }

  // ─── 公開 API ──────────────────────────────────────────────────────────────

  /** 顯示新一行對話 */
  show(text, speaker, choices = []) {
    this._opts = { text, speaker, choices };
    this._build();
  }

  // ─── 選項按鍵 ─────────────────────────────────────────────────────────────

  _makeChoice(label, W, H, active) {
    const c = new PIXI.Container();
    c.eventMode = 'static';
    c.cursor    = 'pointer';
    c.hitArea   = new PIXI.Rectangle(0, 0, W, H);

    const bg = new PIXI.Graphics();
    bg.roundRect(0, 0, W, H, 2)
      .fill({ color: active ? 0x1E1608 : 0x0D0D0D });
    bg.roundRect(0, 0, W, H, 2)
      .stroke({ color: active ? 0xE6B200 : 0x2C2C2C, width: 1 });

    const dn = new PIXI.Graphics();
    dn.roundRect(0, 0, W, H, 2).fill({ color: 0x0A0A06 });
    dn.roundRect(0, 0, W, H, 2).stroke({ color: 0x8B6800, width: 1 });
    dn.visible = false;

    const txt = new PIXI.Text({
      text: (active ? '▶  ' : '　') + label,
      style: new PIXI.TextStyle({
        fontFamily: '"Noto Sans TC","Microsoft JhengHei",sans-serif',
        fontSize: 12, fontWeight: active ? 'bold' : 'normal',
        fill: active ? 0xE6B200 : 0x555555,
      }),
    });
    txt.x = 12;
    txt.y = Math.max(0, (H - txt.style.fontSize - 4) / 2);

    c.addChild(bg, dn, txt);

    c.on('pointerdown', (e) => {
      e.stopPropagation();
      bg.visible = false; dn.visible = true;
    });
    c.on('pointerup', () => {
      bg.visible = true; dn.visible = false;
      c.emit('_tap');
    });
    c.on('pointerupoutside', () => { bg.visible = true; dn.visible = false; });
    c.on('pointercancel',    () => { bg.visible = true; dn.visible = false; });

    return c;
  }

  // ─── Resize ───────────────────────────────────────────────────────────────

  _bindResize() {
    this._rh = () => this._build();
    this._app.stage.on('resize', this._rh);
  }

  destroy(opts) {
    if (this._typeTimer) { clearTimeout(this._typeTimer); this._typeTimer = null; }
    if (this._ticker)    { this._ticker.destroy(); this._ticker = null; }
    if (this._rh) this._app.stage.off('resize', this._rh);
    super.destroy(opts);
  }
}
lse;

    const txt = new PIXI.Text({
      text: (active ? '▶  ' : '　') + label,
      style: new PIXI.TextStyle({
        fontFamily: '"Noto Sans TC","Microsoft JhengHei",sans-serif',
        fontSize: 12, fontWeight: active ? 'bold' : 'normal',
        fill: active ? 0xE6B200 : 0x555555,
      }),
    });
    txt.x = 12;
    txt.y = Math.max(0, (H - txt.style.fontSize - 4) / 2);

    c.addChild(bg, dn, txt);

    c.on('pointerdown', (e) => {
      e.stopPropagation();
      bg.visible = false; dn.visible = true;
    });
    c.on('pointerup', () => {
      bg.visible = true; dn.visible = false;
      c.emit('_tap');
    });
    c.on('pointerupoutside', () => { bg.visible = true; dn.visible = false; });
    c.on('pointercancel',    () => { bg.visible = true; dn.visible = false; });

    return c;
  }

  // ─── Resize ───────────────────────────────────────────────────────────────

  _bindResize() {
    this._rh = () => this._build();
    this._app.stage.on('resize', this._rh);
  }

  destroy(opts) {
    if (this._typeTimer) { clearTimeout(this._typeTimer); this._typeTimer = null; }
    if (this._ticker)    { this._ticker.destroy(); this._ticker = null; }
    if (this._rh) this._app.stage.off('resize', this._rh);
    super.destroy(opts);
  }
}
