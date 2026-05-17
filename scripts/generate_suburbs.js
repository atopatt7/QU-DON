#!/usr/bin/env node
/**
 * scripts/generate_suburbs.js
 * 自動生成兩張 40×40 郊區過渡地圖並寫入 src/data/maps/
 *
 * 用法：node scripts/generate_suburbs.js
 */

const fs   = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', 'src', 'data', 'maps');
const W = 40, H = 40;
const SIZE = W * H;

// ── 通用地圖骨架 ──────────────────────────────────────────────────────────────
function makeMap({ id, name, subtitle, groundFill, warps }) {
  return {
    id,
    name,
    subtitle,
    width:  W,
    height: H,
    tileSize: 48,
    visionRadius: 6,
    configRef: 'src/data/maps/config.json',
    layers: {
      ground:  Array(SIZE).fill(groundFill),
      objects: Array(SIZE).fill(0),
    },
    collision: Array(SIZE).fill(0),
    warps,
    triggers:    [],
    spawnPoints: [],
    ambience: {
      colorTint:  '0x101010',
      lightLevel: 0.7,
    },
    metadata: {
      author:  'QU-DON dev',
      version: '1.0',
      created: new Date().toISOString().slice(0, 10),
      tags:    ['outdoor', 'suburb', 'transit'],
    },
  };
}

// ── 地圖定義 ──────────────────────────────────────────────────────────────────
const maps = [
  makeMap({
    id:       'map_black_rock_west_suburb',
    name:     'Black Rock 西郊',
    subtitle:  '黑石街向西延伸的街道，路燈稀疏，柏油路龜裂。',
    groundFill: 1000,
    warps: [
      {
        id: 'exit_west',
        gx: 0, gy: 19,
        targetMap: 'map_hakka_east_suburb',
        targetGx: 38, targetGy: 19,
        direction: 'left',
        label: '哈卡東郊',
        sprite: 'interface/warp_arrow_base.png',
        rotation: 0,
        active: true,
      },
      {
        id: 'exit_east',
        gx: 39, gy: 19,
        targetMap: 'map_black_rock_street',
        targetGx: 1, targetGy: 19,
        direction: 'right',
        label: '黑石街',
        sprite: 'interface/warp_arrow_base.png',
        rotation: 90,
        active: true,
      },
    ],
  }),

  makeMap({
    id:       'map_hakka_east_suburb',
    name:     '哈卡街東郊',
    subtitle:  '哈卡街東端邊界，潮濕的柏油路反射著遠處的霓虹。',
    groundFill: 2000,
    warps: [
      {
        id: 'exit_west',
        gx: 0, gy: 19,
        targetMap: 'map_hakka_street',
        targetGx: 38, targetGy: 19,
        direction: 'left',
        label: '哈卡街',
        sprite: 'interface/warp_arrow_base.png',
        rotation: 0,
        active: true,
      },
      {
        id: 'exit_east',
        gx: 39, gy: 19,
        targetMap: 'map_black_rock_west_suburb',
        targetGx: 1, targetGy: 19,
        direction: 'right',
        label: 'Black Rock 西郊',
        sprite: 'interface/warp_arrow_base.png',
        rotation: 90,
        active: true,
      },
    ],
  }),
];

// ── 寫檔 ──────────────────────────────────────────────────────────────────────
for (const map of maps) {
  const dest = path.join(OUT_DIR, `${map.id}.json`);
  fs.writeFileSync(dest, JSON.stringify(map, null, 2), 'utf8');
  console.log(`✓ 寫入 ${dest}`);
}
console.log('Done.');
