#!/usr/bin/env node
/**
 * scripts/generate_hakka.js
 * 生成 src/data/maps/map_hakka_street.json（哈卡街 40×30）
 * 並將 Tile 200-207 寫入 src/data/maps/config.json
 *
 * 執行：node scripts/generate_hakka.js
 */

'use strict';
const fs   = require('fs');
const path = require('path');

const W    = 40;
const H    = 30;
const SIZE = W * H;

const ground    = new Array(SIZE).fill(203); // 預設：紅磚牆
const objects   = new Array(SIZE).fill(0);   // 預設：無物件
const collision = new Array(SIZE).fill(1);   // 預設：不可通行

const at = (x, y) => y * W + x;

// ─── (A) 主幹道與人行道 ─────────────────────────────────────────────────────
// 主幹道 y=18-20：潮濕柏油路（200）
for (let y = 18; y <= 20; y++) {
  for (let x = 0; x < W; x++) {
    ground[at(x, y)]    = 200;
    collision[at(x, y)] = 0;
  }
}

// 北側人行道 y=16-17：唐人街青石磚（201）
for (let y = 16; y <= 17; y++) {
  for (let x = 0; x < W; x++) {
    ground[at(x, y)]    = 201;
    collision[at(x, y)] = 0;
  }
}

// 南側人行道 y=21-22：唐人街青石磚（201）
for (let y = 21; y <= 22; y++) {
  for (let x = 0; x < W; x++) {
    ground[at(x, y)]    = 201;
    collision[at(x, y)] = 0;
  }
}

// ─── (B) 北側建築正面 y=15：每 5 格交替 204 烤鴨店 / 205 中藥行 ────────────
// 地面 203 + 建築正面 tile 取代 → collision 保持 1
for (let x = 2; x < W; x += 5) {
  const isEven = Math.floor((x - 2) / 5) % 2 === 0;
  ground[at(x, 15)] = isEven ? 204 : 205;
}

// ─── (C) 南側暗巷：x=10-12 & x=25-27，向南延伸至 y=27 ─────────────────────
const ALLEYS = [[10, 12], [25, 27]];

for (const [xL, xR] of ALLEYS) {
  for (let x = xL; x <= xR; x++) {
    // 巷道本體 y=23-27：髒污暗巷地磚（202），可通行
    for (let y = 23; y <= 27; y++) {
      ground[at(x, y)]    = 202;
      collision[at(x, y)] = 0;
    }
    // 巷底 y=28：垃圾堆（地面 202 + 物件 207），阻擋通行
    ground[at(x, 28)]  = 202;
    objects[at(x, 28)] = 207;
    // collision[at(x, 28)] 保持 1（阻擋）
  }
}

// ─── (D) 唐人街牌坊石柱：x=37，y=16（北人行道）與 y=22（南人行道）───────────
objects[at(37, 16)]   = 206;
collision[at(37, 16)] = 1; // 石柱阻擋通行

objects[at(37, 22)]   = 206;
collision[at(37, 22)] = 1;

// ─── (E) 傳送點出口確認：x=39, y=19 須為可通行 ───────────────────────────────
// 已由 (A) 設為 0；此處明確重申
collision[at(39, 19)] = 0;

// ─────────────────────────────────────────────────────────────────────────────
// 組裝地圖 JSON
// ─────────────────────────────────────────────────────────────────────────────
const mapData = {
  id:           'map_hakka_street',
  name:         'Hakka Street',
  subtitle:     '哈卡街 — 霓虹燈光倒映在潮濕石板上，烤鴨油脂香混著柏油氣味',
  width:        W,
  height:       H,
  tileSize:     48,
  visionRadius: 6,
  configRef:    'src/data/maps/config.json',

  layers: { ground, objects },
  collision,

  warps: [
    {
      id:        'exit_to_black_rock',
      gx:        39,
      gy:        19,
      targetMap: 'map_black_rock_street',
      targetGx:  1,
      targetGy:  19,
      direction: 'right',
      label:     '黑石街',
      sprite:    'interface/warp_arrow_base.png',
      rotation:  90,
      active:    true,
    },
  ],

  triggers: [],

  spawnPoints: [
    { id: 'player_start',          gx: 20, gy: 19, facing: 'down' },
    { id: 'spawn_from_black_rock', gx: 38, gy: 19, facing: 'left' },
  ],

  lights: [],

  ambience: {
    music:       'assets/sounds/chinatown_ambience.mp3',
    lightLevel:  0.22,
    rainOverlay: true,
    weather:     'drizzle',
  },

  displayName: '哈卡街',
};

// 輸出地圖
const mapOut = path.join(__dirname, '../src/data/maps/map_hakka_street.json');
fs.writeFileSync(mapOut, JSON.stringify(mapData));
console.log(`✓ 地圖輸出 → ${mapOut}`);
console.log(`  尺寸 ${W}×${H} = ${SIZE} 格`);
console.log(`  可通行格: ${collision.filter(v => v === 0).length}  障礙格: ${collision.filter(v => v === 1).length}`);

// ─────────────────────────────────────────────────────────────────────────────
// 更新 config.json：新增 tile 200-207
// ─────────────────────────────────────────────────────────────────────────────
const configPath = path.join(__dirname, '../src/data/maps/config.json');
const config     = JSON.parse(fs.readFileSync(configPath, 'utf8'));

const newTiles = {
  '200': {
    name:     'chinatown_road_wet',
    group:    'chinatown',
    walkable: true,
    collides: false,
    draw:     'puddle',
    color:    '0x0c1018',
    sfx:      'footstep_puddle',
    desc:     '潮濕柏油路（帶有霓虹燈倒影）',
  },
  '201': {
    name:     'chinatown_sidewalk',
    group:    'chinatown',
    walkable: true,
    collides: false,
    draw:     'sidewalk',
    color:    '0x2a2218',
    sfx:      'footstep_stone',
    desc:     '唐人街人行道（六角形青石磚）',
  },
  '202': {
    name:     'chinatown_alley',
    group:    'chinatown',
    walkable: true,
    collides: false,
    draw:     'asphalt',
    color:    '0x0e0e0c',
    sfx:      'footstep_asphalt',
    desc:     '髒污暗巷地磚',
  },
  '203': {
    name:     'chinatown_redbrick',
    group:    'chinatown',
    walkable: false,
    collides: true,
    draw:     'brick_wall',
    color:    '0x3a1510',
    desc:     '紅磚牆（建築基座）',
  },
  '204': {
    name:     'chinatown_duck_shop',
    group:    'chinatown',
    walkable: false,
    collides: true,
    draw:     'brick_wall',
    color:    '0x3a1c08',
    _light:   { radius: 3, color: '0xffaa44', intensity: 0.5 },
    desc:     '烤鴨店櫥窗（掛著烤鴨，透出暖黃光）',
  },
  '205': {
    name:     'chinatown_herb_shop',
    group:    'chinatown',
    walkable: false,
    collides: true,
    draw:     'brick_wall',
    color:    '0x1a2010',
    desc:     '中藥行/當鋪木門（緊閉，帶有鐵花窗）',
  },
  '206': {
    name:     'chinatown_paifang',
    group:    'chinatown',
    walkable: false,
    collides: true,
    draw:     'brick_wall',
    color:    '0x2a1808',
    desc:     '中式牌坊石柱（刻有龍紋）',
  },
  '207': {
    name:     'chinatown_trash_pile',
    group:    'chinatown',
    walkable: false,
    collides: true,
    draw:     'crate',
    color:    '0x141410',
    desc:     '雜亂的疊箱與垃圾桶（暗巷用）',
  },
};

// 合併：只新增，不覆蓋既有定義
let added = 0;
for (const [id, def] of Object.entries(newTiles)) {
  if (!config.tiles[id]) {
    config.tiles[id] = def;
    added++;
  }
}

// 更新 _comment_groups
config._comment_groups.chinatown = '200-207 (哈卡街唐人街專用 tiles)';

fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
console.log(`✓ config.json 更新 → 新增 ${added} 個 tile 定義（200-207）`);
