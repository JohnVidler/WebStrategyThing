import type { World } from '../ecs/world';
import type { BlueprintStats } from './blueprint';
import { Missile, Position, Resource, Unit } from './components';
import { BUILDING_VISION, NIGHT_VISION_FRACTION, NIGHT_VISION_LOSS, TILE, UNIT_VISION } from './rules';
import type { Terrain } from './terrain';

/*
 * Fog of war. A player sees their own units and buildings, every resource field
 * (the map is known), and anything within the vision of one of their own: at
 * least a small radius, more with sensor modules. The server sends each player
 * only what they can see; the client draws the same vision as fog.
 *
 * Sight is blocked by line of sight when the map's `Terrain` is given: rock and
 * buildings are opaque (you see the face of one, never past it), and a viewer sees
 * out of its own footprint. Flying units look down over everything. Without a
 * terrain the vision is the plain circle.
 */

export function visionRange(s: BlueprintStats): number {
  return Math.max(s.sensorRange, s.structure ? BUILDING_VISION : UNIT_VISION);
}

/**
 * Sight range at the given sunlight (0..100). By day it is `visionRange`; as it gets dark the fog closes
 * in by up to a quarter of the range, at most three tiles, in proportion to how dark it is.
 */
export function visionAt(s: BlueprintStats, sun: number): number {
  const r = visionRange(s);
  return r - Math.min(NIGHT_VISION_LOSS, r * NIGHT_VISION_FRACTION) * (1 - Math.min(100, Math.max(0, sun)) / 100);
}

export interface Viewer {
  readonly x: number;
  readonly y: number;
  readonly r: number;
  /** Looks down from above: nothing blocks it. */
  readonly air?: boolean;
  /** Footprint (tiles) of a building viewer, whose own tiles never block its sight. */
  readonly size?: number;
}

/** `owner` is one player, or a team of players who share what they see. */
const isOwner = (owner: number | ReadonlySet<number>, id: number): boolean => (typeof owner === 'number' ? owner === id : owner.has(id));

/** Own entities' vision circles (sub-tile units). `stats` may be undefined while class info is in flight. */
export function viewersOf(
  world: World,
  owner: number | ReadonlySet<number>,
  stats: (e: number) => BlueprintStats | undefined,
  skip?: (e: number) => boolean,
  sun = 100,
): Viewer[] {
  const unit = world.store(Unit);
  const pos = world.store(Position);
  const out: Viewer[] = [];
  for (const e of unit.dense) {
    if (!isOwner(owner, unit.f.owner[e]) || !pos.has(e) || skip?.(e)) continue;
    const s = stats(e);
    if (s) out.push({ x: pos.f.x[e], y: pos.f.y[e], r: visionAt(s, sun), air: s.flying, size: s.structure ? s.footprint : 0 });
  }
  return out;
}

/** True if the point (sub-tile units) is inside one of the vision circles. */
export function inVision(viewers: readonly Viewer[], x: number, y: number): boolean {
  return viewers.some((v) => (x - v.x) ** 2 + (y - v.y) ** 2 <= v.r * v.r);
}

/**
 * The tiles a set of viewers can see, by recursive shadowcasting. A tile is marked with the current
 * generation, so nothing is cleared between uses; one grid per map is reused (`VisionGrid.of`).
 */
export class VisionGrid {
  private static readonly cache = new WeakMap<Terrain, VisionGrid>();
  /** A tile is in view when its entry equals `gen`. */
  readonly stamp: Uint32Array;
  gen = 0;
  private t!: Terrain;
  private cx = 0;
  private cy = 0;
  private fx = 0;
  private fy = 0;
  private rt = 0;
  private reach = 0;
  private ox0 = 0;
  private oy0 = 0;
  private ox1 = 0;
  private oy1 = 0;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.stamp = new Uint32Array(width * height);
  }

  static of(terrain: Terrain): VisionGrid {
    let g = VisionGrid.cache.get(terrain);
    if (!g) VisionGrid.cache.set(terrain, (g = new VisionGrid(terrain.width, terrain.height)));
    return g;
  }

  /** Forgets everything seen so far. */
  begin(): void {
    if (++this.gen === 0xffffffff) {
      this.stamp.fill(0);
      this.gen = 1;
    }
  }

  seen(tx: number, ty: number): boolean {
    return tx >= 0 && ty >= 0 && tx < this.width && ty < this.height && this.stamp[ty * this.width + tx] === this.gen;
  }

  /** Adds what each viewer sees on `terrain` to the current generation. */
  add(terrain: Terrain, viewers: readonly Viewer[]): void {
    for (const v of viewers) this.addOne(terrain, v);
  }

  addOne(terrain: Terrain, v: Viewer): void {
    this.t = terrain;
    this.fx = v.x / TILE;
    this.fy = v.y / TILE;
    this.rt = v.r / TILE;
    this.cx = Math.floor(this.fx);
    this.cy = Math.floor(this.fy);
    this.reach = Math.ceil(this.rt) + 1;
    if (v.air) {
      for (let y = Math.max(0, this.cy - this.reach); y <= Math.min(this.height - 1, this.cy + this.reach); y++) {
        for (let x = Math.max(0, this.cx - this.reach); x <= Math.min(this.width - 1, this.cx + this.reach); x++) this.mark(x, y);
      }
      return;
    }
    const size = v.size ?? 0;
    this.ox0 = size > 0 ? Math.round(this.fx - size / 2) : this.cx;
    this.oy0 = size > 0 ? Math.round(this.fy - size / 2) : this.cy;
    this.ox1 = this.ox0 + Math.max(size, 1) - 1;
    this.oy1 = this.oy0 + Math.max(size, 1) - 1;
    this.mark(this.cx, this.cy);
    // Eight octants, as (xx, xy, yx, yy) transforms.
    this.scan(1, 1, 0, 1, 0, 0, 1);
    this.scan(1, 1, 0, 0, 1, 1, 0);
    this.scan(1, 1, 0, 0, -1, 1, 0);
    this.scan(1, 1, 0, -1, 0, 0, 1);
    this.scan(1, 1, 0, -1, 0, 0, -1);
    this.scan(1, 1, 0, 0, -1, -1, 0);
    this.scan(1, 1, 0, 0, 1, -1, 0);
    this.scan(1, 1, 0, 1, 0, 0, -1);
  }

  private mark(x: number, y: number): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    if ((x + 0.5 - this.fx) ** 2 + (y + 0.5 - this.fy) ** 2 <= this.rt * this.rt) this.stamp[y * this.width + x] = this.gen;
  }

  private opaque(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return true;
    if (x >= this.ox0 && x <= this.ox1 && y >= this.oy0 && y <= this.oy1) return false;
    const i = y * this.width + x;
    return this.t.passable[i] !== 1 || this.t.occupied[i] !== 0;
  }

  /**
   * One octant of recursive shadowcasting. Rows run outwards from the viewer; `start` and `end` are
   * the slopes (1 to 0) still open. (xx, xy, yx, yy) maps a row/column offset onto the map.
   */
  private scan(row: number, start: number, end: number, xx: number, xy: number, yx: number, yy: number): void {
    if (start < end) return;
    let from = start;
    for (let i = row; i <= this.reach; i++) {
      let blocked = false;
      let next = from;
      for (let dx = -i; dx <= 0; dx++) {
        const dy = -i;
        const mx = this.cx + dx * xx + dy * xy;
        const my = this.cy + dx * yx + dy * yy;
        const left = (dx - 0.5) / (dy + 0.5);
        const right = (dx + 0.5) / (dy - 0.5);
        if (from < right) continue;
        if (end > left) break;
        this.mark(mx, my);
        const wall = this.opaque(mx, my);
        if (blocked) {
          if (wall) {
            next = right;
          } else {
            blocked = false;
            from = next;
          }
        } else if (wall && i < this.reach) {
          blocked = true;
          this.scan(i + 1, from, left, xx, xy, yx, yy);
          next = right;
        }
      }
      if (blocked) break;
    }
  }
}

/** The tiles under an entity: a building's footprint, or the one tile a unit or missile is in. */
function seenAt(grid: VisionGrid, x: number, y: number, size: number): boolean {
  if (size <= 1) return grid.seen(Math.floor(x / TILE), Math.floor(y / TILE));
  const ox = Math.round(x / TILE - size / 2);
  const oy = Math.round(y / TILE - size / 2);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) if (grid.seen(ox + i, oy + j)) return true;
  return false;
}

/** True if the point (sub-tile units) is in view of one of the viewers, with rock and buildings blocking sight. */
export function inSight(terrain: Terrain, viewers: readonly Viewer[], x: number, y: number): boolean {
  const grid = VisionGrid.of(terrain);
  grid.begin();
  grid.add(terrain, viewers);
  return seenAt(grid, x, y, 1);
}

/**
 * Every entity `owner` can see this tick. Pass the map's terrain for line of sight; without it
 * vision is the plain circle.
 */
export function visibleTo(
  world: World,
  owner: number | ReadonlySet<number>,
  stats: (e: number) => BlueprintStats | undefined,
  terrain?: Terrain,
  sun = 100,
): Set<number> {
  const unit = world.store(Unit);
  const missiles = world.store(Missile);
  const pos = world.store(Position);
  const viewers = viewersOf(world, owner, stats, undefined, sun);
  const seen = new Set<number>(world.store(Resource).dense);
  let grid: VisionGrid | undefined;
  if (terrain) {
    grid = VisionGrid.of(terrain);
    grid.begin();
    grid.add(terrain, viewers);
  }
  for (const e of pos.dense) {
    if (seen.has(e)) continue;
    // Your own missiles stay in view however far they fly.
    if ((unit.has(e) && isOwner(owner, unit.f.owner[e])) || (missiles.has(e) && isOwner(owner, missiles.f.owner[e]))) {
      seen.add(e);
      continue;
    }
    const x = pos.f.x[e];
    const y = pos.f.y[e];
    if (grid) {
      const st = unit.has(e) ? stats(e) : undefined;
      const size = st?.structure ? st.footprint : 1;
      if (seenAt(grid, x, y, size)) seen.add(e);
      continue;
    }
    for (const v of viewers) {
      if ((x - v.x) ** 2 + (y - v.y) ** 2 <= v.r * v.r) {
        seen.add(e);
        break;
      }
    }
  }
  return seen;
}
