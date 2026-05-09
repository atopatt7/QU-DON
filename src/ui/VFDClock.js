/**
 * QU-DON | src/ui/VFDClock.js
 *
 * VFD（真空螢光管）風格數位時鐘
 *
 * 渲染技術：
 *   Layer 1 — 模糊輝光層（BlurFilter，同色低透明度）
 *   Layer 2 — 清晰文字層（正常渲染）
 *   Layer 3 — 細節段落底色（未亮起的「暗段」模擬，可選）
 *
 * 字型建議：
 *   - 第一選擇：'VT323'（Google Fonts）— 最接近 VFD 點陣風格
 *   - 第二選擇：'Share Tech Mono'（Google Fonts）
 *   - 回退：'Courier New'（系統內建）
 *
 * 使用：
 *   const clock = new VFDClock({ color: 'green', fontSize: 22 });
 *   stage.addChild(clock);
 *   // 銷毀時記得呼叫：
 *   clock.destroy({ children: true });
 */

export class VFDClock extends PIXI.Container {
  /**
   * @param {object}           opts
   * @param {'green'|'amber'}  [opts.color='green']   燈色主題
   * @param {number}           [opts.fontSize=22]      字型大小（px）
   * @param {boolean}          [opts.showSeconds=true] 是否顯示秒數
   */
  constructor({ color = 'green', fontSize = 22, showSeconds = true } = {}) {
    super();

    this._showSeconds = showSeconds;

    // ── 色彩主題 ────────────────────────────────────────────────────────
    const THEMES = {
      green: { bright: 0x00FF41, mid: 0x00CC33, dim: 0x003310, glow: 0x00FF41 },
      amber: { bright: 0xFFB000, mid: 0xCC8800, dim: 0x331800, glow: 0xFF9900 },
    };
    this._theme = THEMES[color] ?? THEMES.green;

    // ── 字型樣式 ────────────────────────────────────────────────────────
    const fontFamily = '"VT323", "Share Tech Mono", "Courier New", monospace';

    // Layer 3：暗段底色（模擬 VFD 未亮起的段落）
    this._dimText = new PIXI.Text({
      text: '88:88:88',
      style: new PIXI.TextStyle({
        fontFamily,
        fontSize,
        fill:          this._theme.dim,
        letterSpacing: 3,
      }),
    });
    this.addChild(this._dimText);

    // Layer 1：輝光層
    this._glowText = new PIXI.Text({
      text: '',
      style: new PIXI.TextStyle({
        fontFamily,
        fontSize,
        fill:          this._theme.glow,
        letterSpacing: 3,
      }),
    });
    this._glowFilter = new PIXI.BlurFilter({ strength: 8, quality: 4 });
    this._glowText.filters = [this._glowFilter];
    this._glowText.alpha   = 0.5;
    this.addChild(this._glowText);

    // Layer 2：清晰層
    this._mainText = new PIXI.Text({
      text: '',
      style: new PIXI.TextStyle({
        fontFamily,
        fontSize,
        fill:          this._theme.bright,
        letterSpacing: 3,
      }),
    });
    this.addChild(this._mainText);

    // ── 秒數閃爍冒號（可選裝飾）────────────────────────────────────────
    this._colonVisible = true;

    // ── 開始計時 ────────────────────────────────────────────────────────
    this._update();
    this._interval = setInterval(() => this._update(), 1000);
  }

  // ─── 私有：更新時間顯示 ────────────────────────────────────────────────────

  _update() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');

    const hh = pad(now.getHours());
    const mm = pad(now.getMinutes());
    const ss = pad(now.getSeconds());

    // 秒數冒號交替閃爍（每 500ms 在 setInterval 1000ms 之間已是固定，
    // 這裡做 on/off 輪替）
    this._colonVisible = !this._colonVisible;
    const sep = this._colonVisible ? ':' : ' ';

    const timeStr = this._showSeconds
      ? `${hh}${sep}${mm}${sep}${ss}`
      : `${hh}${sep}${mm}`;

    this._mainText.text = timeStr;
    this._glowText.text = timeStr;

    // 暗段底色長度要與顯示內容等長
    this._dimText.text = this._showSeconds ? '88:88:88' : '88:88';
  }

  // ─── 公開 API ─────────────────────────────────────────────────────────────

  /** 切換燈色（'green' | 'amber'） */
  setColor(color) {
    const THEMES = {
      green: { bright: 0x00FF41, mid: 0x00CC33, dim: 0x003310, glow: 0x00FF41 },
      amber: { bright: 0xFFB000, mid: 0xCC8800, dim: 0x331800, glow: 0xFF9900 },
    };
    this._theme = THEMES[color] ?? THEMES.green;

    this._mainText.style.fill  = this._theme.bright;
    this._glowText.style.fill  = this._theme.glow;
    this._dimText.style.fill   = this._theme.dim;
  }

  /** 取得目前顯示寬度（用於外部對齊） */
  get displayWidth()  { return this._mainText.width; }
  get displayHeight() { return this._mainText.height; }

  // ─── 生命週期 ──────────────────────────────────────────────────────────────

  /** 必須呼叫，否則 setInterval 會洩漏 */
  destroy(opts) {
    clearInterval(this._interval);
    super.destroy(opts);
  }
}
