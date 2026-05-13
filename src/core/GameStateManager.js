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

    // ── NPC 系統資料 ──────────────────────────────────────────────────────────
    this.recruitedNpcs = [];   // 已招募 NPC 的 id 陣列
    this.npcFlags      = {};   // 劇情旗標，例如 { "met_lena": true }
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

  recruitNpc(id) {
    if (!this.recruitedNpcs.includes(id)) {
      this.recruitedNpcs.push(id);
    }
  }

  isRecruited(id) {
    return this.recruitedNpcs.includes(id);
  }

  setNpcFlag(flagId, value = true) {
    this.npcFlags[flagId] = value;
  }

  getNpcFlag(flagId) {
    return this.npcFlags[flagId] ?? false;
  }
}
