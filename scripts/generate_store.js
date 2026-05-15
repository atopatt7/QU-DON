#!/usr/bin/env node
/**
 * scripts/generate_store.js
 * 1. 擴建黑石街南側 y=24~38，新增便利商店入口
 * 2. 生成 src/data/maps/map_convenience_store.json（10×10）
 * 3. 將 Tile 300-305 寫入 src/data/maps/config.json
 *
 * 執行：node scripts/generate_store.js
 */

'use strict';
const fs   = require('fs');
const path = require('path');

// ─────────────────────────────────────────────────────────────────────────────
// PART 1: 擴建黑石街南側
// ─────────────────────────────────────────────────────────────────────────────
const brsPath = path.join(__dirname, '../src/data/maps/map_black_rock_street.json');
const brs     = JSON.parse(fs.readFileSync(brsPath, 'utf8'));

const BW = brs.width;   // 40
const BH = brs.height;  // 40
const at  = (x, y) => y * BW + x;

const gnd = brs.layers.ground;
const obj = brs.layers.objects;
const col = brs.collision;

// ── 工具：以 x 為 seed 做出有變化的路面 ──────────────────────────────────────
const roadTile = (x, y) => {
  const h = (x * 17 + y * 31) % 16;
  if (h < 2)  return 4;  // 水坑
  if (h < 5)  return 2;  // 裂縫路面
  return 1;               // 一般柏油
};

// 南側各列設定
for (let y = 24; y <= 38; y++) {
  for (let x = 0; x < BW; x++) {
    const i = at(x, y);

    // y=31~38：後排建築 + 南側外牆（全封閉）
    if (y >= 31) {
      gnd[i] = 0;
      obj[i] = 20;
      col[i] = 1;
      continue;
    }

    const isWall = (x === 0 || x === BW - 1);

    // ── y=28：便利商店建築正面 ──────────────────────────────────────────────
    if (y === 28) {
      gnd[i] = isWall ? 0 : 10;
      obj[i] = (x === 20) ? 300 : 20;  // x=20 是自動門
      col[i] = 1;                        // 整行不可通行
      continue;
    }

    // ── 側牆（x=0, x=39）：y=24~30 ─────────────────────────────────────────
    if (isWall) {
      gnd[i] = 0;
      obj[i] = 20;
      col[i] = 1;
      continue;
    }

    // ── 內部：依列類型填入 ──────────────────────────────────────────────────
    if (y === 24 || y === 27 || y === 29 || y === 30) {
      // 人行道
      gnd[i] = ((x + y) % 5 === 0) ? 11 : 10;
      obj[i] = 0;
      col[i] = 0;
    } else {
      // y=25, 26：道路
      gnd[i] = roadTile(x, y);
      obj[i] = 0;
      col[i] = 0;
    }
  }
}

// 補上便利商店路燈（y=29 兩側）
const addLight = (gx, gy, color, radius, intensity, flicker, interval, label) => {
  brs.lights.push({ gx, gy, radius, color, intensity, flicker,
    ...(interval ? { flickerInterval: interval } : {}),
    ...(label    ? { label }                      : {}) });
};
addLight(16, 29, '0xffffff', 3, 0.50, false, null, '便利商店外招牌（白）');
addLight(24, 29, '0xffffff', 3, 0.50, false, null, '便利商店外招牌（白）');
addLight(20, 26, '0x00ccff', 2, 0.35, true, 2400, '便利商店霓虹藍光');

// 新增傳送點
brs.warps.push({
  id:        'warp_to_convenience_store',
  gx:        20,
  gy:        29,
  targetMap: 'map_convenience_store',
  targetGx:  5,
  targetGy:  8,
  direction: 'up',
  label:     '便利商店',
  active:    true,
});

fs.writeFileSync(brsPath, JSON.stringify(brs));
console.log('✓ map_black_rock_street.json 更新完成');
console.log(`  南側開放格: ${[24,25,26,27,29,30].map(y =>
  Array.from({length: BW - 2}, (_, x) => col[at(x+1, y)]).filter(v => v === 0).length
).reduce((a,b) => a+b, 0)} 格`);

// ─────────────────────────────────────────────────────────────────────────────
// PART 2: 生成便利商店地圖 (10×10)
// ─────────────────────────────────────────────────────────────────────────────
const SW = 10;
const SH = 10;
const SSIZE = SW * SH;
const sat = (x, y) => y * SW + x;

const sGnd = new Array(SSIZE).fill(301);
const sObj = new Array(SSIZE).fill(0);
const sCol = new Array(SSIZE).fill(0);

// ── 四周牆壁 ─────────────────────────────────────────────────────────────────
for (let x = 0; x < SW; x++) {
  for (let y = 0; y < SH; y++) {
    if (x === 0 || x === SW - 1 || y === 0) {
      sObj[sat(x, y)] = 302;
      sCol[sat(x, y)] = 1;
    }
  }
}
// 南牆（y=9）：除了 x=5 作為出口
for (let x = 0; x < SW; x++) {
  if (x !== 5) {
    sObj[sat(x, 9)] = 302;
    sCol[sat(x, 9)] = 1;
  }
  // x=5 保持 sObj=0, sCol=0（出口/傳送點）
}

// ── y=1：天花板燈管（小裝飾用，不阻擋，僅視覺）────────────────────────────
// 不加物件，地板燈光由 lights 陣列處理

// ── 收銀台 x=2~3, y=2 ───────────────────────────────────────────────────────
for (let x = 2; x <= 3; x++) {
  sObj[sat(x, 2)] = 304;
  sCol[sat(x, 2)] = 1;
}

// ── 零食貨架 x=6~8, y=3~5 ───────────────────────────────────────────────────
for (let x = 6; x <= 8; x++) {
  for (let y = 3; y <= 5; y++) {
    sObj[sat(x, y)] = 303;
    sCol[sat(x, y)] = 1;
  }
}

// ── 飲料冰櫃 x=1, y=4~7 ─────────────────────────────────────────────────────
for (let y = 4; y <= 7; y++) {
  sObj[sat(1, y)] = 305;
  sCol[sat(1, y)] = 1;
}

// ─────────────────────────────────────────────────────────────────────────────
const storeData = {
  id:           'map_convenience_store',
  name:         'Convenience Store',
  subtitle:     '24小時便利商店 — 螢光燈嗡嗡作響，收銀機的鍵盤已磨到看不清數字',
  width:        SW,
  height:       SH,
  tileSize:     48,
  visionRadius: 6,
  configRef:    'src/data/maps/config.json',

  layers: { ground: sGnd, objects: sObj },
  collision: sCol,

  warps: [
    {
      id:        'exit_to_black_rock',
      gx:        5,
      gy:        9,
      targetMap: 'map_black_rock_street',
      targetGx:  20,
      targetGy:  30,
      direction: 'down',
      label:     '黑石街',
      active:    true,
    },
  ],

  triggers: [],

  spawnPoints: [
    { id: 'spawn_from_black_rock', gx: 5, gy: 8, facing: 'up' },
    { id: 'clerk_spawn',           gx: 3, gy: 1, facing: 'down' },
  ],

  lights: [
    // 店內螢光燈（白色冷光）
    { gx: 3, gy: 3, radius: 4, color: '0xe8f4ff', intensity: 0.55, flicker: false },
    { gx: 7, gy: 3, radius: 4, color: '0xe8f4ff', intensity: 0.55, flicker: false },
    { gx: 3, gy: 7, radius: 4, color: '0xe8f4ff', intensity: 0.55, flicker: false },
    { gx: 7, gy: 7, radius: 4, color: '0xe8f4ff', intensity: 0.55, flicker: false },
    // 冰櫃藍光
    { gx: 1, gy: 5, radius: 3, color: '0x44aaff', intensity: 0.45, flicker: true, flickerInterval: 3000, label: '飲料冰櫃藍光' },
  ],

  ambience: {
    music:       null,
    lightLevel:  0.65,
    rainOverlay: false,
    weather:     'clear',
  },

  displayName: '便利商店',
};

const storeOut = path.join(__dirname, '../src/data/maps/map_convenience_store.json');
fs.writeFileSync(storeOut, JSON.stringify(storeData));
console.log(`✓ map_convenience_store.json 輸出 → ${storeOut}`);
console.log(`  尺寸 ${SW}×${SH} = ${SSIZE} 格`);
console.log(`  可通行格: ${sCol.filter(v => v === 0).length}  障礙格: ${sCol.filter(v => v === 1).length}`);

// ─────────────────────────────────────────────────────────────────────────────
// PART 3: 更新 config.json — 新增 tile 300-305
// ─────────────────────────────────────────────────────────────────────────────
const configPath = path.join(__dirname, '../src/data/maps/config.json');
const config     = JSON.parse(fs.readFileSync(configPath, 'utf8'));

const newTiles = {
  '300': {
    name:     'store_auto_door',
    group:    'convenience_store',
    walkable: false,
    collides: true,
    draw:     'store_door',
    color:    '0x88ccee',
    _light:   { radius: 3, color: '0xffffff', intensity: 0.55 },
    desc:     '便利商店自動玻璃門（帶金屬框，透出白色日光燈）',
  },
  '301': {
    name:     'store_floor',
    group:    'convenience_store',
    walkable: true,
    collides: false,
    draw:     'store_floor',
    color:    '0xd8e8ec',
    sfx:      'footstep_tile',
    desc:     '超商塑膠拋光地板（白底灰格紋）',
  },
  '302': {
    name:     'store_wall',
    group:    'convenience_store',
    walkable: false,
    collides: true,
    draw:     'store_wall',
    color:    '0x2a2a30',
    desc:     '超商內牆（貼滿促銷海報與廣告貼紙）',
  },
  '303': {
    name:     'store_shelf',
    group:    'convenience_store',
    walkable: false,
    collides: true,
    draw:     'store_shelf',
    color:    '0x28201c',
    desc:     '零食貨架（陳列微波食品、罐頭、泡麵）',
  },
  '304': {
    name:     'store_counter',
    group:    'convenience_store',
    walkable: false,
    collides: true,
    draw:     'store_counter',
    color:    '0x1c1a18',
    _light:   { radius: 2, color: '0xffee88', intensity: 0.35 },
    desc:     '收銀台（老舊收銀機，鍵盤磨損，螢光燈在閃爍）',
  },
  '305': {
    name:     'store_fridge',
    group:    'convenience_store',
    walkable: false,
    collides: true,
    draw:     'store_fridge',
    color:    '0x0e1a28',
    _light:   { radius: 3, color: '0x44aaff', intensity: 0.45 },
    desc:     '飲料冰櫃（透明玻璃門，透出冷冷的藍光）',
  },
};

let added = 0;
for (const [id, def] of Object.entries(newTiles)) {
  if (!config.tiles[id]) {
    config.tiles[id] = def;
    added++;
  }
}

if (!config._comment_groups) config._comment_groups = {};
config._comment_groups.convenience_store = '300-305 (便利商店專用 tiles)';

fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
console.log(`✓ config.json 更新 → 新增 ${added} 個 tile 定義（300-305）`);
