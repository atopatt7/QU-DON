/**
 * QU-DON | src/ui/ControlPanel.js
 *
 * 底部控制面板（佔螢幕下方 34%）
 *
 * ┌─────────────────────────────────────────────────────────────┐
 * │ ▓▓▓▓▓▓▓▓▓▓▓▓▓  深色木紋背景  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │ ← 金邊分隔線
 * │                                                             │
 * │  [D-Pad 十字]              [○確] [○取]                     │
 * │     ▲                                                       │
 * │  ◀  ■  ▶          [VFD 時鐘] 00:00:00                     │
 * │     ▼                                                       │
 * │                                                             │
 * │ ≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡  CRT 掃描線疊加  ≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡ │
 * └─────────────────────────────────────────────────────────────┘
 *
 * 架構分離原則：
 *   ◆ 渲染邏輯 — 完全由 Pixi.js 處理，在此類中
 *   ◆ 輸入邏輯 — 透過 InputManager.injectDir() / .injectAction() 傳遞
 *   ◆ 不使用任何 DOM addEventListener（由 MembraneButton 的 Pixi 事件接管）
 *
 * 使用方式：
 *   const panel = await ControlPanel.create(app, inputManager);
 *   app.stage.addChild(panel);
 */

import { MembraneButton } from './MembraneButton.js';
import { VFDClock }       from './VFDClock.js';

// ─── 常數 ──────────────────────────────────────────────────────────────────────

const PANEL_RATIO   = 0.34;   // 面板佔螢幕高度比例
const DPAD_MARGIN_L = 28;     // D-Pad 左邊距（px）
const ACT_MARGIN_R  = 28;     // Action 按鈕右邊距（px）
const CLOCK_MARGIN  = { x: 14, bottom: 10 }; // VFD 時鐘邊距

// D-Pad 方向定義
const DPAD_DIRS = [
  { dir: 'up',    label: '▲', col: 1, row: 0 },
  { dir: 'left',  label: '◀', col: 0, row: 1 },
  { dir: 'right', label: '▶', col: 2, row: 1 },
  { dir: 'down',  label: '▼', col: 1, row: 2 },
];

// ─── ControlPanel ──────────────────────────────────────────────────────────────

export class ControlPanel extends PIXI.Container {

  constructor(app, inputManager) {
    super();
    this._app    = app;
    this._input  = inputManager;

    // AudioContext（需使用者互動後解鎖）
    this._audioCtx  = null;
    this._buttons   = [];
    this._clock     = null;
    this._resizeOff = null;

    this._unlockAudio = this._unlockAudioCtx.bind(this);
    window.addEventListener('pointerdown', this._unlockAudio, { once: true });
  }

  // ─── 工廠方法（非同步，處理貼圖載入）──────────────────────────────────────

  /**
   * @param {PIXI.Application} app
   * @param {InputManager}     inputManager
   * @returns {Promise<ControlPanel>}
   */
  static async create(app, inputManager) {
    const panel = new ControlPanel(app, inputManager);
    await panel._loadAssets();
    panel._build();
    panel._bindResize();
    return panel;
  }

  // ─── 資源載入（貼圖回退） ─────────────────────────────────────────────────

  async _loadAssets() {
    const tryLoad = async (url) => {
      try {
        return await PIXI.Assets.load(url);
      } catch (_) {
        return null; // 找不到貼圖時回退到程式繪製
      }
    };

    [this._texWood, this._texBtnUp, this._texBtnDn] = await Promise.all([
      tryLoad('assets/ui/dark_wood_texture.jpg'),
      tryLoad('assets/ui/btn_membrane_up.png'),
      tryLoad('assets/ui/btn_membrane_down.png'),
    ]);
  }

  // ─── 建置面板 ──────────────────────────────────────────────────────────────

  _build() {
    const { width: W, height: H } = this._app.screen;
    const panelH = Math.floor(H * PANEL_RATIO);
    this.x = 0;
    this.y = H - panelH;

    // 計算自適應按鈕尺寸（限制最大值避免 PC 端過大）
    const btnSize = Math.min(Math.floor(panelH * 0.27), 62);
    const gap     = Math.max(3, Math.floor(btnSize * 0.07));
    const actSize = Math.min(Math.floor(panelH * 0.31), 68);

    // ── 層序 ──────────────────────────────────────────────────────────────
    this.addChild(this._buildBackground(W, panelH));    // 最底層
    this.addChild(this._buildTopDivider(W));            // 金邊分隔線
    this.addChild(this._buildDPad(btnSize, gap, panelH)); // D-Pad
    this.addChild(this._buildActionCluster(actSize, panelH, W)); // 右側按鈕
    this._clock = this._buildClock(panelH);
    this.addChild(this._clock);
    this.addChild(this._buildScanlines(W, panelH));     // 最頂層（不攔截事件）
  }

  // ── 1. 背景 ─────────────────────────────────────────────────────────────

  _buildBackground(W, H) {
    const bg = new PIXI.Container();

    if (this._texWood) {
      // 鋪磚貼圖
      const tile = new PIXI.TilingSprite({
        texture:    this._texWood,
        width:      W,
        height:     H,
      });
      tile.tileScale.set(0.45); // 縮小以顯示木紋細節
      bg.addChild(tile);

      // 半透明深色壓暗層（確保控件可讀）
      const dim = new PIXI.Graphics();
      dim.rect(0, 0, W, H).fill({ color: 0x000000, alpha: 0.50 });
      bg.addChild(dim);
    } else {
      bg.addChild(this._drawProceduralWood(W, H));
    }

    return bg;
  }

  /** 程式繪製程序性木紋（無貼圖回退） */
  _drawProceduralWood(W, H) {
    const root = new PIXI.Container();
    const gfx  = new PIXI.Graphics();

    // 基底色（深胡桃木）
    gfx.rect(0, 0, W, H).fill({ color: 0x16100a });

    // 低頻寬木紋條帶
    const lcg = (s) => (s * 1664525 + 1013904223) & 0x7fffffff;
    let seed = 42;
    for (let i = 0; i < 20; i++) {
      seed = lcg(seed);
      const y     = (seed / 0x7fffffff) * H;
      seed = lcg(seed);
      const thick = 2 + (seed / 0x7fffffff) * 6;
      seed = lcg(seed);
      const alpha = 0.04 + (seed / 0x7fffffff) * 0.06;
      gfx.rect(0, y, W, thick).fill({ color: 0x4a2c0e, alpha });
    }

    // 高頻細紋理
    for (let i = 0; i < 55; i++) {
      seed = lcg(seed);
      const y     = (seed / 0x7fffffff) * H;
      seed = lcg(seed);
      const alpha = 0.02 + (seed / 0x7fffffff) * 0.025;
      gfx.rect(0, y, W, 1).fill({ color: 0x241808, alpha });
    }

    // 四角暗角漸層（用多個半透明矩形模擬）
    for (let i = 0; i < 6; i++) {
      const d = i * 8;
      gfx.rect(0, H - d * 2, W, d * 2)
        .fill({ color: 0x000000, alpha: 0.04 + i * 0.02 });
    }

    root.addChild(gfx);
    return root;
  }

  // ── 2. 頂部金邊分隔線 ──────────────────────────────────────────────────

  _buildTopDivider(W) {
    const gfx = new PIXI.Graphics();
    gfx.rect(0, 0, W, 2).fill({ color: 0x7a6030 }); // 金邊
    gfx.rect(0, 2, W, 1).fill({ color: 0x080604 }); // 陰影
    gfx.rect(0, 3, W, 1).fill({ color: 0x3a2c10, alpha: 0.4 }); // 柔化
    return gfx;
  }

  // ── 3. D-Pad 十字 ────────────────────────────────────────────────────────

  _buildDPad(btnSize, gap, panelH) {
    const dpad = new PIXI.Container();

    // 十字置中計算
    const crossW = btnSize * 3 + gap * 2;
    const crossH = btnSize * 3 + gap * 2;

    DPAD_DIRS.forEach(({ dir, label, col, row }) => {
      const btn = new MembraneButton({
        label,
        dir,
        texUp:   this._texBtnUp,
        texDown: this._texBtnDn,
        size:    btnSize,
        audioCtx: this._audioCtx,
      });

      btn.x = col * (btnSize + gap);
      btn.y = row * (btnSize + gap);

      // ◆ 輸入邏輯委派給 InputManager（渲染/輸入分離）
      btn.on('press',   (d) => this._input.injectDir(d));
      btn.on('release', ()  => this._input.injectDir(null));

      dpad.addChild(btn);
      this._buttons.push(btn);
    });

    // 十字中心裝飾（黑色小方塊）
    const center = new PIXI.Graphics();
    center.roundRect(btnSize + gap, btnSize + gap, btnSize, btnSize, 4)
      .fill({ color: 0x0c0906 });
    center.roundRect(btnSize + gap, btnSize + gap, btnSize, btnSize, 4)
      .stroke({ color: 0x2a1e0a, width: 1 });
    // 小圓點
    center.circle(
      btnSize + gap + btnSize / 2,
      btnSize + gap + btnSize / 2,
      btnSize * 0.12
    ).fill({ color: 0x3a2c10 });
    dpad.addChildAt(center, 0);

    // 定位：靠左，垂直置中
    dpad.x = DPAD_MARGIN_L;
    dpad.y = (panelH - crossH) / 2;

    return dpad;
  }

  // ── 4. Action 按鈕叢集（右側）────────────────────────────────────────────

  _buildActionCluster(actSize, panelH, W) {
    const cluster = new PIXI.Container();

    const BTN_DEFS = [
      { label: '確\n認', action: 'confirm', color: 0x0f2008, border: 0x2a5010 },
      { label: '取\n消', action: 'cancel',  color: 0x200808, border: 0x501010 },
    ];

    const clusterW = BTN_DEFS.length * actSize + (BTN_DEFS.length - 1) * 14;

    BTN_DEFS.forEach(({ label, action, color, border }, i) => {
      const btn = this._buildRoundActionBtn(label, actSize, color, border);
      btn.x = i * (actSize + 14);
      btn.y = 0;

      // ◆ 委派輸入
      btn.on('_press',   () => this._input.injectAction(action, true));
      btn.on('_release', () => this._input.injectAction(action, false));

      cluster.addChild(btn);
    });

    cluster.x = W - clusterW - ACT_MARGIN_R;
    cluster.y = (panelH - actSize) / 2;

    return cluster;
  }

  /** 圓形 Action 按鈕（帶環形邊框） */
  _buildRoundActionBtn(label, size, fillColor, borderColor) {
    const c = new PIXI.Container();
    c.eventMode = 'static';
    c.cursor    = 'pointer';
    c.hitArea   = new PIXI.Circle(size / 2, size / 2, size / 2);

    const r = size / 2;

    // 一般態
    const up = new PIXI.Graphics();
    up.circle(r, r, r).fill({ color: fillColor });
    up.circle(r, r, r).stroke({ color: borderColor, width: 2.5 });
    // 環形高光
    up.arc(r, r, r - 3, Math.PI * 1.1, Math.PI * 1.9)
      .stroke({ color: 0xffffff, width: 1, alpha: 0.08 });

    // 按下態
    const dn = new PIXI.Graphics();
    dn.circle(r + 1, r + 1, r - 1).fill({ color: Math.max(0, fillColor - 0x040202) });
    dn.circle(r + 1, r + 1, r - 1).stroke({ color: Math.max(0, borderColor - 0x101010), width: 2 });
    dn.visible = false;

    // 標籤
    const txt = new PIXI.Text({
      text: label,
      style: new PIXI.TextStyle({
        fontFamily: '"Courier New", monospace',
        fontSize:   Math.floor(size * 0.24),
        fill:       0xb8a870,
        fontWeight: 'bold',
        align:      'center',
        lineHeight: Math.floor(size * 0.28),
      }),
    });
    txt.anchor.set(0.5);
    txt.x = r;
    txt.y = r;

    c.addChild(up, dn, txt);

    // 狀態切換
    const setState = (pressed) => {
      up.visible = !pressed;
      dn.visible =  pressed;
      txt.x = r + (pressed ? 1 : 0);
      txt.y = r + (pressed ? 1.5 : 0);
    };

    c.on('pointerdown', (e) => {
      e.stopPropagation();
      setState(true);
      this._playThump();
      c.emit('_press');
    });
    const release = () => { setState(false); c.emit('_release'); };
    c.on('pointerup',        release);
    c.on('pointerupoutside', release);
    c.on('pointercancel',    release);

    return c;
  }

  // ── 5. VFD 時鐘 ────────────────────────────────────────────────────────────

  _buildClock(panelH) {
    const fontSize = Math.max(14, Math.floor(panelH * 0.13));
    const clock    = new VFDClock({ color: 'green', fontSize });
    clock.x = CLOCK_MARGIN.x;
    clock.y = panelH - clock.displayHeight - CLOCK_MARGIN.bottom;
    return clock;
  }

  // ── 6. CRT 掃描線疊加 ────────────────────────────────────────────────────

  _buildScanlines(W, H) {
    const gfx = new PIXI.Graphics();
    const step = 3; // 每 3px 一條
    for (let y = 0; y < H; y += step) {
      gfx.rect(0, y, W, 1).fill({ color: 0x000000, alpha: 0.14 });
    }
    gfx.eventMode = 'none'; // 穿透，不攔截下層點擊事件
    return gfx;
  }

  // ─── 視窗縮放 ─────────────────────────────────────────────────────────────

  _bindResize() {
    const handler = ({ width, height }) => {
      // 銷毀舊時鐘（清除 setInterval）
      if (this._clock) {
        this._clock.destroy({ children: true });
        this._clock = null;
      }
      this._buttons = [];
      this.removeChildren();
      this._build();
    };
    this._app.stage.on('resize', handler);
    // 儲存以便 destroy 時移除
    this._resizeHandler = handler;
  }

  // ─── AudioContext 解鎖（首次觸控後啟用音效）─────────────────────────────

  _unlockAudioCtx() {
    if (this._audioCtx) return;
    try {
      this._audioCtx = new AudioContext();
      // 傳遞給所有已建立的按鈕
      this._buttons.forEach(btn => { btn.audioCtx = this._audioCtx; });
    } catch (_) {}
  }

  // ─── 合成 thump（Action 按鈕共用）────────────────────────────────────────

  _playThump() {
    const ctx = this._audioCtx;
    if (!ctx) return;
    try {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      const t = ctx.currentTime;
      osc.frequency.setValueAtTime(85, t);
      osc.frequency.exponentialRampToValueAtTime(20, t + 0.09);
      gain.gain.setValueAtTime(0.22, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      osc.start(t);
      osc.stop(t + 0.12);
    } catch (_) {}
  }

  // ─── 生命週期 ─────────────────────────────────────────────────────────────

  destroy(opts) {
    if (this._clock)   this._clock.destroy({ children: true });
    if (this._resizeHandler) this._app.stage.off('resize', this._resizeHandler);
    window.removeEventListener('pointerdown', this._unlockAudio);
    super.destroy(opts);
  }
}
