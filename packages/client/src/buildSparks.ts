import type { Graphics } from 'pixi.js';

/**
 * Building-completion effect: sparks (the same bright streaks as the main menu's) leave the
 * building's edge and run outwards along the tile grid lines. At every crossing they take a random
 * turn, but never back towards the building, and fade with the distance they have covered.
 * Each spark's whole route is rolled up front; drawing is just a walk along that polyline.
 */
export const BUILD_SPARK_COLOUR = 0xcfe8ff;
const GLOW_COLOUR = 0x78beff;
/** Travel speed in tiles per second. */
const SPEED = 6;
/** Visible length of a spark's tail, in tiles. */
const TAIL = 2.2;
/** How many grid steps a spark makes before it has faded out completely. */
const STEPS: [number, number] = [4, 9];
/** Completion bursts are bigger than the odd spark thrown off while building. */
const MAX_SPARKS = 64;
/** The completion flash: an expanding ring and a white wash over the footprint. */
const FLASH_MS = 450;

export interface BuildSparks {
  born: number;
  ms: number;
  /** One route per spark, in tile coordinates: x0, y0, x1, y1, ... (one tile apart). */
  routes: number[][];
  /** Footprint (tiles), for the completion flash; absent on the odd sparks thrown off mid-build. */
  flash?: { x: number; y: number; size: number };
}

const DIRS: [number, number][] = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];

/**
 * Rolls the sparks for a building whose footprint covers tiles [x, x+size) × [y, y+size).
 * Without `count` this is the full completion burst (with a flash); pass a small count for the
 * odd one or two sparks a site throws off while it is being built.
 */
export function makeBuildSparks(x: number, y: number, size: number, born: number, count?: number): BuildSparks {
  const cx = x + size / 2;
  const cy = y + size / 2;
  const burst = count === undefined;
  const n = count ?? Math.min(MAX_SPARKS, 16 + size * 8);
  const routes: number[][] = [];
  let longest = 0;
  for (let k = 0; k < n; k++) {
    // A random crossing on the footprint's outline, and the way out of the building from there.
    const side = Math.floor(Math.random() * 4);
    const t = Math.floor(Math.random() * (size + 1));
    let px = side === 0 ? x + size : side === 2 ? x : x + t;
    let py = side === 1 ? y + size : side === 3 ? y : y + t;
    let dir = side;
    const steps = STEPS[0] + Math.floor(Math.random() * (STEPS[1] - STEPS[0] + 1));
    const route = [px, py];
    for (let s = 0; s < steps; s++) {
      px += DIRS[dir][0];
      py += DIRS[dir][1];
      route.push(px, py);
      // At the crossing: straight on, or a left/right turn, as long as it still leads away from the centre.
      const options = [dir, (dir + 1) % 4, (dir + 3) % 4].filter((d) => DIRS[d][0] * (px - cx) + DIRS[d][1] * (py - cy) >= 0);
      if (options.length) dir = options[Math.floor(Math.random() * options.length)];
    }
    routes.push(route);
    longest = Math.max(longest, steps);
  }
  const ms = Math.max(burst ? FLASH_MS : 0, ((longest + TAIL) / SPEED) * 1000);
  return { born, ms, routes, flash: burst ? { x, y, size } : undefined };
}

/** Whether the effect has finished. */
export const buildSparksDone = (fx: BuildSparks, now: number): boolean => now - fx.born >= fx.ms;

/** Draws the part of `route` between distances `from` and `to` (tiles along it) as one stroke. */
function stroke(g: Graphics, route: number[], from: number, to: number, ox: number, oy: number, scale: number, width: number, colour: number, alpha: number): void {
  const total = route.length / 2 - 1;
  from = Math.max(0, from);
  to = Math.min(total, to);
  if (to <= from || alpha <= 0) return;
  const at = (d: number): [number, number] => {
    const i = Math.min(total - 1, Math.floor(d));
    const f = d - i;
    return [ox + (route[i * 2] + (route[i * 2 + 2] - route[i * 2]) * f) * scale, oy + (route[i * 2 + 1] + (route[i * 2 + 3] - route[i * 2 + 1]) * f) * scale];
  };
  const [sx, sy] = at(from);
  g.moveTo(sx, sy);
  for (let v = Math.floor(from) + 1; v < to; v++) g.lineTo(ox + route[v * 2] * scale, oy + route[v * 2 + 1] * scale);
  const [ex, ey] = at(to);
  g.lineTo(ex, ey).stroke({ width, color: colour, alpha });
}

/** `ox`/`oy` and `scale` map tiles to screen pixels. */
export function drawBuildSparks(g: Graphics, fx: BuildSparks, now: number, ox: number, oy: number, scale: number): void {
  const travelled = ((now - fx.born) / 1000) * SPEED;
  if (fx.flash) {
    const t = (now - fx.born) / FLASH_MS;
    if (t < 1) {
      const { x, y, size } = fx.flash;
      const cx = ox + (x + size / 2) * scale;
      const cy = oy + (y + size / 2) * scale;
      g.rect(ox + x * scale, oy + y * scale, size * scale, size * scale).fill({ color: 0xffffff, alpha: 0.55 * (1 - t) * (1 - t) });
      const r = (size / 2 + 0.2 + t * (size / 2 + 1.5)) * scale;
      g.circle(cx, cy, r).stroke({ width: Math.max(2, 5 * (1 - t)), color: BUILD_SPARK_COLOUR, alpha: 0.9 * (1 - t) });
      g.circle(cx, cy, r * 0.7).stroke({ width: Math.max(1.5, 3 * (1 - t)), color: GLOW_COLOUR, alpha: 0.5 * (1 - t) });
    }
  }
  for (const route of fx.routes) {
    const total = route.length / 2 - 1;
    // Brightness falls off with distance along the route, so the far end of each run is the faintest.
    const fade = (d: number) => Math.max(0, 1 - d / total);
    const head = Math.min(total, travelled);
    const tail = Math.max(0, travelled - TAIL);
    if (tail >= total) continue;
    const pieces = 4;
    for (let k = 0; k < pieces; k++) {
      const a = tail + ((head - tail) * k) / pieces;
      const b = tail + ((head - tail) * (k + 1)) / pieces;
      const alpha = fade(b) * ((k + 1) / pieces);
      stroke(g, route, a, b, ox, oy, scale, 5, GLOW_COLOUR, alpha * 0.25);
      stroke(g, route, a, b, ox, oy, scale, 1.6, BUILD_SPARK_COLOUR, alpha);
    }
  }
}
