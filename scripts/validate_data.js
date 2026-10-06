/**
 * QU-DON | scripts/validate_data.js
 * 遊戲資料一致性檢查（地圖 / 傳送點 / NPC / 實體 / 貼圖路徑）
 *
 * 用法：node scripts/validate_data.js
 *   有 ERROR → exit 1（CI 會擋下部署）
 *   只有 WARN → exit 0
 *
 * 只對「從起始地圖經由 warp 可到達」的地圖做嚴格檢查；
 * 到不了的地圖（舊版 / 尚未接上）只列為警告。
 */

const fs   = require('fs');
const path = require('path');

const ROOT       = path.join(__dirname, '..');
const MAPS_DIR   = path.join(ROOT, 'src/data/maps');
const NPCS_DIR   = path.join(ROOT, 'src/data/npcs');
const ENT_DIR    = path.join(ROOT, 'src/data/entities');
// 起始地圖 + 程式直接傳送的地圖（main.js 戰敗回家）
const ENTRY_MAPS = ['map_black_rock_street', 'map_qu_don_room'];

const errors = [];
const warns  = [];
const err  = (msg) => errors.push(msg);
const warn = (msg) => warns.push(msg);

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const exists   = (rel)  => fs.existsSync(path.join(ROOT, rel));

// ─── 載入資料 ────────────────────────────────────────────────────────────────
const tileCfg = readJson(path.join(MAPS_DIR, 'config.json')).tiles ?? {};

const maps = {};
for (const f of fs.readdirSync(MAPS_DIR)) {
  if (f.startsWith('map_') && f.endsWith('.json')) {
    maps[f.slice(0, -5)] = readJson(path.join(MAPS_DIR, f));
  }
}

// 與 MapManager.loadMap 相同的碰撞解析（collisions:[{gx,gy}] 優先，否則舊式 collision:[]）
function buildCollision(m) {
  const col = new Uint8Array(m.width * m.height);
  if (Array.isArray(m.collisions)) {
    for (const { gx, gy } of m.collisions) col[gy * m.width + gx] = 1;
  } else if (Array.isArray(m.collision)) {
    m.collision.forEach((v, i) => { col[i] = v ? 1 : 0; });
  }
  return col;
}
const collision = Object.fromEntries(Object.entries(maps).map(([id, m]) => [id, buildCollision(m)]));

const inBounds = (m, x, y) => x >= 0 && y >= 0 && x < m.width && y < m.height;
const walkable = (id, x, y) => inBounds(maps[id], x, y) && !collision[id][y * maps[id].width + x];
const warpAt   = (m, x, y) => (m.warps ?? []).find(w => w.gx === x && w.gy === y && w.active !== false);

// ─── 可到達地圖 ──────────────────────────────────────────────────────────────
const reachable = new Set();
const queue = ENTRY_MAPS.filter(id => maps[id]);
for (const id of ENTRY_MAPS) if (!maps[id]) err(`入口地圖不存在：${id}`);
while (queue.length) {
  const id = queue.shift();
  if (reachable.has(id)) continue;
  reachable.add(id);
  for (const w of maps[id].warps ?? []) if (maps[w.targetMap]) queue.push(w.targetMap);
}
for (const id of Object.keys(maps)) {
  if (!reachable.has(id)) warn(`${id}：沒有任何傳送點通往此地圖（未檢查）`);
}

// ─── 地圖檢查 ────────────────────────────────────────────────────────────────
for (const id of reachable) {
  const m = maps[id];

  // 傳送點
  for (const w of m.warps ?? []) {
    const tag = `${id} warp "${w.id}"`;
    if (!inBounds(m, w.gx, w.gy)) err(`${tag}：位置 (${w.gx},${w.gy}) 超出地圖`);
    const t = maps[w.targetMap];
    if (!t) { err(`${tag}：目標地圖 ${w.targetMap} 不存在`); continue; }
    if (!walkable(w.targetMap, w.targetGx, w.targetGy)) {
      err(`${tag}：目標 ${w.targetMap} (${w.targetGx},${w.targetGy}) 不可行走`);
    } else if (warpAt(t, w.targetGx, w.targetGy)) {
      err(`${tag}：目標 ${w.targetMap} (${w.targetGx},${w.targetGy}) 本身是傳送點，會來回彈跳`);
    }
  }

  // 出生點
  const spawn = m.spawnPoints?.find(s => s.id === 'player_start') ?? m.spawnPoints?.[0];
  if (spawn && !walkable(id, spawn.gx, spawn.gy)) err(`${id}：出生點 (${spawn.gx},${spawn.gy}) 不可行走`);

  // config.json 標記為碰撞的方塊，地圖碰撞資料卻可通行（傳送點除外：門類方塊本來就要能踩上去）
  for (let i = 0; i < m.width * m.height; i++) {
    if (collision[id][i]) continue;
    const x = i % m.width, y = Math.floor(i / m.width);
    if (warpAt(m, x, y)) continue;
    const obj = m.layers.objects?.[i] ?? 0;
    const gnd = m.layers.ground?.[i]  ?? 0;
    const hit = [obj, gnd].find(t => t && tileCfg[t]?.collides);
    if (hit) err(`${id} (${x},${y})：方塊 ${hit}「${tileCfg[hit].name}」在 config 標為碰撞，但地圖碰撞資料可通行`);
  }
}

// ─── 物品參照（choices / onEnd / variants 中的 requiresItem、takeItem、giveItem）──
const itemIds = new Set(readJson(path.join(ROOT, 'src/data/items.json')).items.map(i => i.id));
const asList  = v => (v == null ? [] : Array.isArray(v) ? v : [v]);
function checkItemRefs(obj, tag) {
  if (!obj || typeof obj !== 'object') return;
  for (const key of ['requiresItem', 'takeItem', 'giveItem']) {
    for (const ref of asList(obj[key])) {
      const id = typeof ref === 'string' ? ref : ref?.id;
      if (!itemIds.has(id)) err(`${tag}：${key} 參照不存在的物品 "${id}"`);
    }
  }
  checkItemRefs(obj.onEnd, tag);
  for (const c of obj.choices ?? [])  checkItemRefs(c, `${tag} 選項「${c.text}」`);
  for (const v of obj.variants ?? []) checkItemRefs(v, `${tag} variant`);
}

// ─── 地圖調查點 ─────────────────────────────────────────────────────────────
for (const id of reachable) {
  const m = maps[id];
  for (const t of m.triggers ?? []) {
    if (t.type !== 'examine') continue;
    const tag = `${id} trigger "${t.id}"`;
    if (!inBounds(m, t.gx, t.gy)) err(`${tag}：位置 (${t.gx},${t.gy}) 超出地圖`);
    if (!Array.isArray(t.dialogue) || !t.dialogue.length) err(`${tag}：缺少 dialogue`);
    // 調查點必須能從相鄰的可行走格子面向它
    const reachableFrom = [[0, 1], [0, -1], [1, 0], [-1, 0]]
      .some(([dx, dy]) => walkable(id, t.gx + dx, t.gy + dy));
    if (!reachableFrom) err(`${tag}：四周沒有可站立的格子，玩家無法調查`);
    checkItemRefs(t, tag);
  }
}

// ─── 實體 registry ──────────────────────────────────────────────────────────
const registry = readJson(path.join(ENT_DIR, 'registry.json'));
const entities = {};
for (const [ref, rel] of Object.entries(registry)) {
  if (ref.startsWith('_')) continue;
  const file = path.join(ENT_DIR, rel);
  if (!fs.existsSync(file)) { err(`registry "${ref}"：檔案不存在 ${rel}`); continue; }
  const ent = readJson(file);
  entities[ref] = ent;
  const vis = ent.visuals ?? {};
  if (vis.spriteSheet && !exists(vis.spriteSheet)) err(`實體 ${ref}：spriteSheet 不存在 ${vis.spriteSheet}`);
  if (vis.battleMugshot && !exists(vis.battleMugshot)) warn(`實體 ${ref}：battleMugshot 不存在 ${vis.battleMugshot}`);
}

// ─── NPC 配置 ───────────────────────────────────────────────────────────────
const seenIds = new Map();
for (const f of fs.readdirSync(NPCS_DIR)) {
  if (!f.endsWith('.json')) continue;
  // EntityManager 以 npcs_{mapId}.json 載入，mapId 含 map_ 前綴
  const mapId = f.replace(/^npcs_/, '').replace(/\.json$/, '');
  const m = maps[mapId];
  if (!m) { err(`${f}：找不到對應地圖 ${mapId}.json（檔名須為 npcs_<地圖ID>.json）`); continue; }

  for (const npc of readJson(path.join(NPCS_DIR, f))) {
    const tag = `${f} "${npc.id}"`;
    if (seenIds.has(npc.id)) err(`${tag}：id 與 ${seenIds.get(npc.id)} 重複`);
    seenIds.set(npc.id, f);

    if (!['hostile', 'recruitable', 'system', undefined].includes(npc.category)) {
      err(`${tag}：未知 category "${npc.category}"`);
    }
    // 預設位置與每個 variant 的位置都要合法
    for (const [label, pos] of [['位置', npc.position], ...(npc.variants ?? [])
      .filter(v => v.position).map((v, i) => [`variant[${i}] 位置`, v.position])]) {
      const { x, y } = pos ?? {};
      if (!walkable(mapId, x, y)) err(`${tag}：${label} (${x},${y}) 不可行走`);
      else if (warpAt(m, x, y))   err(`${tag}：${label} (${x},${y}) 在傳送點上`);
    }
    checkItemRefs(npc, tag);

    const ent = npc.entityRef ? entities[npc.entityRef] : null;
    if (npc.entityRef && !ent) err(`${tag}：entityRef "${npc.entityRef}" 不在 registry`);

    // 可戰鬥的 NPC 需要戰鬥數值（否則 BattleUI 會悄悄套用預設值）
    const stats = { ...(ent?.stats ?? {}), ...(npc.stats ?? {}) };
    const canFight = npc.category === 'hostile'
                  || (npc.choices ?? ent?.choices ?? []).some(c => c.action === 'BATTLE');
    if (canFight && (stats.hp == null || (stats.atk ?? stats.attack) == null)) {
      err(`${tag}：可進入戰鬥但缺少 hp / atk 數值`);
    }
    // 可對話的 NPC 需要台詞（否則按確認鍵沒有反應）
    const dialogue = npc.dialogue ?? ent?.dialogue;
    if (npc.category !== 'hostile' && !(Array.isArray(dialogue) && dialogue.length)) {
      warn(`${tag}：可互動但沒有 dialogue 陣列`);
    }

    if (npc.behavior === 'patrol') {
      const pts = npc.path ?? [];
      if (pts.length < 2) err(`${tag}：patrol 至少需要 2 個路徑點`);
      // 逐格展開（與 EntityManager._initPatrol 相同：先 X 後 Y）
      for (let i = 0; i < pts.length; i++) {
        let [px, py] = pts[i];
        const [tx, ty] = pts[(i + 1) % pts.length];
        for (;;) {
          if (!walkable(mapId, px, py)) { err(`${tag}：巡邏路徑經過不可行走的 (${px},${py})`); break; }
          if (warpAt(m, px, py))        { err(`${tag}：巡邏路徑經過傳送點 (${px},${py})`); break; }
          if (px === tx && py === ty) break;
          if (px !== tx) px += Math.sign(tx - px); else py += Math.sign(ty - py);
        }
      }
    }
  }
}

// ─── 輸出 ───────────────────────────────────────────────────────────────────
for (const w of warns)  console.log(`WARN   ${w}`);
for (const e of errors) console.log(`ERROR  ${e}`);
console.log(`\n${reachable.size} 張地圖已檢查，${errors.length} 個錯誤，${warns.length} 個警告`);
process.exit(errors.length ? 1 : 0);
