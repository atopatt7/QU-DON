/**
 * QU-DON | src/core/GameStateManager.js
 * 遊戲狀態機 — 管理所有畫面切換
 */

export const GameState = {
  HOME:      'HOME',
  WORLD:     'WORLD',
  BATTLE:    'BATTLE',
  DIALOGUE:  'DIALOGUE',
  INVENTORY: 'INVENTORY',
};

export class GameStateManager extends PIXI.EventEmitter {
  constructor() {
    super();
    this._state    = GameState.HOME;
    this._previous = null;
    this._locked   = false;

    // ── 隊伍與劇情旗標（主要欄位）────────────────────────────────────────────
    this.party  = [];   // 已招募 NPC id 陣列（新標準欄位）
    this.flags  = {};   // 劇情布林旗標，例如 { "met_lena": true, "office_unlocked": false }

    // 向後相容別名（舊代碼可繼續用）
    this.recruitedNpcs = this.party;
    this.npcFlags      = this.flags;
  }

  get state()    { return this._state; }
  get previous() { return this._previous; }

  is(state) { return this._state === state; }

  transition(newState, data = {}) {
    if (this._locked || newState === this._state) return;
    const from     = this._state;
    this._previous = from;
    this._state    = newState;
    this.emit('change', { from, to: newState, data });
    console.log(`[GSM] ${from} → ${newState}`);
  }

  /** 暫時鎖定（轉場動畫期間） */
  lock()   { this._locked = true; }
  unlock() { this._locked = false; }

  // ── NPC 招募方法 ────────────────────────────────────────────────────────────

  /**
   * 將 NPC 加入隊伍，並 emit 'party:join' 通知訂閱者（例如 EntityManager 切換跟隨行為）。
   * @param {string} id  — NPC 實例 id（對應 npcs_*.json 的 "id" 欄位）
   */
  recruitNpc(id) {
    if (this.party.includes(id)) return;
    this.party.push(id);
    // EntityManager / WorldMapScreen 可訂閱此事件切換 AI 行為
    this.emit('party:join', { id });
    console.log(`[GSM] 招募 → ${id}  隊伍人數：${this.party.length}`);
  }

  isRecruited(id) {
    return this.party.includes(id);
  }

  /**
   * 設定劇情旗標，並 emit 'flag:set' 供任務系統或地圖觸發器監聽。
   * @param {string}  flagId
   * @param {*}       value   — 預設 true；可傳任何值（string / number 等）
   */
  setFlag(flagId, value = true) {
    this.flags[flagId] = value;
    this.emit('flag:set', { flagId, value });
    console.log(`[GSM] 旗標 ${flagId} = ${value}`);
  }

  getFlag(flagId) {
    return this.flags[flagId] ?? false;
  }

  // 向後相容方法名
  setNpcFlag(flagId, value = true) { this.setFlag(flagId, value); }
  getNpcFlag(flagId)               { return this.getFlag(flagId); }
}
