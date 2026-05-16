#!/usr/bin/env node
/**
 * scripts/remap_sequential_ids.js
 * 將 1000-1999 範圍的黑石街圖塊 ID 緊湊化為連續序列（從 1000 開始）
 *
 * 執行：node scripts/remap_sequential_ids.js
 */
'use strict';
const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// ─── Step 1：從 config.json 收集並排序所有 1000-1999 的 ID ──────────────────
const configPath = path.join(ROOT, 'src/data/maps/config.json');
const config     = JSON.parse(fs.readFileSync(configPath, 'utf8'));

const oldIds = Object.keys(config.tiles)
  .map(Number)
  .filter(id => id >= 1000 && id <= 1999)
  .sort((a, b) => a - b);

console.log(`\n找到 ${oldIds.length} 個 1000-1999 範圍的圖塊 ID`);

// ─── Step 2：建立映射表 old→new ────────────────────────────────────────────
const mapping = {};
oldIds.forEach((oldId, i) => {
  mapping[oldId] = 1000 + i;
});

// 印出完整映射表
console.log('\n═══════════════════════════════════════════');
console.log('  舊 ID  →  新 ID   │  tiles name');
console.log('───────────────────────────────────────────');
for (const [old, neu] of Object.entries(mapping)) {
  const tileName = config.tiles[old]?.name ?? '(unknown)';
  const marker   = old == 1304 ? ' ← counter tile!' : '';
  console.log(`  ${String(old).padEnd(6)} →  ${String(neu).padEnd(7)}  │  ${tileName}${marker}`);
}
console.log('═══════════════════════════════════════════\n');

// 確認 counter tile
const counterNew = mapping[1304];
console.log(`✓ counter tile: 1304 → ${counterNew}  (PASSTHROUGH_TILES 將更新為 new Set([${counterNew}]))\n`);

// ─── 工具：用於 JS 原始碼的整數精確取代（降序，避免前綴污染）──────────────────
// 只在非數字字元邊界取代（word boundary for digits）
function remapInCode(src, mapDesc) {
  // 降序排列舊 ID 以避免 1001 substring 干擾 10010 之類（這裡不存在但保險起見）
  const descEntries = Object.entries(mapDesc).sort((a, b) => Number(b[0]) - Number(a[0]));
  let out = src;
  for (const [oldStr, newId] of descEntries) {
    // 使用 (?<!\d) 和 (?!\d) 確保只匹配完整數字
    const re = new RegExp(`(?<!\\d)${oldStr}(?!\\d)`, 'g');
    out = out.replace(re, String(newId));
  }
  return out;
}

// ─── Step 3：更新 config.json ──────────────────────────────────────────────
{
  const newTiles = {};
  // 先把非 1000-1999 的 tile 原樣保留（hakka 2xxx 等）
  for (const [k, v] of Object.entries(config.tiles)) {
    const n = Number(k);
    if (n >= 1000 && n <= 1999) {
      newTiles[mapping[n]] = v;
    } else {
      newTiles[n] = v;
    }
  }
  config.tiles = newTiles;
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log('✓ config.json 更新完成');
}

// ─── Step 4：更新所有地圖 JSON（layers.ground + layers.objects）──────────────
const MAP_FILES = [
  'map_black_rock_street.json',
  'map_neon_bar.json',
  'map_hakka_street.json',
  'map_qu_don_room.json',
  'map_back_alley.json',
  'map_underground_parking.json',
  'map_convenience_store.json',
];

for (const mf of MAP_FILES) {
  const mpath = path.join(ROOT, 'src/data/maps', mf);
  if (!fs.existsSync(mpath)) { console.log(`  ⚠ 跳過（不存在）: ${mf}`); continue; }

  const mapData = JSON.parse(fs.readFileSync(mpath, 'utf8'));

  const remap = arr => arr.map(id => {
    if (id >= 1000 && id <= 1999 && mapping[id] !== undefined) return mapping[id];
    return id;
  });

  if (mapData.layers?.ground)  mapData.layers.ground  = remap(mapData.layers.ground);
  if (mapData.layers?.objects) mapData.layers.objects = remap(mapData.layers.objects);
  // ⚠ 不動 collision[]！那是 0/1 二進位碰撞資料

  fs.writeFileSync(mpath, JSON.stringify(mapData));
  console.log(`✓ ${mf} 更新完成`);
}

// ─── Step 5：更新 MapManager.js ───────────────────────────────────────────
{
  const mmPath = path.join(ROOT, 'src/modules/MapManager.js');
  let   src    = fs.readFileSync(mmPath, 'utf8');

  // 降序取代，避免較短 ID 先被取代後污染較長 ID 的轉換
  src = remapInCode(src, mapping);

  fs.writeFileSync(mmPath, src);
  console.log('✓ MapManager.js 更新完成');
}

// ─── Step 6：更新 InteractionManager.js ───────────────────────────────────
{
  const imPath = path.join(ROOT, 'src/modules/InteractionManager.js');
  let   src    = fs.readFileSync(imPath, 'utf8');

  src = remapInCode(src, mapping);

  fs.writeFileSync(imPath, src);
  console.log('✓ InteractionManager.js 更新完成');
}

// ─── Step 7：更新 generate_store.js（其中硬寫了 1xxx tile ID）──────────────
{
  const gsPath = path.join(ROOT, 'scripts/generate_store.js');
  let   src    = fs.readFileSync(gsPath, 'utf8');

  src = remapInCode(src, mapping);

  fs.writeFileSync(gsPath, src);
  console.log('✓ generate_store.js 更新完成');
}

// ─── 摘要 ─────────────────────────────────────────────────────────────────
console.log(`\n完成！共重新映射 ${oldIds.length} 個圖塊 ID（1000 ~ ${1000 + oldIds.length - 1}）`);
console.log(`counter tile (原 1304) 新 ID：${counterNew}`);
