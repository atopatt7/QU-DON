/**
 * QU-DON | src/core/SaveSystem.js
 * 存檔與設定（localStorage）
 *
 * 存檔內容（version 1）：
 *   { version, savedAt, map, gx, gy, facing, hp, flags, inventory, party, partyNames, removedNpcs }
 *
 * localStorage 在無痕模式、部分 App 內建瀏覽器中會丟例外或容量為 0，
 * 所有讀寫都包在 try/catch 裡：存不了就當作沒有存檔，遊戲照常進行。
 */

const SAVE_KEY     = 'qudon.save.v1';
const SETTINGS_KEY = 'qudon.settings.v1';
const VERSION      = 1;

function read(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export const SaveSystem = {
  /** 是否有可讀取的存檔 */
  has() {
    return read(SAVE_KEY)?.version === VERSION;
  },

  /** @returns {object|null} */
  load() {
    const data = read(SAVE_KEY);
    return data?.version === VERSION ? data : null;
  },

  /** @returns {boolean} 是否成功寫入 */
  save(data) {
    return write(SAVE_KEY, { ...data, version: VERSION, savedAt: Date.now() });
  },

  clear() {
    try { localStorage.removeItem(SAVE_KEY); } catch { /* 無法存取就算了 */ }
  },
};

const DEFAULT_SETTINGS = { music: true };

export const Settings = {
  get() {
    return { ...DEFAULT_SETTINGS, ...(read(SETTINGS_KEY) ?? {}) };
  },
  set(patch) {
    const next = { ...Settings.get(), ...patch };
    write(SETTINGS_KEY, next);
    return next;
  },
};
