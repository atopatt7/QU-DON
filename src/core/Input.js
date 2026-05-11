/**
 * QU-DON | src/core/Input.js  v2
 * 統一輸入管理器
 *   - PC：WASD / 方向鍵（即時方向）
 *   - Mobile：D-Pad 按鈕 / 滑動手勢
 *   - 通用：Canvas 點擊 / Tap → Grid 座標（tile-click 移動）
 *
 * 使用方式（每幀）：
 *   const state = input.update();
 *   // state.justDir      → 本幀方向鍵觸發的方向（格子移動用）
 *   // state.tileTarget   → { gx, gy } | null，玩家點擊的目標格（點擊移動用）
 *   // state.confirmJust  → 確認鍵剛按下
 *   // state.cancelJust   → 取消鍵剛按下
 *
 * 呼叫 input.setGridConfig(tileSize, offsetX, offsetY) 讓 Camera 偏移生效。
 */

export class InputManager {
  /**
   * @param {HTMLCanvasElement} canvas  Pixi 的 canvas 元素
   */
  constructor(canvas = null) {
    this._canvas  = canvas;
    this._keys    = {};
    this._actions = {};
    this._justPressed = {};

    // D-Pad 方向（手機按住狀態）
    this._dpadDir = null;

    // 格子點擊佇列（最多保留 1 個，遊戲迴圈每幀取走）
    this._tileClickQueue = null;

    // Grid → Canvas 轉換參數（由外部 Camera 設定）
    this._tileSize = 32;
    this._offsetX  = 0;
    this._offsetY  = 0;

    // 轉場鎖定（地圖切換期間暫停所有輸入）
    this._locked = false;

    // 觸控滑動
    this._touchStart = null;
    this._swipeThreshold = 28;  // px

    // 長按判斷（區分 tap vs drag）
    this._tapMaxDist = 10;  // px，超過視為滑動，不算 tap

    this._bindKeyboard();
    this._bindDPad();
    this._bindCanvasInput();
  }

  // ─── 公開設定 API ──────────────────────────────────────────────────────────

  /**
   * 每次 Camera 移動後呼叫，確保點擊座標轉換正確。
   * @param {number} tileSize  單格像素大小（含縮放後）
   * @param {number} offsetX   地圖左上角在 Canvas 內的 X offset（像素）
   * @param {number} offsetY   地圖左上角在 Canvas 內的 Y offset（像素）
   */
  setGridConfig(tileSize, offsetX, offsetY) {
    this._tileSize = tileSize;
    this._offsetX  = offsetX;
    this._offsetY  = offsetY;
  }

  /** 替換監聽的 Canvas（Pixi renderer 重建時使用） */
  setCanvas(canvas) {
    if (this._canvas) {
      this._canvas.removeEventListener('pointerdown', this._onCanvasPointer);
    }
    this._canvas = canvas;
    this._bindCanvasInput();
  }

  // ─── Keyboard ─────────────────────────────────────────────────────────────

  _bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (this._keys[e.code]) return; // 壓住不重複觸發
      this._keys[e.code] = true;
      this._justPressed[e.code] = true;
    });
    window.addEventListener('keyup', (e) => {
      this._keys[e.code] = false;
    });
  }

  _dirFromKeys() {
    if (this._keys['ArrowUp']    || this._keys['KeyW']) return 'up';
    if (this._keys['ArrowDown']  || this._keys['KeyS']) return 'down';
    if (this._keys['ArrowLeft']  || this._keys['KeyA']) return 'left';
    if (this._keys['ArrowRight'] || this._keys['KeyD']) return 'right';
    return null;
  }

  // ─── D-Pad Buttons（Mobile）──────────────────────────────────────────────

  _bindDPad() {
    const dpad = document.getElementById('dpad');
    if (!dpad) return;

    dpad.querySelectorAll('.dpad-btn').forEach(btn => {
      const dir = btn.dataset.dir;

      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this._dpadDir = dir;
        this._justPressed['__dpad__'] = true;
        btn.style.background = 'rgba(255,255,255,0.35)';
      });

      const release = () => {
        if (this._dpadDir === dir) this._dpadDir = null;
        btn.style.background = 'rgba(255,255,255,0.15)';
      };
      btn.addEventListener('pointerup',     release);
      btn.addEventListener('pointercancel', release);
      btn.addEventListener('pointerleave',  release);
    });

    // Action buttons
    document.querySelectorAll('.action-btn').forEach(btn => {
      const action = btn.dataset.action;
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this._actions[action] = true;
        this._justPressed[`__action_${action}__`] = true;
        btn.style.background = 'rgba(255,255,255,0.35)';
      });
      const release = () => {
        this._actions[action] = false;
        btn.style.background = 'rgba(255,255,255,0.15)';
      };
      btn.addEventListener('pointerup',     release);
      btn.addEventListener('pointercancel', release);
    });
  }

  // ─── Canvas 點擊 / Touch（Tile Click 移動）────────────────────────────────

  _bindCanvasInput() {
    if (!this._canvas) return;

    // 統一用 pointer events（PC + touch 相容）
    this._onCanvasPointer = this._handleCanvasPointer.bind(this);
    this._onCanvasPointerMove = this._handleCanvasDrag.bind(this);
    this._onCanvasPointerUp   = this._handleCanvasRelease.bind(this);

    this._canvas.addEventListener('pointerdown', this._onCanvasPointer);
    this._canvas.addEventListener('pointermove', this._onCanvasPointerMove);
    this._canvas.addEventListener('pointerup',   this._onCanvasPointerUp);
    this._canvas.addEventListener('pointercancel', this._onCanvasPointerUp);

    // 防止手機長按選取
    this._canvas.style.touchAction = 'none';
  }

  _handleCanvasPointer(e) {
    this._pointerDownPos = { x: e.clientX, y: e.clientY };
    this._pointerMoved   = false;
    this._touchStart     = { x: e.clientX, y: e.clientY };
  }

  _handleCanvasDrag(e) {
    if (!this._pointerDownPos) return;
    const dx = e.clientX - this._pointerDownPos.x;
    const dy = e.clientY - this._pointerDownPos.y;
    if (Math.hypot(dx, dy) > this._tapMaxDist) {
      this._pointerMoved = true;
    }
  }

  _handleCanvasRelease(e) {
    if (!this._pointerDownPos) return;
    this._pointerDownPos = null;
    // Tile-click 移動已停用：僅透過方向鍵 / D-Pad 控制移動
  }

  // ─── 主更新（每幀呼叫）───────────────────────────────────────────────────

  /**
   * 消費本幀所有輸入，回傳快照。
   * @returns {{
   *   direction:   string|null,
   *   justMoved:   boolean,
   *   justDir:     string|null,
   *   tileTarget:  {gx:number,gy:number}|null,
   *   confirmJust: boolean,
   *   cancelJust:  boolean,
   *   action:      object,
   *   raw:         object,
   * }}
   */
  update() {
    // 轉場鎖定期間：清空所有佇列，回傳空白狀態
    if (this._locked) {
      this._justPressed    = {};
      this._tileClickQueue = null;
      return {
        direction: null, justMoved: false, justDir: null,
        tileTarget: null, confirmJust: false, cancelJust: false,
        action: {}, raw: {},
      };
    }

    const keyDir    = this._dirFromKeys();
    const swipeDir  = this._justPressed['__swipeDir__'] || null;
    const dpadDir   = this._dpadDir;

    // 優先級：鍵盤 > D-Pad > Swipe
    const heldDir   = keyDir || dpadDir || null;
    const justDir   = (
      this._justPressed['ArrowUp']    || this._justPressed['KeyW']    ? 'up'    :
      this._justPressed['ArrowDown']  || this._justPressed['KeyS']    ? 'down'  :
      this._justPressed['ArrowLeft']  || this._justPressed['KeyA']    ? 'left'  :
      this._justPressed['ArrowRight'] || this._justPressed['KeyD']    ? 'right' :
      this._justPressed['__dpad__'] || this._justPressed['__inject__'] ? dpadDir :
      swipeDir
    ) || null;

    const justMoved = !!justDir;

    // 格子點擊目標（消費後清空）
    const tileTarget = this._tileClickQueue || null;
    this._tileClickQueue = null;

    // Confirm / Cancel
    const confirmJust = !!(
      this._justPressed['Space'] || this._justPressed['Enter'] ||
      this._justPressed['__action_confirm__']
    );
    const cancelJust = !!(
      this._justPressed['Escape'] || this._justPressed['__action_cancel__']
    );

    // 清空 justPressed（每幀只觸發一次）
    this._justPressed = {};

    return {
      direction:   heldDir,
      justMoved,
      justDir,
      tileTarget,
      confirmJust,
      cancelJust,
      action: { ...this._actions },
      raw:    { ...this._keys },
    };
  }

  // ─── ControlPanel 注入 API ────────────────────────────────────────────────
  // 渲染/輸入分離：ControlPanel 不直接操作 DOM，改呼叫這兩個方法

  /**
   * 由 ControlPanel 的 MembraneButton press/release 事件呼叫。
   * @param {string|null} dir  'up'|'down'|'left'|'right'|null
   */
  injectDir(dir) {
    const wasNone = !this._dpadDir;
    this._dpadDir = dir;
    // 有方向且是從無到有 → 視為 justPressed（格子移動用）
    if (dir && wasNone) {
      this._justPressed['__inject__'] = true;
    }
  }

  /**
   * 由 ControlPanel 的 Action 按鈕呼叫。
   * @param {string}  action   'confirm' | 'cancel'
   * @param {boolean} pressed  true = 按下，false = 放開
   */
  injectAction(action, pressed) {
    this._actions[action] = pressed;
    if (pressed) {
      this._justPressed[`__action_${action}__`] = true;
    }
  }

  // ─── 轉場鎖定 API ────────────────────────────────────────────────────────

  /** 鎖定輸入（地圖轉場期間呼叫），防止幽靈移動。 */
  lock() { this._locked = true; }

  /** 解除鎖定（轉場完成後呼叫）。 */
  unlock() { this._locked = false; }
}
