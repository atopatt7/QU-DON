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
    this.partyNames = {}; // id → 顯示名稱（隊伍人脈介面用）
    this.flags  = {};   // 劇情布林旗標，例如 { "met_lena": true, "office_unlocked": false }
    this.inventory = []; // [{ id, qty }]
    this.itemDefs  = []; // items.json 的 items 陣列

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
  recruitNpc(id, name = id) {
    if (this.party.includes(id)) return;
    this.party.push(id);
    this.partyNames[id] = name;
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

  // ── 背包 ────────────────────────────────────────────────────────────────────
  // inventory 由 main.js 指定（與 InventoryScreen 共用同一個陣列，必須原地修改）

  itemDef(id)  { return this.itemDefs.find(d => d.id === id) ?? null; }
  itemName(id) { const d = this.itemDef(id); return d?.name_zh ?? d?.name ?? id; }

  itemCount(id) { return this.inventory.find(e => e.id === id)?.qty ?? 0; }
  hasItem(id, qty = 1) { return this.itemCount(id) >= qty; }

  addItem(id, qty = 1) {
    const entry = this.inventory.find(e => e.id === id);
    if (entry) entry.qty += qty;
    else this.inventory.push({ id, qty });
    this.emit('inventory:change', { id, qty });
  }

  removeItem(id, qty = 1) {
    const entry = this.inventory.find(e => e.id === id);
    if (!entry || entry.qty < qty) return false;
    entry.qty -= qty;
    if (entry.qty === 0) this.inventory.splice(this.inventory.indexOf(entry), 1);
    this.emit('inventory:change', { id, qty: -qty });
    return true;
  }

  // ── 資料驅動條件 ────────────────────────────────────────────────────────────
  /**
   * 判斷物件上的條件欄位是否成立（缺少的欄位視為成立）：
   *   if:           "flag" | ["flag", ...]   全部旗標為真
   *   ifNot:        "flag" | ["flag", ...]   全部旗標為假
   *   requiresItem: "itemId" | { id, qty }   背包持有足夠數量
   */
  meets(cond) {
    if (!cond) return true;
    const list = v => (v == null ? [] : Array.isArray(v) ? v : [v]);
    if (!list(cond.if).every(f => this.getFlag(f)))     return false;
    if (list(cond.ifNot).some(f => this.getFlag(f)))     return false;
    for (const req of list(cond.requiresItem)) {
      const { id, qty = 1 } = typeof req === 'string' ? { id: req } : req;
      if (!this.hasItem(id, qty)) return false;
    }
    return true;
  }

  /**
   * 依 variants 解析目前生效的資料：第一個條件成立的 variant 覆寫 base 欄位。
   * 回傳 { ...base, ...variant, _variant: index（-1 = 未套用 variant）}
   */
  resolveVariant(base) {
    const variants = base?.variants ?? [];
    const idx = variants.findIndex(v => this.meets(v));
    const { variants: _omit, ...rest } = base;
    if (idx < 0) return { ...rest, _variant: -1 };
    const { if: _if, ifNot: _ifNot, requiresItem: _req, ...overrides } = variants[idx];
    return { ...rest, ...overrides, _variant: idx };
  }
}
