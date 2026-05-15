/**
 * QU-DON | src/modules/DataManager.js
 * 模組化 NPC 實體資料載入器
 *
 * 架構：
 *   registry.json  → ID → 檔案路徑對照表
 *   actors/[id].json → 標準化角色資料（Stats / Visuals / Behavior）
 *
 * 使用：
 *   const dm   = await DataManager.create();
 *   const data = await dm.loadActorData('enemy_pickpocket');
 */

const BASE_URL = './src/data/entities/';

export class DataManager {

  constructor() {
    this._registry = null;           // registry.json 內容
    this._cache    = new Map();      // actorId → 已載入的資料物件
  }

  // ── 靜態工廠（預先載入 registry）──────────────────────────────────────────
  static async create() {
    const dm = new DataManager();
    await dm._loadRegistry();
    return dm;
  }

  // ─── 載入 registry.json ────────────────────────────────────────────────────
  async _loadRegistry() {
    const resp = await fetch(`${BASE_URL}registry.json`);
    if (!resp.ok) throw new Error('[DataManager] 無法載入 registry.json');
    this._registry = await resp.json();
  }

  // ─── 載入單一角色資料 ─────────────────────────────────────────────────────
  /**
   * 根據 actorId 從 registry 查找路徑，動態載入對應 JSON。
   * 結果會被快取，同一 ID 不重複請求。
   *
   * @param {string} actorId  — 對應 registry.json 的 key（例如 'enemy_pickpocket'）
   * @returns {Promise<Object>} 角色資料物件
   */
  async loadActorData(actorId) {
    // ── 快取命中：直接回傳 ─────────────────────────────────────────────────
    if (this._cache.has(actorId)) return this._cache.get(actorId);

    // ── 確保 registry 已載入（防禦：直接 new 而非 create() 時的保險）──────
    if (!this._registry) await this._loadRegistry();

    const relPath = this._registry[actorId];
    if (!relPath) {
      throw new Error(`[DataManager] registry 中找不到 actorId: "${actorId}"`);
    }

    // ── 動態載入角色 JSON ──────────────────────────────────────────────────
    const resp = await fetch(`${BASE_URL}${relPath}`);
    if (!resp.ok) {
      throw new Error(`[DataManager] 無法載入角色檔案: ${relPath} (HTTP ${resp.status})`);
    }

    const data = await resp.json();
    this._cache.set(actorId, data);
    return data;
  }

  // ─── 批次載入（Promise.all 版）────────────────────────────────────────────
  /**
   * 同時載入多個角色，比逐一呼叫更快。
   * @param {string[]} actorIds
   * @returns {Promise<Object[]>}
   */
  async loadActorDataBatch(actorIds) {
    return Promise.all(actorIds.map(id => this.loadActorData(id)));
  }

  // ─── 清除快取（地圖切換時可選用）─────────────────────────────────────────
  clearCache() {
    this._cache.clear();
  }
}
