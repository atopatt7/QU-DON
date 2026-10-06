#!/usr/bin/env node
/**
 * scripts/generate_suburbs.js
 * 自動生成哈卡街東郊 40×40 過渡地圖並寫入 src/data/maps/
 * （黑石街西郊改由 scripts/build_west_suburb.js 手工配置）
 *
 * 用法：node scripts/generate_suburbs.js
 */

const fs   = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', 'src', 'data', 'maps');
const W = 40, H = 40;

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
const maps = [buildEastSuburb()];

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
