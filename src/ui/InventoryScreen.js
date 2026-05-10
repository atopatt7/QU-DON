/**
 * QU-DON | src/ui/InventoryScreen.js
 * 背包與狀態系統 — 對應 Figma Screen 5
 *
 * 設計語彙：「深色皮革公事包 / 檔案夾」
 * 包含：
 *   頂部標題列（◀ 返回 + 標題）
 *   頁籤：物品 / 武器 / 烏鴉（成員）
 *   清單：道具列表（圖示 + 名稱 + 描述 + 數量）
 *   底部角色狀態列（HP / SP / 重量 / 金錢）
 *
 * 事件：
 *   'close'          點擊返回
 *   'use'  (itemId)  使用道具
 */
export class InventoryScreen extends PIXI.Container {
  /**
   * @param {PIXI.Application} app
   * @param {object}           gameState
   *   { player, inventory: [{itemId, name_zh, category, qty, description_zh, icon_label}] }
   */
  constructor(app, gameState = {}) {
    super();
    this._app       = app;
    this._gs        = gameState;
    this._activeTab = 0;  // 0=物品 1=武器 2=烏鴉
    this._scrollY   = 0;
    this._build();
    this._bindResize();
  }

  // ─── 建置 ──────────────────────────────────────────────────────────────────

  _build() {
    const { width: W, height: H } = this._app.screen;
    this.removeChildren();

    this._buildBg(W, H);
    const titleH = this._buildTitleBar(W, H);
    const tabH   = this._buildTabs(W, titleH);
    const statsH = this._buildStatsBar(W, H);
    this._buildList(W, titleH + tabH, H - titleH - tabH - statsH);
  }

  // ── 背景（皮革紋理） ───────────────────────────────────────────────────────

  _buildBg(W, H) {
    const bg = new PIXI.Graphics();
    bg.rect(0, 0, W, H).fill({ color: 0x0D0804 });
    this.addChild(bg);

    // 皮革條紋（程式繪製）
    const lcg = (s) => (s * 1664525 + 1013904223) & 0x7fffffff;
    let seed = 77;
    const stripes = new PIXI.Graphics();
    for (let i = 0; i < 30; i++) {
      seed = lcg(seed);
      const y = (seed / 0x7fffffff) * H;
      seed = lcg(seed);
      const t = 1 + (seed / 0x7fffffff) * 3;
      seed = lcg(seed);
      const a = 0.015 + (seed / 0x7fffffff) * 0.025;
      stripes.rect(0, y, W, t).fill({ color: 0x4A2808, alpha: a });
    }
    stripes.eventMode = 'none';
    this.addChild(stripes);
  }

  // ── 頂部標題列 ────────────────────────────────────────────────────────────

  _buildTitleBar(W) {
    const H = 58;

    const bar = new PIXI.Graphics();
    bar.rect(0, 0, W, H).fill({ color: 0x080502 });
    bar.rect(0, H - 2, W, 2).fill({ color: 0x3D2808 });
    this.addChild(bar);

    // 返回按鍵
    const backBtn = new PIXI.Container();
    backBtn.eventMode = 'static';
    backBtn.cursor    = 'pointer';
    backBtn.hitArea   = new PIXI.Rectangle(0, 0, 90, H);

    const backTxt = new PIXI.Text({
      text: '◀  返回',
      style: new PIXI.TextStyle({
        fontFamily: '"Noto Sans TC","Microsoft JhengHei",sans-serif',
        fontSize: 14, fontWeight: 'bold', fill: 0xBB8830,
      }),
    });
    backTxt.x = 16;
    backTxt.y = (H - backTxt.height) / 2;
    backBtn.addChild(backTxt);

    backBtn.on('pointerdown', (e) => { e.stopPropagation(); backTxt.alpha = 0.6; });
    backBtn.on('pointerup',   () => { backTxt.alpha = 1; this.emit('close'); });
    backBtn.on('pointerupoutside', () => { backTxt.alpha = 1; });

    this.addChild(backBtn);

    // 標題
    const titleTxt = new PIXI.Text({
      text: '背包',
      style: new PIXI.TextStyle({
        fontFamily: '"Noto Sans TC","Microsoft JhengHei",sans-serif',
        fontSize: 18, fontWeight: 'bold', fill: 0xE0A030,
      }),
    });
    titleTxt.anchor.set(0.5, 0.5);
    titleTxt.x = W / 2;
    titleTxt.y = H / 2;
    this.addChild(titleTxt);

    return H;
  }

  // ── 頁籤列 ────────────────────────────────────────────────────────────────

  _buildTabs(W, y) {
    const H    = 44;
    const TABS = ['物品', '武器', '烏鴉'];
    const tw   = Math.floor(W / TABS.length);

    TABS.forEach((label, i) => {
      const active = i === this._activeTab;

      const tab = new PIXI.Container();
      tab.eventMode = 'static';
      tab.cursor    = 'pointer';
      tab.hitArea   = new PIXI.Rectangle(0, 0, tw, H);
      tab.x = i * tw;
      tab.y = y;

      const bg = new PIXI.Graphics();
      bg.rect(0, 0, tw, H).fill({ color: active ? 0x1E1408 : 0x0C0804 });
      bg.rect(0, 0, tw, H).stroke({ color: active ? 0xE0A030 : 0x261808, width: 2 });
      if (active) {
        bg.rect(0, H - 2, tw, 2).fill({ color: 0xE0A030 });
      }
      tab.addChild(bg);

      const txt = new PIXI.Text({
        text: label,
        style: new PIXI.TextStyle({
          fontFamily: '"Noto Sans TC","Microsoft JhengHei",sans-serif',
          fontSize: 15,
          fontWeight: active ? 'bold' : 'normal',
          fill: active ? 0xE0A030 : 0x5C4020,
        }),
      });
      txt.anchor.set(0.5);
      txt.x = tw / 2;
      txt.y = H / 2;
      tab.addChild(txt);

      tab.on('pointerdown', (e) => { e.stopPropagation(); });
      tab.on('pointerup',   () => {
        this._activeTab = i;
        this._scrollY   = 0;
        this._build();
      });

      this.addChild(tab);
    });

    return H;
  }

  // ── 道具清單 ──────────────────────────────────────────────────────────────

  _buildList(W, startY, listH) {
    // 遮罩容器
    const mask = new PIXI.Graphics();
    mask.rect(0, startY, W, listH).fill({ color: 0xFFFFFF });
    this.addChild(mask);

    const listContainer = new PIXI.Container();
    listContainer.mask  = mask;
    this.addChild(mask);
    this.addChild(listContainer);

    const items = this._getTabItems();
    const ROW_H = 76;

    items.forEach((item, i) => {
      const row = this._buildRow(item, W, ROW_H, i);
      row.x = 0;
      row.y = startY + i * ROW_H + this._scrollY;
      listContainer.addChild(row);
    });

    // 空狀態
    if (items.length === 0) {
      const empty = new PIXI.Text({
        text: '── 無物品 ──',
        style: new PIXI.TextStyle({
          fontFamily: '"Noto Sans TC","Microsoft JhengHei",sans-serif',
          fontSize: 14, fill: 0x3A2810,
        }),
      });
      empty.anchor.set(0.5);
      empty.x = W / 2;
      empty.y = startY + listH / 2;
      listContainer.addChild(empty);
    }

    // 捲動（touch）
    let touchStartY = 0;
    const listMask = new PIXI.Graphics();
    listMask.rect(0, startY, W, listH).fill({ color: 0xFFFFFF, alpha: 0.01 });
    listMask.eventMode = 'static';

    listMask.on('pointerdown', (e) => { touchStartY = e.global.y; });
    listMask.on('pointermove', (e) => {
      if (e.buttons === 0 && !e.pressure) return;
      const dy = e.global.y - touchStartY;
      touchStartY = e.global.y;
      const maxScroll = Math.max(0, items.length * ROW_H - listH);
      this._scrollY = Math.max(-maxScroll, Math.min(0, this._scrollY + dy));
      listContainer.children.forEach((child, idx) => {
        if (child !== mask) {
          child.y = startY + idx * ROW_H + this._scrollY;
        }
      });
    });

    this.addChild(listMask);
    this._listMask = listMask;
  }

  _buildRow(item, W, H, idx) {
    const row = new PIXI.Container();

    const bg = new PIXI.Graphics();
    bg.rect(0, 0, W, H).fill({ color: idx % 2 === 0 ? 0x120D06 : 0x0D0904 });
    bg.rect(0, H - 1, W, 1).fill({ color: 0x2A1C0A });
    row.addChild(bg);

    // 圖示框
    const iconSize = Math.floor(H * 0.62);
    const iconX    = 16;
    const iconY    = (H - iconSize) / 2;

    const iconBg = new PIXI.Graphics();
    iconBg.roundRect(iconX, iconY, iconSize, iconSize, 3)
           .fill({ color: 0x1C1408 });
    iconBg.roundRect(iconX, iconY, iconSize, iconSize, 3)
           .stroke({ color: 0x3D2808, width: 1 });
    row.addChild(iconBg);

    const iconTxt = new PIXI.Text({
      text: item.icon_label ?? '■',
      style: new PIXI.TextStyle({ fontSize: Math.floor(iconSize * 0.55), fill: item.icon_color ?? 0xE0A030 }),
    });
    iconTxt.anchor.set(0.5);
    iconTxt.x = iconX + iconSize / 2;
    iconTxt.y = iconY + iconSize / 2;
    row.addChild(iconTxt);

    // 名稱
    const nameX = iconX + iconSize + 12;
    const name  = new PIXI.Text({
      text: item.name_zh ?? item.name ?? '???',
      style: new PIXI.TextStyle({
        fontFamily: '"Noto Sans TC","Microsoft JhengHei",sans-serif',
        fontSize: 15, fontWeight: 'bold', fill: 0xEEEEEE,
      }),
    });
    name.x = nameX;
    name.y = Math.floor(H * 0.2);
    row.addChild(name);

    // 描述
    const desc = new PIXI.Text({
      text: item.description_zh ?? item.description ?? '',
      style: new PIXI.TextStyle({
        fontFamily: '"Noto Sans TC","Microsoft JhengHei",sans-serif',
        fontSize: 10, fill: 0x666666,
        wordWrap: true, wordWrapWidth: W - nameX - 70,
      }),
    });
    desc.x = nameX;
    desc.y = Math.floor(H * 0.52);
    row.addChild(desc);

    // 數量
    const qtyColor = item.qty === 1 ? 0xFF5555 : 0x00FF41;
    const qty = new PIXI.Text({
      text: `× ${item.qty ?? 1}`,
      style: new PIXI.TextStyle({
        fontFamily: '"VT323","Courier New",monospace',
        fontSize: 14, fontWeight: 'bold', fill: qtyColor,
      }),
    });
    qty.anchor.set(1, 0.5);
    qty.x = W - 16;
    qty.y = H / 2;
    row.addChild(qty);

    // 點擊（使用道具）
    row.eventMode = 'static';
    row.hitArea   = new PIXI.Rectangle(0, 0, W, H);
    row.on('pointerdown', (e) => { e.stopPropagation(); bg.alpha = 0.7; });
    row.on('pointerup',   () => { bg.alpha = 1; if (item.usable) this.emit('use', item.id); });
    row.on('pointerupoutside', () => { bg.alpha = 1; });

    return row;
  }

  // ── 底部角色狀態列 ────────────────────────────────────────────────────────

  _buildStatsBar(W, H) {
    const barH = 116;
    const y    = H - barH;

    const bg = new PIXI.Graphics();
    bg.rect(0, y, W, barH).fill({ color: 0x070402 });
    bg.rect(0, y, W, 2).fill({ color: 0x3D2808 });
    this.addChild(bg);

    const p = this._gs.player ?? {
      name: '瞿董', level: 8, hp: 204, maxHp: 240, sp: 144, maxSp: 240,
    };

    // 角色名稱 + 等級
    const nameLabel = new PIXI.Text({
      text: `${p.name}  /  LV. ${String(p.level ?? 8).padStart(2, '0')}`,
      style: new PIXI.TextStyle({
        fontFamily: '"Noto Sans TC","Microsoft JhengHei",sans-serif',
        fontSize: 13, fontWeight: 'bold', fill: 0xE0A030,
      }),
    });
    nameLabel.x = 16;
    nameLabel.y = y + 12;
    this.addChild(nameLabel);

    // HP 條
    this._buildStatBar(16, y + 36, W - 120, 10, p.hp, p.maxHp, 0x00FF41, 'HP');
    // SP 條
    this._buildStatBar(16, y + 56, W - 120, 8,  p.sp ?? 144, p.maxSp ?? 240, 0x3366FF, 'SP');

    // 攜帶重量
    const weight = new PIXI.Text({
      text: `攜帶重量  ${p.weight ?? 12} / ${p.maxWeight ?? 20} kg`,
      style: new PIXI.TextStyle({
        fontFamily: '"Noto Sans TC","Microsoft JhengHei",sans-serif',
        fontSize: 11, fill: 0x5C4020,
      }),
    });
    weight.x = 16;
    weight.y = y + 74;
    this.addChild(weight);

    // 持有金錢
    const money = new PIXI.Text({
      text: `$  ${(p.money ?? 2480).toLocaleString()}`,
      style: new PIXI.TextStyle({
        fontFamily: '"VT323","Courier New",monospace',
        fontSize: 15, fontWeight: 'bold', fill: 0xE0A030,
      }),
    });
    money.anchor.set(1, 0);
    money.x = W - 16;
    money.y = y + 72;
    this.addChild(money);

    return barH;
  }

  _buildStatBar(x, y, barW, barH, cur, max, color, label) {
    const pct = Math.max(0, Math.min(1, cur / max));

    const bg = new PIXI.Graphics();
    bg.roundRect(x, y, barW, barH, 2)
      .fill({ color: color === 0x00FF41 ? 0x051005 : 0x050514 });
    bg.roundRect(x, y, barW, barH, 2).stroke({ color: 0x222222, width: 1 });
    this.addChild(bg);

    if (pct > 0) {
      const fill = new PIXI.Graphics();
      fill.roundRect(x, y, Math.floor(barW * pct), barH, 2).fill({ color });
      this.addChild(fill);
    }

    const txt = new PIXI.Text({
      text: `${label}  ${cur} / ${max}`,
      style: new PIXI.TextStyle({
        fontFamily: '"VT323","Courier New",monospace',
        fontSize: Math.max(10, barH + 1), fill: color,
      }),
    });
    txt.x = x + barW + 8;
    txt.y = y - 1;
    this.addChild(txt);
  }

  // ─── 資料篩選 ─────────────────────────────────────────────────────────────

  _getTabItems() {
    const inv = this._gs.inventory ?? DEFAULT_INVENTORY;
    const tabCategories = ['consumable', 'weapon', 'ally'];
    const cat = tabCategories[this._activeTab];

    if (this._activeTab === 2) {
      // 烏鴉（成員）頁
      return (this._gs.members ?? DEFAULT_MEMBERS);
    }
    return inv.filter(i => i.category === cat || (!i.category && this._activeTab === 0));
  }

  // ─── Resize ───────────────────────────────────────────────────────────────

  _bindResize() {
    this._rh = () => this._build();
    this._app.stage.on('resize', this._rh);
  }

  destroy(opts) {
    if (this._rh) this._app.stage.off('resize', this._rh);
    super.destroy(opts);
  }
}

// ─── 預設資料（無真實存檔時使用）────────────────────────────────────────────

const DEFAULT_INVENTORY = [
  { id:'stolen_meds', name_zh:'偷來的藥',   category:'consumable', qty:2,  usable:true,  icon_label:'✚', icon_color:0x00FF41, description_zh:'回復 HP 25 點，移除流血狀態' },
  { id:'lead_pipe',   name_zh:'鉛管',       category:'weapon',     qty:1,  usable:false, icon_label:'⚒', icon_color:0xAAAAAA, description_zh:'8–14 鈍器傷害，25% 擊退機率' },
  { id:'9mm_rounds',  name_zh:'九釐米彈匣', category:'consumable', qty:12, usable:false, icon_label:'⊙', icon_color:0xBBBB44, description_zh:'標準 9mm 空尖彈，每發計算清楚' },
  { id:'9mm_handgun', name_zh:'.38 街頭特製', category:'weapon',   qty:1,  usable:false, icon_label:'🔫', icon_color:0x888888, description_zh:'12–18 穿刺傷害，射程 5 格' },
];

const DEFAULT_MEMBERS = [
  { id:'qu_don',  name_zh:'瞿董',    category:'ally', qty:1, icon_label:'◆', icon_color:0xE0A030, description_zh:'前黑道協調人，以資訊和談判見長' },
  { id:'raymond', name_zh:'Raymond', category:'ally', qty:1, icon_label:'◆', icon_color:0xFF5555, description_zh:'前拳擊手，擅長近戰壓制' },
  { id:'lina',    name_zh:'Lina',    category:'ally', qty:1, icon_label:'◆', icon_color:0x44AAFF, description_zh:'前警察線人，狙擊手身手' },
];
