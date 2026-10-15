import type { World } from '../ecs/world';
import type { BlueprintStats } from './blueprint';
import { Position, Resource, Unit } from './components';
import { BUILDING_VISION, TILE, UNIT_VISION } from './rules';

/*
 * Fog of war. A player sees their own units and buildings, every resource field
 * (the map is known), and anything within the vision of one of their own: at
 * least a small radius, more with sensor modules. The server sends each player
 * only what they can see; the client draws the same vision as fog.
 */

export function visionRange(s: BlueprintStats): number {
  return Math.max(s.sensorRange, s.structure ? BUILDING_VISION : UNIT_VISION);
}

export interface Viewer {
  readonly x: number;
  readonly y: number;
  readonly r: number;
}

/** `owner` is one player, or a team of players who share what they see. */
const isOwner = (owner: number | ReadonlySet<number>, id: number): boolean => (typeof owner === 'number' ? owner === id : owner.has(id));

/** Own entities' vision circles (sub-tile units). `stats` may be undefined while class info is in flight. */
export function viewersOf(
  world: World,
  owner: number | ReadonlySet<number>,
  stats: (e: number) => BlueprintStats | undefined,
  skip?: (e: number) => boolean,
): Viewer[] {
  const unit = world.store(Unit);
  const pos = world.store(Position);
  const out: Viewer[] = [];
  for (const e of unit.dense) {
    if (!isOwner(owner, unit.f.owner[e]) || !pos.has(e) || skip?.(e)) continue;
    const s = stats(e);
    if (s) out.push({ x: pos.f.x[e], y: pos.f.y[e], r: visionRange(s) });
  }
  return out;
}

/** True if the point (sub-tile units) is inside one of the vision circles. */
export function inVision(viewers: readonly Viewer[], x: number, y: number): boolean {
  return viewers.some((v) => (x - v.x) ** 2 + (y - v.y) ** 2 <= v.r * v.r);
}

/** Every entity `owner` can see this tick. */
export function visibleTo(world: World, owner: number | ReadonlySet<number>, stats: (e: number) => BlueprintStats | undefined): Set<number> {
  const unit = world.store(Unit);
  const pos = world.store(Position);
  const viewers = viewersOf(world, owner, stats);
  const seen = new Set<number>(world.store(Resource).dense);
  for (const e of pos.dense) {
    if (seen.has(e)) continue;
    if (unit.has(e) && isOwner(owner, unit.f.owner[e])) {
      seen.add(e);
      continue;
    }
    const x = pos.f.x[e];
    const y = pos.f.y[e];
    for (const v of viewers) {
      if ((x - v.x) ** 2 + (y - v.y) ** 2 <= v.r * v.r) {
        seen.add(e);
        break;
      }
    }
  }
  return seen;
}
