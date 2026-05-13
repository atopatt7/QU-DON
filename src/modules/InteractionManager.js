/**
 * QU-DON | src/modules/InteractionManager.js
 * 環境調查系統 — 玩家面對特定 Tile 按確認鍵觸發對話框描述
 *
 * 使用方式（main.js 遊戲迴圈）：
 *   if (state.confirmJust) {
 *     if (interaction.isActive) interaction.advance();
 *     else                      interaction.tryInteract(player.gx, player.gy, facing);
 *   }
 *
 * 設計守則：
 *   - 不修改 MapManager._isDirty（純讀取，不觸發重渲染）
 *   - 不使用 input.lock()（避免阻斷確認鍵自身的讀取）
 *   - 調查中 main.js 提前 return，lerp 動畫同步暫停
 */

// ─── 環境描述資料表（Tile ID → 對話內容）────────────────────────────────────────
const TILE_EXAMINE = {
  41: {
    speaker: '（環境）',
    text: '這張床雖然硬，但在黑石街，能躺著睡覺已經是奢侈。',
  },
  43: {
    speaker: '（環境）',
    text: '播著無止盡的雪花，這台老古董快撐不下去了。',
  },
  44: {
    speaker: '（環境）',
    text: '水龍頭滴著帶有鏽味的水，提醒著你時間正在流逝。',
  },
  45: {
    speaker: '（環境）',
    text: '皮革已經龜裂。曾經你在這決定過無數人的生死，現在只能用來發呆。',
  },
};

// ─── 面向 → 前方格子偏移量 ─────────────────────────────────────────────────────
const FACING_DELTA = {
  up:    [  0, -1 ],
  down:  [  0,  1 ],
  left:  [ -1,  0 ],
  right: [  1,  0 ],
};

export class InteractionManager {
  /**
   * @param {import('../modules/MapManager.js').MapManager} mapManager
   * @param {import('../ui/DialogueOverlay.js').DialogueOverlay} dialogueOverlay
   */
  constructor(mapManager, dialogueOverlay) {
    this._map    = mapManager;
    this._dlg    = dialogueOverlay;
    this._active = false;
  }

  // ─── 公開 API ──────────────────────────────────────────────────────────────

  /**
   * 玩家按下確認鍵時呼叫。
   * 偵測玩家正前方一格的 objects 層 Tile ID，若有描述則顯示對話框。
   * @param {number} gx      玩家當前格 X
   * @param {number} gy      玩家當前格 Y
   * @param {string} facing  玩家面向 ('up'|'down'|'left'|'right')
   * @returns {boolean}  true 表示對話已觸發
   */
  tryInteract(gx, gy, facing) {
    if (this._active) return false;

    const [dx, dy] = FACING_DELTA[facing] ?? [0, 1];
    const tx = gx + dx;
    const ty = gy + dy;

    const md = this._map.mapData;
    if (!md) return false;

    // 邊界守護：確保目標格在地圖範圍內
    if (tx < 0 || ty < 0 || tx >= md.width || ty >= (md.height ?? Infinity)) return false;

    // 優先查 objects 層（家具 / 牆壁），fallback 到 ground 層（地板）
    const idx    = ty * md.width + tx;
    const tileId = md.layers.objects?.[idx] || md.layers.ground?.[idx] || 0;
    const entry  = TILE_EXAMINE[tileId];
    if (!entry) return false;

    this._active      = true;
    this._dlg.visible = true;
    this._dlg.show(entry.text, entry.speaker);

    // 對話結束（'next' 由 DialogueOverlay 在打字完成後點擊時 emit）
    this._dlg.once('next', () => this._close());

    return true;
  }

  /**
   * 對話框開啟期間，鍵盤確認鍵呼叫此方法。
   * 打字中 → 立即顯示全文；打字完成 → 關閉對話框。
   */
  advance() {
    if (!this._active) return;
    this._dlg.advance();
  }

  /** 對話框是否正在顯示中（用於 main.js 封鎖移動輸入） */
  get isActive() { return this._active; }

  // ─── 內部 ──────────────────────────────────────────────────────────────────

  _close() {
    this._active      = false;
    this._dlg.visible = false;
  }
}
