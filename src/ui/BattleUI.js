/**
 * QU-DON | src/ui/BattleUI.js
 * 戰鬥介面 — 對應 Figma Screen 3（寶可夢對峙風）
 *
 * 佈局：
 *   上方 50% — 敵我對峙區（指針儀表板風格血條）
 *   中間 10% — 橫向對話 Log 框（工業塑料邊框）
 *   下方 40% — 2×2 薄膜行動鍵（攻擊/技能/道具/逃跑）
 *
 * 事件：
 *   'action'  (id: string)  → 'attack' | 'skill' | 'item' | 'escape'
 *   'close'                 → 戰鬥結束關閉
 */
export class BattleUI extends PIXI.Container {
  /**
   * @param {PIXI.Application} app
   * @param {object}           data
   *   { player: { name, level, hp, maxHp, sp, maxSp },
   *     enemy:  { name, level, hp, maxHp } }
   */
  constructor(app, data = {}) {
    super();
    this._app           = app;
    this._data          = data;
    this._log           = ['戰鬥即將開始...'];
    this._isLocked      = false;
    this._actHandler    = null;
    this._portraitCache = { player: null, enemy: null }; // null=未載入, false=失敗, Sprite=就緒
    this._build();
    this._bindResize();
  }

  // ─── 建置 ──────────────────────────────────────────────────────────────────

  _build() {
    const { width: W, height: H } = this._app.screen;
    this.removeChildren();

    const eH  = Math.floor(H * 0.25);   // 敵方上半
    const pH  = Math.floor(H * 0.25);   // 我方下半
    const logY = Math.floor(H * 0.50);
    const logH = Math.floor(H * 0.10);
    const panY = logY + logH;
    const panH = H - panY;

    this._buildBg(W, H);
    this._buildEnemyZone(W, 0,  eH);
    this._buildPlayerZone(W, eH, pH);
    this._buildLogFrame(W, logY, logH);
    this._buildActionPanel(W, panY, panH);
  }

  _buildBg(W, H) {
    const bg = new PIXI.Graphics();
    bg.rect(0, 0, W, H).fill({ color: 0x0A0808 });
    this.addChild(bg);

    const scan = new PIXI.Graphics();
    for (let y = 0; y < H; y += 3) {
      scan.rect(0, y, W, 1).fill({ color: 0x000000, alpha: 0.15 });
    }
    scan.eventMode = 'none';
    this.addChild(scan);
  }

  // ── 敵方區塊 ────────────────────────────────────────────────────────────

  _buildEnemyZone(W, y, h) {
    const bg = new PIXI.Graphics();
    bg.rect(0, y, W, h).fill({ color: 0x100808 });
    this.addChild(bg);

    const enemy = this._data.enemy ?? { name: '街頭老大', level: 12, hp: 156, maxHp: 240 };

    // ── 敵方精靈框（右對齊，整欄高）────────────────────────────────────────
    const sw = Math.floor(W * 0.38), sh = h - 8;
    const frameX = W - sw - 16, frameY = y + 4;
    const sf = new PIXI.Graphics();
    sf.rect(frameX, frameY, sw, sh).fill({ color: 0x0D0606 });
    sf.rect(frameX, frameY, sw, sh).stroke({ color: 0xFF0040, width: 1 });
    this.addChild(sf);

    if (this._portraitCache.enemy) {
      const port = this._portraitCache.enemy;
      const tex  = port.texture;
      const scale = Math.min((sw - 4) / tex.width, (sh - 4) / tex.height);
      port.scale.set(scale);
      port.x = frameX + 2 + Math.floor((sw - 4 - tex.width  * scale) / 2);
      port.y = frameY + 2 + Math.floor((sh - 4 - tex.height * scale) / 2);
      this.addChild(port);
    } else {
      const sl = new PIXI.Text({
        text: 'ENEMY SPRITE',
        style: new PIXI.TextStyle({ fontFamily: '"VT323",monospace', fontSize: 9, fill: 0xFF0040 }),
      });
      sl.anchor.set(0.5);
      sl.x = frameX + sw / 2;
      sl.y = frameY + sh / 2;
      sl.alpha = 0.3;
      this.addChild(sl);
    }

    // ── 名稱＋血條：從左邊界到頭像框左側 5px 為止 ───────────────────────────
    const barEndX = frameX - 5;
    const barX    = 16;
    const barW    = barEndX - barX;

    const nameTxt = new PIXI.Text({
      text: `▶ ${enemy.name}  LV.${String(enemy.level ?? 1).padStart(2, '0')}`,
      style: new PIXI.TextStyle({
        fontFamily: '"Noto Sans TC", "Microsoft JhengHei", sans-serif',
        fontSize: Math.floor(W * 0.033), fontWeight: 'bold', fill: 0xFF5555,
      }),
    });
    nameTxt.x = barX;
    nameTxt.y = y + 10;
    this.addChild(nameTxt);

    const barY = y + nameTxt.height + 18;
    this._buildBar(barX, barY, barW, 22, enemy.hp, enemy.maxHp, 0xFF0040, '生命值');
  }

  // ── 我方區塊 ────────────────────────────────────────────────────────────

  _buildPlayerZone(W, y, h) {
    const bg = new PIXI.Graphics();
    bg.rect(0, y, W, h).fill({ color: 0x070B10 });
    this.addChild(bg);

    const p = this._data.player ?? { name: '瞿董', level: 8, hp: 204, maxHp: 240, sp: 144, maxSp: 240 };

    // ── 頭像框（左側）──────────────────────────────────────────────────────
    const sw = Math.floor(W * 0.26), sh = h - 8;
    const frameX = 16, frameY = y + 4;
    const sf = new PIXI.Graphics();
    sf.rect(frameX, frameY, sw, sh).fill({ color: 0x050910 });
    sf.rect(frameX, frameY, sw, sh).stroke({ color: 0x00FF41, width: 1 });
    this.addChild(sf);

    if (this._portraitCache.player) {
      const port = this._portraitCache.player;
      const tex  = port.texture;
      const scale = Math.min((sw - 4) / tex.width, (sh - 4) / tex.height);
      port.scale.set(scale);
      port.x = frameX + 2 + Math.floor((sw - 4 - tex.width  * scale) / 2);
      port.y = frameY + 2 + Math.floor((sh - 4 - tex.height * scale) / 2);
      this.addChild(port);
    }

    // ── 名稱＋血條：頭像框右側 5px 開始，右側留 16px ──────────────────────
    const statX = frameX + sw + 5;
    const statW = W - statX - 16;

    const nameTxt = new PIXI.Text({
      text: `${p.name}  LV.${String(p.level ?? 1).padStart(2, '0')}`,
      style: new PIXI.TextStyle({
        fontFamily: '"Noto Sans TC", "Microsoft JhengHei", sans-serif',
        fontSize: Math.floor(W * 0.033), fontWeight: 'bold', fill: 0x00FF41,
      }),
    });
    nameTxt.x = statX;
    nameTxt.y = y + 10;
    this.addChild(nameTxt);

    const barY = y + nameTxt.height + 18;
    this._buildBar(statX, barY,      statW, 22, p.hp, p.maxHp, 0x00FF41, '生命值');
    this._buildBar(statX, barY + 30, statW, 16, p.sp ?? 144, p.maxSp ?? 240, 0x3366FF, 'SP');
  }

  // ── 通用血條（帶輝光） ────────────────────────────────────────────────────

  _buildBar(x, y, barW, barH, cur, max, color, label) {
    const pct     = Math.max(0, Math.min(1, cur / max));
    const bgColor = color === 0xFF0040 ? 0x1A0505
                  : color === 0x3366FF ? 0x050514
                  : 0x050A05;

    // 底板
    const bg = new PIXI.Graphics();
    bg.roundRect(x, y, barW, barH, 3).fill({ color: bgColor });
    bg.roundRect(x, y, barW, barH, 3).stroke({ color: 0x333333, width: 1 });
    this.addChild(bg);

    // 輝光層
    if (pct > 0) {
      const fillGlow = new PIXI.Graphics();
      fillGlow.roundRect(x, y, Math.floor(barW * pct), barH, 3).fill({ color });
      fillGlow.filters = [new PIXI.BlurFilter({ strength: barH * 0.4, quality: 1 })];
      fillGlow.alpha   = 0.45;
      this.addChild(fillGlow);

      const fill = new PIXI.Graphics();
      fill.roundRect(x, y, Math.floor(barW * pct), barH, 3).fill({ color });
      this.addChild(fill);
    }

    // ── 文字疊在血條內部（左側 padding 8px，垂直置中）────────────────────
    const fontSize = Math.max(10, Math.floor(barH * 0.68));
    const txt = new PIXI.Text({
      text: `${label}  ${cur} / ${max}`,
      style: new PIXI.TextStyle({
        fontFamily: '"VT323","Courier New",monospace',
        fontSize,
        fill: 0xFFFFFF,
        dropShadow: { color: 0x000000, blur: 3, distance: 1, alpha: 0.9 },
      }),
    });
    txt.x = x + 8;
    txt.y = y + Math.floor((barH - fontSize) / 2);
    this.addChild(txt);
  }

  // ── 對話 Log 框 ──────────────────────────────────────────────────────────

  _buildLogFrame(W, y, h) {
    const frame = new PIXI.Graphics();
    frame.rect(0, y, W, h).fill({ color: 0x111111 });
    frame.rect(0, y, W, h).stroke({ color: 0x2E2E2E, width: 2 });
    frame.moveTo(0, y).lineTo(W, y).stroke({ color: 0x444444, width: 1 });
    this.addChild(frame);

    const msgs = this._log.slice(-2);
    msgs.forEach((msg, i) => {
      const txt = new PIXI.Text({
        text: i === msgs.length - 1 ? `▶ ${msg}` : msg,
        style: new PIXI.TextStyle({
          fontFamily: '"Noto Sans TC", "Microsoft JhengHei", sans-serif',
          fontSize: Math.min(Math.floor(W * 0.031), 12),
          fontWeight: i === msgs.length - 1 ? 'bold' : 'normal',
          fill: i === msgs.length - 1 ? 0xE0E0E0 : 0xFF5555,
        }),
      });
      txt.x = 16;
      txt.y = y + 6 + i * (txt.style.fontSize + 6);
      this.addChild(txt);
    });
  }

  // ── 行動面板 2×2 ────────────────────────────────────────────────────────

  _buildActionPanel(W, y, h) {
    const bg = new PIXI.Graphics();
    bg.rect(0, y, W, h).fill({ color: 0x1A1208 });
    this.addChild(bg);

    const DEFS = [
      { label:'[ 攻 擊 ]', sub:'ATTACK',  action:'attack',  fill:0x4D0D0D, border:0xFF0040, text:0xFF5555 },
      { label:'技能',      sub:'SKILL',   action:'skill',   fill:0x071A0D, border:0x00FF41, text:0x00FF41 },
      { label:'[ 物 品 ]', sub:'ITEM',    action:'item',    fill:0x1A1405, border:0xE6B200, text:0xE6B200 },
      { label:'[ 逃 跑 ]', sub:'RUN',     action:'escape',  fill:0x1A1A1A, border:0x555555, text:0x888888 },
    ];

    const pad  = 8;
    const cols = 2;
    const rows = 2;
    const bW   = Math.floor((W - pad * (cols + 1)) / cols);
    const bH   = Math.floor((h - pad * (rows + 1)) / rows);

    DEFS.forEach(({ label, sub, action, fill, border, text }, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const bx  = pad + col * (bW + pad);
      const by  = y + pad + row * (bH + pad);

      const btn = this._makeActionBtn(label, sub, bW, bH, fill, border, text);
      btn.x = bx;
      btn.y = by;
      btn.on('_tap', () => this.emit('action', action));
      this.addChild(btn);
    });
  }

  _makeActionBtn(label, sub, W, H, fillColor, borderColor, textColor) {
    const c = new PIXI.Container();
    c.eventMode = 'static';
    c.cursor    = 'pointer';
    c.hitArea   = new PIXI.Rectangle(0, 0, W, H);

    const r  = 4;
    const fs = Math.floor(H * 0.29);

    const up = new PIXI.Graphics();
    up.roundRect(0, 0, W, H, r).fill({ color: fillColor });
    up.roundRect(0, 0, W, H, r).stroke({ color: borderColor, width: 1.5 });
    up.moveTo(r, 1).lineTo(W - r, 1).stroke({ color: 0xFFFFFF, width: 0.8, alpha: 0.07 });
    up.moveTo(r, H - 1).lineTo(W - r, H - 1).stroke({ color: 0x000000, width: 1.2, alpha: 0.5 });

    const dn = new PIXI.Graphics();
    dn.roundRect(0, 0, W, H, r).fill({ color: Math.max(0, fillColor - 0x080404) });
    dn.roundRect(0, 0, W, H, r).stroke({ color: Math.max(0, borderColor - 0x404040), width: 1.5 });
    dn.visible = false;

    const mainTxt = new PIXI.Text({
      text: label,
      style: new PIXI.TextStyle({
        fontFamily: '"Noto Sans TC","Microsoft JhengHei",sans-serif',
        fontSize: fs, fontWeight: 'bold', fill: textColor,
      }),
    });
    mainTxt.anchor.set(0.5);
    mainTxt.x = W / 2;
    mainTxt.y = H / 2 - Math.floor(fs * 0.3);

    const subTxt = new PIXI.Text({
      text: sub,
      style: new PIXI.TextStyle({
        fontFamily: '"VT323","Courier New",monospace',
        fontSize: Math.floor(H * 0.12), fill: textColor,
      }),
    });
    subTxt.anchor.set(0.5);
    subTxt.x = W / 2;
    subTxt.y = H / 2 + Math.floor(fs * 0.7);
    subTxt.alpha = 0.5;

    c.addChild(up, dn, mainTxt, subTxt);

    const setState = (p) => {
      up.visible = !p; dn.visible = p;
      mainTxt.y = H / 2 - Math.floor(fs * 0.3) + (p ? 1.5 : 0);
    };
    c.on('pointerdown',    (e) => { e.stopPropagation(); setState(true); });
    c.on('pointerup',      () => { setState(false); c.emit('_tap'); });
    c.on('pointerupoutside', () => setState(false));
    c.on('pointercancel',    () => setState(false));

    return c;
  }

  // ─── 公開 API ──────────────────────────────────────────────────────────────

  /**
   * 以外部傳入的角色資料初始化戰鬥畫面。
   * 接受兩種格式：
   *   扁平式  { name, hp, maxHp, sp, maxSp, level }
   *   巢狀式  { name, stats: { hp, maxHp, atk, def } }  ← actors.json 格式
   */
  startBattle(playerData, enemyData) {
    const pStats = playerData.stats ?? playerData;
    const eStats = enemyData.stats  ?? enemyData;
    this._data = {
      player: {
        name:  playerData.name,
        level: playerData.level ?? 1,
        hp:    pStats.hp    ?? 100,
        maxHp: pStats.maxHp ?? 100,
        sp:    pStats.sp    ?? 80,
        maxSp: pStats.maxSp ?? 80,
        atk:   pStats.atk   ?? 10,
        def:   pStats.def   ?? 5,
      },
      enemy: {
        name:  enemyData.name,
        level: enemyData.level ?? 1,
        hp:    eStats.hp    ?? 50,
        maxHp: eStats.maxHp ?? 50,
        atk:   eStats.atk   ?? 6,
        def:   eStats.def   ?? 2,
      },
    };
    // 保存 visuals 供頭像系統使用
    this._data.player.visuals = playerData.visuals ?? null;
    this._data.enemy.visuals  = enemyData.visuals  ?? null;

    this._log             = [`${enemyData.name} 擋住了去路！`];
    this._isLocked        = false;
    this._portraitCache   = { player: null, enemy: null }; // 重置快取

    // 重新綁定內部戰鬥邏輯（移除舊監聽器後再掛）
    if (this._actHandler) this.off('action', this._actHandler);
    this._actHandler = (a) => this._onAction(a);
    this.on('action', this._actHandler);

    this._build();

    // 非同步載入頭像，完成後重繪（不阻塞戰鬥啟動）
    this._loadPortraits().catch(() => {});
  }

  // ─── 頭像系統 ─────────────────────────────────────────────────────────────────

  /**
   * 並行載入主角與敵方頭像，完成後觸發 _build() 重繪。
   * player 有 fallback 路徑（即使 visuals 未傳入也能顯示正面圖）。
   */
  async _loadPortraits() {
    const playerPath = this._data.player?.visuals?.battleMugshot ?? null;
    const enemyPath  = this._data.enemy?.visuals?.battleMugshot  ?? null;

    await Promise.allSettled([
      playerPath ? this._loadOnePortrait('player', playerPath) : Promise.resolve(),
      enemyPath  ? this._loadOnePortrait('enemy',  enemyPath)  : Promise.resolve(),
    ]);

    this._build();
  }

  /**
   * 載入單一頭像：裁切上半身 50% + 套用 VFD 螢光綠濾鏡。
   * @param {'player'|'enemy'} role
   * @param {string} path  完整資源路徑
   */
  async _loadOnePortrait(role, path) {
    try {
      const baseTex  = await PIXI.Assets.load(path);

      // ── 裁切上半身（height × 0.5）──────────────────────────────────────────
      const cropRect = new PIXI.Rectangle(0, 0, baseTex.width, Math.floor(baseTex.height * 0.5));
      const tex      = new PIXI.Texture({ source: baseTex.source, frame: cropRect });

      const spr = new PIXI.Sprite(tex);
      this._portraitCache[role] = spr;
    } catch {
      console.warn(`[BattleUI] 頭像載入失敗: ${path}`);
      this._portraitCache[role] = false;
    }
  }

  // ─── 戰鬥輔助 ────────────────────────────────────────────────────────────────

  /** 推入訊息（最多保留 4 筆）並重繪介面。 */
  _pushLog(msg) {
    this._log.push(msg);
    if (this._log.length > 4) this._log.shift();
    this._build();
  }

  /** 以 _data 最新 hp 重繪介面（血條 + 數值）。 */
  _updateHealthUI() {
    this._build();
  }

  /**
   * 內部回合制邏輯入口，由 startBattle 綁定至 'action' 事件。
   * 僅處理 'attack'；其餘行動預留給未來擴充。
   */
  _onAction(action) {
    if (action !== 'attack') return;
    if (this._isLocked) return;
    this._isLocked = true;

    const p = this._data.player;
    const e = this._data.enemy;

    // ── 玩家攻擊 ────────────────────────────────────────────────────────────
    let dmg = Math.max(1, p.atk - e.def);
    dmg = Math.floor(dmg * (0.9 + Math.random() * 0.2));
    e.hp = Math.max(0, e.hp - dmg);
    this._pushLog(`瞿董 攻擊了 ${e.name}，造成 ${dmg} 點傷害！`);

    // ── 勝利判定 ────────────────────────────────────────────────────────────
    if (e.hp === 0) {
      this._pushLog('🏆 戰鬥勝利！');
      setTimeout(() => {
        this._isLocked = false;
        this.visible = false;
        this.emit('win');
        this.emit('close');
      }, 1500);
      return;
    }

    // ── 敵人反擊（延遲 1 秒） ─────────────────────────────────────────────
    setTimeout(() => {
      let eDmg = Math.floor(Math.max(1, e.atk - p.def) * (0.9 + Math.random() * 0.2));
      p.hp = Math.max(0, p.hp - eDmg);
      this._pushLog(`${e.name} 反擊，造成 ${eDmg} 點傷害！`);
      this._updateHealthUI();

      // ── 敗北判定 ──────────────────────────────────────────────────────────
      if (p.hp === 0) {
        this._pushLog('💀 戰鬥失敗...');
        setTimeout(() => {
          this._isLocked = false;
          this.visible = false;
          this.emit('lose');
          this.emit('close');
        }, 1500);
        return;
      }

      this._isLocked = false; // 解鎖，等待玩家下一回合
    }, 1000);
  }

  /** 推入 Log 並刷新（公開版，供外部呼叫） */
  pushLog(msg) {
    this._log.push(msg);
    if (this._log.length > 6) this._log.shift();
    this._build();
  }

  /** 更新血量資料並刷新 */
  updateData(data) {
    this._data = { ...this._data, ...data };
    this._build();
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
