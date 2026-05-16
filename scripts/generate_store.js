#!/usr/bin/env node
/**
 * scripts/generate_store.js
 * 1. 重建黑石街便利商店建築實體 (y=28~32, x=17~23)
 * 2. 生成北側入口版便利商店地圖 (10×10，入口在 y=0)
 *
 * 注意：所有 Tile ID 使用遷移後版本（1xxx / 2xxx）
 *   1008=牆壁  1031=玻璃門  1032=地板  1033=室內牆
 *   1019=貨架  1008=收銀台  1000=冰櫃  1006/1007=人行道  1000/1000=路面
 *
 * 執行：node scripts/generate_store.js
 */
'use strict';
const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// ─────────────────────────────────────────────────────────────────────────────
// PART 1：修整黑石街建築實體
// ─────────────────────────────────────────────────────────────────────────────
const brsPath = path.join(ROOT, 'src/data/maps/map_black_rock_street.json');
const brs     = JSON.parse(fs.readFileSync(brsPath, 'utf8'));
const BW      = brs.width;  // 40
const at      = (x, y) => y * BW + x;

const gnd = brs.layers.ground;
const obj = brs.layers.objects;
const col = brs.collision;

// 道路地面 seed（輸出已遷移的 ID）
const roadTile = (x, y) => {
  const h = (x * 17 + y * 31) % 16;
  if (h < 2) return 1000;   // 水坑
  if (h < 5) return 1000;   // 裂縫路面
  return 1000;               // 一般柏油
};

// ── y=24~38：街道 + 建築正面 ─────────────────────────────────────────────────
// 建築佔地：x=17~23，y=28~32
const BLDG_X0 = 17, BLDG_X1 = 23;
const BLDG_Y0 = 28, BLDG_Y1 = 32;

for (let y = 24; y <= 38; y++) {
  for (let x = 0; x < BW; x++) {
    const i = at(x, y);

    // 超出建築南邊以下 → 全部實心背景牆
    if (y > BLDG_Y1) {
      gnd[i] = 0;
      obj[i] = 1008;
      col[i] = 1;
      continue;
    }

    const isMapEdge = (x === 0 || x === BW - 1);

    // ── 建築實體區域 (x=17~23, y=28~32) ──────────────────────────────────
    if (x >= BLDG_X0 && x <= BLDG_X1 && y >= BLDG_Y0 && y <= BLDG_Y1) {
      if (y === BLDG_Y0 && x === 20) {
        // 唯一入口：自動門
        gnd[i] = 1006;
        obj[i] = 1031;
        col[i] = 0;      // 可踩上觸發 Warp
      } else {
        // 建築牆壁
        gnd[i] = 0;
        obj[i] = 1008;
        col[i] = 1;
      }
      continue;
    }

    // ── 地圖邊牆 ─────────────────────────────────────────────────────────
    if (isMapEdge) {
      gnd[i] = 0;
      obj[i] = 1008;
      col[i] = 1;
      continue;
    }

    // ── 街道內部：依列決定地面類型 ─────────────────────────────────────
    switch (y) {
      case 24: case 27: case 29: case 30:   // 人行道
        gnd[i] = ((x + y) % 5 === 0) ? 1007 : 1006;
        obj[i] = 0; col[i] = 0;
        break;
      default:                              // y=25,26：道路
        gnd[i] = roadTile(x, y);
        obj[i] = 0; col[i] = 0;
    }
  }
}

// ── Warp：更新或新增（避免重複） ─────────────────────────────────────────────
const existingW = brs.warps.find(w => w.targetMap === 'map_convenience_store');
const warpData  = {
  id:        'warp_to_convenience_store',
  gx:        20,
  gy:        28,          // 踩在自動門上觸發
  targetMap: 'map_convenience_store',
  targetGx:  5,
  targetGy:  1,           // 店內北側第一格（門口內側）
  direction: 'down',
  label:     '便利商店',
  active:    true,
};
if (existingW) Object.assign(existingW, warpData);
else brs.warps.push(warpData);

fs.writeFileSync(brsPath, JSON.stringify(brs));
console.log('✓ map_black_rock_street.json 更新完成');
console.log(`  建築實體: x=${BLDG_X0}~${BLDG_X1}, y=${BLDG_Y0}~${BLDG_Y1}`);
console.log(`  自動門: (20,${BLDG_Y0}) col=0`);

// ─────────────────────────────────────────────────────────────────────────────
// PART 2：生成便利商店地圖 10×10（北側入口版）
// ─────────────────────────────────────────────────────────────────────────────
// 佈局草圖（y 向下遞增，玩家從北方 y=0 進入）：
//
//  y=0  ████░░████  ← 北牆，x=4,5 是門口（warp）
//  y=1  █________█  ← 入口走廊
//  y=2  █________█
//  y=3  █F_______█  ← 冰櫃 x=1 開始
//  y=4  █F___SSS█   ← 貨架 x=6-8
//  y=5  █F___SSS█
//  y=6  █F___SSS█
//  y=7  █________█
//  y=8  █_CC_____█  ← 收銀台 x=2-3（店員在 y=7 面朝下）
//  y=9  ██████████  ← 南牆（全實）
//
//  F=冰櫃(1000) S=貨架(1019) C=收銀台(1008) █=牆(1033) _=地板(1032)

const SW = 10, SH = 10;
const SSIZE = SW * SH;
const sat = (x, y) => y * SW + x;

const sGnd = new Array(SSIZE).fill(1032);  // 預設地板
const sObj = new Array(SSIZE).fill(0);
const sCol = new Array(SSIZE).fill(0);

// ── 四周牆壁 ──────────────────────────────────────────────────────────────────
for (let x = 0; x < SW; x++) {
  for (let y = 0; y < SH; y++) {
    const isEdge = x === 0 || x === SW - 1 || y === 0 || y === SH - 1;
    if (!isEdge) continue;
    sObj[sat(x, y)] = 1033;
    sCol[sat(x, y)] = 1;
    sGnd[sat(x, y)] = 0;
  }
}

// ── 北牆門口 (x=4,5)：留空作為 warp 觸發 ────────────────────────────────────
for (const dx of [4, 5]) {
  sObj[sat(dx, 0)] = 0;
  sCol[sat(dx, 0)] = 0;
  sGnd[sat(dx, 0)] = 1032;
}

// ── 冰櫃 x=1, y=3~6 ──────────────────────────────────────────────────────────
for (let y = 3; y <= 6; y++) {
  sObj[sat(1, y)] = 1000;
  sCol[sat(1, y)] = 1;
}

// ── 貨架 x=6~8, y=4~6 ────────────────────────────────────────────────────────
for (let x = 6; x <= 8; x++) {
  for (let y = 4; y <= 6; y++) {
    sObj[sat(x, y)] = 1019;
    sCol[sat(x, y)] = 1;
  }
}

// ── 收銀台 x=2~3, y=8 ────────────────────────────────────────────────────────
for (const cx of [2, 3]) {
  sObj[sat(cx, 8)] = 1008;
  sCol[sat(cx, 8)] = 1;
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
      gy:        0,         // 北側門口踩上即離開
      targetMap: 'map_black_rock_street',
      targetGx:  20,
      targetGy:  27,        // BRS 自動門前一格（y=27 人行道）
      direction: 'up',
      label:     '黑石街',
      active:    true,
    },
  ],

  triggers: [],

  spawnPoints: [
    { id: 'spawn_from_black_rock', gx: 5, gy: 1, facing: 'down' },
    { id: 'clerk_spawn',           gx: 2, gy: 7, facing: 'down' },
  ],

  lights: [
    { gx: 4, gy: 3, radius: 4, color: '0xe8f4ff', intensity: 0.55, flicker: false },
    { gx: 7, gy: 3, radius: 4, color: '0xe8f4ff', intensity: 0.55, flicker: false },
    { gx: 4, gy: 7, radius: 4, color: '0xe8f4ff', intensity: 0.55, flicker: false },
    { gx: 7, gy: 7, radius: 4, color: '0xe8f4ff', intensity: 0.55, flicker: false },
    { gx: 1, gy: 5, radius: 3, color: '0x44aaff', intensity: 0.45, flicker: true,
      flickerInterval: 3000, label: '飲料冰櫃藍光' },
  ],

  ambience: {
    music:       null,
    lightLevel:  0.65,
    rainOverlay: false,
    weather:     'clear',
  },

  displayName: '便利商店',
};

const storeOut = path.join(ROOT, 'src/data/maps/map_convenience_store.json');
fs.writeFileSync(storeOut, JSON.stringify(storeData));
console.log('✓ map_convenience_store.json 輸出完成（北側入口版）');
console.log(`  可通行格: ${sCol.filter(v => v === 0).length}  障礙格: ${sCol.filter(v => v === 1).length}`);
