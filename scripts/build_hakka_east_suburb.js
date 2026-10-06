#!/usr/bin/env node
/**
 * scripts/build_hakka_east_suburb.js
 * 生成「哈卡街東郊」地圖（手工配置）。世界觀見 docs/WORLD.md〈ZONE-B〉：
 * 河岸低地，小工廠、資源回收場，每年颱風季都淹水；新洛城計畫第二期的預定地。
 *
 * 用法：node scripts/build_hakka_east_suburb.js
 * NPC 配置在 src/data/npcs/npcs_map_hakka_east_suburb.json
 *
 * 區域（40×40）：
 *   y  0–15  北側：兩間小工廠、資源回收場
 *   y 16–22  公路（哈卡街 ↔ 黑石街西郊），南北人行道
 *   y 23–33  南側：低窪的鐵皮住家、積水
 *   y 34     洛河堤防（之後是河，不可通行）
 */

const fs   = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'src', 'data', 'maps', 'map_hakka_east_suburb.json');
const W = 40, H = 40;

const T = {
  PUDDLE: 1003, HLINE: 1005, CONCRETE: 1015, METAL_GATE: 1014, CROSSWALK_V: 1030,
  WET_ROAD: 2000, SIDEWALK: 2001, ALLEY: 2002, BRICK: 2003, TRASH: 2007,
  DIRT: 1038, FENCE: 1040, BARREL: 1042, TIN_WALL: 1050,
};

const ground    = new Array(W * H).fill(T.ALLEY);
const objects   = new Array(W * H).fill(0);
const collision = new Array(W * H).fill(0);
const idx = (x, y) => y * W + x;

let seed = 0x4AC4A;
const rng = () => ((seed = (Math.imul(1664525, seed) + 1013904223) >>> 0) / 0x100000000);

function setGround(x, y, id) { ground[idx(x, y)] = id; }
function place(x, y, id, solid = true) { objects[idx(x, y)] = id; collision[idx(x, y)] = solid ? 1 : 0; }
function block(x0, y0, x1, y1, id) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) place(x, y, id); }
function clear(x, y) { objects[idx(x, y)] = 0; collision[idx(x, y)] = 0; }

// ── 公路 y=16–22 ─────────────────────────────────────────────────────────────
for (let x = 0; x < W; x++) {
  setGround(x, 16, T.SIDEWALK);
  setGround(x, 22, T.SIDEWALK);
  for (const y of [17, 18, 20, 21]) setGround(x, y, rng() < 0.12 ? T.PUDDLE : T.WET_ROAD);
  setGround(x, 19, T.HLINE);
}
for (const cx of [29, 30, 31]) for (let y = 17; y <= 21; y++) setGround(cx, y, T.CROSSWALK_V);

// ── 北側：工廠 A（五金行）、工廠 B（成衣加工）─────────────────────────────────
block(2, 4, 11, 13, T.BRICK);
place(6, 13, T.METAL_GATE);               // 五金行鐵捲門（正面朝公路）
block(14, 6, 22, 13, T.TIN_WALL);
place(18, 13, T.METAL_GATE);              // 加工廠鐵捲門

// ── 北側：資源回收場（矮牆圍起來，南側開口）──────────────────────────────────
for (let x = 25; x <= 38; x++) { place(x, 2, T.FENCE); setGround(x, 2, T.DIRT); }
for (let y = 2; y <= 14; y++) { place(25, y, T.FENCE); place(38, y, T.FENCE); setGround(25, y, T.DIRT); setGround(38, y, T.DIRT); }
for (let x = 26; x <= 37; x++) for (let y = 3; y <= 14; y++) setGround(x, y, T.DIRT);
for (let x = 25; x <= 38; x++) { if (x < 30 || x > 32) { place(x, 14, T.FENCE); setGround(x, 14, T.DIRT); } }
for (const [x, y] of [[27, 4], [28, 4], [27, 5], [33, 4], [34, 4], [35, 4], [36, 6], [36, 7], [28, 9], [29, 9], [34, 10], [35, 10], [27, 12]]) {
  place(x, y, T.TRASH);
}
place(31, 7, T.BARREL);                   // 回收場中間燒廢線的火桶

// ── 南側：低窪鐵皮住家 + 積水 ─────────────────────────────────────────────────
for (const [x0, y0, x1, y1, door] of [
  [3, 25, 7, 28, [5, 25]],
  [11, 26, 15, 29, [13, 26]],
  [20, 24, 24, 27, [22, 24]],
  [28, 26, 33, 29, [30, 26]],
]) {
  block(x0, y0, x1, y1, T.TIN_WALL);
  place(door[0], door[1], T.METAL_GATE);
}
for (let i = 0; i < 70; i++) {            // 颱風過後退不掉的積水
  const x = Math.floor(rng() * W), y = 23 + Math.floor(rng() * 11);
  if (!objects[idx(x, y)]) setGround(x, y, T.PUDDLE);
}

// ── 洛河堤防 y=34；之後是河（不可通行、不繪製）──────────────────────────────
for (let x = 0; x < W; x++) {
  place(x, 34, T.CONCRETE);
  for (let y = 35; y < H; y++) { setGround(x, y, 0); collision[idx(x, y)] = 1; }
}

// ── 北側邊界 y=0–1：工廠後面的空地，不開放 ──────────────────────────────────
for (let x = 0; x < W; x++) for (let y = 0; y <= 1; y++) { setGround(x, y, 0); collision[idx(x, y)] = 1; }

// ═══════════════════════════════════════════════════════════════════════════
//  調查點
// ═══════════════════════════════════════════════════════════════════════════
const ex = (id, gx, gy, dialogue, extra = {}) => ({ id, gx, gy, type: 'examine', dialogue, ...extra });

const triggers = [
  ex('hardware_gate', 6, 13, [
    '五金行的鐵捲門拉到底。門上的招牌寫著「永昌五金」。',
    '門邊的牆上，有一條褐色的水痕，到你胸口那麼高。旁邊用油漆寫著：「去年　颱風」。',
  ]),
  ex('factory_gate', 18, 13, [
    '成衣加工廠。鐵捲門上貼著一張公告：',
    '「新洛城計畫　第二期　預定地　——　鴻圖建設」',
    '公告是新的。西郊還沒蓋好，他們已經在看下一塊地了。',
  ], { variants: [{ if: 'ws_end_camp', dialogue: [
    '成衣加工廠的鐵捲門上，那張「新洛城計畫第二期」的公告被人撕掉了一半。',
    '剩下的那半張，上面有人用原子筆寫了兩個字：「下次」。',
  ] }] }),
  ex('recycle_tv', 33, 4, [
    '堆成小山的舊電視、冰箱、電風扇。全是從拆掉的房子裡搬出來的。',
    '一台電視的背面貼著一張舊門牌：「黑石街　三十七號」。',
  ]),
  ex('recycle_fire', 31, 7, [
    '鐵桶裡在燒電線外皮，黑煙嗆得人流眼淚。燒乾淨的銅線一斤可以賣十二塊。',
  ]),
  ex('shack_door_a', 5, 25, [
    '鐵皮屋的門上貼著一張紅紙，毛筆字寫得很用力：「拒絕拆遷」。',
  ]),
  ex('shack_door_b', 22, 24, [
    '門縫裡傳出收音機的聲音，在報颱風的路徑。',
    '「……預計週末接近洛城外海，沿岸低窪地區請做好防颱準備……」',
  ]),
  ex('levee', 16, 34, [
    '堤防另一邊就是洛河。水是黑的，看不出有多深。',
    '水位比上個月高了一截。這一帶的人說，每年颱風季，河都會來拿走一點東西。',
  ]),
];

const map = {
  id:           'map_hakka_east_suburb',
  name:         '哈卡街東郊',
  displayName:  '哈卡街東郊',
  subtitle:     '洛河邊的低窪地。工廠、回收場、鐵皮屋，每年颱風都淹水。',
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
      targetMap: 'map_hakka_street', targetGx: 38, targetGy: 19,
      direction: 'left', label: '哈卡街', active: true,
    },
    {
      id: 'exit_east', gx: 39, gy: 19,
      targetMap: 'map_black_rock_west_suburb', targetGx: 1, targetGy: 19,
      direction: 'right', label: 'Black Rock 西郊', active: true,
    },
  ],
  triggers,
  spawnPoints: [
    { id: 'spawn_from_west', gx: 1,  gy: 19, facing: 'right' },
    { id: 'spawn_from_east', gx: 38, gy: 19, facing: 'left'  },
  ],
  ambience: { colorTint: '0x101018', lightLevel: 0.5 },
  metadata: {
    author: 'QU-DON dev', version: '2.0',
    created: '2026-05-17', updated: '2026-10-06',
    tags: ['outdoor', 'suburb', 'riverside', 'transit'],
  },
};

fs.writeFileSync(OUT, JSON.stringify(map, null, 2) + '\n', 'utf8');
console.log(`✓ ${path.relative(process.cwd(), OUT)}  triggers=${triggers.length}`);
