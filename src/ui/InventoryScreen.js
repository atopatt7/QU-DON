/**
 * QU-DON | src/ui/InventoryScreen.js
 * 背包介面 — VFD 琥珀風（對應 StatusScreen 配色）
 *
 * 佈局：
 *   標題列（含關閉按鈕）
 *   左欄 40% — 物品清單（鍵盤 ↑↓ / 滑鼠點選）
 *   右欄 60% — 選取物品的詳細資訊
 *
 * 事件：
 *   'close'         — Esc / I 鍵 / 關閉按鈕
 *   'use' (itemId)  — 點擊「使用」按鈕（消耗品）
 *
 * API：
 *   show(inventory)     — 傳入 [{id, qty}, ...] 顯示背包
 *   hide()
 *   static async create(app)  — 載入 items.json 後建立實例
 */

// ── 顏色系統（沿用 StatusScreen 琥珀 VFD 調）──────────────────────────────
const C = {
  bg:         0x0a0a0a,
  panel:      0x111008,
  border:     0x5a4a1a,
  borderHi:   0xc8a832,
  label:      0xe0d8c0,
  value:      0xFFB000,
  accent:     0x00FF41,
  sp:         0xFF5555,
  dim:        0x555544,
  rowEven:    0x161408,
  rowOdd:     0x1e1c0a,
  rowSel:     0x2a2000,
  scanline:   0x000000,
};

const FONT_MONO = '"Courier New", "VT323", monospace';
const FONT_JP   = '"Noto Sans TC", "Microsoft JhengHei", sans-serif';

// ── 類別標籤映射 ──────────────────────────────────────────────────────────
const CATEGORY_LABEL = {
  consumable: '消耗品',
  weapon:     '武器',
  ammo:       '彈藥',
  key_item:   '重要道具',
  misc:       '雜物',
};

// ── 效果類型標籤映射 ──────────────────────────────────────────────────────
const EFFECT_LABEL = {
  heal_hp:        { label: '恢復生命值', color: C.accent  },
  heal_sp:        { label: '恢復 SP',   color: 0x3399ff  },
  remove_status:  { label: '解除狀態',  color: 0xFFB000  },
};

export class InventoryScreen extends PIXI.Container {

  /**
   * @param {PIXI.Application} app
   * @param {object[]}         itemDefs  — items.json 的 items 陣列
   */
  constructor(app, itemDefs = []) {
    super();
    this._app         = app;
    this._itemDefs    = itemDefs;
    this._inventory   = [];   // [{id, qty}] — 由 show() 傳入
    this._selectedIdx = 0;    // 當前選取列
    this._scrollOff   = 0;    // 可視窗口起始列
    this._keyHandler  = null;

    this._build();
    this._bindResize();
    this._bindKeyboard();

    this.visible = false;
  }

  // ─── 靜態工廠：載入 items.json 後建立實例 ────────────────────────────────

  static async create(app) {
    try {
      const res  = await fetch('./src/data/items.json');
      const json = await res.json();
      const defs = Array.isArray(json) ? json : (json.items ?? []);
      return new InventoryScreen(app, defs);
    } catch {
      console.warn('[InventoryScreen] 無法載入 items.json，使用空定義');
      return new InventoryScreen(app, []);
    }
  }

  // ─── 公開 API ──────────────────────────────────────────────────────────────

  /** 傳入玩家背包陣列並顯示 */
  show(inventory = []) {
    this._inventory   = inventory;
    this._selectedIdx = 0;
    this._scrollOff   = 0;
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
    dim.rect(0, 0, W, H).fill({ color: 0x000000, alpha: 0.84 });
    dim.eventMode = 'static';
    this.addChild(dim);
  }

  // ── 主面板 ────────────────────────────────────────────────────────────────

  _buildPanel(W, H) {
    const panW = Math.min(W * 0.94, 800);
    const panH = Math.min(H * 0.90, 580);
    const panX = Math.floor((W - panW) / 2);
    const panY = Math.floor((H - panH) / 2);

    // 框體
    const panel = new PIXI.Graphics();
    panel.roundRect(panX, panY, panW, panH, 4)
         .fill({ color: C.panel });
    panel.roundRect(panX + 2, panY + 2, panW - 4, panH - 4, 3)
         .stroke({ color: C.border, width: 1 });
    panel.roundRect(panX, panY, panW, panH, 4)
         .stroke({ color: C.borderHi, width: 1.5 });
    // 掃描線
    for (let y = panY + 4; y < panY + panH - 4; y += 3) {
      panel.moveTo(panX + 4, y).lineTo(panX + panW - 4, y)
           .stroke({ color: C.scanline, width: 1, alpha: 0.10 });
    }
    this.addChild(panel);

    const titleH = Math.floor(panH * 0.10);
    this._buildTitleBar(panX, panY, panW, titleH);

    const bodyY  = panY + titleH;
    const bodyH  = panH - titleH;
    const leftW  = Math.floor(panW * 0.40);
    const rightW = panW - leftW;

    // 分隔線
    const div = new PIXI.Graphics();
    div.moveTo(panX + leftW, bodyY + 8)
       .lineTo(panX + leftW, panY + panH - 8)
       .stroke({ color: C.border, width: 1 });
    this.addChild(div);

    this._buildItemList(panX,          bodyY, leftW,  bodyH);
    this._buildItemDetail(panX + leftW, bodyY, rightW, bodyH);
  }

  // ── 標題列 ────────────────────────────────────────────────────────────────

  _buildTitleBar(px, py, pw, th) {
    const bar = new PIXI.Graphics();
    bar.rect(px, py, pw, th).fill({ color: 0x1a1600 });
    bar.moveTo(px, py + th).lineTo(px + pw, py + th)
       .stroke({ color: C.borderHi, width: 1 });
    this.addChild(bar);

    const fs = Math.max(11, Math.floor(th * 0.45));

    const title = this._text('◈  INVENTORY / 隨身物資  ◈', fs, C.borderHi, 'bold');
    title.anchor.set(0.5, 0.5);
    title.x = px + pw / 2;
    title.y = py + th / 2;
    this.addChild(title);

    // 關閉按鈕
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

  // ── 左欄：物品清單 ────────────────────────────────────────────────────────

  _buildItemList(cx, cy, cw, ch) {
    const pad  = Math.floor(cw * 0.07);
    let   curY = cy + pad;

    const fs   = this._responsiveFs(cw, 0.065);
    const fsSm = this._responsiveFs(cw, 0.050);

    // 小標題
    const header = this._text('[ 物品清單 ]', fsSm, C.dim);
    header.x = cx + pad; header.y = curY;
    this.addChild(header);
    curY += header.height + 4;
    this._hLine(cx + pad, curY, cw - pad * 2);
    curY += 8;

    if (this._inventory.length === 0) {
      const empty = this._text('— 背包是空的 —', fsSm, C.dim);
      empty.anchor.set(0.5, 0);
      empty.x = cx + cw / 2; empty.y = curY + 20;
      this.addChild(empty);
      return;
    }

    // 計算可視列數
    const itemH      = Math.floor(fs * 2.3);
    const listBottom = cy + ch - pad - Math.floor(fsSm * 1.8);
    const maxVisible = Math.max(1, Math.floor((listBottom - curY) / (itemH + 4)));

    // 滾動窗口：確保選取列始終在可視範圍內
    if (this._selectedIdx < this._scrollOff) {
      this._scrollOff = this._selectedIdx;
    } else if (this._selectedIdx >= this._scrollOff + maxVisible) {
      this._scrollOff = this._selectedIdx - maxVisible + 1;
    }

    const visible = this._inventory.slice(this._scrollOff, this._scrollOff + maxVisible);

    visible.forEach(({ id, qty }, vi) => {
      const absIdx = vi + this._scrollOff;
      const def    = this._getItemDef(id);
      const isSel  = absIdx === this._selectedIdx;

      // 列背景
      const rowBg = new PIXI.Graphics();
      if (isSel) {
        rowBg.roundRect(cx + pad, curY, cw - pad * 2, itemH, 2)
             .fill({ color: C.rowSel })
             .stroke({ color: C.borderHi, width: 1 });
      } else {
        rowBg.roundRect(cx + pad, curY, cw - pad * 2, itemH, 2)
             .fill({ color: absIdx % 2 === 0 ? C.rowEven : C.rowOdd });
      }
      this.addChild(rowBg);

      // 選取游標
      if (isSel) {
        const cur = this._text('▶', fsSm, C.borderHi, 'bold');
        cur.x = cx + pad + 3;
        cur.y = curY + Math.floor((itemH - cur.height) / 2);
        this.addChild(cur);
      }

      // 物品名稱
      const nameX   = cx + pad + (isSel ? 16 : 8);
      const nameCol = isSel ? C.borderHi : C.label;
      const nameTxt = this._text(def.name_zh ?? def.name ?? id, fs, nameCol,
                                 isSel ? 'bold' : 'normal', FONT_JP);
      nameTxt.x = nameX;
      nameTxt.y = curY + Math.floor((itemH - nameTxt.height) / 2);
      this.addChild(nameTxt);

      // 數量徽章（右對齊）
      const qtyTxt = this._text(`×${qty}`, fsSm,
                                isSel ? C.value : C.dim, 'bold');
      qtyTxt.anchor.set(1, 0.5);
      qtyTxt.x = cx + cw - pad - 4;
      qtyTxt.y = curY + itemH / 2;
      this.addChild(qtyTxt);

      // 點擊切換選取
      const hit = new PIXI.Container();
      hit.eventMode = 'static';
      hit.cursor    = 'pointer';
      hit.hitArea   = new PIXI.Rectangle(cx + pad, curY, cw - pad * 2, itemH);
      const capturedIdx = absIdx;
      hit.on('pointertap', () => {
        this._selectedIdx = capturedIdx;
        this._build();
      });
      this.addChild(hit);

      curY += itemH + 4;
    });

    // 捲動指示器
    const total = this._inventory.length;
    if (total > maxVisible) {
      const hint = this._text(
        `${this._selectedIdx + 1} / ${total}   ↑↓ 選取`,
        fsSm, C.dim
      );
      hint.anchor.set(0.5, 1);
      hint.x = cx + cw / 2;
      hint.y = cy + ch - 4;
      this.addChild(hint);
    } else {
      const hint = this._text('↑ ↓ 選取', fsSm, C.dim);
      hint.anchor.set(0.5, 1);
      hint.x = cx + cw / 2;
      hint.y = cy + ch - 4;
      this.addChild(hint);
    }
  }

  // ── 右欄：物品詳情 ────────────────────────────────────────────────────────

  _buildItemDetail(cx, cy, cw, ch) {
    const pad  = Math.floor(cw * 0.07);
    let   curY = cy + pad;

    const fs   = this._responsiveFs(cw, 0.058);
    const fsLg = this._responsiveFs(cw, 0.088);
    const fsSm = this._responsiveFs(cw, 0.047);

    const entry = this._inventory[this._selectedIdx];
    const def   = entry ? this._getItemDef(entry.id) : null;

    // 小標題
    const header = this._text('[ 物品詳情 ]', fsSm, C.dim);
    header.x = cx + pad; header.y = curY;
    this.addChild(header);
    curY += header.height + 4;
    this._hLine(cx + pad, curY, cw - pad * 2);
    curY += 12;

    if (!def) {
      const empty = this._text('— 選取物品以查看詳情 —', fsSm, C.dim);
      empty.anchor.set(0.5, 0.5);
      empty.x = cx + cw / 2; empty.y = cy + ch / 2;
      this.addChild(empty);
      return;
    }

    // ── 物品名稱（大標題）───────────────────────────────────────────────────
    const nameT = this._text(def.name_zh ?? def.name ?? def.id, fsLg,
                             C.borderHi, 'bold', FONT_JP);
    nameT.x = cx + pad; nameT.y = curY;
    this.addChild(nameT);
    curY += nameT.height + 6;

    // ── 類別徽章 ─────────────────────────────────────────────────────────────
    const catLabel = CATEGORY_LABEL[def.category] ?? def.category ?? '—';
    const catTxt   = this._text(catLabel, fsSm, C.dim);
    const badgeW   = catTxt.width + 16;
    const badgeH   = catTxt.height + 6;

    const catBg = new PIXI.Graphics();
    catBg.roundRect(cx + pad, curY, badgeW, badgeH, 2)
         .fill({ color: 0x1a1408 })
         .stroke({ color: C.border, width: 1 });
    catTxt.x = cx + pad + 8; catTxt.y = curY + 3;
    this.addChild(catBg, catTxt);
    curY += badgeH + 12;

    this._hLine(cx + pad, curY, cw - pad * 2);
    curY += 10;

    // ── 描述（多行自動換行）─────────────────────────────────────────────────
    const descStyle = new PIXI.TextStyle({
      fontFamily:    FONT_JP,
      fontSize:      Math.max(10, fs - 1),
      fill:          C.label,
      wordWrap:      true,
      wordWrapWidth: cw - pad * 2 - 8,
      lineHeight:    Math.floor(fs * 1.6),
    });
    const descTxt = new PIXI.Text({
      text:  def.description_zh ?? def.description ?? '—',
      style: descStyle,
    });
    descTxt.x = cx + pad; descTxt.y = curY;
    this.addChild(descTxt);
    curY += descTxt.height + 14;

    // ── 使用效果區塊（僅限消耗品）────────────────────────────────────────────
    const effects = def.useProps?.effects ?? [];
    if (effects.length > 0) {
      this._hLine(cx + pad, curY, cw - pad * 2);
      curY += 8;

      const effHdr = this._text('使用效果', fsSm, C.dim);
      effHdr.x = cx + pad; effHdr.y = curY;
      this.addChild(effHdr);
      curY += effHdr.height + 4;

      effects.forEach(eff => {
        const meta  = EFFECT_LABEL[eff.type];
        if (!meta) return;
        const label = meta.label;
        const val   = eff.value  ? `+${eff.value}` :
                      eff.statusId ? eff.statusId    : '';
        curY = this._statRow(cx + pad, curY, cw - pad * 2,
                             fs, fsSm, label, val, meta.color);
      });

      curY += 4;
    }

    // ── 持有數量（底部）─────────────────────────────────────────────────────
    this._hLine(cx + pad, curY + 4, cw - pad * 2);
    curY += 12;
    this._statRow(cx + pad, curY, cw - pad * 2,
                  fs, fsSm, '持有數量', String(entry.qty), C.value);
    curY += Math.floor(fs * 1.6);

    // ── 「使用」按鈕（消耗品且 visible 狀態才顯示）───────────────────────────
    if (def.usable && entry.qty > 0) {
      curY += 8;
      const btnW = Math.min(cw - pad * 2, 140);
      const btnH = Math.max(28, Math.floor(fs * 1.9));
      const btnX = cx + pad;
      const btnY = curY;

      const btnBg = new PIXI.Graphics();
      btnBg.roundRect(btnX, btnY, btnW, btnH, 3)
           .fill({ color: 0x1a2a10 })
           .stroke({ color: C.accent, width: 1.5 });
      this.addChild(btnBg);

      const btnTxt = this._text('▶ 使用', Math.max(10, Math.floor(btnH * 0.48)),
                                C.accent, 'bold', FONT_JP);
      btnTxt.anchor.set(0.5, 0.5);
      btnTxt.x = btnX + btnW / 2; btnTxt.y = btnY + btnH / 2;
      this.addChild(btnTxt);

      const hit = new PIXI.Container();
      hit.eventMode = 'static';
      hit.cursor    = 'pointer';
      hit.hitArea   = new PIXI.Rectangle(btnX, btnY, btnW, btnH);
      hit.on('pointerover',  () => { btnBg.tint = 0xbbddbb; btnTxt.tint = 0xbbddbb; });
      hit.on('pointerout',   () => { btnBg.tint = 0xffffff; btnTxt.tint = 0xffffff; });
      hit.on('pointerdown',  (e) => e.stopPropagation());
      hit.on('pointerup',    () => this.emit('use', def.id));
      hit.on('pointertap',   () => this.emit('use', def.id));
      this.addChild(hit);
    }
  }

  // ─── 工具方法（與 StatusScreen 相同介面）──────────────────────────────────

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

  _responsiveFs(colW, ratio) {
    return Math.min(Math.max(10, Math.floor(colW * ratio)), 22);
  }

  _statRow(x, y, rowW, fsLabel, _fsVal, label, value, valueColor) {
    const lbl = this._text(label, fsLabel, C.label);
    const val = this._text(value, fsLabel, valueColor, 'bold');
    lbl.x = x; lbl.y = y;
    val.anchor.set(1, 0);
    val.x = x + rowW; val.y = y;
    this.addChild(lbl, val);

    const dotLine = new PIXI.Graphics();
    const dotY    = y + lbl.height / 2;
    dotLine.moveTo(x + lbl.width + 4, dotY)
           .lineTo(x + rowW - val.width - 4, dotY)
           .stroke({ color: C.dim, width: 1, alpha: 0.5 });
    this.addChild(dotLine);

    const rowH = Math.max(lbl.height, val.height);
    return y + rowH + Math.floor(rowH * 0.35);
  }

  /** 從 _itemDefs 取得物品定義；找不到時回傳最小佔位物件 */
  _getItemDef(id) {
    return this._itemDefs.find(d => d.id === id) ?? {
      id, name: id, name_zh: id, category: 'misc', description_zh: '—',
      usable: false, useProps: null,
    };
  }

  // ─── 鍵盤 ─────────────────────────────────────────────────────────────────

  _bindKeyboard() {
    this._keyHandler = (e) => {
      if (!this.visible) return;
      switch (e.key) {
        case 'Escape':
        case 'i':
        case 'I':
          e.preventDefault();
          this.hide();
          break;
        case 'ArrowUp': {
          e.preventDefault();
          const len = this._inventory.length;
          if (len === 0) break;
          this._selectedIdx = (this._selectedIdx - 1 + len) % len;
          this._build();
          break;
        }
        case 'ArrowDown': {
          e.preventDefault();
          const len = this._inventory.length;
          if (len === 0) break;
          this._selectedIdx = (this._selectedIdx + 1) % len;
          this._build();
          break;
        }
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
