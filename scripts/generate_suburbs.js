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

function idx(x, y) { return y * W + x; }

// ── 西郊地圖（細分區域）───────────────────────────────────────────────────────
function buildWestSuburb() {
  const ground    = new Array(W * H).fill(0);
  const objects   = new Array(W * H).fill(0);
  const collision = new Array(W * H).fill(0);

  // ── 1. 中央公路 Y=17~21 ──────────────────────────────────────────────────
  for (let y = 17; y <= 21; y++) {
    for (let x = 0; x < W; x++) {
      ground[idx(x, y)] = (y === 19) ? 1005 : 1000; // 1005=水平雙黃線
    }
  }

  // ── 2. 上方工地 Y=0~16 ───────────────────────────────────────────────────
  for (let y = 0; y <= 16; y++) {
    for (let x = 0; x < W; x++) {
      ground[idx(x, y)] = 1038; // 泥土地
    }
  }

  // Y=16 圍籬，X=10~14 留空作為工地入口
  for (let x = 0; x < W; x++) {
    if (x < 10 || x > 14) {
      objects[idx(x, 16)]   = 1040; // 鐵皮圍籬
      collision[idx(x, 16)] = 1;
    }
  }

  // 工地內部 Y=5~10, X=5~15：ㄇ字型水泥管障礙，圍出可行走動線
  // 左列 X=5, Y=5~10
  for (let y = 5; y <= 10; y++) {
    objects[idx(5, y)]   = 1039;
    collision[idx(5, y)] = 1;
  }
  // 右列 X=15, Y=5~10
  for (let y = 5; y <= 10; y++) {
    objects[idx(15, y)]   = 1039;
    collision[idx(15, y)] = 1;
  }
  // 頂排 X=6~14, Y=5（ㄇ頂部）
  for (let x = 6; x <= 14; x++) {
    objects[idx(x, 5)]   = 1039;
    collision[idx(x, 5)] = 1;
  }
  // 中間散置幾塊（增加視覺密度，不封死動線）
  [[8, 8], [11, 7], [13, 9], [7, 10]].forEach(([x, y]) => {
    objects[idx(x, y)]   = 1039;
    collision[idx(x, y)] = 1;
  });

  // ── 3. 下方流浪漢營地 Y=22~39 ────────────────────────────────────────────
  for (let y = 22; y <= 39; y++) {
    for (let x = 0; x < W; x++) {
      ground[idx(x, y)] = 1038;
    }
  }

  // Y=22 圍籬，X=25~29 留空作為營地入口
  for (let x = 0; x < W; x++) {
    if (x < 25 || x > 29) {
      objects[idx(x, 22)]   = 1040;
      collision[idx(x, 22)] = 1;
    }
  }

  // 營地內部 Y=28~32, X=20~30：帳篷圍住中央營火
  // 帳篷群（邊緣散置）
  [
    [20, 28], [22, 28], [28, 28], [30, 28],
    [20, 32], [22, 32], [28, 32], [30, 32],
    [20, 30], [30, 30],
  ].forEach(([x, y]) => {
    objects[idx(x, y)]   = 1041; // 帳篷
    collision[idx(x, y)] = 1;
  });

  // 中央營火區 3×3（X=23~25, Y=29~31）
  // 四角放鐵桶，中心保持空曠（玩家可站立）
  [[23, 29], [25, 29], [23, 31], [25, 31]].forEach(([x, y]) => {
    objects[idx(x, y)]   = 1042; // 鐵桶
    collision[idx(x, y)] = 1;
  });
  // 額外路邊鐵桶
  [[27, 26], [21, 27], [29, 33]].forEach(([x, y]) => {
    objects[idx(x, y)]   = 1042;
    collision[idx(x, y)] = 1;
  });

  return {
    id:       'map_black_rock_west_suburb',
    name:     'Black Rock 西郊',
    subtitle: '黑石街向西延伸的街道，路燈稀疏，柏油路龜裂。',
    width: W, height: H,
    tileSize: 48,
    visionRadius: 6,
    configRef: 'src/data/maps/config.json',
    layers: { ground, objects },
    collision,
    warps: [
      {
        id: 'exit_west', gx: 0, gy: 19,
        targetMap: 'map_hakka_east_suburb', targetGx: 38, targetGy: 19,
        direction: 'left', label: '哈卡東郊', active: true,
      },
      {
        id: 'exit_east', gx: 39, gy: 19,
        targetMap: 'map_black_rock_street', targetGx: 1, targetGy: 19,
        direction: 'right', label: '黑石街', active: true,
      },
    ],
    triggers: [],
    spawnPoints: [
      { id: 'spawn_from_east', gx: 38, gy: 19, facing: 'left' },
      { id: 'spawn_from_west', gx: 1,  gy: 19, facing: 'right' },
    ],
    ambience: {
      colorTint:  '0x101510',
      lightLevel: 0.55,
    },
    metadata: {
      author: 'QU-DON dev', version: '1.0',
      created: new Date().toISOString().slice(0, 10),
      tags: ['outdoor', 'suburb', 'construction', 'transit'],
    },
  };
}

// ── 東郊地圖（基礎版，全柏油路）────────────────────────────────────────────────
function buildEastSuburb() {
  const SIZE = W * H;
  return {
    id:       'map_hakka_east_suburb',
    name:     '哈卡街東郊',
    subtitle: '哈卡街東端邊界，潮濕的柏油路反射著遠處的霓虹。',
    width: W, height: H,
    tileSize: 48,
    visionRadius: 6,
    configRef: 'src/data/maps/config.json',
    layers: {
      ground:  Array(SIZE).fill(2000),
      objects: Array(SIZE).fill(0),
    },
    collision: Array(SIZE).fill(0),
    warps: [
      {
        id: 'exit_west', gx: 0, gy: 19,
        targetMap: 'map_hakka_street', targetGx: 38, targetGy: 19,
        direction: 'left', label: '哈卡街', active: true,
      },
      {
        id: 'exit_east', gx: 39, gy: 19,
        targetMap: 'map_black_rock_west_suburb', targetGx: 1, targetGy: 19,
        direction: 'right', label: 'Black Rock 西郊', active: true,
      },
    ],
    triggers: [],
    spawnPoints: [
      { id: 'spawn_from_west', gx: 1,  gy: 19, facing: 'right' },
      { id: 'spawn_from_east', gx: 38, gy: 19, facing: 'left' },
    ],
    ambience: {
      colorTint:  '0x101018',
      lightLevel: 0.6,
    },
    metadata: {
      author: 'QU-DON dev', version: '1.0',
      created: new Date().toISOString().slice(0, 10),
      tags: ['outdoor', 'suburb', 'transit'],
    },
  };
}

// ── 寫檔 ──────────────────────────────────────────────────────────────────────
const maps = [buildWestSuburb(), buildEastSuburb()];

for (const map of maps) {
  const dest = path.join(OUT_DIR, `${map.id}.json`);
  fs.writeFileSync(dest, JSON.stringify(map, null, 2), 'utf8');
  console.log(`✓ 寫入 ${dest}`);
}
console.log('Done.');
