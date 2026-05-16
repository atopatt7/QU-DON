#!/usr/bin/env node
/**
 * scripts/migrate_ids.js
 * 全域 Tile ID 升級：現有地圖 (BRS 區域) 所有圖塊 ID +1000
 *
 * 規則：
 *   - ID = 0 → 保持 0（void/空）
 *   - ID 200-207 → 保持（哈卡街唐人街 tiles，未來遷移至 2xxx）
 *   - 其餘 ID > 0 → +1000
 *
 * 遷移目標：
 *   地圖 JSON (layers.ground / layers.objects)
 *   config.json (tile 鍵名)
 *   MapManager.js  (TILE_PALETTE 鍵 / VARIANT_IDS / switch cases)
 *   InteractionManager.js (TILE_EXAMINE 鍵 / PASSTHROUGH_TILES)
 *
 * 執行：node scripts/migrate_ids.js
 */

'use strict';
const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// ── 遷移規則 ─────────────────────────────────────────────────────────────────
// 哈卡街圖塊保留原始 ID，其餘 > 0 均 +1000
const shouldMigrate = (id) => id > 0 && !(id >= 200 && id <= 207);
const migrate       = (id) => shouldMigrate(id) ? id + 1000 : id;

// ─────────────────────────────────────────────────────────────────────────────
// STEP 1：地圖 JSON（layers.ground + layers.objects）
// ─────────────────────────────────────────────────────────────────────────────
const MAP_FILES = [
  'map_black_rock_street.json',
  'map_convenience_store.json',
  'map_neon_bar.json',
  'map_qu_don_room.json',
  'map_qu_apartment.json',
  'map_underground_parking.json',
  'map_back_alley.json',
  'map_01.json',
  // map_hakka_street.json 不遷移（保留 200-207，未來改 2xxx）
];

const mapsDir = path.join(ROOT, 'src/data/maps');
let mapMigrated = 0;

for (const fname of MAP_FILES) {
  const fpath = path.join(mapsDir, fname);
  if (!fs.existsSync(fpath)) {
    console.warn(`  跳過（不存在）: ${fname}`);
    continue;
  }
  const data = JSON.parse(fs.readFileSync(fpath, 'utf8'));
  let changed = 0;

  for (const layerKey of ['ground', 'objects']) {
    const arr = data.layers?.[layerKey];
    if (!Array.isArray(arr)) continue;
    for (let i = 0; i < arr.length; i++) {
      const next = migrate(arr[i]);
      if (next !== arr[i]) { arr[i] = next; changed++; }
    }
  }

  fs.writeFileSync(fpath, JSON.stringify(data));
  console.log(`✓ ${fname}  (${changed} 個 tile 更新)`);
  mapMigrated++;
}
console.log(`\n地圖 JSON 完成：${mapMigrated} 個檔案\n`);

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2：config.json — 重新命名 tile 鍵
// ─────────────────────────────────────────────────────────────────────────────
const configPath = path.join(mapsDir, 'config.json');
const config     = JSON.parse(fs.readFileSync(configPath, 'utf8'));

const newTiles = {};
let cfgChanged = 0;
for (const [k, v] of Object.entries(config.tiles)) {
  const id    = parseInt(k, 10);
  const newId = migrate(id);
  newTiles[String(newId)] = v;
  if (newId !== id) cfgChanged++;
}
config.tiles = newTiles;
fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
console.log(`✓ config.json  (${cfgChanged} 個 tile 鍵重命名)\n`);

// ─────────────────────────────────────────────────────────────────────────────
// STEP 3：MapManager.js — TILE_PALETTE 鍵 / VARIANT_IDS / switch cases
// ─────────────────────────────────────────────────────────────────────────────
const mmPath = path.join(ROOT, 'src/modules/MapManager.js');
let   mm     = fs.readFileSync(mmPath, 'utf8');

// 3a. TILE_PALETTE 鍵：匹配行首空白 + 數字 + 冒號，排除 200-207 範圍
//     替換對象：  N:   →   (N+1000):
//     僅針對 TILE_PALETTE 大括號內的鍵，確保不誤觸 hex 顏色值
mm = mm.replace(/^(\s+)(\d+):(\s+\{)/gm, (match, leading, numStr, trailing) => {
  const id = parseInt(numStr, 10);
  if (!shouldMigrate(id)) return match;
  return `${leading}${id + 1000}:${trailing}`;
});

// 3b. VARIANT_IDS — 整行替換
mm = mm.replace(
  /const VARIANT_IDS\s*=\s*new Set\(\[.*?\]\);/,
  'const VARIANT_IDS   = new Set([1001, 1002, 1004, 1005, 1010, 1011, 1040, 200, 201, 202, 1301]);'
);

// 3c. switch case 語句：case N: (含任意空白)，排除 200-207
mm = mm.replace(/\bcase (\d+):/g, (match, numStr) => {
  const id = parseInt(numStr, 10);
  if (!shouldMigrate(id)) return match;
  return `case ${id + 1000}:`;
});

fs.writeFileSync(mmPath, mm);
console.log('✓ MapManager.js  (TILE_PALETTE / VARIANT_IDS / switch cases)');

// ─────────────────────────────────────────────────────────────────────────────
// STEP 4：InteractionManager.js — TILE_EXAMINE 鍵 / PASSTHROUGH_TILES
// ─────────────────────────────────────────────────────────────────────────────
const imPath = path.join(ROOT, 'src/modules/InteractionManager.js');
let   im     = fs.readFileSync(imPath, 'utf8');

// 4a. TILE_EXAMINE object 鍵：數字行
im = im.replace(/^(\s+)(\d+):\s*\{/gm, (match, leading, numStr) => {
  const id = parseInt(numStr, 10);
  if (!shouldMigrate(id)) return match;
  return `${leading}${id + 1000}: {`;
});

// 4b. PASSTHROUGH_TILES
im = im.replace(
  /const PASSTHROUGH_TILES\s*=\s*new Set\(\[.*?\]\);/,
  'const PASSTHROUGH_TILES = new Set([1304]);'
);

fs.writeFileSync(imPath, im);
console.log('✓ InteractionManager.js  (TILE_EXAMINE / PASSTHROUGH_TILES)\n');

console.log('════════════════════════════════════════');
console.log('遷移完成！請更新 sw.js 版本號後推送。');
