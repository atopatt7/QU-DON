/**
 * QU-DON | src/ui/MembraneButton.js
 *
 * 可重用薄膜按鈕（Membrane Button）Pixi.js 組件
 *
 * 模式：
 *   A) 貼圖模式 — 傳入 texUp / texDown 時使用
 *   B) 回退模式 — 無貼圖時程式繪製 noir 風格按鈕
 *
 * 音效：使用 Web Audio API 合成 "thump"，不依賴音效檔
 *
 * 事件（透過 Pixi EventEmitter）：
 *   'press'   → (dir: string)  按下時觸發
 *   'release' → (dir: string)  放開時觸發
 *
 * 架構原則（渲染 / 輸入分離）：
 *   - MembraneButton 只負責視覺狀態與發出事件
 *   - 誰監聽事件、如何處理輸入邏輯，由 ControlPanel 決定
 */

export class MembraneButton extends PIXI.Container {
  /**
   * @param {object}         opts
   * @param {string}         opts.label        顯示文字（▲▼◀▶）
   * @param {string}         opts.dir          方向 ID，'up'|'down'|'left'|'right'
   * @param {PIXI.Texture}   [opts.texUp]      一般態貼圖（可省略）
   * @param {PIXI.Texture}   [opts.texDown]    按下態貼圖（可省略）
   * @param {AudioContext}   [opts.audioCtx]   音效 Context（可省略，互動後再傳入）
   * @param {number}         [opts.size=64]    按鈕正方形尺寸（像素）
   */
  constructor({ label = '', dir = '', texUp = null, texDown = null, audioCtx = null, size = 64 }) {
    super();

    this._dir      = dir;
    this._size     = size;
    this._pressed  = false;
    this.audioCtx  = audioCtx; // 公開，ControlPanel 解鎖 AudioContext 後設定

    // ── 視覺層 ────────────────────────────────────────────────────────────
    this._bg = new PIXI.Container();
    this.addChild(this._bg);

    if (texUp && texDown) {
      this._buildTexture(texUp, texDown);
    } else {
      this._buildFallback();
    }

    // ── 文字標籤 ──────────────────────────────────────────────────────────
    this._lbl = new PIXI.Text({
      text: label,
      style: new PIXI.TextStyle({
        fontFamily: '"Courier New", monospace',
        fontSize:   Math.floor(size * 0.34),
        fill:       0xc8b880,
        fontWeight: 'bold',
      }),
    });
    this._lbl.anchor.set(0.5);
    this._lbl.x = size / 2;
    this._lbl.y = size / 2;
    this.addChild(this._lbl);

    // ── 互動 ──────────────────────────────────────────────────────────────
    this.eventMode = 'static';
    this.cursor    = 'pointer';
    this.hitArea   = new PIXI.Rectangle(0, 0, size, size);

    this.on('pointerdown',    this._onPress,   this);
    this.on('pointerup',      this._onRelease, this);
    this.on('pointerupoutside', this._onRelease, this);
    this.on('pointercancel',  this._onRelease, this);
  }

  // ─── 建置：貼圖模式 ──────────────────────────────────────────────────────

  _buildTexture(texUp, texDown) {
    const s = this._size;

    this._sprUp = new PIXI.Sprite(texUp);
    this._sprUp.width  = s;
    this._sprUp.height = s;

    this._sprDown = new PIXI.Sprite(texDown);
    this._sprDown.width  = s;
    this._sprDown.height = s;
    this._sprDown.visible = false;

    this._bg.addChild(this._sprUp, this._sprDown);
  }

  // ─── 建置：程式繪製回退 ───────────────────────────────────────────────────

  _buildFallback() {
    const s = this._size;

    // 一般態
    const up = new PIXI.Graphics();
    // 底板
    up.roundRect(0, 0, s, s, 6).fill({ color: 0x28200e });
    // 頂部高光（浮雕感）
    up.moveTo(4, s - 5).lineTo(4, 4).lineTo(s - 5, 4)
      .stroke({ color: 0x5a4820, width: 1.5 });
    // 底部陰影
    up.moveTo(5, s - 4).lineTo(s - 4, s - 4).lineTo(s - 4, 4)
      .stroke({ color: 0x080604, width: 1.5 });
    // 薄膜圓盤
    up.circle(s / 2, s / 2, s * 0.36).fill({ color: 0x1c1609 });
    up.circle(s / 2, s / 2, s * 0.36).stroke({ color: 0x3e2e12, width: 1.5 });
    // 反射高光
    up.ellipse(s / 2 - s * 0.09, s / 2 - s * 0.10, s * 0.09, s * 0.06)
      .fill({ color: 0x4a3820, alpha: 0.55 });

    // 按下態
    const dn = new PIXI.Graphics();
    dn.roundRect(0, 0, s, s, 6).fill({ color: 0x1a1508 });
    dn.moveTo(4, s - 5).lineTo(4, 4).lineTo(s - 5, 4)
      .stroke({ color: 0x080604, width: 1.5 });
    dn.moveTo(5, s - 4).lineTo(s - 4, s - 4).lineTo(s - 4, 4)
      .stroke({ color: 0x3a2a0e, width: 1.5 });
    dn.circle(s / 2 + 1, s / 2 + 1.5, s * 0.34).fill({ color: 0x100d05 });
    dn.circle(s / 2 + 1, s / 2 + 1.5, s * 0.34).stroke({ color: 0x28200a, width: 1.5 });
    dn.visible = false;

    this._sprUp   = up;
    this._sprDown = dn;
    this._bg.addChild(up, dn);
  }

  // ─── 狀態切換 ──────────────────────────────────────────────────────────────

  _setState(pressed) {
    this._pressed         = pressed;
    this._sprUp.visible   = !pressed;
    this._sprDown.visible =  pressed;
    // 按下時文字微微下沉
    this._lbl.y = this._size / 2 + (pressed ? 1.5 : 0);
  }

  // ─── 事件處理 ─────────────────────────────────────────────────────────────

  _onPress(e) {
    e.stopPropagation();
    this._setState(true);
    this._playThump();
    this.emit('press', this._dir);
  }

  _onRelease() {
    if (!this._pressed) return;
    this._setState(false);
    this.emit('release', this._dir);
  }

  // ─── 合成音效：低頻 thump ──────────────────────────────────────────────────

  _playThump() {
    const ctx = this.audioCtx;
    if (!ctx) return;
    try {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      // 細微失真（機械感）
      const wave = ctx.createWaveShaper();
      wave.curve = MembraneButton._distortionCurve(80);

      osc.connect(wave);
      wave.connect(gain);
      gain.connect(ctx.destination);

      osc.type = 'sine';
      const t = ctx.currentTime;
      osc.frequency.setValueAtTime(95, t);
      osc.frequency.exponentialRampToValueAtTime(18, t + 0.09);
      gain.gain.setValueAtTime(0.28, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
      osc.start(t);
      osc.stop(t + 0.13);
    } catch (_) { /* 靜默失敗 */ }
  }

  /** 建立 WaveShaper 失真曲線 */
  static _distortionCurve(amount) {
    const n = 256;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      curve[i] = ((Math.PI + amount) * x) / (Math.PI + amount * Math.abs(x));
    }
    return curve;
  }

  // ─── Getter ────────────────────────────────────────────────────────────────
  get dir() { return this._dir; }
  get isPressed() { return this._pressed; }
}
