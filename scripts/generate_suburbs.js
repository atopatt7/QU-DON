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

// 簡易 LCG 偽亂數（seed 固定確保每次生成結果相同）
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0xFFFFFFFF;
  };
}

// ── 西郊地圖 ─────────────────────────────────────────────────────────────────
function buildWestSuburb() {
  const rng = makeRng(0xDEADBEEF);
  const ground    = new Array(W * H).fill(0);
  const objects   = new Array(W * H).fill(0);
  const collision = new Array(W * H).fill(0);

  // ── 1. 中央公路 Y=17~21 ──────────────────────────────────────────────────
  for (let y = 17; y <= 21; y++) {
    for (let x = 0; x < W; x++) {
      if (y === 19) {
        ground[idx(x, y)] = 1005; // 雙黃線，不加亂數
      } else {
        const r = rng();
        if      (r < 0.10) ground[idx(x, y)] = 1001; // 龜裂柏油
        else if (r < 0.15) ground[idx(x, y)] = 1003; // 積水路面
        else               ground[idx(x, y)] = 1000; // 正常柏油
      }
    }
  }

  // ── 2. 上方工地 Y=0~16 ───────────────────────────────────────────────────
  for (let y = 0; y <= 16; y++) {
    for (let x = 0; x < W; x++) {
      ground[idx(x, y)] = 1038;
    }
  }

  // Y=16 圍籬，X=10~14 留空作為工地入口
  for (let x = 0; x < W; x++) {
    if (x < 10 || x > 14) {
      objects[idx(x, 16)]   = 1040;
      collision[idx(x, 16)] = 1;
    }
  }

  // 固定 ㄇ 字型水泥管骨架（確保動線存在）
  for (let y = 5; y <= 10; y++) {
    objects[idx(5, y)]   = 1039; collision[idx(5, y)]   = 1;
    objects[idx(15, y)]  = 1039; collision[idx(15, y)]  = 1;
  }
  for (let x = 6; x <= 14; x++) {
    objects[idx(x, 5)]   = 1039; collision[idx(x, 5)]   = 1;
  }

  // 隨機散佈水泥管（避開入口通道 X=10~14 且 Y 接近圍籬）
  let placed = 0;
  const target = 17;
  while (placed < target) {
    const rx = 2  + Math.floor(rng() * 36); // X: 2~37
    const ry = 2  + Math.floor(rng() * 13); // Y: 2~14
    // 避開入口動線（X=10~14）與已佔用格子
    if (rx >= 10 && rx <= 14) continue;
    if (objects[idx(rx, ry)] !== 0)   continue;
    objects[idx(rx, ry)]   = 1039;
    collision[idx(rx, ry)] = 1;
    placed++;
  }

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

  // 固定帳篷與鐵桶聚落核心
  [[20,28],[22,28],[28,28],[30,28],[20,32],[22,32],[28,32],[30,32],[20,30],[30,30]]
    .forEach(([x, y]) => { objects[idx(x,y)] = 1041; collision[idx(x,y)] = 1; });
  [[23,29],[25,29],[23,31],[25,31],[27,26],[21,27],[29,33]]
    .forEach(([x, y]) => { objects[idx(x,y)] = 1042; collision[idx(x,y)] = 1; });

  // 隨機散佈帳篷（10 個，避開入口通道 X=25~29）
  let tents = 0;
  while (tents < 10) {
    const rx = 2  + Math.floor(rng() * 36); // X: 2~37
    const ry = 24 + Math.floor(rng() * 14); // Y: 24~37
    if (rx >= 25 && rx <= 29) continue;
    if (objects[idx(rx, ry)] !== 0) continue;
    objects[idx(rx, ry)]   = 1041;
    collision[idx(rx, ry)] = 1;
    tents++;
  }

  // 隨機散佈鐵桶（15 個，避開入口通道 X=25~29）
  let barrels = 0;
  while (barrels < 15) {
    const rx = 2  + Math.floor(rng() * 36);
    const ry = 24 + Math.floor(rng() * 14);
    if (rx >= 25 && rx <= 29) continue;
    if (objects[idx(rx, ry)] !== 0) continue;
    objects[idx(rx, ry)]   = 1042;
    collision[idx(rx, ry)] = 1;
    barrels++;
  }

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
      { id: 'spawn_from_east', gx: 38, gy: 19, facing: 'left'  },
      { id: 'spawn_from_west', gx: 1,  gy: 19, facing: 'right' },
    ],
    ambience: {
      colorTint:  '0x101510',
      lightLevel: 0.55,
    },
    metadata: {
      author: 'QU-DON dev', version: '1.1',
      created: '2026-05-17',
      updated: new Date().toISOString().slice(0, 10),
      tags: ['outdoor', 'suburb', 'construction', 'transit'],
    },
  };
}

// ── 東郊地圖（基礎版）────────────────────────────────────────────────────────
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
      { id: 'spawn_from_east', gx: 38, gy: 19, facing: 'left'  },
    ],
    ambience: {
      colorTint:  '0x101018',
      lightLevel: 0.6,
    },
    metadata: {
      author: 'QU-DON dev', version: '1.0',
      created: '2026-05-17',
      tags: ['outdoor', 'suburb', 'transit'],
    },
  };
}

// ── 寫檔 ──────────────────────────────────────────────────────────────────────
const maps = [buildWestSuburb(), buildEastSuburb()];

for (const map of maps) {
  const dest = path.join(OUT_DIR, `${map.id}.json`);
  fs.writeFileSync(dest, JSON.stringify(map, null, 2), 'utf8');

  // 簡易統計
  if (map.layers.objects) {
    const obs = map.layers.objects;
    const count = (id) => obs.filter(v => v === id).length;
    console.log(`✓ ${map.id}`);
    console.log(`  1039(管): ${count(1039)}  1040(籬): ${count(1040)}  1041(帳): ${count(1041)}  1042(桶): ${count(1042)}`);
    const road = map.layers.ground.filter((v,i) => { const y=Math.floor(i/40); return y>=17&&y<=21; });
    console.log(`  公路 1001(龜裂): ${road.filter(v=>v===1001).length}  1003(積水): ${road.filter(v=>v===1003).length}  1000(正常): ${road.filter(v=>v===1000).length}`);
  }
}
console.log('Done.');
