import { liquidKind, type Terrain } from '@wst/engine';

/** Why a building cannot go where the player wants it, in the order they are checked. */
export type PlacementProblem = 'bounds' | 'building' | 'rock' | 'water' | 'lava' | 'void' | 'vision' | 'sites';

/** What the player reads for each problem, and the sound event raised (see `SOUND_EVENTS.md`). */
export const PLACEMENT_PROBLEMS: Record<PlacementProblem, { text: string; sound: string }> = {
  bounds: { text: 'Cannot build here: that is off the edge of the map', sound: 'build.invalid_bounds' },
  building: { text: 'Cannot build here: something is already in the way', sound: 'build.invalid_blocked' },
  rock: { text: 'Cannot build here: the ground is solid rock', sound: 'build.invalid_terrain' },
  water: { text: 'Cannot build here: that is water', sound: 'build.invalid_terrain' },
  lava: { text: 'Cannot build here: that is lava', sound: 'build.invalid_terrain' },
  void: { text: 'Cannot build here: that is a chasm', sound: 'build.invalid_terrain' },
  vision: { text: 'Cannot build here: you can only build where you have vision', sound: 'build.invalid_vision' },
  sites: { text: 'Cannot build yet: too many construction sites at once', sound: 'build.invalid_limit' },
};

/**
 * The first reason a footprint at (x, y) cannot be built on, or null if the ground is fine.
 * `shape` is the building's footprint mask (`X` marks the cells it fills), if it has one.
 */
export function footprintProblem(terrain: Terrain, x: number, y: number, size: number, shape?: readonly string[] | null): PlacementProblem | null {
  let found: PlacementProblem | null = null;
  const rank = (p: PlacementProblem): void => {
    if (!found || ORDER.indexOf(p) < ORDER.indexOf(found)) found = p;
  };
  for (let j = y; j < y + size; j++) {
    for (let i = x; i < x + size; i++) {
      if (shape && shape[j - y][i - x] !== 'X') continue;
      if (!terrain.inBounds(i, j)) rank('bounds');
      else if (terrain.walkable(i, j)) continue;
      else if (terrain.isRock(i, j)) rank('rock');
      else if (terrain.depthAt(i, j) > 0) rank(LIQUIDS[liquidKind(terrain.depthAt(i, j))] ?? 'water');
      else rank('building');
    }
  }
  return found;
}

const ORDER: readonly PlacementProblem[] = ['bounds', 'building', 'rock', 'void', 'lava', 'water'];
const LIQUIDS: readonly (PlacementProblem | undefined)[] = [undefined, 'water', 'water', 'lava', 'void'];
