import type { World } from '../ecs/world';
import type { BlueprintStats } from './blueprint';
import { Position, Resource, Unit } from './components';
import { TILE } from './parts';

/*
 * Fog of war. A player sees their own units and buildings, every resource field
 * (the map is known), and anything within the vision of one of their own: at
 * least a small radius, more with sensor modules. The server sends each player
 * only what they can see; the client draws the same vision as fog.
 */

/** Vision without sensors, in sub-tile units. */
export const UNIT_VISION = 4 * TILE;
export const BUILDING_VISION = 6 * TILE;

export function visionRange(s: BlueprintStats): number {
  return Math.max(s.sensorRange, s.structure ? BUILDING_VISION : UNIT_VISION);
}

export interface Viewer {
  readonly x: number;
  readonly y: number;
  readonly r: number;
}

/** Own entities' vision circles (sub-tile units). `stats` may be undefined while class info is in flight. */
export function viewersOf(world: World, owner: number, stats: (e: number) => BlueprintStats | undefined): Viewer[] {
  const unit = world.store(Unit);
  const pos = world.store(Position);
  const out: Viewer[] = [];
  for (const e of unit.dense) {
    if (unit.f.owner[e] !== owner || !pos.has(e)) continue;
    const s = stats(e);
    if (s) out.push({ x: pos.f.x[e], y: pos.f.y[e], r: visionRange(s) });
  }
  return out;
}

/** Every entity `owner` can see this tick. */
export function visibleTo(world: World, owner: number, stats: (e: number) => BlueprintStats | undefined): Set<number> {
  const unit = world.store(Unit);
  const pos = world.store(Position);
  const viewers = viewersOf(world, owner, stats);
  const seen = new Set<number>(world.store(Resource).dense);
  for (const e of pos.dense) {
    if (seen.has(e)) continue;
    if (unit.has(e) && unit.f.owner[e] === owner) {
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
