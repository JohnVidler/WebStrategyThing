import { Rng } from '../util/rng';
import type { Blueprint } from './blueprint';
import { BASE_FIELD, BASE_LAYOUT, BASE_UNITS, NEUTRAL_CLASS, STARTER_CLASSES, type ClassTemplate } from './content';
import { TILE } from './parts';
import { Simulation } from './simulation';
import { generateTerrain, type ClearArea, type TerrainLayout } from './terrain';

export const MAP_SIZE = 64;
export const NEUTRAL = 0;
const FIELD_CRYSTALS = 6;
const FIELD_AMOUNT = 400;
const NEUTRAL_UNITS = 4;

export interface MapDefinition {
  readonly id: string;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly layout: TerrainLayout;
  readonly description: string;
}

export const MAPS: readonly MapDefinition[] = [
  { id: 'crossroads', name: 'Crossroads', width: 64, height: 64, layout: 'standard', description: 'Balanced central routes' },
  { id: 'small-basin', name: 'Small Basin', width: 48, height: 48, layout: 'open', description: 'Compact and open' },
  { id: 'broken-country', name: 'Broken Country', width: 72, height: 72, layout: 'scattered', description: 'Small scattered outcrops' },
  { id: 'twin-ridges', name: 'Twin Ridges', width: 80, height: 56, layout: 'ridges', description: 'Long lanes between ridges' },
  { id: 'highlands', name: 'Highlands', width: 96, height: 80, layout: 'dense', description: 'Large, rocky battlefields' },
];

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
const flip = (on: boolean, v: number, size: number, extent: number) => (on ? extent - v - size : v);

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
  return generateTerrain(selected.width, selected.height, new Rng(seed ^ 0x51ed), clearAreas(selected.width, selected.height), selected.layout);
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
  for (let i = 0; i < 6; i++) {
    const cell = terrain.nearestWalkable(centreX - 2 + sim.rng.int(5), centreY - 2 + sim.rng.int(5));
    if (cell) sim.spawnResource(cell[0] * TILE + TILE / 2, cell[1] * TILE + TILE / 2, FIELD_AMOUNT);
  }
  const wanderer = defineClass(sim, NEUTRAL, NEUTRAL_CLASS);
  for (let i = 0; i < NEUTRAL_UNITS; i++) {
    const x = centreX - 8 + sim.rng.int(16);
    const y = centreY - 8 + sim.rng.int(16);
    sim.spawnUnit(wanderer, x * TILE + TILE / 2, y * TILE + TILE / 2);
  }
  return sim;
}

function placeField(sim: Simulation, c: Corner): void {
  const { width, height } = sim.config;
  for (let i = 0; i < FIELD_CRYSTALS; i++) {
    const x = flip(c.flipX, BASE_FIELD.x - 2 + sim.rng.int(5), 1, width);
    const y = flip(c.flipY, BASE_FIELD.y - 2 + sim.rng.int(5), 1, height);
    const cell = sim.terrain.nearestWalkable(x, y, 4);
    if (cell) sim.spawnResource(cell[0] * TILE + TILE / 2, cell[1] * TILE + TILE / 2, FIELD_AMOUNT);
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
