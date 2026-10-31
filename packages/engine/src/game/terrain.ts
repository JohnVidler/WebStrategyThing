import type { Rng } from '../util/rng';
import { TILE } from './parts';
import { CLIFF_EVERY, CLIFF_HEIGHT, DEEP_MAX, DEFAULT_WADE, LAVA_MAX, MAX_LIQUID_DEPTH, MAX_TERRAIN_HEIGHT, SHALLOW_MAX, VOID_DEPTH } from './rules';

/**
 * How a ground unit gets about: `climb` is the highest rock it may stand on (0 = open ground
 * only, as on wheels; legs climb), and `clearance` the cells it needs clear on every side of
 * its centre (0 for anything up to a heavy hull).
 */
export interface Mobility {
  readonly climb: number;
  readonly clearance: number;
  /** The deepest liquid it may enter (`Terrain.depth`): 0 stays on dry ground; absent means DEFAULT_WADE, shallow water (slowly). */
  readonly wade?: number;
  /** Skims over liquid at full speed (hover drives). */
  readonly hover?: boolean;
}

/** What kind of liquid a depth is: 0 none, 1 shallow water, 2 deep water, 3 lava, 4 void. */
export const liquidKind = (depth: number): number => (depth <= 0 ? 0 : depth <= SHALLOW_MAX ? 1 : depth <= DEEP_MAX ? 2 : depth <= LAVA_MAX ? 3 : 4);

/** Wheels, tracks and anything small: open ground and shallow water, fits any one-tile gap. */
export const WHEELS: Mobility = Object.freeze({ climb: 0, clearance: 0 });
/** Dry ground only: where buildings stand and aircraft land. */
export const DRY: Mobility = Object.freeze({ climb: 0, clearance: 0, wade: 0 });

/**
 * Terrain heights plus a building-occupancy overlay. Open ground is height 0 (`passable`);
 * rock is 1..MAX_TERRAIN_HEIGHT, higher the deeper inside an outcrop (or a cliff, high right
 * from its edge). Below ground level is liquid: `depth` 1..MAX_LIQUID_DEPTH (shallow water,
 * deep water, lava, void; see `liquidKind`). `passable` stays 1 only on dry open ground, so code
 * that knows nothing of liquids treats them like rock. Wheeled units need open ground with no
 * building (or liquid up to their wade); legged units may also walk onto rock up to their climb.
 * Flying units ignore both in flight but may only stop on a cell that is dry, open and free.
 * Shared by server and client: the client runs the same pathfinder to draw routes.
 */
export class Terrain {
  /** 1 = dry open ground (height 0, no liquid). Kept beside `heights` because most of the game only cares about this. */
  readonly passable: Uint8Array;
  /** Liquid depth per cell: 0 dry, 1..MAX_LIQUID_DEPTH (never on a rock cell). */
  readonly depth: Uint8Array;
  /** Rock height per cell (0 on open ground). Read it through `heightAt`, which also copes with `passable` edited by hand. */
  readonly heights: Uint8Array;
  /** How many building footprints cover each cell. */
  readonly occupied: Uint8Array;
  /** Bumped on every change, so callers can cache paths. */
  version = 0;
  /** Counts every cell set through `setElevation`: a cheap key for caches (the client's liquid outlines) that depend on the shape of the ground but not on buildings. */
  shape = 0;
  /** True once any cell holds liquid (never reset): a map without any skips the liquid checks in the path search. */
  hasLiquid = false;
  /** Per climb and wade: distance (cells) from each cell to the nearest one a unit of that kind cannot enter; rebuilt when `version` moves. */
  private readonly room = new Map<number, { version: number; dist: Uint8Array }>();

  constructor(
    readonly width: number,
    readonly height: number,
    passable?: Uint8Array,
    heights?: Uint8Array,
    depth?: Uint8Array,
  ) {
    this.passable = passable ?? new Uint8Array(width * height).fill(1);
    this.heights = heights ?? new Uint8Array(width * height);
    this.depth = depth ?? new Uint8Array(width * height);
    if (depth) this.hasLiquid = depth.some((v) => v > 0);
    this.occupied = new Uint8Array(width * height);
    if (!heights) this.computeHeights();
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  isPassable(x: number, y: number): boolean {
    return this.inBounds(x, y) && this.passable[y * this.width + x] === 1;
  }

  /** Height of a cell: 0 on open ground and under liquid, at least 1 on rock, MAX_TERRAIN_HEIGHT + 1 outside the map. */
  heightAt(x: number, y: number): number {
    if (!this.inBounds(x, y)) return MAX_TERRAIN_HEIGHT + 1;
    const i = y * this.width + x;
    return this.passable[i] === 1 || this.depth[i] > 0 ? 0 : Math.max(1, this.heights[i]);
  }

  /** Liquid depth of a cell: 0 on dry ground, rock and outside the map. */
  depthAt(x: number, y: number): number {
    return this.inBounds(x, y) ? this.depth[y * this.width + x] : 0;
  }

  /** Solid rock (not liquid): what stops sight. The map edge counts as rock. */
  isRock(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return true;
    const i = y * this.width + x;
    return this.passable[i] !== 1 && this.depth[i] === 0;
  }

  /** Signed elevation: rock height above 0, minus the depth of a liquid, 0 on dry ground (outside the map: MAX_TERRAIN_HEIGHT + 1). */
  elevationAt(x: number, y: number): number {
    const d = this.depthAt(x, y);
    return d > 0 ? -d : this.heightAt(x, y);
  }

  /** Passable terrain with no building on it. */
  walkable(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return false;
    const i = y * this.width + x;
    return this.passable[i] === 1 && this.occupied[i] === 0;
  }

  /** A unit that climbs `climb` and wades `wade` may stand here: no building, liquid no deeper than it wades, rock no higher than it climbs. */
  enterable(x: number, y: number, climb: number, wade: number = DEFAULT_WADE): boolean {
    if (!this.inBounds(x, y)) return false;
    const i = y * this.width + x;
    if (this.occupied[i] !== 0) return false;
    const d = this.depth[i];
    if (d > 0) return d <= wade;
    return this.passable[i] === 1 || (climb > 0 && this.heightAt(x, y) <= climb);
  }

  /** A unit with mobility `m` fits with its centre in this cell (and the cells around it are enterable, as far as its clearance). */
  fits(x: number, y: number, m: Mobility): boolean {
    if (m.clearance <= 0) return this.enterable(x, y, m.climb, m.wade);
    if (!this.inBounds(x, y)) return false;
    return this.roomFor(m.climb, m.wade)[y * this.width + x] > m.clearance;
  }

  /**
   * Chebyshev distance from every cell to the nearest cell (or the map edge) a unit of `climb`
   * and `wade` cannot enter: 0 on such a cell, 1 next to one, and so on. A unit needing clearance c
   * fits where this is above c. Two chamfer passes (exact for the chessboard metric), cached per climb and wade.
   */
  roomFor(climb: number, wade: number = DEFAULT_WADE): Uint8Array {
    const key = climb * 16 + wade;
    const have = this.room.get(key);
    if (have && have.version === this.version) return have.dist;
    const w = this.width;
    const h = this.height;
    const d = have?.dist ?? new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) d[y * w + x] = this.enterable(x, y, climb, wade) ? 255 : 0;
    }
    const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : d[y * w + x]);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (d[i] !== 0) d[i] = Math.min(d[i], at(x - 1, y) + 1, at(x - 1, y - 1) + 1, at(x, y - 1) + 1, at(x + 1, y - 1) + 1);
      }
    }
    for (let y = h - 1; y >= 0; y--) {
      for (let x = w - 1; x >= 0; x--) {
        const i = y * w + x;
        if (d[i] !== 0) d[i] = Math.min(d[i], at(x + 1, y) + 1, at(x + 1, y + 1) + 1, at(x, y + 1) + 1, at(x - 1, y + 1) + 1);
      }
    }
    this.room.set(key, { version: this.version, dist: d });
    return d;
  }

  /**
   * Sets rock heights from `passable`: each rock cell gets its depth inside its outcrop (steps to the
   * nearest open or liquid cell, so the rim is 1), capped at MAX_TERRAIN_HEIGHT; rock cells marked in `cliff`
   * are at least CLIFF_HEIGHT. Liquid cells have height 0. Call after changing `passable` or `depth`.
   */
  computeHeights(cliff?: Uint8Array): void {
    const w = this.width;
    const n = this.passable.length;
    const depth = this.heights;
    depth.fill(MAX_TERRAIN_HEIGHT);
    const queue: number[] = [];
    for (let i = 0; i < n; i++) {
      if (this.passable[i] === 1 || this.depth[i] > 0) {
        depth[i] = 0;
        queue.push(i);
      }
    }
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q];
      const next = depth[i] + 1;
      if (next >= MAX_TERRAIN_HEIGHT) continue;
      const x = i % w;
      const y = (i - x) / w;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (!this.inBounds(nx, ny)) continue;
        const j = ny * w + nx;
        if (depth[j] <= next) continue;
        depth[j] = next;
        queue.push(j);
      }
    }
    if (cliff) for (let i = 0; i < n; i++) if (cliff[i] && depth[i] > 0) depth[i] = Math.max(depth[i], CLIFF_HEIGHT);
    this.version++;
  }

  /**
   * Sets one cell to a signed elevation: above 0 rock of that height, 0 dry ground, below 0 liquid of that depth
   * (-1..-MAX_LIQUID_DEPTH). Leaves the neighbours' rock heights and `version` alone: callers changing many cells
   * call `computeHeights` (or bump `version`) once afterwards.
   */
  setElevation(x: number, y: number, elevation: number): void {
    if (!this.inBounds(x, y)) return;
    const i = y * this.width + x;
    const e = Math.max(-MAX_LIQUID_DEPTH, Math.min(MAX_TERRAIN_HEIGHT, Math.trunc(elevation)));
    this.passable[i] = e === 0 ? 1 : 0;
    this.heights[i] = e > 0 ? e : 0;
    this.depth[i] = e < 0 ? -e : 0;
    if (e < 0) this.hasLiquid = true;
    this.shape++;
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
    return this.nearestFit(x, y, DRY, maxRadius);
  }

  /** Nearest cell a unit with mobility `m` fits in, searching outward in square rings (deterministic order). */
  nearestFit(x: number, y: number, m: Mobility, maxRadius = 12): [number, number] | null {
    if (this.fits(x, y, m)) return [x, y];
    for (let r = 1; r <= maxRadius; r++) {
      let best: [number, number] | null = null;
      let bestD = Infinity;
      for (let j = y - r; j <= y + r; j++) {
        for (let i = x - r; i <= x + r; i++) {
          if (Math.max(Math.abs(i - x), Math.abs(j - y)) !== r || !this.fits(i, j, m)) continue;
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

  /**
   * True if a unit with mobility `m` can travel in a straight line between two sub-tile points, fitting all the way.
   * `maxWet` caps how many samples along the centre line (a quarter tile apart) may lie in liquid, so a shortcut
   * cannot wade through more water than the path it replaces (default: no cap).
   */
  lineWalkable(x0: number, y0: number, x1: number, y1: number, m: Mobility = WHEELS, maxWet = Infinity): boolean {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.max(1, Math.ceil(len / (TILE / 4)));
    // Sample the centre line and two lines offset by ~a unit radius, so paths don't clip corners.
    const ox = len > 0 ? Math.trunc((-dy / len) * TILE * 0.3) : 0;
    const oy = len > 0 ? Math.trunc((dx / len) * TILE * 0.3) : 0;
    let wet = 0;
    for (let s = 0; s <= steps; s++) {
      const px = x0 + Math.trunc((dx * s) / steps);
      const py = y0 + Math.trunc((dy * s) / steps);
      for (let side = 0; side < 3; side++) {
        const k = side === 2 ? -1 : side; // centre line first, then the two offset lines
        const cx = Math.floor((px + k * ox) / TILE);
        const cy = Math.floor((py + k * oy) / TILE);
        if (!this.fits(cx, cy, m)) return false;
        if (side === 0 && maxWet !== Infinity && this.depth[cy * this.width + cx] > 0 && ++wet > maxWet) return false;
      }
    }
    return true;
  }

  /** Compact wire form: one character per cell, row-major: '0' open ground, '1'-'9' rock height, 'a'-'i' liquid depth 1-9. */
  encode(): string {
    let s = '';
    for (let y = 0; y < this.height; y++) for (let x = 0; x < this.width; x++) s += elevationChar(this.elevationAt(x, y));
    return s;
  }

  static decode(width: number, height: number, s: string): Terrain {
    const p = new Uint8Array(width * height);
    const h = new Uint8Array(width * height);
    const d = new Uint8Array(width * height);
    for (let i = 0; i < p.length; i++) {
      const e = elevationOfChar(s.charCodeAt(i));
      if (e > 0) h[i] = e;
      else if (e < 0) d[i] = -e;
      else p[i] = 1;
    }
    return new Terrain(width, height, p, h, d);
  }
}

/** The wire character of a signed elevation (see `Terrain.encode`). */
export const elevationChar = (e: number): string => (e < 0 ? String.fromCharCode(96 + Math.min(MAX_LIQUID_DEPTH, -e)) : String(Math.min(MAX_TERRAIN_HEIGHT, e)));

/** The signed elevation of a wire character code; anything unknown is dry ground. */
export function elevationOfChar(code: number): number {
  if (code >= 49 && code <= 48 + MAX_TERRAIN_HEIGHT) return code - 48;
  if (code >= 97 && code <= 96 + MAX_LIQUID_DEPTH) return -(code - 96);
  return 0;
}

export interface ClearArea {
  readonly x: number;
  readonly y: number;
  readonly r: number;
}

/**
 * Liquid bodies a map adds after its rock: water `lakes`, `lava` pools, `chasms` (voids) and winding `rivers`, each crossed
 * by `bridges` dry strips (default 2). Counts are before `density`, and per quadrant, mirrored like rock, unless `free` is set:
 * then they are for the whole map and placed anywhere, so the ground is not symmetric (every base is still joined to the others
 * by ground wheels can cross). No liquid is drawn, and no random number used, for a map that asks for none.
 */
export interface LiquidSpec {
  readonly lakes?: number;
  readonly lava?: number;
  readonly chasms?: number;
  /** A void in the middle of the map, as a fraction of the width and height it spans in each direction from the centre. */
  readonly centralVoid?: number;
  readonly rivers?: number;
  readonly bridges?: number;
  readonly free?: boolean;
}

/** `citadel` walls off the centre of the map behind a ring with a gate on each side. */
export type TerrainLayout = 'standard' | 'open' | 'scattered' | 'ridges' | 'dense' | 'citadel';

/**
 * Generates rock outcrops in one quadrant and mirrors them on both axes, so
 * every corner start is equally fair. `clear` areas (bases, fields) are kept
 * open and connected to the map centre. `density` multiplies the number of
 * outcrops, so bigger maps can be as cluttered as small ones. Every
 * CLIFF_EVERY-th outcrop is a cliff (high from its edge), and rock heights
 * follow depth inside each outcrop.
 */
export function generateTerrain(
  width: number,
  height: number,
  rng: Rng,
  clear: readonly ClearArea[],
  layout: TerrainLayout = 'standard',
  density = 1,
  /** Clear areas are opened where they are given, not mirrored on all four corners (maps whose starts are not the four corners). */
  asymmetric = false,
  /** Water, lava and voids, added after every other random draw so maps without them are unchanged. */
  liquids?: LiquidSpec,
): Terrain {
  const t = new Terrain(width, height);
  const cliff = new Uint8Array(width * height);
  const qw = Math.ceil(width / 2);
  const qh = Math.ceil(height / 2);
  const mirrors = (x: number, y: number) => [[x, y], [width - 1 - x, y], [x, height - 1 - y], [width - 1 - x, height - 1 - y]];
  const block = (x: number, y: number, isCliff: boolean) => {
    for (const [mx, my] of mirrors(x, y)) {
      if (!t.inBounds(mx, my)) continue;
      t.passable[my * width + mx] = 0;
      if (isCliff) cliff[my * width + mx] = 1;
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
    // Chosen by position in the list, so the rock layout (and every random number after it) is unchanged.
    const isCliff = n % CLIFF_EVERY === CLIFF_EVERY - 1;
    for (let y = cy - ry; y <= cy + ry; y++) {
      for (let x = cx - rx; x <= cx + rx; x++) {
        if (x < 0 || y < 0 || x >= qw || y >= qh) continue;
        if (((x - cx) * ry) ** 2 + ((y - cy) * rx) ** 2 <= (rx * ry) ** 2) block(x, y, isCliff);
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
        // The citadel wall is a cliff: walkers must use the gates too (only colossus legs stride over it).
        if (d >= radius && d < radius + 2.5 && !gate) block(x, y, true);
      }
    }
  }

  // Liquid bodies (kind 1 water, 2 lava, 3 void) go on open ground only, mirrored like rock. Their depth is set at the end
  // from the distance to the shore; fords are water capped at shallow, so a river can be waded where bridges would be.
  const kind = new Uint8Array(width * height);
  const ford = new Uint8Array(width * height);
  if (liquids) {
    const free = liquids.free === true;
    const pool = (x: number, y: number, k: number) => {
      for (const [mx, my] of free ? [[x, y]] : mirrors(x, y)) {
        if (!t.inBounds(mx, my)) continue;
        const i = my * width + mx;
        if (t.passable[i] !== 1 || kind[i]) continue;
        t.passable[i] = 0;
        kind[i] = k;
      }
    };
    const body = (count: number | undefined, k: number, rxBase: number, rxSpread: number, ryBase: number, rySpread: number) => {
      for (let n = 0; n < Math.round((count ?? 0) * density); n++) {
        const [bw, bh] = free ? [width, height] : [qw, qh];
        const cx = rng.int(bw);
        const cy = rng.int(bh);
        let rx = rxBase + rng.int(rxSpread);
        let ry = ryBase + rng.int(rySpread);
        if (k === 3 && n % 2) [rx, ry] = [ry, rx]; // chasms run both ways
        for (let y = cy - ry; y <= cy + ry; y++) {
          for (let x = cx - rx; x <= cx + rx; x++) {
            if (x < 0 || y < 0 || x >= bw || y >= bh) continue;
            if (((x - cx) * ry) ** 2 + ((y - cy) * rx) ** 2 <= (rx * ry) ** 2) pool(x, y, k);
          }
        }
      }
    };
    if (liquids.centralVoid) {
      // One big void at the middle, over rock too; no random numbers drawn.
      const rx = Math.round(width * liquids.centralVoid);
      const ry = Math.round(height * liquids.centralVoid);
      const mx = (width - 1) / 2;
      const my = (height - 1) / 2;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (((x - mx) / rx) ** 2 + ((y - my) / ry) ** 2 > 1) continue;
          const i = y * width + x;
          t.passable[i] = 0;
          kind[i] = 3;
        }
      }
    }
    body(liquids.lakes, 1, 2, 4, 2, 4);
    body(liquids.lava, 2, 1, 3, 1, 3);
    body(liquids.chasms, 3, 1, 2, 3, 4);
    // Rivers run right across the map (the first along it, the next across it, and so on), five cells wide and winding, with
    // `bridges` dry strips three cells wide where they can be crossed on foot. Never mirrored: they are the landform.
    for (let r = 0; r < (liquids.rivers ?? 0); r++) {
      const vertical = r % 2 === 1;
      const along = vertical ? height : width;
      const across = vertical ? width : height;
      const phase = rng.int(628) / 100;
      const amp = 2 + rng.int(3);
      const base = Math.floor(across * (0.3 + 0.4 * (rng.int(100) / 100)));
      const bridges = liquids.bridges ?? 2;
      const crossings: number[] = [];
      for (let b = 0; b < bridges; b++) crossings.push(Math.floor((along * (b + 1)) / (bridges + 1)) + rng.int(9) - 4);
      for (let p = 0; p < along; p++) {
        if (crossings.some((c) => Math.abs(p - c) <= 1)) continue;
        const off = Math.round(Math.sin(p * 0.12 + phase) * amp);
        for (let d = -2; d <= 2; d++) {
          const q = base + off + d;
          pool(vertical ? q : p, vertical ? p : q, 1);
        }
      }
    }
  }

  // Everything below opens all four mirrored cells at once, so no corner is ever given a
  // shortcut the others lack.
  const dry = (i: number) => {
    t.passable[i] = 1;
    kind[i] = 0;
    ford[i] = 0;
    t.depth[i] = 0;
  };
  const open = (x: number, y: number) => {
    for (const [mx, my] of mirrors(x, y)) {
      if (t.inBounds(mx, my)) dry(my * width + mx);
    }
  };
  const openClear = (x: number, y: number) => {
    if (!asymmetric) open(x, y);
    else if (t.inBounds(x, y)) dry(y * width + x);
  };
  for (const a of clear) {
    for (let y = Math.floor(a.y - a.r); y <= Math.ceil(a.y + a.r); y++) {
      for (let x = Math.floor(a.x - a.r); x <= Math.ceil(a.x + a.r); x++) {
        if ((x - a.x) ** 2 + (y - a.y) ** 2 <= a.r * a.r) openClear(x, y);
      }
    }
  }

  // Make sure every clear area connects to the centre: carve 3-wide corridors where needed.
  // Only the top-left quadrant's areas are checked; the mirrored carving serves the others.
  // With liquid the centre may be a river, so every area is checked against the first one instead (a base, always dry).
  const hub = liquids && clear.length > 0 ? clear[0] : null;
  const centre: [number, number] = hub ? [Math.floor(hub.x), Math.floor(hub.y)] : [Math.floor(width / 2), Math.floor(height / 2)];
  open(centre[0], centre[1]);
  if (liquids) settleLiquids(t, kind, ford); // depths first: wheels can wade shallow water, so fords keep a map joined
  for (const a of clear) {
    if (!asymmetric && !hub && (a.x > width / 2 || a.y > height / 2)) continue;
    const reach = flood(t, centre[0], centre[1]);
    if (reach[Math.floor(a.y) * width + Math.floor(a.x)]) continue;
    const steps = Math.max(Math.abs(centre[0] - a.x), Math.abs(centre[1] - a.y));
    for (let s = 0; s <= steps; s++) {
      const x = Math.round(a.x + ((centre[0] - a.x) * s) / steps);
      const y = Math.round(a.y + ((centre[1] - a.y) * s) / steps);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) openClear(x + dx, y + dy);
    }
  }
  // Fill unreachable pockets so nothing spawns or lands where it can never leave.
  const reach = flood(t, centre[0], centre[1]);
  for (let i = 0; i < t.passable.length; i++) if (!reach[i]) t.passable[i] = 0;
  if (liquids) settleLiquids(t, kind, ford);
  t.computeHeights(cliff);
  return t;
}

/**
 * Sets every liquid cell's depth from its kind and distance to the shore (the nearest cell of another kind, not the map edge):
 * water 1 at the shore up to DEEP_MAX in the middle (fords stay shallow), lava from DEEP_MAX + 1 up to LAVA_MAX, a void all VOID_DEPTH.
 */
function settleLiquids(t: Terrain, kind: Uint8Array, ford: Uint8Array): void {
  const w = t.width;
  const n = w * t.height;
  t.depth.fill(0);
  const dist = new Int32Array(n);
  const queue = new Int32Array(n);
  for (let k = 1; k <= 3; k++) {
    let head = 0;
    let tail = 0;
    let any = false;
    for (let i = 0; i < n; i++) {
      if (kind[i] === k) {
        dist[i] = -1;
        any = true;
      } else {
        dist[i] = 0;
        queue[tail++] = i;
      }
    }
    if (!any) continue;
    while (head < tail) {
      const i = queue[head++];
      const x = i % w;
      if (x > 0 && dist[i - 1] === -1) (dist[i - 1] = dist[i] + 1), (queue[tail++] = i - 1);
      if (x < w - 1 && dist[i + 1] === -1) (dist[i + 1] = dist[i] + 1), (queue[tail++] = i + 1);
      if (i >= w && dist[i - w] === -1) (dist[i - w] = dist[i] + 1), (queue[tail++] = i - w);
      if (i + w < n && dist[i + w] === -1) (dist[i + w] = dist[i] + 1), (queue[tail++] = i + w);
    }
    for (let i = 0; i < n; i++) {
      if (kind[i] !== k) continue;
      const d = dist[i] < 0 ? 99 : dist[i];
      t.depth[i] = k === 1 ? Math.min(ford[i] ? SHALLOW_MAX : DEEP_MAX, Math.max(1, d)) : k === 2 ? Math.min(LAVA_MAX, DEEP_MAX + Math.max(1, d)) : VOID_DEPTH;
      t.heights[i] = 0;
    }
  }
  t.hasLiquid = true;
  t.version++;
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
      if (!t.enterable(nx, ny, 0)) continue; // dry ground and shallow water: where wheels can go
      const j = ny * t.width + nx;
      if (seen[j]) continue;
      seen[j] = 1;
      stack.push(j);
    }
  }
  return seen;
}
