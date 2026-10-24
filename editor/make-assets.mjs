// Regenerates the Tiled support files that are generated rather than hand-written:
// terrain.png (the tileset image) and template.tmj (a blank 48 x 48 map).
// Run: node editor/make-assets.mjs
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const TILE = 32;
const COUNT = 10; // height 0 (open ground) then 1..9 (rock)

// Open ground is a dark green-grey; rock gets lighter the higher it is. Cliff-height rock (3+) gets a hatch so it reads differently.
const colour = (h) => (h === 0 ? [38, 50, 44] : [70 + h * 16, 76 + h * 15, 84 + h * 14]);

const w = TILE * COUNT;
const raw = Buffer.alloc((w * 4 + 1) * TILE);
for (let y = 0; y < TILE; y++) {
  raw[y * (w * 4 + 1)] = 0;
  for (let x = 0; x < w; x++) {
    const h = Math.floor(x / TILE);
    const lx = x % TILE;
    let [r, g, b] = colour(h);
    if (lx === 0 || y === 0) [r, g, b] = [r - 12, g - 12, b - 12].map((v) => Math.max(0, v));
    if (h >= 3 && (lx + y) % 8 === 0) [r, g, b] = [r + 25, g + 25, b + 25];
    // A small digit-like mark: h dots along the top, so the height is readable at a glance.
    if (h > 0 && y >= 12 && y < 16 && lx >= 4 && lx < 4 + h * 3 && (lx - 4) % 3 < 2) [r, g, b] = [250, 250, 250];
    const o = y * (w * 4 + 1) + 1 + x * 4;
    raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = 255;
  }
}
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, sum]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(w, 0);
ihdr.writeUInt32BE(TILE, 4);
ihdr.set([8, 6, 0, 0, 0], 8);
writeFileSync(join(dir, 'terrain.png'), Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));

const SIZE = 48;
const map = {
  compressionlevel: -1,
  type: 'map',
  version: '1.10',
  tiledversion: '1.10.2',
  orientation: 'orthogonal',
  renderorder: 'right-down',
  infinite: false,
  width: SIZE,
  height: SIZE,
  tilewidth: TILE,
  tileheight: TILE,
  nextlayerid: 2,
  nextobjectid: 1,
  tilesets: [{ firstgid: 1, source: 'terrain.tsx' }],
  layers: [{ id: 1, name: 'terrain', type: 'tilelayer', x: 0, y: 0, width: SIZE, height: SIZE, opacity: 1, visible: true, data: new Array(SIZE * SIZE).fill(1) }],
};
writeFileSync(join(dir, 'template.tmj'), JSON.stringify(map, null, 1) + '\n');
console.log('wrote terrain.png and template.tmj');
