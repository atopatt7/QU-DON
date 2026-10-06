#!/usr/bin/env node
/**
 * scripts/build_west_suburb.js
 * 生成「黑石街西郊」地圖（手工配置版，取代 generate_suburbs.js 的隨機散佈）
 *
 * 用法：node scripts/build_west_suburb.js
 * NPC 配置在 src/data/npcs/npcs_map_black_rock_west_suburb.json（另行維護）
 *
 * 區域（40×40）：
 *   y  0–15  鴻圖建設工地：西側材料堆、中央未完成地基、東北角工地辦公室
 *   y    16  工地圍籬：正門 x=12（守衛）、西側缺口 x=3
 *   y 17–21  西郊公路：南北人行道、路燈、兩處斑馬線
 *   y    22  營地圍籬：入口 x=25–29
 *   y 23–39  遊民營地：中央火堆廣場、西側 / 東側帳篷群
 */

const fs   = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'src', 'data', 'maps', 'map_black_rock_west_suburb.json');
const W = 40, H = 40;

// ── 方塊 ID（見 src/data/maps/config.json）─────────────────────────────────
const T = {
  ASPHALT: 1000, CRACKED: 1001, PUDDLE: 1003, HLINE: 1005,
  SIDEWALK: 1006, SIDEWALK_TRASH: 1007, LAMPPOST: 1008, HYDRANT: 1009,
  TRASHCAN: 1010, SIDEWALK_CRACKED: 1011, CONCRETE: 1015, CROSSWALK_V: 1030,
  DIRT: 1038, PIPES: 1039, FENCE: 1040, TENT: 1041, BARREL: 1042,
  TIN_WALL: 1050, TIN_DOOR: 1051,
};

const ground    = new Array(W * H).fill(T.DIRT);
const objects   = new Array(W * H).fill(0);
const collision = new Array(W * H).fill(0);

const idx = (x, y) => y * W + x;

// 固定種子亂數（每次生成結果相同，方便 diff）
let seed = 0x5EEDC0DE;
const rng = () => ((seed = (Math.imul(1664525, seed) + 1013904223) >>> 0) / 0x100000000);

function setGround(x, y, id) { ground[idx(x, y)] = id; }
function place(x, y, id, solid = true) {
  objects[idx(x, y)]   = id;
  collision[idx(x, y)] = solid ? 1 : 0;
}
function clear(x, y) { objects[idx(x, y)] = 0; collision[idx(x, y)] = 0; }
function hline(x0, x1, y, id) { for (let x = x0; x <= x1; x++) place(x, y, id); }
function vline(x, y0, y1, id) { for (let y = y0; y <= y1; y++) place(x, y, id); }

// ═══════════════════════════════════════════════════════════════════════════
//  公路 y=17–21
// ═══════════════════════════════════════════════════════════════════════════
for (let x = 0; x < W; x++) {
  for (const y of [17, 21]) {           // 人行道
    const r = rng();
    setGround(x, y, r < 0.10 ? T.SIDEWALK_CRACKED : r < 0.16 ? T.SIDEWALK_TRASH : T.SIDEWALK);
  }
  for (const y of [18, 20]) {           // 車道
    const r = rng();
    setGround(x, y, r < 0.10 ? T.CRACKED : r < 0.16 ? T.PUDDLE : T.ASPHALT);
  }
  setGround(x, 19, T.HLINE);            // 雙黃線
}
// 斑馬線：工地正門前、營地入口前
for (const cx of [11, 12, 13, 26, 27, 28]) {
  for (let y = 18; y <= 20; y++) setGround(cx, y, T.CROSSWALK_V);
}
// 路燈、消防栓、垃圾桶（全部避開斑馬線、門口與巡邏路線 y=21 x16–31）
for (const x of [4, 20, 34]) place(x, 17, T.LAMPPOST);
for (const x of [6, 36])     place(x, 21, T.LAMPPOST);
place(31, 17, T.HYDRANT);
place(34, 21, T.TRASHCAN);

// ═══════════════════════════════════════════════════════════════════════════
//  工地 y=0–16
// ═══════════════════════════════════════════════════════════════════════════
// 圍籬：正門 x=12、西側缺口 x=3
hline(0, W - 1, 16, T.FENCE);
clear(12, 16);
clear(3, 16);
// 守衛哨：正門內側兩桶火
place(10, 15, T.BARREL);
place(14, 15, T.BARREL);

// 西側材料堆：三排水泥管，排與排之間是走道（從缺口潛入的路線）
for (const y of [3, 7, 11]) hline(2, 8, y, T.PIPES);

// 中央未完成地基（混凝土外框，南側開口）
hline(13, 24, 2, T.CONCRETE);
hline(13, 24, 9, T.CONCRETE);
vline(13, 2, 9, T.CONCRETE);
vline(24, 2, 9, T.CONCRETE);
clear(18, 9);
clear(19, 9);

// 東側堆料：給潛行時躲巡邏用
place(26, 7, T.PIPES); place(27, 7, T.PIPES);
place(36, 10, T.PIPES); place(37, 10, T.PIPES); place(36, 11, T.PIPES);
place(28, 15, T.PIPES); place(29, 15, T.PIPES);

// 工地辦公室（鐵皮屋 x=31–39, y=0–4），門在南牆 x=35
for (let y = 0; y <= 4; y++) hline(31, 39, y, T.TIN_WALL);
place(35, 4, T.TIN_DOOR, false); // 傳送點：踩上去進辦公室
place(32, 6, T.BARREL);          // 門口看門小弟取暖的火桶

// ═══════════════════════════════════════════════════════════════════════════
//  營地 y=22–39
// ═══════════════════════════════════════════════════════════════════════════
hline(0, W - 1, 22, T.FENCE);
for (let x = 25; x <= 29; x++) clear(x, 22);

// 中央火堆廣場：老許坐在兩桶火中間
place(25, 27, T.BARREL);
place(29, 27, T.BARREL);
// 廣場外圈帳篷
for (const [x, y] of [[22, 25], [32, 25], [22, 29], [32, 29], [23, 32], [31, 32]]) place(x, y, T.TENT);

// 西側帳篷群（含阿吳的帳篷 (4,35)）
for (const [x, y] of [[4, 26], [8, 25], [12, 26], [5, 30], [10, 29], [14, 31], [4, 35], [9, 35], [13, 36]]) {
  place(x, y, T.TENT);
}
place(8, 28, T.BARREL);
place(7, 33, T.BARREL);

// 東側帳篷群
for (const [x, y] of [[35, 25], [38, 27], [35, 31], [37, 35], [34, 37]]) place(x, y, T.TENT);
place(36, 29, T.BARREL);

// 南側
for (const [x, y] of [[19, 35], [27, 36], [30, 34]]) place(x, y, T.TENT);
place(24, 35, T.BARREL);

// ═══════════════════════════════════════════════════════════════════════════
//  調查點（type: "examine"，玩家面向該格按確認）
// ═══════════════════════════════════════════════════════════════════════════
const notice = {
  dialogue: [
    '圍籬上貼著一張公告：「鴻圖建設　西郊景觀住宅新建工程」。',
    '「本週五 06:00 進行營地清除及整地作業。閒人勿進。」',
    '公告右下角，有人用原子筆寫了兩個小字：「騙子」。',
  ],
};
const fenceGap = {
  dialogue: ['鐵皮被人用剪刀剪開了一道口子，剛好夠一個人側身鑽過去。'],
};
const campSign = {
  dialogue: [
    '營地入口的鐵皮上釘著一塊紙板，字是用油漆刷上去的：',
    '「這裡住著人。」',
  ],
};

const triggers = [
  { id: 'site_notice_w', gx: 11, gy: 16, type: 'examine', ...notice },
  { id: 'site_notice_e', gx: 13, gy: 16, type: 'examine', ...notice },
  { id: 'fence_gap_w',   gx: 2,  gy: 16, type: 'examine', ...fenceGap },
  { id: 'fence_gap_e',   gx: 4,  gy: 16, type: 'examine', ...fenceGap },
  { id: 'camp_sign_w',   gx: 24, gy: 22, type: 'examine', ...campSign },
  { id: 'camp_sign_e',   gx: 30, gy: 22, type: 'examine', ...campSign },
  {
    id: 'camp_graffiti', gx: 6, gy: 22, type: 'examine',
    dialogue: [
      '圍籬內側噴著一排紅字：「我們不走」。',
      '字的下面印滿了手印，大大小小的。',
    ],
  },
  {
    // 西側材料堆最深處：工人藏起來的急救箱
    id: 'site_pipe_stash', gx: 8, gy: 7, type: 'examine',
    dialogue: [
      '水泥管深處塞著一個工地急救箱。',
      '大概是哪個工人藏在這裡，就再也沒回來拿。',
    ],
    onEnd: { giveItem: { id: 'bandage', qty: 1 }, setFlag: 'ws_stash_site' },
    variants: [
      { if: 'ws_stash_site', dialogue: ['水泥管裡只剩幾張發霉的報紙。'], onEnd: null },
    ],
  },
  {
    // 地基北牆內側：阿吳線索
    id: 'foundation_glove', gx: 18, gy: 2, type: 'examine',
    dialogue: [
      '地基的水泥顏色深淺不一。這一塊，明顯是最近才補灌的。',
      '縫隙裡卡著一隻工作手套。手套內側用奇異筆寫著一個字——「吳」。',
    ],
    onEnd: { setFlag: 'ws_found_glove' },
    variants: [
      { if: 'ws_found_glove', dialogue: ['最近才補灌的水泥。你不太想去想底下有什麼。'], onEnd: null },
    ],
  },
  {
    // 阿吳的帳篷
    id: 'wu_tent', gx: 4, gy: 35, type: 'examine',
    dialogue: [
      '這頂帳篷的主人很久沒回來了。門口的紙板上寫著一個「吳」字。',
      '裡面收得很整齊。枕頭底下壓著一張全家福，還有一盒沒拆封的止痛藥。',
    ],
    onEnd: { giveItem: { id: 'painkiller', qty: 1 }, setFlag: 'ws_wu_tent' },
    variants: [
      { if: 'ws_wu_tent', dialogue: ['阿吳的帳篷。全家福還壓在枕頭底下，你沒有動它。'], onEnd: null },
    ],
  },
];

// ═══════════════════════════════════════════════════════════════════════════
//  輸出
// ═══════════════════════════════════════════════════════════════════════════
const map = {
  id:           'map_black_rock_west_suburb',
  name:         'Black Rock 西郊',
  displayName:  '黑石街西郊',
  subtitle:     '黑石街向西延伸的街道。北邊是蓋到一半的工地，南邊是撐著帳篷過日子的人。',
  width:  W,
  height: H,
  tileSize:     48,
  visionRadius: 6,
  configRef:    'src/data/maps/config.json',
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
    {
      id: 'enter_const_office', gx: 35, gy: 4,
      targetMap: 'map_const_office', targetGx: 5, targetGy: 8,
      direction: 'up', label: '工地辦公室', active: true,
    },
  ],
  triggers,
  spawnPoints: [
    { id: 'spawn_from_east', gx: 38, gy: 19, facing: 'left'  },
    { id: 'spawn_from_west', gx: 1,  gy: 19, facing: 'right' },
  ],
  ambience: {
    colorTint:  '0x101510',
    lightLevel: 0.55,
  },
  metadata: {
    author:  'QU-DON dev',
    version: '2.0',
    created: '2026-05-17',
    updated: '2026-10-06',
    tags:    ['outdoor', 'suburb', 'construction', 'camp', 'quest'],
    quest:   '拆遷前夜 — 見 src/data/npcs/npcs_map_black_rock_west_suburb.json',
  },
};

fs.writeFileSync(OUT, JSON.stringify(map, null, 2) + '\n', 'utf8');
console.log(`✓ ${path.relative(process.cwd(), OUT)}  triggers=${triggers.length}`);
