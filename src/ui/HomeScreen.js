/**
 * QU-DON | src/ui/HomeScreen.js
 * 首頁主選單 — 對應 Figma Screen 1
 *
 * 視覺：
 *   • 深黑背景 + 1980 年代建築輪廓
 *   • 霓虹光條（紅 #FF0040 / 綠 #00FF41）
 *   • 主標題「瞿董默示錄」鉻金屬 + 紅色輝光
 *   • 三個薄膜按鍵：新遊戲 / 載入遊戲 / 設定
 *
 * 事件：
 *   'action'  (actionId: string)  按鍵被點擊
 *     actionId: 'new_game' | 'load_game' | 'settings'
 */
export class HomeScreen extends PIXI.Container {
  constructor(app) {
    super();
    this._app = app;
    this._build();
    this._bindResize();
  }

  // ─── 建置 ──────────────────────────────────────────────────────────────────

  _build() {
    const { width: W, height: H } = this._app.screen;
    this.removeChildren();

    this._buildBackground(W, H);
    this._buildNeon(W, H);
    this._buildScanlines(W, H);
    this._buildTitle(W, H);
    this._buildMenu(W, H);
    this._buildFooter(W, H);
  }

  // ── 背景 + 建築輪廓 ──────────────────────────────────────────────────────

  _buildBackground(W, H) {
    const bg = new PIXI.Graphics();
    bg.rect(0, 0, W, H).fill({ color: 0x0A0507 });
    this.addChild(bg);

    // 夜空漸層（上方）
    const sky = new PIXI.Graphics();
    sky.rect(0, 0, W, Math.floor(H * 0.6)).fill({ color: 0x06040A, alpha: 0.7 });
    this.addChild(sky);

    // 建築輪廓 - 左
    const bL = new PIXI.Graphics();
    bL.rect(0, Math.floor(H * 0.19), Math.floor(W * 0.22), Math.floor(H * 0.48))
       .fill({ color: 0x090912 });
    this.addChild(bL);

    // 建築輪廓 - 右
    const bR = new PIXI.Graphics();
    bR.rect(Math.floor(W * 0.78), Math.floor(H * 0.14), Math.floor(W * 0.22), Math.floor(H * 0.53))
       .fill({ color: 0x080910 });
    this.addChild(bR);

    // 地面反光（雨夜）
    const ground = new PIXI.Graphics();
    ground.rect(0, Math.floor(H * 0.60), W, Math.floor(H * 0.40))
          .fill({ color: 0x08030E });
    this.addChild(ground);

    // 建築小窗格（亮點）
    const lcg = (s) => (s * 1664525 + 1013904223) & 0x7fffffff;
    let seed = 137;
    for (let i = 0; i < 14; i++) {
      seed = lcg(seed);
      const wx = (seed / 0x7fffffff) * W * 0.18;
      seed = lcg(seed);
      const wy = Math.floor(H * 0.2) + (seed / 0x7fffffff) * Math.floor(H * 0.35);
      seed = lcg(seed);
      const ww = 3 + (seed / 0x7fffffff) * 5;
      seed = lcg(seed);
      const wh = 4 + (seed / 0x7fffffff) * 8;
      seed = lcg(seed);
      const wa = 0.1 + (seed / 0x7fffffff) * 0.3;
      const win = new PIXI.Graphics();
      win.rect(wx, wy, ww, wh).fill({ color: 0xFFEE88, alpha: wa });
      this.addChild(win);

      // 右側建築
      const win2 = new PIXI.Graphics();
      win2.rect(W - wx - ww, wy, ww, wh).fill({ color: 0xFFEE88, alpha: wa });
      this.addChild(win2);
    }
  }

  // ── 霓虹燈條 ──────────────────────────────────────────────────────────────

  _buildNeon(W, H) {
    // 紅色燈條（輝光 + 實體）
    const nRGlow = new PIXI.Graphics();
    nRGlow.rect(Math.floor(W * 0.15), Math.floor(H * 0.24), 4, Math.floor(H * 0.14))
          .fill({ color: 0xFF0040 });
    nRGlow.filters = [new PIXI.BlurFilter({ strength: 14, quality: 2 })];
    this.addChild(nRGlow);

    const nR = new PIXI.Graphics();
    nR.rect(Math.floor(W * 0.15), Math.floor(H * 0.24), 4, Math.floor(H * 0.14))
       .fill({ color: 0xFF0040 });
    this.addChild(nR);

    // 綠色燈條
    const nGGlow = new PIXI.Graphics();
    nGGlow.rect(Math.floor(W * 0.835), Math.floor(H * 0.21), 4, Math.floor(H * 0.095))
           .fill({ color: 0x00FF41 });
    nGGlow.filters = [new PIXI.BlurFilter({ strength: 14, quality: 2 })];
    this.addChild(nGGlow);

    const nG = new PIXI.Graphics();
    nG.rect(Math.floor(W * 0.835), Math.floor(H * 0.21), 4, Math.floor(H * 0.095))
       .fill({ color: 0x00FF41 });
    this.addChild(nG);
  }

  // ── CRT 掃描線 ─────────────────────────────────────────────────────────────

  _buildScanlines(W, H) {
    const g = new PIXI.Graphics();
    for (let y = 0; y < H; y += 3) {
      g.rect(0, y, W, 1).fill({ color: 0x000000, alpha: 0.18 });
    }
    g.eventMode = 'none';
    this.addChild(g);
  }

  // ── 標題 ─────────────────────────────────────────────────────────────────

  _buildTitle(W, H) {
    const fontSize = Math.min(Math.floor(W * 0.143), 56);
    const fontFam  = '"Noto Sans TC", "Microsoft JhengHei", "PingFang TC", sans-serif';

    // 輝光層
    const glow = new PIXI.Text({
      text: '瞿董默示錄',
      style: new PIXI.TextStyle({ fontFamily: fontFam, fontSize, fontWeight: 'bold', fill: 0xF2EBD0 }),
    });
    glow.anchor.set(0.5, 0);
    glow.x = W / 2;
    glow.y = Math.floor(H * 0.213);
    glow.filters = [new PIXI.BlurFilter({ strength: 20, quality: 3 })];
    glow.tint  = 0xFF0040;
    glow.alpha = 0.8;
    this.addChild(glow);

    // 清晰層
    const title = new PIXI.Text({
      text: '瞿董默示錄',
      style: new PIXI.TextStyle({ fontFamily: fontFam, fontSize, fontWeight: 'bold', fill: 0xF0EAD0 }),
    });
    title.anchor.set(0.5, 0);
    title.x = W / 2;
    title.y = Math.floor(H * 0.213);
    this.addChild(title);

    // 副標題（VFD 螢光）
    const subSize = Math.min(Math.floor(W * 0.033), 13);
    const subGlow = new PIXI.Text({
      text: 'QU-DON APOCALYPSE',
      style: new PIXI.TextStyle({
        fontFamily: '"VT323", "Share Tech Mono", "Courier New", monospace',
        fontSize: subSize, fill: 0x00FF41, letterSpacing: 3,
      }),
    });
    subGlow.anchor.set(0.5, 0);
    subGlow.x = W / 2;
    subGlow.y = Math.floor(H * 0.302);
    subGlow.filters = [new PIXI.BlurFilter({ strength: 4, quality: 2 })];
    subGlow.alpha = 0.7;
    this.addChild(subGlow);

    const sub = new PIXI.Text({
      text: 'QU-DON APOCALYPSE',
      style: new PIXI.TextStyle({
        fontFamily: '"VT323", "Share Tech Mono", "Courier New", monospace',
        fontSize: subSize, fill: 0x00FF41, letterSpacing: 3,
      }),
    });
    sub.anchor.set(0.5, 0);
    sub.x = W / 2;
    sub.y = Math.floor(H * 0.302);
    this.addChild(sub);

    // 時代標語
    const era = new PIXI.Text({
      text: '── 1986  洛杉磯  雨季 ──',
      style: new PIXI.TextStyle({
        fontFamily: '"Noto Sans TC", "Microsoft JhengHei", sans-serif',
        fontSize: Math.min(Math.floor(W * 0.026), 10), fill: 0x484848,
      }),
    });
    era.anchor.set(0.5, 0);
    era.x = W / 2;
    era.y = Math.floor(H * 0.427);
    this.addChild(era);
  }

  // ── 選單按鍵 ─────────────────────────────────────────────────────────────

  _buildMenu(W, H) {
    const DEFS = [
      { label: '▶  新遊戲', action: 'new_game',  accent: true  },
      { label: '載入遊戲',  action: 'load_game', accent: false },
      { label: '設定',      action: 'settings',  accent: false },
    ];

    const btnW   = Math.min(Math.floor(W * 0.513), 200);
    const btnH   = Math.min(Math.floor(H * 0.062), 52);
    const gap    = Math.max(6, Math.floor(H * 0.009));
    let   startY = Math.floor(H * 0.51);

    DEFS.forEach(({ label, action, accent }) => {
      const btn = this._makeBtn(label, btnW, btnH, accent);
      btn.x = (W - btnW) / 2;
      btn.y = startY;
      btn.on('_tap', () => this.emit('action', action));
      this.addChild(btn);
      startY += btnH + gap;
    });
  }

  _makeBtn(label, W, H, accent) {
    const c = new PIXI.Container();
    c.eventMode = 'static';
    c.cursor    = 'pointer';
    c.hitArea   = new PIXI.Rectangle(0, 0, W, H);

    const r = 3;
    const borderColor = accent ? 0xFF0040 : 0x363636;
    const fillColor   = accent ? 0x2A1616 : 0x1C1C1C;
    const textColor   = accent ? 0xFF5555 : 0x888888;
    const fontSize    = Math.floor(H * 0.31);

    const up = new PIXI.Graphics();
    up.roundRect(0, 0, W, H, r).fill({ color: fillColor });
    up.roundRect(0, 0, W, H, r).stroke({ color: borderColor, width: 1.5 });
    up.moveTo(r, 1).lineTo(W - r, 1).stroke({ color: 0xFFFFFF, width: 0.8, alpha: 0.07 });
    up.moveTo(r, H - 1).lineTo(W - r, H - 1).stroke({ color: 0x000000, width: 1, alpha: 0.4 });

    const dn = new PIXI.Graphics();
    dn.roundRect(0, 0, W, H, r).fill({ color: Math.max(0, fillColor - 0x080808) });
    dn.roundRect(0, 0, W, H, r).stroke({ color: Math.max(0, borderColor - 0x303030), width: 1.5 });
    dn.visible = false;

    const txt = new PIXI.Text({
      text: label,
      style: new PIXI.TextStyle({
        fontFamily: '"Noto Sans TC", "Microsoft JhengHei", sans-serif',
        fontSize, fontWeight: 'bold', fill: textColor,
      }),
    });
    txt.anchor.set(0.5);
    txt.x = W / 2;
    txt.y = H / 2;

    c.addChild(up, dn, txt);

    const setState = (p) => {
      up.visible = !p; dn.visible = p;
      txt.y = H / 2 + (p ? 1.5 : 0);
    };
    c.on('pointerdown',    (e) => { e.stopPropagation(); setState(true); });
    c.on('pointerup',      () => { setState(false); c.emit('_tap'); });
    c.on('pointerupoutside', () => setState(false));
    c.on('pointercancel',    () => setState(false));

    return c;
  }

  // ── 頁尾 ──────────────────────────────────────────────────────────────────

  _buildFooter(W, H) {
    const f = new PIXI.Text({
      text: '© 1986 QU-DON CORP.  版本 1.0.0',
      style: new PIXI.TextStyle({
        fontFamily: '"VT323", "Courier New", monospace',
        fontSize: Math.min(Math.floor(W * 0.023), 9), fill: 0x2A2A2A,
      }),
    });
    f.anchor.set(0.5, 1);
    f.x = W / 2;
    f.y = H - 10;
    this.addChild(f);
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
