import { Rng } from '../util/rng';
import type { Blueprint } from './blueprint';
import type { Scenario } from './scenario';
import { BASE_FIELD, BASE_LAYOUT, BASE_UNITS, NEUTRAL_CLASS, STARTER_CLASSES, type ClassTemplate } from './content';
import { placeFeatures } from './features';
import { TILE } from './parts';
import { BASE_FIELD_PATCHES, CENTRE_FIELD_PATCHES, NEUTRAL_UNITS, RESOURCE_PATCH_AMOUNT } from './rules';
import { Simulation } from './simulation';
import { generateTerrain, Terrain, type ClearArea, type LiquidSpec, type TerrainLayout } from './terrain';

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
  /** Water, lava, voids and rivers added after the rock (see `LiquidSpec`). Absent: dry land, as every older map. */
  readonly liquids?: LiquidSpec;
  /** Hand-made terrain (a campaign level drawn in Tiled): `Terrain.encode()` form, width x height digits. Replaces generation. */
  readonly terrain?: string;
  /**
   * Made for one scenario (horde or surrounded): the map is only offered for it and plays it whatever
   * was asked for. With `starts` the players' bases are clustered where the map says, not in the four corners.
   */
  readonly scenario?: Scenario;
  /** Where the humans' bases go, in seat order (at most four). Default: the four corners (Surrounded: the map centre). */
  readonly starts?: readonly Corner[];
  /** Surrounded: where the bots' bases go. Default: the four corners. */
  readonly foes?: readonly Corner[];
  /** Horde: the tile its groups appear at. Default: the corner opposite the human. */
  readonly hordeFrom?: { readonly x: number; readonly y: number };
}

/** A 2x2 block of bases (22 tiles apart) whose top-left base is moved by (x, y) tiles from the top-left layout. */
const cluster = (x: number, y: number): Corner[] => [
  { flipX: false, flipY: false, offsetX: x, offsetY: y },
  { flipX: false, flipY: false, offsetX: x + 22, offsetY: y },
  { flipX: false, flipY: false, offsetX: x, offsetY: y + 22 },
  { flipX: false, flipY: false, offsetX: x + 22, offsetY: y + 22 },
];

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
  // Made for one scenario each: the players start close together (a block of four bases) and the map is only offered for that scenario.
  { id: 'last-redoubt', name: 'Last Redoubt', width: 96, height: 80, layout: 'dense', scenario: 'horde', starts: cluster(2, 2), hordeFrom: { x: 80, y: 64 }, description: 'Horde: four bases huddled in one rocky corner, and the whole far side of the map to come at you' },
  { id: 'siege-line', name: 'Siege Line', width: 112, height: 72, layout: 'ridges', scenario: 'horde', starts: cluster(2, 12), hordeFrom: { x: 96, y: 36 }, description: 'Horde: a cluster of bases on the west edge, with lanes between ridges for the horde to march down' },
  { id: 'crossfire', name: 'Crossfire', width: 112, height: 112, layout: 'scattered', density: 1.5, scenario: 'surrounded', starts: cluster(34, 34), description: 'Surrounded: your bases share the middle of a wide map, with a bot in every corner' },
  { id: 'pincer', name: 'Pincer', width: 96, height: 96, layout: 'standard', scenario: 'surrounded', starts: cluster(26, 26), description: 'Surrounded: a tighter map with a rocky middle; the four bots are never far away' },
  { id: 'dead-end', name: 'Dead End', width: 64, height: 96, layout: 'ridges', scenario: 'horde', starts: cluster(10, 52), hordeFrom: { x: 32, y: 12 }, description: 'Horde: a tall, narrow map with your bases at the bottom and the horde pouring down the lanes from the top' },
  { id: 'high-ground', name: 'High Ground', width: 128, height: 96, layout: 'dense', density: 1.5, scenario: 'horde', starts: cluster(83, 28), hordeFrom: { x: 16, y: 48 }, description: 'Horde: your bases on the east edge behind a belt of heavy rock, with a long march for the horde' },
  { id: 'long-night', name: 'Long Night', width: 160, height: 80, layout: 'scattered', density: 2, scenario: 'horde', starts: cluster(4, 20), hordeFrom: { x: 144, y: 40 }, description: 'Horde: a very long field of small outcrops; the horde has the whole length of the map to string out' },
  { id: 'trench-works', name: 'Trench Works', width: 96, height: 96, layout: 'citadel', scenario: 'horde', starts: cluster(52, 3), hordeFrom: { x: 16, y: 80 }, description: 'Horde: bases in the top-right corner with a walled ring in the middle that splits the horde as it comes' },
  { id: 'bullseye', name: 'Bullseye', width: 160, height: 160, layout: 'citadel', density: 2, scenario: 'surrounded', starts: cluster(58, 58), description: 'Surrounded: your bases inside a great walled ring with four gates, and a bot in every corner far outside' },
  { id: 'ridgeback', name: 'Ridgeback', width: 128, height: 96, layout: 'ridges', scenario: 'surrounded', starts: cluster(42, 26), description: 'Surrounded: long ridges run between your bases and the corners, so attacks come down lanes' },
  { id: 'clearing', name: 'Clearing', width: 120, height: 120, layout: 'open', density: 2, scenario: 'surrounded', starts: cluster(38, 38), description: 'Surrounded: wide open ground with little cover, and bots that can see you coming' },
  { id: 'rubble', name: 'Rubble', width: 104, height: 104, layout: 'dense', scenario: 'surrounded', starts: cluster(30, 30), description: 'Surrounded: heavy rock all around the middle; a tight, defensible position with few ways in' },
  { id: 'badlands', name: 'Badlands', width: 144, height: 112, layout: 'dense', density: 2.5, outposts: 3, description: 'Huge rocky maze with distant fields' },
  { id: 'lakeland', name: 'Lakeland', width: 96, height: 96, layout: 'open', density: 1.5, liquids: { lakes: 13, free: true }, description: 'Open country dotted with lakes of every size: shallows slow wheels and tracks, deep water stops them' },
  { id: 'twin-rivers', name: 'Twin Rivers', width: 112, height: 80, layout: 'standard', liquids: { rivers: 2, bridges: 2, lakes: 2, free: true }, description: 'Two winding rivers, each bridged in two places: hold the crossings, or ford and swim them with amphibious and hover drives' },
  { id: 'cinder-fields', name: 'Cinder Fields', width: 104, height: 104, layout: 'scattered', outposts: 1, liquids: { lava: 9, lakes: 2, free: true }, description: 'Scattered pools of lava and a few lakes: only hover units cross the lava, and it burns them' },
  { id: 'the-rift', name: 'The Rift', width: 112, height: 96, layout: 'ridges', liquids: { chasms: 2, lava: 2, centralVoid: 0.15 }, description: 'A vast void at the heart of the map and chasms with no floor split the lanes: only fliers cross' },
];

/**
 * Game modes. Versus: a four-way free-for-all, one human per corner. Co-op: up to two
 * humans on one team against a bot each (see bot.ts). Solo: co-op for one human. Campaign: solo on a
 * hand-made level from the campaigns/ folder (see server/src/campaign.ts).
 */
export type GameMode = 'versus' | 'coop' | 'solo' | 'campaign';
export const GAME_MODES: readonly { id: GameMode; name: string; description: string }[] = [
  { id: 'versus', name: 'Free for all', description: 'Up to four players, every one against all the others' },
  { id: 'solo', name: 'Single Player', description: 'One player against a bot that churns out waves of units (a private room)' },
  { id: 'campaign', name: 'Campaign', description: 'A single-player level from a campaign (a private room)' },
  { id: 'coop', name: 'Co-op vs bots', description: 'Up to two players on one team, against a bot each that churns out waves of units' },
];
export const parseGameMode = (id: string | null | undefined): GameMode => (id === 'coop' || id === 'solo' || id === 'campaign' ? id : 'versus');

/** The maps made for `scenario`, or (with no scenario) the ones that suit any game. */
export const mapsFor = (scenario?: Scenario): MapDefinition[] => MAPS.filter((map) => map.scenario === scenario);

export const DEFAULT_MAP_ID = MAPS[0].id;
export const mapById = (id: string | undefined): MapDefinition => MAPS.find((map) => map.id === id) ?? MAPS[0];

/** Each start corner is the top-left layout mirrored on zero, one or both axes. */
export interface Corner {
  readonly flipX: boolean;
  readonly flipY: boolean;
  /** Shifts everything placed for this start, in tiles (the map-centre start of Surrounded). Default 0. */
  readonly offsetX?: number;
  readonly offsetY?: number;
}

/** The start in the middle of the map: the top-left layout moved so the base is centred (its clear patch is centred on tile 8, 9). */
export const centreCorner = (width: number, height: number): Corner => ({
  flipX: false,
  flipY: false,
  offsetX: Math.round(width / 2 - 8),
  offsetY: Math.round(height / 2 - 9),
});

export const CORNERS: readonly Corner[] = [
  { flipX: false, flipY: false },
  { flipX: true, flipY: true },
  { flipX: true, flipY: false },
  { flipX: false, flipY: true },
];

/** Mirrors a top-left tile coordinate of something `size` tiles wide. */
export const flip = (on: boolean, v: number, size: number, extent: number) => (on ? extent - v - size : v);

/**
 * Where bases go for a scenario: the humans' seats and, in Surrounded, the bots' bases. Without map-specific
 * starts these are the four corners (and the centre for Surrounded), as they have always been.
 */
export function mapStarts(map: MapDefinition, scenario: Scenario = 'standard'): { seats: readonly Corner[]; foes: readonly Corner[] } {
  const surrounded = (map.scenario ?? scenario) === 'surrounded';
  return {
    seats: map.starts ?? (surrounded ? [centreCorner(map.width, map.height)] : CORNERS),
    foes: surrounded ? map.foes ?? CORNERS : [],
  };
}

function clearAreas(map: MapDefinition, scenario: Scenario = 'standard'): ClearArea[] {
  const areas: ClearArea[] = [];
  const { width, height } = map;
  const starts = [...mapStarts(map, scenario).foes, ...mapStarts(map, scenario).seats];
  if (map.hordeFrom) areas.push({ x: map.hordeFrom.x, y: map.hordeFrom.y, r: 6 });
  for (const c of starts) {
    const pt = (x: number, y: number, r: number) =>
      areas.push({ x: (c.flipX ? width - x : x) + (c.offsetX ?? 0), y: (c.flipY ? height - y : y) + (c.offsetY ?? 0), r });
    pt(8, 9, 8);
    pt(BASE_FIELD.x + 0.5, BASE_FIELD.y + 0.5, 4);
    pt(16, 16, 3);
  }
  return areas;
}

export function createMapTerrain(map: MapDefinition | string, seed = 0x5eed, scenario: Scenario = 'standard'): ReturnType<typeof generateTerrain> {
  const selected = typeof map === 'string' ? mapById(map) : map;
  if (selected.terrain) return handMadeTerrain(selected, scenario);
  return generateTerrain(selected.width, selected.height, new Rng(seed ^ 0x51ed), clearAreas(selected, scenario), selected.layout, selected.density ?? 1, selected.starts !== undefined, selected.liquids);
}

/** Decodes a drawn map, then forces the four base areas open so no start can be walled in. */
function handMadeTerrain(map: MapDefinition, scenario: Scenario): Terrain {
  const t = Terrain.decode(map.width, map.height, map.terrain!);
  for (const a of clearAreas(map, scenario)) {
    for (let y = Math.floor(a.y - a.r); y <= Math.ceil(a.y + a.r); y++) {
      for (let x = Math.floor(a.x - a.r); x <= Math.ceil(a.x + a.r); x++) {
        if (!t.inBounds(x, y) || (x - a.x) ** 2 + (y - a.y) ** 2 > a.r * a.r) continue;
        t.passable[y * map.width + x] = 1;
        t.heights[y * map.width + x] = 0;
        t.depth[y * map.width + x] = 0;
      }
    }
  }
  return t;
}

/** Terrain, resource fields and neutral wanderers; players are added with setUpPlayer(). */
export function createMatch(seed: number, selection: MapDefinition | string | number = DEFAULT_MAP_ID, scenario: Scenario = 'standard'): Simulation {
  const selected =
    typeof selection === 'number'
      ? { ...MAPS[0], width: selection, height: selection }
      : typeof selection === 'string'
        ? mapById(selection)
        : selection;
  const { width, height } = selected;
  const terrain = createMapTerrain(selected, seed, scenario);
  const sim = new Simulation({ width, height, seed }, terrain);
  const starts = mapStarts(selected, scenario);
  const all = [...starts.foes, ...starts.seats];
  for (const c of selected.starts ? all : CORNERS) placeField(sim, c);
  const centreX = width / 2;
  const centreY = height / 2;
  if ((selected.scenario ?? scenario) === 'surrounded') {
    // The middle is a player's base: it gets a base field of its own instead of the shared one, and no wanderers.
    if (!selected.starts) placeField(sim, centreCorner(width, height));
  } else {
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
  }
  for (const c of selected.starts ? all : CORNERS) placeOutposts(sim, c, selected.outposts ?? 0);
  // Steam vents and scenery (drawn from their own random stream), on drawn terrain too: they only go where there is open ground.
  placeFeatures(sim, seed, clearAreas(selected, scenario));
  return sim;
}

function placeField(sim: Simulation, c: Corner): void {
  const { width, height } = sim.config;
  for (let i = 0; i < BASE_FIELD_PATCHES; i++) {
    const x = flip(c.flipX, BASE_FIELD.x - 2 + sim.rng.int(5), 1, width) + (c.offsetX ?? 0);
    const y = flip(c.flipY, BASE_FIELD.y - 2 + sim.rng.int(5), 1, height) + (c.offsetY ?? 0);
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
    sim.spawnStructure(bp, flip(corner.flipX, entry.x, size, width) + (corner.offsetX ?? 0), flip(corner.flipY, entry.y, size, height) + (corner.offsetY ?? 0), entry.energy ?? 1);
  }
  let left = resources;
  for (const b of sim.stockpile.dense) {
    if (sim.unit.f.owner[b] === owner) left -= sim.addStock(b, left);
  }
  for (const group of BASE_UNITS) {
    const bp = classes.get(group.cls)!;
    for (let i = 0; i < group.count; i++) {
      const x = flip(corner.flipX, group.x + i, 1, width) + (corner.offsetX ?? 0);
      const y = flip(corner.flipY, group.y, 1, height) + (corner.offsetY ?? 0);
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
