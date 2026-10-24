import { Rng } from '../util/rng';
import type { Blueprint } from './blueprint';
import { BASE_FIELD, BASE_LAYOUT, BASE_UNITS, NEUTRAL_CLASS, STARTER_CLASSES, type ClassTemplate } from './content';
import { TILE } from './parts';
import { BASE_FIELD_PATCHES, CENTRE_FIELD_PATCHES, NEUTRAL_UNITS, RESOURCE_PATCH_AMOUNT } from './rules';
import { Simulation } from './simulation';
import { generateTerrain, Terrain, type ClearArea, type TerrainLayout } from './terrain';

export const MAP_SIZE = 64;
export const NEUTRAL = 0;

export interface MapDefinition {
  readonly id: string;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly layout: TerrainLayout;
  readonly description: string;
  /** Multiplies the amount of rock (bigger maps need more to stay interesting). Default 1. */
  readonly density?: number;
  /** Extra resource fields strung along each corner's route to the centre. Default 0. */
  readonly outposts?: number;
  /** Hand-made terrain (a campaign level drawn in Tiled): `Terrain.encode()` form, width x height digits. Replaces generation. */
  readonly terrain?: string;
}

export const MAPS: readonly MapDefinition[] = [
  { id: 'crossroads', name: 'Crossroads', width: 64, height: 64, layout: 'standard', description: 'Balanced central routes' },
  { id: 'small-basin', name: 'Small Basin', width: 48, height: 48, layout: 'open', description: 'Compact and open' },
  { id: 'broken-country', name: 'Broken Country', width: 72, height: 72, layout: 'scattered', description: 'Small scattered outcrops' },
  { id: 'twin-ridges', name: 'Twin Ridges', width: 80, height: 56, layout: 'ridges', description: 'Long lanes between ridges' },
  { id: 'highlands', name: 'Highlands', width: 96, height: 80, layout: 'dense', description: 'Large, rocky battlefields' },
  { id: 'great-plains', name: 'Great Plains', width: 128, height: 128, layout: 'open', density: 3, outposts: 2, description: 'Vast open ground, room to expand' },
  { id: 'sprawl', name: 'Sprawl', width: 112, height: 112, layout: 'scattered', density: 2.5, outposts: 2, description: 'Wide country of small outcrops' },
  { id: 'long-valley', name: 'Long Valley', width: 160, height: 80, layout: 'ridges', density: 2.5, outposts: 3, description: 'A very long battlefield between ridges' },
  { id: 'bastion', name: 'Bastion', width: 128, height: 96, layout: 'citadel', density: 2, outposts: 2, description: 'A walled centre with four gates' },
  { id: 'badlands', name: 'Badlands', width: 144, height: 112, layout: 'dense', density: 2.5, outposts: 3, description: 'Huge rocky maze with distant fields' },
];

/**
 * Game modes. Versus: a four-way free-for-all, one human per corner. Co-op: up to two
 * humans on one team against a bot each (see bot.ts). Solo: co-op for one human. Campaign: solo on a
 * hand-made level from the campaigns/ folder (see server/src/campaign.ts).
 */
export type GameMode = 'versus' | 'coop' | 'solo' | 'campaign';
export const GAME_MODES: readonly { id: GameMode; name: string; description: string }[] = [
  { id: 'versus', name: 'Free for all', description: 'Up to four players, every one against all the others' },
  { id: 'solo', name: 'Single-player', description: 'One player against a bot that churns out waves of units (a private room)' },
  { id: 'campaign', name: 'Campaign', description: 'A single-player level from a campaign (a private room)' },
  { id: 'coop', name: 'Co-op vs bots', description: 'Up to two players on one team, against a bot each that churns out waves of units' },
];
export const parseGameMode = (id: string | null | undefined): GameMode => (id === 'coop' || id === 'solo' || id === 'campaign' ? id : 'versus');

export const DEFAULT_MAP_ID = MAPS[0].id;
export const mapById = (id: string | undefined): MapDefinition => MAPS.find((map) => map.id === id) ?? MAPS[0];

/** Each start corner is the top-left layout mirrored on zero, one or both axes. */
export interface Corner {
  readonly flipX: boolean;
  readonly flipY: boolean;
}

export const CORNERS: readonly Corner[] = [
  { flipX: false, flipY: false },
  { flipX: true, flipY: true },
  { flipX: true, flipY: false },
  { flipX: false, flipY: true },
];

/** Mirrors a top-left tile coordinate of something `size` tiles wide. */
export const flip = (on: boolean, v: number, size: number, extent: number) => (on ? extent - v - size : v);

function clearAreas(width: number, height: number): ClearArea[] {
  const areas: ClearArea[] = [];
  for (const c of CORNERS) {
    const pt = (x: number, y: number, r: number) =>
      areas.push({ x: c.flipX ? width - x : x, y: c.flipY ? height - y : y, r });
    pt(8, 9, 8);
    pt(BASE_FIELD.x + 0.5, BASE_FIELD.y + 0.5, 4);
    pt(16, 16, 3);
  }
  return areas;
}

export function createMapTerrain(map: MapDefinition | string, seed = 0x5eed): ReturnType<typeof generateTerrain> {
  const selected = typeof map === 'string' ? mapById(map) : map;
  if (selected.terrain) return handMadeTerrain(selected);
  return generateTerrain(selected.width, selected.height, new Rng(seed ^ 0x51ed), clearAreas(selected.width, selected.height), selected.layout, selected.density ?? 1);
}

/** Decodes a drawn map, then forces the four base areas open so no start can be walled in. */
function handMadeTerrain(map: MapDefinition): Terrain {
  const t = Terrain.decode(map.width, map.height, map.terrain!);
  for (const a of clearAreas(map.width, map.height)) {
    for (let y = Math.floor(a.y - a.r); y <= Math.ceil(a.y + a.r); y++) {
      for (let x = Math.floor(a.x - a.r); x <= Math.ceil(a.x + a.r); x++) {
        if (!t.inBounds(x, y) || (x - a.x) ** 2 + (y - a.y) ** 2 > a.r * a.r) continue;
        t.passable[y * map.width + x] = 1;
        t.heights[y * map.width + x] = 0;
      }
    }
  }
  return t;
}

/** Terrain, resource fields and neutral wanderers; players are added with setUpPlayer(). */
export function createMatch(seed: number, selection: MapDefinition | string | number = DEFAULT_MAP_ID): Simulation {
  const selected =
    typeof selection === 'number'
      ? { ...MAPS[0], width: selection, height: selection }
      : typeof selection === 'string'
        ? mapById(selection)
        : selection;
  const { width, height } = selected;
  const terrain = createMapTerrain(selected, seed);
  const sim = new Simulation({ width, height, seed }, terrain);
  for (const c of CORNERS) placeField(sim, c);
  const centreX = width / 2;
  const centreY = height / 2;
  for (let i = 0; i < CENTRE_FIELD_PATCHES; i++) {
    const cell = terrain.nearestWalkable(centreX - 2 + sim.rng.int(5), centreY - 2 + sim.rng.int(5));
    if (cell) sim.spawnResourcePatch(cell[0] * TILE + TILE / 2, cell[1] * TILE + TILE / 2, RESOURCE_PATCH_AMOUNT);
  }
  const wanderer = defineClass(sim, NEUTRAL, NEUTRAL_CLASS);
  for (let i = 0; i < NEUTRAL_UNITS; i++) {
    const x = centreX - 8 + sim.rng.int(16);
    const y = centreY - 8 + sim.rng.int(16);
    sim.spawnUnit(wanderer, x * TILE + TILE / 2, y * TILE + TILE / 2);
  }
  for (const c of CORNERS) placeOutposts(sim, c, selected.outposts ?? 0);
  return sim;
}

function placeField(sim: Simulation, c: Corner): void {
  const { width, height } = sim.config;
  for (let i = 0; i < BASE_FIELD_PATCHES; i++) {
    const x = flip(c.flipX, BASE_FIELD.x - 2 + sim.rng.int(5), 1, width);
    const y = flip(c.flipY, BASE_FIELD.y - 2 + sim.rng.int(5), 1, height);
    const cell = sim.terrain.nearestWalkable(x, y, 4);
    if (cell) sim.spawnResourcePatch(cell[0] * TILE + TILE / 2, cell[1] * TILE + TILE / 2, RESOURCE_PATCH_AMOUNT);
  }
}

/** Resource fields spaced evenly along the line from a corner's own field to the map centre. */
function placeOutposts(sim: Simulation, c: Corner, count: number): void {
  const { width, height } = sim.config;
  const fromX = flip(c.flipX, BASE_FIELD.x, 1, width);
  const fromY = flip(c.flipY, BASE_FIELD.y, 1, height);
  for (let i = 1; i <= count; i++) {
    const f = i / (count + 1);
    const x = fromX + (width / 2 - fromX) * f;
    const y = fromY + (height / 2 - fromY) * f;
    for (let k = 0; k < BASE_FIELD_PATCHES / 2; k++) {
      const cell = sim.terrain.nearestWalkable(Math.round(x - 1 + sim.rng.int(3)), Math.round(y - 1 + sim.rng.int(3)), 6);
      if (cell) sim.spawnResourcePatch(cell[0] * TILE + TILE / 2, cell[1] * TILE + TILE / 2, RESOURCE_PATCH_AMOUNT);
    }
  }
}

export function defineClass(sim: Simulation, owner: number, c: ClassTemplate): Blueprint {
  const bp = sim.blueprints.define(owner, c.name, c.parts);
  if (c.program) sim.setProgram(bp.id, c.program);
  return bp;
}

/**
 * Gives a player the starter classes, the starting base for their corner,
 * starting units and resources (placed in the HQ's silos). Harvesters start
 * with a HARVEST task.
 */
export function setUpPlayer(sim: Simulation, owner: number, corner: Corner, resources: number): Blueprint[] {
  const { width, height } = sim.config;
  const classes = new Map<ClassTemplate, Blueprint>();
  for (const c of STARTER_CLASSES) classes.set(c, defineClass(sim, owner, c));

  for (const entry of BASE_LAYOUT) {
    const bp = classes.get(entry.cls)!;
    const size = bp.stats.footprint;
    sim.spawnStructure(bp, flip(corner.flipX, entry.x, size, width), flip(corner.flipY, entry.y, size, height), entry.energy ?? 1);
  }
  let left = resources;
  for (const b of sim.stockpile.dense) {
    if (sim.unit.f.owner[b] === owner) left -= sim.addStock(b, left);
  }
  for (const group of BASE_UNITS) {
    const bp = classes.get(group.cls)!;
    for (let i = 0; i < group.count; i++) {
      const x = flip(corner.flipX, group.x + i, 1, width);
      const y = flip(corner.flipY, group.y, 1, height);
      const e = sim.spawnUnit(bp, x * TILE + TILE / 2, y * TILE + TILE / 2);
      if (bp.stats.cargo > 0) {
        const field = nearestResource(sim, e);
        if (field >= 0) sim.issueOrder(owner, e, 0, 0, field, false);
      }
    }
  }
  return [...classes.values()];
}

function nearestResource(sim: Simulation, e: number): number {
  let best = -1;
  let bestD = Infinity;
  for (const r of sim.resource.dense) {
    const d = sim.distSq(e, r);
    if (d < bestD || (d === bestD && r < best)) {
      best = r;
      bestD = d;
    }
  }
  return best;
}
