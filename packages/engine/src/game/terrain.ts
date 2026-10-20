import type { Rng } from '../util/rng';
import { TILE } from './parts';

/**
 * Boolean terrain (passable or not) plus a building-occupancy overlay.
 * Ground units need both clear; flying units ignore both in flight but may
 * only stop on a cell that is passable and free.
 * Shared by server and client: the client runs the same pathfinder to draw routes.
 */
export class Terrain {
  readonly passable: Uint8Array;
  /** How many building footprints cover each cell. */
  readonly occupied: Uint8Array;
  /** Bumped on every change, so callers can cache paths. */
  version = 0;

  constructor(
    readonly width: number,
    readonly height: number,
    passable?: Uint8Array,
  ) {
    this.passable = passable ?? new Uint8Array(width * height).fill(1);
    this.occupied = new Uint8Array(width * height);
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  isPassable(x: number, y: number): boolean {
    return this.inBounds(x, y) && this.passable[y * this.width + x] === 1;
  }

  /** Passable terrain with no building on it. */
  walkable(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return false;
    const i = y * this.width + x;
    return this.passable[i] === 1 && this.occupied[i] === 0;
  }

  /** Marks (delta = 1) or clears (delta = -1) a size × size footprint (only the 'X' cells of `shape`, if given) whose top-left is (x, y). */
  occupy(x: number, y: number, size: number, delta: 1 | -1, shape?: readonly string[] | null): void {
    for (let j = y; j < y + size; j++) {
      for (let i = x; i < x + size; i++) {
        if (shape && shape[j - y][i - x] !== 'X') continue;
        if (this.inBounds(i, j)) this.occupied[j * this.width + i] += delta;
      }
    }
    this.version++;
  }

  clearOccupancy(): void {
    this.occupied.fill(0);
    this.version++;
  }

  footprintFree(x: number, y: number, size: number, shape?: readonly string[] | null): boolean {
    for (let j = y; j < y + size; j++) for (let i = x; i < x + size; i++) if ((!shape || shape[j - y][i - x] === 'X') && !this.walkable(i, j)) return false;
    return true;
  }

  /** Nearest walkable cell, searching outward in square rings (deterministic order). */
  nearestWalkable(x: number, y: number, maxRadius = 12): [number, number] | null {
    if (this.walkable(x, y)) return [x, y];
    for (let r = 1; r <= maxRadius; r++) {
      let best: [number, number] | null = null;
      let bestD = Infinity;
      for (let j = y - r; j <= y + r; j++) {
        for (let i = x - r; i <= x + r; i++) {
          if (Math.max(Math.abs(i - x), Math.abs(j - y)) !== r || !this.walkable(i, j)) continue;
          const d = (i - x) ** 2 + (j - y) ** 2;
          if (d < bestD) {
            bestD = d;
            best = [i, j];
          }
        }
      }
      if (best) return best;
    }
    return null;
  }

  /** True if a unit can travel in a straight line between two sub-tile points without touching a blocked cell. */
  lineWalkable(x0: number, y0: number, x1: number, y1: number): boolean {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.max(1, Math.ceil(len / (TILE / 4)));
    // Sample the centre line and two lines offset by ~a unit radius, so paths don't clip corners.
    const ox = len > 0 ? Math.trunc((-dy / len) * TILE * 0.3) : 0;
    const oy = len > 0 ? Math.trunc((dx / len) * TILE * 0.3) : 0;
    for (let s = 0; s <= steps; s++) {
      const px = x0 + Math.trunc((dx * s) / steps);
      const py = y0 + Math.trunc((dy * s) / steps);
      for (const k of [0, 1, -1]) {
        if (!this.walkable(Math.floor((px + k * ox) / TILE), Math.floor((py + k * oy) / TILE))) return false;
      }
    }
    return true;
  }

  /** Compact wire form: one '0'/'1' character per cell. */
  encode(): string {
    let s = '';
    for (const v of this.passable) s += v ? '1' : '0';
    return s;
  }

  static decode(width: number, height: number, s: string): Terrain {
    const p = new Uint8Array(width * height);
    for (let i = 0; i < p.length; i++) p[i] = s.charCodeAt(i) === 49 ? 1 : 0;
    return new Terrain(width, height, p);
  }
}

export interface ClearArea {
  readonly x: number;
  readonly y: number;
  readonly r: number;
}

/** `citadel` walls off the centre of the map behind a ring with a gate on each side. */
export type TerrainLayout = 'standard' | 'open' | 'scattered' | 'ridges' | 'dense' | 'citadel';

/**
 * Generates rock outcrops in one quadrant and mirrors them on both axes, so
 * every corner start is equally fair. `clear` areas (bases, fields) are kept
 * open and connected to the map centre. `density` multiplies the number of
 * outcrops, so bigger maps can be as cluttered as small ones.
 */
export function generateTerrain(
  width: number,
  height: number,
  rng: Rng,
  clear: readonly ClearArea[],
  layout: TerrainLayout = 'standard',
  density = 1,
): Terrain {
  const t = new Terrain(width, height);
  const qw = Math.ceil(width / 2);
  const qh = Math.ceil(height / 2);
  const block = (x: number, y: number) => {
    for (const [mx, my] of [[x, y], [width - 1 - x, y], [x, height - 1 - y], [width - 1 - x, height - 1 - y]]) {
      if (t.inBounds(mx, my)) t.passable[my * width + mx] = 0;
    }
  };
  const outcrops =
    layout === 'standard'
      ? 10 + rng.int(4)
      : layout === 'open'
        ? 5 + rng.int(3)
        : layout === 'scattered'
          ? 20 + rng.int(7)
          : layout === 'ridges'
            ? 8 + rng.int(3)
            : layout === 'citadel'
              ? 12 + rng.int(5)
              : 15 + rng.int(5);
  for (let n = 0; n < Math.round(outcrops * density); n++) {
    const cx = rng.int(qw);
    const cy = rng.int(qh);
    let rx = 1;
    let ry = 1;
    if (layout === 'standard') {
      rx += rng.int(5);
      ry += rng.int(5);
    } else if (layout === 'open') {
      rx += rng.int(3);
      ry += rng.int(3);
    } else if (layout === 'scattered') {
      rx += rng.int(2);
      ry += rng.int(2);
    } else if (layout === 'citadel') {
      rx += rng.int(3);
      ry += rng.int(3);
    } else if (layout === 'ridges') {
      rx += rng.int(2);
      ry += 3 + rng.int(5);
      if (n % 2) [rx, ry] = [ry, rx];
    } else {
      rx += 2 + rng.int(4);
      ry += 2 + rng.int(4);
    }
    for (let y = cy - ry; y <= cy + ry; y++) {
      for (let x = cx - rx; x <= cx + rx; x++) {
        if (x < 0 || y < 0 || x >= qw || y >= qh) continue;
        if (((x - cx) * ry) ** 2 + ((y - cy) * rx) ** 2 <= (rx * ry) ** 2) block(x, y);
      }
    }
  }

  if (layout === 'citadel') {
    // Ring of rock around the centre, in quadrant coordinates (the centre is the quadrant's far corner).
    const radius = Math.floor(Math.min(width, height) * 0.2);
    for (let y = 0; y < qh; y++) {
      for (let x = 0; x < qw; x++) {
        const d = Math.hypot(x - (qw - 0.5), y - (qh - 0.5));
        const gate = Math.abs(x - (qw - 0.5)) < 3 || Math.abs(y - (qh - 0.5)) < 3;
        if (d >= radius && d < radius + 2.5 && !gate) block(x, y);
      }
    }
  }

  // Everything below opens all four mirrored cells at once, so no corner is ever given a
  // shortcut the others lack.
  const open = (x: number, y: number) => {
    for (const [mx, my] of [[x, y], [width - 1 - x, y], [x, height - 1 - y], [width - 1 - x, height - 1 - y]]) {
      if (t.inBounds(mx, my)) t.passable[my * width + mx] = 1;
    }
  };
  for (const a of clear) {
    for (let y = Math.floor(a.y - a.r); y <= Math.ceil(a.y + a.r); y++) {
      for (let x = Math.floor(a.x - a.r); x <= Math.ceil(a.x + a.r); x++) {
        if ((x - a.x) ** 2 + (y - a.y) ** 2 <= a.r * a.r) open(x, y);
      }
    }
  }

  // Make sure every clear area connects to the centre: carve 3-wide corridors where needed.
  // Only the top-left quadrant's areas are checked; the mirrored carving serves the others.
  const centre: [number, number] = [Math.floor(width / 2), Math.floor(height / 2)];
  open(centre[0], centre[1]);
  for (const a of clear) {
    if (a.x > width / 2 || a.y > height / 2) continue;
    const reach = flood(t, centre[0], centre[1]);
    if (reach[Math.floor(a.y) * width + Math.floor(a.x)]) continue;
    const steps = Math.max(Math.abs(centre[0] - a.x), Math.abs(centre[1] - a.y));
    for (let s = 0; s <= steps; s++) {
      const x = Math.round(a.x + ((centre[0] - a.x) * s) / steps);
      const y = Math.round(a.y + ((centre[1] - a.y) * s) / steps);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) open(x + dx, y + dy);
    }
  }
  // Fill unreachable pockets so nothing spawns or lands where it can never leave.
  const reach = flood(t, centre[0], centre[1]);
  for (let i = 0; i < t.passable.length; i++) if (!reach[i]) t.passable[i] = 0;
  return t;
}

function flood(t: Terrain, sx: number, sy: number): Uint8Array {
  const seen = new Uint8Array(t.width * t.height);
  const stack = [sy * t.width + sx];
  seen[stack[0]] = 1;
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % t.width;
    const y = (i - x) / t.width;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (!t.isPassable(nx, ny)) continue;
      const j = ny * t.width + nx;
      if (seen[j]) continue;
      seen[j] = 1;
      stack.push(j);
    }
  }
  return seen;
}
