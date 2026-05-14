/**
 * QU-DON | src/ui/StatusScreen.js
 * 狀態與專長介面 — 終端機硬派風格，兩欄式佈局
 *
 * 事件：
 *   'close'  — 按 Escape 或關閉按鈕
 *
 * API：
 *   updateData(data)  — 更新數值並重繪
 *   show() / hide()
 */

// ── 預設資料（actors.json 的 qu_don 初始值）────────────────────────────────
const DEFAULT_DATA = {
  name:         '瞿董',
  level:        1,
  exp:          0,
  nextLevelExp: 100,
  hp:           85,
  maxHp:        85,
  atk:          12,
  def:          8,
  stamina:      80,
  maxStamina:   80,
  skillPoints:  3,
  perks: [
    { label: 'Street Network', rank: 1, desc: '花費 0 AP 獲取敵方位置情報' },
  ],
};

// ── 顏色系統 ────────────────────────────────────────────────────────────────
const C = {
  bg:        0x0a0a0a,
  panel:     0x111008,
  border:    0x5a4a1a,
  borderHi:  0xc8a832,
  label:     0xe0d8c0,
  value:     0xFFB000,
  accent:    0x00FF41,
  sp:        0xFF5555,
  dim:       0x555544,
  perkBox:   0x1a1808,
  perkBorder:0x3a3010,
  scanline:  0x000000,
};

const FONT_MONO = '"Courier New", "VT323", monospace';
const FONT_JP   = '"Noto Sans TC", "Microsoft JhengHei", sans-serif';

export class StatusScreen extends PIXI.Container {

  /**
   * @param {PIXI.Application} app
   */
  constructor(app) {
    super();
    this._app     = app;
    this._data    = { ...DEFAULT_DATA };
    this._keyHandler = null;

    this._build();
    this._bindResize();
    this._bindKeyboard();

    this.visible = false;
  }

  // ─── 公開 API ──────────────────────────────────────────────────────────────

  /** 更新角色資料並重繪 */
  updateData(data) {
    this._data = { ...this._data, ...data };
    this._build();
  }

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

  // ── 半透明遮罩 ────────────────────────────────────────────────────────────

  _buildDim(W, H) {
    const dim = new PIXI.Graphics();
    dim.rect(0, 0, W, H).fill({ color: 0x000000, alpha: 0.82 });
    dim.eventMode = 'static';
    this.addChild(dim);
  }

  // ── 主面板 ────────────────────────────────────────────────────────────────

  _buildPanel(W, H) {
    // 面板尺寸：手機最大化，桌機適中
    const panW = Math.min(W * 0.96, 780);
    const panH = Math.min(H * 0.92, 600);
    const panX = Math.floor((W - panW) / 2);
    const panY = Math.floor((H - panH) / 2);

    // ── 老舊終端機框體 ──────────────────────────────────────────────────────
    const panel = new PIXI.Graphics();
    // 外框雙線
    panel.roundRect(panX, panY, panW, panH, 4)
         .fill({ color: C.panel });
    panel.roundRect(panX + 2, panY + 2, panW - 4, panH - 4, 3)
         .stroke({ color: C.border, width: 1 });
    panel.roundRect(panX, panY, panW, panH, 4)
         .stroke({ color: C.borderHi, width: 1.5 });

    // 掃描線紋理（每 3px 一條暗紋）
    for (let y = panY + 4; y < panY + panH - 4; y += 3) {
      panel.moveTo(panX + 4, y).lineTo(panX + panW - 4, y)
           .stroke({ color: C.scanline, width: 1, alpha: 0.10 });
    }
    this.addChild(panel);

    // ── 頂部標題列 ──────────────────────────────────────────────────────────
    const titleH = Math.floor(panH * 0.09);
    this._buildTitleBar(panX, panY, panW, titleH);

    // ── 兩欄分割 ────────────────────────────────────────────────────────────
    const bodyY  = panY + titleH;
    const bodyH  = panH - titleH;
    const leftW  = Math.floor(panW * 0.50);
    const rightW = panW - leftW;

    // 分隔線
    const divider = new PIXI.Graphics();
    divider.moveTo(panX + leftW, bodyY + 8)
           .lineTo(panX + leftW, panY + panH - 8)
           .stroke({ color: C.border, width: 1 });
    this.addChild(divider);

    this._buildLeftCol(panX,          bodyY, leftW,  bodyH);
    this._buildRightCol(panX + leftW, bodyY, rightW, bodyH);
  }

  // ── 標題列 ────────────────────────────────────────────────────────────────

  _buildTitleBar(px, py, pw, th) {
    const bar = new PIXI.Graphics();
    bar.rect(px, py, pw, th)
       .fill({ color: 0x1a1600 });
    bar.moveTo(px, py + th).lineTo(px + pw, py + th)
       .stroke({ color: C.borderHi, width: 1 });
    this.addChild(bar);

    const fs = Math.max(11, Math.floor(th * 0.45));

    const title = this._text('◈  STATUS & PERKS  ◈', fs, C.borderHi, 'bold');
    title.anchor.set(0.5, 0.5);
    title.x = px + pw / 2;
    title.y = py + th / 2;
    this.addChild(title);

    // 關閉按鈕（右上角，鍵盤 ESC ＆ 手機觸控皆可用）
    const btnW = Math.max(64, Math.floor(pw * 0.14));
    const btnH = Math.floor(th * 0.72);
    const btnX = px + pw - btnW - 8;
    const btnY = py + Math.floor((th - btnH) / 2);

    const btnBg = new PIXI.Graphics();
    btnBg.roundRect(btnX, btnY, btnW, btnH, 3)
         .fill({ color: 0x2a1a00 })
         .stroke({ color: C.dim, width: 1 });
    this.addChild(btnBg);

    const btnTxt = this._text('✕  關閉', Math.max(9, Math.floor(btnH * 0.52)), C.dim);
    btnTxt.anchor.set(0.5, 0.5);
    btnTxt.x = btnX + btnW / 2;
    btnTxt.y = btnY + btnH / 2;
    this.addChild(btnTxt);

    // 互動區（比文字大，方便手指點擊）
    const hitArea = new PIXI.Container();
    hitArea.eventMode = 'static';
    hitArea.cursor    = 'pointer';
    hitArea.hitArea   = new PIXI.Rectangle(btnX - 4, btnY - 4, btnW + 8, btnH + 8);
    hitArea.on('pointerover',  () => { btnBg.tint = 0xddaa44; btnTxt.tint = 0xddaa44; });
    hitArea.on('pointerout',   () => { btnBg.tint = 0xffffff; btnTxt.tint = 0xffffff; });
    hitArea.on('pointerdown',  (e) => e.stopPropagation());
    hitArea.on('pointerup',    () => this.hide());
    hitArea.on('pointertap',   () => this.hide());
    this.addChild(hitArea);
  }

  // ── 左欄：身體數值 ───────────────────────────────────────────────────────

  _buildLeftCol(cx, cy, cw, ch) {
    const pad  = Math.floor(cw * 0.07);
    const d    = this._data;
    let   curY = cy + pad;

    const fs   = this._responsiveFs(cw, 0.060);
    const fsLg = this._responsiveFs(cw, 0.085);
    const fsSm = this._responsiveFs(cw, 0.048);

    // 角色名稱
    const nameJp = this._text(d.name,    fsLg, C.borderHi, 'bold', FONT_JP);
    const nameEn = this._text('QU-DON', fsSm, C.dim,      'normal');
    nameJp.x = cx + pad; nameJp.y = curY;
    nameEn.x = cx + pad; nameEn.y = curY + nameJp.height + 2;
    this.addChild(nameJp, nameEn);
    curY = nameEn.y + nameEn.height + Math.floor(ch * 0.03);

    // 分隔線
    this._hLine(cx + pad, curY, cw - pad * 2);
    curY += 6;

    // LV & EXP
    const lvLine = this._text(
      `等級 ${String(d.level).padStart(2,'0')}`, fsLg, C.accent, 'bold'
    );
    lvLine.x = cx + pad; lvLine.y = curY;
    this.addChild(lvLine);
    curY += lvLine.height + 4;

    const expBar = this._buildExpBar(
      cx + pad, curY, cw - pad * 2 - 4, Math.max(8, fsSm - 2),
      d.exp, d.nextLevelExp
    );
    curY = expBar + Math.floor(ch * 0.04);

    // 分隔線
    this._hLine(cx + pad, curY, cw - pad * 2);
    curY += 8;

    // 數值列表
    const stats = [
      { label: '生命上限',  value: `${d.hp} / ${d.maxHp}`,          color: C.accent },
      { label: '攻擊力',    value: String(d.atk),                    color: C.value  },
      { label: '防禦力',    value: String(d.def),                    color: C.value  },
      { label: '耐力上限',  value: `${d.stamina} / ${d.maxStamina}`, color: 0x3399ff },
    ];

    stats.forEach(({ label, value, color }) => {
      curY = this._statRow(cx + pad, curY, cw - pad * 2, fs, fsSm, label, value, color);
    });
  }

  // ── 右欄：專長與技能點 ──────────────────────────────────────────────────

  _buildRightCol(cx, cy, cw, ch) {
    const pad  = Math.floor(cw * 0.07);
    const d    = this._data;
    let   curY = cy + pad;

    const fs   = this._responsiveFs(cw, 0.062);
    const fsLg = this._responsiveFs(cw, 0.082);
    const fsSm = this._responsiveFs(cw, 0.050);

    // ── 技能點（突出顯示）────────────────────────────────────────────────────
    const spBox = new PIXI.Graphics();
    const spBoxH = Math.floor(fsLg * 2.4);
    spBox.roundRect(cx + pad, curY, cw - pad * 2, spBoxH, 3)
         .fill({ color: 0x2a0808 })
         .stroke({ color: C.sp, width: 1.5 });
    this.addChild(spBox);

    const spLabel = this._text('剩餘技能點', fsSm, C.dim);
    spLabel.x = cx + pad + 8; spLabel.y = curY + 5;
    this.addChild(spLabel);

    const spVal = this._text(String(d.skillPoints), fsLg, C.sp, 'bold');
    spVal.anchor.set(1, 0);
    spVal.x = cx + cw - pad - 4; spVal.y = curY + 4;
    this.addChild(spVal);
    curY += spBoxH + Math.floor(ch * 0.03);

    // ── 分隔 ─────────────────────────────────────────────────────────────────
    this._hLine(cx + pad, curY, cw - pad * 2);
    curY += 8;

    const perkTitle = this._text('【 街頭專長 】', fs, C.borderHi, 'bold');
    perkTitle.x = cx + pad; perkTitle.y = curY;
    this.addChild(perkTitle);
    curY += perkTitle.height + 6;

    // ── 專長捲動區框架 ───────────────────────────────────────────────────────
    const listH = Math.floor(ch - (curY - cy) - pad);
    this._buildPerkList(cx + pad, curY, cw - pad * 2, listH, d.perks ?? [], fsSm, fs);
  }

  // ── 經驗值進度條 ─────────────────────────────────────────────────────────

  _buildExpBar(x, y, barW, barH, exp, next) {
    const pct = next > 0 ? Math.min(1, exp / next) : 0;

    const bg = new PIXI.Graphics();
    bg.roundRect(x, y, barW, barH, 2).fill({ color: 0x151005 });
    bg.roundRect(x, y, barW, barH, 2).stroke({ color: C.border, width: 1 });
    this.addChild(bg);

    if (pct > 0) {
      const fill = new PIXI.Graphics();
      fill.roundRect(x + 1, y + 1, Math.floor((barW - 2) * pct), barH - 2, 1)
          .fill({ color: C.value });
      this.addChild(fill);
    }

    const expTxt = this._text(
      `經驗值  ${exp} / ${next}`,
      Math.max(9, barH - 1), C.value
    );
    expTxt.x = x; expTxt.y = y + barH + 3;
    this.addChild(expTxt);

    return y + barH + expTxt.height + 4;
  }

  // ── 單行數值列 ────────────────────────────────────────────────────────────

  _statRow(x, y, rowW, fsLabel, fsVal, label, value, valueColor) {
    const lbl = this._text(label, fsLabel, C.label);
    const val = this._text(value, fsLabel, valueColor, 'bold');

    lbl.x = x; lbl.y = y;
    val.anchor.set(1, 0);
    val.x = x + rowW; val.y = y;

    this.addChild(lbl, val);

    // 點線連接
    const dotLine = new PIXI.Graphics();
    const dotY = y + lbl.height / 2;
    dotLine.moveTo(x + lbl.width + 4, dotY)
           .lineTo(x + rowW - val.width - 4, dotY)
           .stroke({ color: C.dim, width: 1, alpha: 0.5 });
    this.addChild(dotLine);

    const rowH = Math.max(lbl.height, val.height);
    return y + rowH + Math.floor(rowH * 0.35);
  }

  // ── 專長清單框架 ─────────────────────────────────────────────────────────

  _buildPerkList(x, y, w, h, perks, fsSm, fsNormal) {
    // 捲動區外框
    const frame = new PIXI.Graphics();
    frame.roundRect(x, y, w, h, 3)
         .fill({ color: C.perkBox })
         .stroke({ color: C.perkBorder, width: 1 });
    this.addChild(frame);

    if (perks.length === 0) {
      const empty = this._text('— 尚無習得的專長 —', fsSm, C.dim);
      empty.anchor.set(0.5, 0.5);
      empty.x = x + w / 2;
      empty.y = y + h / 2;
      this.addChild(empty);
      return;
    }

    const pad   = 8;
    let   itemY = y + pad;
    const maxVisible = Math.floor((h - pad * 2) / (fsNormal * 2.2));

    perks.slice(0, maxVisible).forEach((perk, i) => {
      const bg = new PIXI.Graphics();
      const itemH = Math.floor(fsNormal * 2.0);
      bg.roundRect(x + pad, itemY, w - pad * 2, itemH, 2)
        .fill({ color: i % 2 === 0 ? 0x161408 : 0x1e1c0a });
      this.addChild(bg);

      // 專長名稱
      const nameT = this._text(perk.label, fsNormal, C.value, 'bold', FONT_JP);
      nameT.x = x + pad + 6; nameT.y = itemY + 3;
      this.addChild(nameT);

      // 等級標籤（右側）
      const rankLabel = `Lv.${perk.rank ?? 0}`;
      const rankT = this._text(rankLabel, fsSm, C.accent);
      rankT.anchor.set(1, 0);
      rankT.x = x + w - pad - 4; rankT.y = itemY + 4;
      this.addChild(rankT);

      // 描述（第二行）
      if (perk.desc) {
        const descT = this._text(perk.desc, Math.max(8, fsSm - 1), C.dim);
        descT.x = x + pad + 6; descT.y = itemY + nameT.height + 2;
        this.addChild(descT);
      }

      itemY += itemH + 4;
    });

    // 若有更多，顯示省略提示
    if (perks.length > maxVisible) {
      const more = this._text(
        `… 還有 ${perks.length - maxVisible} 個專長`,
        fsSm, C.dim
      );
      more.anchor.set(0.5, 1);
      more.x = x + w / 2;
      more.y = y + h - 4;
      this.addChild(more);
    }
  }

  // ─── 工具方法 ─────────────────────────────────────────────────────────────

  _text(str, size, color, weight = 'normal', family = FONT_MONO) {
    return new PIXI.Text({
      text: str,
      style: new PIXI.TextStyle({
        fontFamily: family,
        fontSize:   Math.max(9, Math.round(size)),
        fontWeight: weight,
        fill:       color,
      }),
    });
  }

  _hLine(x, y, w) {
    const g = new PIXI.Graphics();
    g.moveTo(x, y).lineTo(x + w, y)
     .stroke({ color: C.border, width: 1, alpha: 0.7 });
    this.addChild(g);
  }

  /** 依欄寬比例計算字體大小，並加上上下限 */
  _responsiveFs(colW, ratio) {
    return Math.min(Math.max(10, Math.floor(colW * ratio)), 22);
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
