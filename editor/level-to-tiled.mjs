// Opens a level that already has drawn terrain in Tiled, or starts a new map from the template.
//   node editor/level-to-tiled.mjs <campaign>/<level> [out.tmj]         (level must have "map.terrain")
//   node editor/level-to-tiled.mjs --new <campaign>/<level> [out.tmj]   (blank 48 x 48 from template.tmj)
// Generated levels (map.layout) have no drawn terrain to open; start one with --new and paint it.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const fresh = args[0] === '--new';
const [id, out] = fresh ? args.slice(1) : args;
if (!id || !/^[\w-]+\/[\w-]+$/.test(id)) {
  console.error('usage: node editor/level-to-tiled.mjs [--new] <campaign>/<level> [out.tmj]');
  process.exit(1);
}
const tmj = JSON.parse(readFileSync(join(dir, 'template.tmj'), 'utf8'));
if (!fresh) {
  const [campaign, level] = id.split('/');
  const rows = JSON.parse(readFileSync(join(dir, '..', 'campaigns', campaign, 'maps', `${level}.json`), 'utf8')).map?.terrain;
  if (!Array.isArray(rows)) {
    console.error(`${id} has no drawn terrain (map.terrain); use --new to start one.`);
    process.exit(1);
  }
  const layer = tmj.layers[0];
  layer.width = tmj.width = rows[0].length;
  layer.height = tmj.height = rows.length;
  layer.data = rows.flatMap((r) => [...r].map((c) => Number(c) + 1));
}
tmj.properties = [{ name: 'level', type: 'string', value: id }];
const target = resolve(out ?? join(dir, 'maps', `${id.split('/')[1]}.tmj`));
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, `${JSON.stringify(tmj, null, 1)}\n`);
console.log(`wrote ${target}`);
