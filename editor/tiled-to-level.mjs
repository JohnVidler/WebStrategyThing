// Writes a Tiled map's terrain into a campaign level file.
//   node editor/tiled-to-level.mjs <map.tmj> [campaigns/<campaign>/maps/<level>.json]
// With no level file given, the map's custom property "level" (e.g. "tutorial/03-new") names it,
// or else a level file with the same name as the .tmj is looked for under campaigns/.
// Only "map" is replaced (by the drawn terrain, keeping its seed and outposts); the briefing, victory and triggers
// in the level file are left alone. The level file must already exist.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const campaigns = join(root, 'campaigns');
const MIN = 24;
const MAX = 192;
const fail = (msg) => {
  console.error(`tiled-to-level: ${msg}`);
  process.exit(1);
};

/** Same areas as clearAreas() in packages/engine/src/game/map.ts: the game forces them open. */
function bases(w, h) {
  const out = [];
  for (const [fx, fy] of [[0, 0], [1, 1], [1, 0], [0, 1]]) {
    for (const [x, y, r] of [[8, 9, 8], [15.5, 13.5, 4], [16, 16, 3]]) out.push({ x: fx ? w - x : x, y: fy ? h - y : y, r });
  }
  return out;
}

/** Converts a parsed .tmj into rows of height digits. Throws a readable message when the map can't be used. */
export function tmjToRows(tmj) {
  const layer = tmj.layers?.find((l) => l.type === 'tilelayer' && l.name === 'terrain');
  if (!layer) throw new Error('the map needs a tile layer named "terrain".');
  if (!Array.isArray(layer.data)) throw new Error('set Map > Map Properties > Tile Layer Format to CSV (the layer data is encoded).');
  const { width: w, height: h } = layer;
  if (w < MIN || h < MIN || w > MAX || h > MAX) throw new Error(`the map must be ${MIN}-${MAX} tiles each way (it is ${w} x ${h}).`);
  const first = tmj.tilesets?.find((t) => String(t.source ?? '').endsWith('terrain.tsx'))?.firstgid;
  if (!first) throw new Error('the map must use the terrain.tsx tileset from this folder.');
  const rows = [];
  for (let y = 0; y < h; y++) {
    let row = '';
    for (let x = 0; x < w; x++) {
      const gid = layer.data[y * w + x] & 0x1fffffff; // strip flip flags
      const height = gid === 0 ? 0 : gid - first;
      if (height < 0 || height > 9) throw new Error(`tile at ${x},${y} is not from the terrain tileset.`);
      row += height;
    }
    rows.push(row);
  }
  return rows;
}

/** Warnings about things the game will fix or can't: a rock centre, or a start that can't reach it. */
export function check(rows) {
  const h = rows.length;
  const w = rows[0].length;
  const forced = new Set();
  for (const a of bases(w, h)) {
    for (let y = Math.floor(a.y - a.r); y <= Math.ceil(a.y + a.r); y++) {
      for (let x = Math.floor(a.x - a.r); x <= Math.ceil(a.x + a.r); x++) {
        if (x >= 0 && y >= 0 && x < w && y < h && (x - a.x) ** 2 + (y - a.y) ** 2 <= a.r * a.r) forced.add(y * w + x);
      }
    }
  }
  const walk = (x, y) => x >= 0 && y >= 0 && x < w && y < h && (rows[y][x] === '0' || forced.has(y * w + x));
  const cx = Math.floor(w / 2);
  const cy = Math.floor(h / 2);
  const seen = new Uint8Array(w * h);
  const stack = [[cx, cy]];
  seen[cy * w + cx] = 1;
  while (stack.length) {
    const [x, y] = stack.pop();
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (!walk(nx, ny) || seen[ny * w + nx]) continue;
      seen[ny * w + nx] = 1;
      stack.push([nx, ny]);
    }
  }
  const notes = [];
  if (!walk(cx, cy)) notes.push('the centre tile is rock; the map centre should be open.');
  [[8, 9], [w - 8, 9], [8, h - 9], [w - 8, h - 9]].forEach(([x, y], i) => {
    if (!seen[y * w + x]) notes.push(`start corner ${i + 1} (around ${x},${y}) can't reach the map centre over open ground.`);
  });
  return notes;
}

function findLevel(tmj, file) {
  const named = tmj.properties?.find((p) => p.name === 'level')?.value;
  if (named) {
    const [campaign, level] = String(named).split('/');
    return join(campaigns, campaign, 'maps', `${level}.json`);
  }
  const base = basename(file).replace(/\.[^.]+$/, '');
  for (const c of readdirSync(campaigns, { withFileTypes: true })) {
    const p = join(campaigns, c.name, 'maps', `${base}.json`);
    if (c.isDirectory() && existsSync(p)) return p;
  }
  return undefined;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [file, explicit] = process.argv.slice(2);
  if (!file) fail('usage: node editor/tiled-to-level.mjs <map.tmj> [level.json]');
  const tmj = JSON.parse(readFileSync(file, 'utf8'));
  let rows;
  try {
    rows = tmjToRows(tmj);
  } catch (err) {
    fail(err.message);
  }
  const target = explicit ? resolve(explicit) : findLevel(tmj, file);
  if (!target || !existsSync(target)) fail('no level file to write into. Pass one, or set a map property "level" to "<campaign>/<level>" (the level file must already exist).');
  const level = JSON.parse(readFileSync(target, 'utf8'));
  // Keep what isn't terrain: the seed (resource and wanderer placement) and extra resource fields.
  const { seed, outposts } = level.map ?? {};
  level.map = { ...(seed === undefined ? {} : { seed }), ...(outposts === undefined ? {} : { outposts }), terrain: rows };
  // One row per line keeps the drawn map readable and diff-friendly.
  const text = JSON.stringify(level, null, 2).replace(/"terrain": \[[^\]]*\]/, () => `"terrain": [\n      ${rows.map((r) => `"${r}"`).join(',\n      ')}\n    ]`);
  writeFileSync(target, `${text}\n`);
  console.log(`wrote ${rows[0].length} x ${rows.length} terrain into ${target}`);
  for (const note of check(rows)) console.warn(`warning: ${note}`);
}
