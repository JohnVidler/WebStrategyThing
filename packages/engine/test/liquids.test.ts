import { describe, expect, it } from 'vitest';
import {
  CORNERS,
  createMatch,
  defineClass,
  deriveStats,
  findPath,
  generateTerrain,
  inSight,
  MAPS,
  Rng,
  setUpPlayer,
  setUpBot,
  SKIMMER_CLASS,
  AMPHIBIAN_CLASS,
  WADER_CLASS,
  UNIT_API,
  Simulation,
  STARTER_CLASSES,
  STRIDER_CLASS,
  Terrain,
  TILE,
  WADE_SPEED_PERMILLE,
  type Mobility,
} from '../src';
import { liquidKind } from '../src/game/terrain';

const at = (t: number) => t * TILE + TILE / 2;

/** An open 30 x 20 map with a lake: columns 12..15 (rows 0..`to`-1) set to `elevation` (negative: depth). */
function lake(elevation: number, to = 16, w = 30, h = 20): Terrain {
  const t = new Terrain(w, h);
  for (let y = 0; y < to; y++) for (let x = 12; x <= 15; x++) t.setElevation(x, y, elevation);
  t.computeHeights();
  return t;
}

const WHEELS: Mobility = { climb: 0, clearance: 0 };
const AMPHIBIOUS: Mobility = { climb: 0, clearance: 0, wade: 5 };
const HOVER: Mobility = { climb: 0, clearance: 0, wade: 8, hover: true };

const cellsOn = (path: number[]) => {
  const out: string[] = [];
  for (let i = 0; i < path.length; i += 2) out.push(`${path[i]},${path[i + 1]}`);
  return out;
};
const wetCells = (t: Terrain, path: number[], sx: number, sy: number) => {
  // Samples the straight legs of the path every quarter tile and counts the wet ones.
  let wet = 0;
  let px = at(sx);
  let py = at(sy);
  for (let i = 0; i < path.length; i += 2) {
    const nx = at(path[i]);
    const ny = at(path[i + 1]);
    const steps = Math.max(1, Math.ceil(Math.hypot(nx - px, ny - py) / (TILE / 4)));
    for (let s = 0; s <= steps; s++) if (t.depthAt(Math.floor((px + ((nx - px) * s) / steps) / TILE), Math.floor((py + ((ny - py) * s) / steps) / TILE)) > 0) wet++;
    px = nx;
    py = ny;
  }
  return wet;
};

describe('liquid terrain', () => {
  it('encodes depth as letters and round-trips through decode', () => {
    const t = new Terrain(6, 1);
    [3, 0, -1, -4, -7, -9].forEach((e, x) => t.setElevation(x, 0, e));
    expect(t.encode()).toBe('30adgi');
    const back = Terrain.decode(6, 1, t.encode());
    expect([0, 1, 2, 3, 4, 5].map((x) => back.elevationAt(x, 0))).toEqual([3, 0, -1, -4, -7, -9]);
    expect(back.hasLiquid).toBe(true);
    // Unknown characters are dry ground.
    expect(Terrain.decode(2, 1, '?z').encode()).toBe('00');
  });

  it('liquid is neither passable nor rock, and reads as height 0', () => {
    const t = lake(-4);
    expect(t.isPassable(13, 3)).toBe(false);
    expect(t.heightAt(13, 3)).toBe(0);
    expect(t.depthAt(13, 3)).toBe(4);
    expect(t.isRock(13, 3)).toBe(false);
    expect(t.isRock(-1, 0)).toBe(true);
    expect(t.walkable(13, 3)).toBe(false);
    expect(t.depthAt(0, 0)).toBe(0);
    expect(t.depthAt(-5, 0)).toBe(0);
  });

  it('liquid kinds follow the depth bands', () => {
    expect([0, 1, 2, 3, 5, 6, 8, 9].map(liquidKind)).toEqual([0, 1, 1, 2, 2, 3, 3, 4]);
  });

  it('each drive enters the liquids it should', () => {
    const t = new Terrain(10, 1);
    [-1, -2, -3, -5, -6, -8, -9].forEach((e, x) => t.setElevation(x, 0, e));
    const enters = (m: Mobility) => [0, 1, 2, 3, 4, 5, 6].map((x) => t.fits(x, 0, m));
    expect(enters(WHEELS)).toEqual([true, true, false, false, false, false, false]);
    expect(enters(AMPHIBIOUS)).toEqual([true, true, true, true, false, false, false]);
    expect(enters(HOVER)).toEqual([true, true, true, true, true, true, false]);
    expect(enters({ climb: 0, clearance: 0, wade: 0 })).toEqual([false, false, false, false, false, false, false]);
    // Legs get no special help: they wade like wheels.
    expect(enters({ climb: 9, clearance: 0 })).toEqual(enters(WHEELS));
  });

  it('buildings and landing stay on dry ground', () => {
    const t = lake(-1);
    expect(t.footprintFree(14, 3, 1)).toBe(false);
    expect(t.footprintFree(5, 3, 2)).toBe(true);
    expect(t.nearestWalkable(13, 3, 6)).not.toBeNull();
    const [nx, ny] = t.nearestWalkable(13, 3, 6)!;
    expect(t.depthAt(nx, ny)).toBe(0);
  });

  it('rock beside a lake is a rim, and liquid does not count as rock height', () => {
    const t = new Terrain(9, 3);
    t.setElevation(0, 1, -2);
    for (let x = 1; x < 9; x++) t.setElevation(x, 1, 9);
    t.passable.fill(0);
    t.passable[0] = 0;
    t.computeHeights();
    expect(t.heightAt(0, 1)).toBe(0);
    expect(t.heights[1 * 9 + 1]).toBe(1);
  });

  it('a lake does not block sight', () => {
    const t = lake(-4);
    const viewer = [{ x: at(5), y: at(3), r: 20 * TILE }];
    // Same open terrain with a rock wall in place of the lake blocks the view; the lake does not.
    const wall = new Terrain(30, 20);
    for (let y = 0; y < 16; y++) for (let x = 12; x <= 15; x++) wall.setElevation(x, y, 3);
    wall.computeHeights();
    expect(inSight(t, viewer, at(20), at(3))).toBe(true);
    expect(inSight(wall, viewer, at(20), at(3))).toBe(false);
  });
});

describe('paths and liquids', () => {
  it('wheels wade a shallow ford straight when the detour is long, and go round deep water', () => {
    const shallow = lake(-1);
    const wade = findPath(shallow, 4, 3, 24, 3, WHEELS);
    expect(wade[wade.length - 2]).toBe(24);
    expect(wetCells(shallow, wade, 4, 3)).toBeGreaterThan(0);
    const deep = lake(-4);
    const around = findPath(deep, 4, 3, 24, 3, WHEELS);
    expect(wetCells(deep, around, 4, 3)).toBe(0);
    expect(cellsOn(around).some((c) => Number(c.split(',')[1]) >= 16)).toBe(true);
    // An amphibious drive goes through deep water, a hover skirt too.
    expect(wetCells(deep, findPath(deep, 4, 3, 24, 3, AMPHIBIOUS), 4, 3)).toBeGreaterThan(0);
    expect(findPath(deep, 4, 3, 24, 3, HOVER).length).toBeLessThanOrEqual(2);
  });

  it('a short detour beats a wade; a long detour loses to one', () => {
    const t = lake(-1, 16);
    const near = findPath(t, 4, 14, 24, 14, WHEELS); // the lake ends at row 15: a 2-row detour
    expect(wetCells(t, near, 4, 14)).toBe(0);
    const farLake = lake(-1, 19); // gap of one row at the bottom: a long way round
    const far = findPath(farLake, 4, 2, 24, 2, WHEELS);
    expect(wetCells(farLake, far, 4, 2)).toBeGreaterThan(0);
  });

  it('smoothing does not turn a detour round a lake back into a wade', () => {
    const t = new Terrain(30, 20);
    // A round pond in the middle of open ground: the path round it must not be cut across it.
    for (let y = 0; y < 20; y++) for (let x = 0; x < 30; x++) if ((x - 14) ** 2 + (y - 10) ** 2 <= 9) t.setElevation(x, y, -4);
    t.computeHeights();
    const path = findPath(t, 4, 10, 24, 10, WHEELS);
    expect(wetCells(t, path, 4, 10)).toBe(0);
    expect(path[path.length - 2]).toBe(24);
  });

  it('a map with no liquid searches exactly as before', () => {
    const t = new Terrain(30, 20);
    expect(t.hasLiquid).toBe(false);
    expect(findPath(t, 1, 1, 25, 15, WHEELS).length).toBeGreaterThan(0);
  });
});

describe('generated liquids', () => {
  const liquidMaps = MAPS.filter((m) => m.liquids);

  it('some maps carry water, lava and chasms', () => {
    expect(liquidMaps.length).toBeGreaterThanOrEqual(4);
    const kinds = new Set<number>();
    for (const m of liquidMaps) {
      const t = generateTerrain(m.width, m.height, new Rng(7), [], m.layout, m.density ?? 1, false, m.liquids);
      for (let i = 0; i < t.depth.length; i++) if (t.depth[i]) kinds.add(liquidKind(t.depth[i]));
    }
    expect([...kinds].sort()).toEqual([1, 2, 3, 4]);
  });

  it('an empty liquid spec changes nothing', () => {
    const a = generateTerrain(48, 48, new Rng(3), [], 'standard').encode();
    const b = generateTerrain(48, 48, new Rng(3), [], 'standard', 1, false, {}).encode();
    expect(b).toBe(a);
  });

  it('is deterministic, and mirrored like rock unless the map asks for free-form ground', () => {
    expect(liquidMaps.some((m) => m.liquids!.free)).toBe(true);
    for (const m of liquidMaps) {
      const a = generateTerrain(m.width, m.height, new Rng(11), [], m.layout, m.density ?? 1, false, m.liquids);
      const b = generateTerrain(m.width, m.height, new Rng(11), [], m.layout, m.density ?? 1, false, m.liquids);
      expect(b.encode()).toBe(a.encode());
      if (m.liquids!.free) continue;
      // Whether a cell is liquid is symmetric on both axes (depth is only symmetric when the shores are).
      for (let y = 0; y < m.height; y += 3) for (let x = 0; x < m.width; x += 3) expect(a.depthAt(x, y) > 0).toBe(a.depthAt(m.width - 1 - x, y) > 0);
    }
  });

  it('every base stays reachable on wheels, and depth deepens inward', () => {
    for (const m of liquidMaps) {
      const sim = createMatch(5, m.id);
      const t = sim.terrain;
      const reach = new Uint8Array(t.width * t.height);
      const [sx, sy] = t.nearestWalkable(9, 10, 20)!; // the top-left base: the middle of the map may well be a river
      const stack = [sy * t.width + sx];
      while (stack.length) {
        const i = stack.pop()!;
        if (reach[i]) continue;
        const x = i % t.width;
        const y = (i - x) / t.width;
        if (!t.enterable(x, y, 0)) continue;
        reach[i] = 1;
        stack.push(i + 1, i - 1, i + t.width, i - t.width);
      }
      for (const corner of [[9, 10], [t.width - 10, 10], [9, t.height - 11], [t.width - 10, t.height - 11]]) expect(reach[corner[1] * t.width + corner[0]]).toBe(1);
      let deepest = 0;
      for (const d of t.depth) deepest = Math.max(deepest, d);
      expect(deepest).toBeGreaterThan(0);
    }
  });

  it('no liquid cell is rock and no rock cell holds liquid', () => {
    for (const m of liquidMaps) {
      const t = createMatch(9, m.id).terrain;
      for (let i = 0; i < t.depth.length; i++) if (t.depth[i]) expect([t.passable[i], t.heights[i]]).toEqual([0, 0]);
    }
  });

  it('a full match runs on a liquid map', () => {
    for (const m of liquidMaps) {
      const sim = createMatch(21, m.id);
      setUpPlayer(sim, 1, CORNERS[0], 500);
      setUpPlayer(sim, 2, CORNERS[3], 500);
      for (let i = 0; i < 60; i++) sim.step();
      expect(sim.tick).toBeGreaterThan(0);
    }
  });
});

describe('drives', () => {
  const stats = (parts: string[]) => deriveStats(['chassis.light', 'cpu.basic', ...parts]);

  it('ground drives wade shallow water; amphibious deep water; hover lava', () => {
    expect(stats(['motor.small']).wade).toBe(2);
    expect(stats(['motor.amphibious']).wade).toBe(5);
    expect(stats(['motor.hover']).wade).toBe(8);
    expect(stats(['motor.hover']).hover).toBe(true);
    expect(stats(['motor.amphibious']).hover).toBe(false);
    expect(stats(['rotor']).flying).toBe(true);
  });

  it('legs cannot be mixed with the new drives', () => {
    expect(() => stats(['legs.light', 'motor.hover'])).toThrow();
    expect(() => stats(['rotor', 'motor.hover'])).toThrow();
  });

  /** A long strip with liquid of `elevation` over columns 10..29, and a unit with `parts` standing at column `startX`. */
  function drive(parts: string[], elevation: number, startX = 3) {
    const t = new Terrain(40, 12);
    for (let y = 0; y < 12; y++) for (let x = 10; x < 30; x++) t.setElevation(x, y, elevation);
    t.computeHeights();
    const sim = new Simulation({ width: 40, height: 12, seed: 1 }, t);
    const bp = defineClass(sim, 1, { ...STRIDER_CLASS, parts: ['chassis.light', 'cpu.basic', ...parts], program: '' });
    const e = sim.spawnUnit(bp, at(3), at(6));
    sim.pos.f.x[e] = at(startX); // spawning always picks dry ground, so move it in afterwards
    sim.addEnergy(e, 1e6);
    return { sim, e, t };
  }
  /** Where the unit's column is after `ticks` ticks of driving east along row 6. */
  const travel = (d: ReturnType<typeof drive>, ticks: number) => {
    const x0 = d.sim.pos.f.x[d.e];
    d.sim.setDestination(d.e, at(36), at(6));
    for (let i = 0; i < ticks; i++) d.sim.step();
    return d.sim.pos.f.x[d.e] - x0;
  };

  it('a unit wading is slower than on dry ground, a hover is not', () => {
    // Shallow water (-1) for a small motor; the hover in the same water; and both on dry ground.
    const wade = travel(drive(['motor.small'], -1, 12), 12);
    const dry = travel(drive(['motor.small'], 0, 12), 12);
    expect(wade).toBeGreaterThan(0);
    expect(wade / dry).toBeGreaterThan(0.5);
    expect(wade / dry).toBeLessThan(0.7);
    const skim = travel(drive(['motor.hover'], -4, 12), 12);
    const skimDry = travel(drive(['motor.hover'], 0, 12), 12);
    expect(skim / skimDry).toBeGreaterThan(0.95);
    // Amphibious: slower in deep water than in the shallows.
    const deep = travel(drive(['motor.amphibious'], -4, 12), 12);
    const shallow = travel(drive(['motor.amphibious'], -1, 12), 12);
    expect(deep).toBeLessThan(shallow);
    expect(deep).toBeGreaterThan(0);
  });

  it('a wheeled unit will not enter deep water by itself', () => {
    const d = drive(['motor.small'], -4);
    travel(d, 200);
    expect(d.sim.pos.f.x[d.e] / TILE).toBeLessThan(10.5);
  });

  it('lava scorches a hover unit and burns up a stranded ground unit; a void takes it', () => {
    const hover = drive(['motor.hover'], -7, 15);
    const hp = hover.sim.health.f.hp[hover.e];
    for (let i = 0; i < 30; i++) hover.sim.step();
    expect(hover.sim.health.f.hp[hover.e]).toBeLessThan(hp);
    expect(hover.sim.health.f.hp[hover.e]).toBeGreaterThan(0);

    const stranded = drive(['motor.small'], -7, 15);
    for (let i = 0; i < 100; i++) stranded.sim.step();
    expect(stranded.sim.world.isAlive(stranded.e)).toBe(false);

    const fall = drive(['motor.hover'], -9, 15);
    for (let i = 0; i < 10; i++) fall.sim.step();
    expect(fall.sim.world.isAlive(fall.e)).toBe(false);
  });
});

describe('starter classes and scripts', () => {
  it('every starter class still builds', () => {
    for (const c of STARTER_CLASSES) expect(() => deriveStats(c.parts)).not.toThrow();
  });

  it('the new classes use the new drives', () => {
    expect(deriveStats(SKIMMER_CLASS.parts)).toMatchObject({ hover: true, wade: 8 });
    expect(deriveStats(AMPHIBIAN_CLASS.parts)).toMatchObject({ hover: false, wade: 5 });
    expect(deriveStats(WADER_CLASS.parts)).toMatchObject({ wade: 5, cargo: expect.any(Number) });
  });

  it('script calls read depth and wade', () => {
    const t = new Terrain(20, 20);
    t.setElevation(5, 5, -4);
    const sim = new Simulation({ width: 20, height: 20, seed: 1 }, t);
    const e = sim.spawnUnit(defineClass(sim, 1, { ...SKIMMER_CLASS, program: '' }), at(2), at(2));
    const ctx = { sim, e, bp: sim.blueprintOf(e)!, stats: sim.stats(e) };
    const call = (name: string, ...args: number[]) => UNIT_API.find((b) => b.name === name)!.fn(ctx, Int32Array.from(args));
    expect([call('depthAt', 5, 5), call('depthAt', 0, 0), call('depthAt', -3, 4), call('heightAt', 5, 5), call('passable', 5, 5), call('wade')]).toEqual([4, 0, 0, 0, 0, 8]);
  });

  it('a Skimmer left standing on lava walks off it; one crossing it is left alone', () => {
    const t = new Terrain(40, 12);
    for (let y = 0; y < 12; y++) for (let x = 10; x < 30; x++) t.setElevation(x, y, -7);
    const sim = new Simulation({ width: 40, height: 12, seed: 1 }, t);
    const e = sim.spawnUnit(defineClass(sim, 1, SKIMMER_CLASS), at(3), at(6));
    sim.pos.f.x[e] = at(12);
    sim.addEnergy(e, 1e6);
    for (let i = 0; i < 80; i++) sim.step();
    expect(sim.world.isAlive(e)).toBe(true);
    const tx = Math.floor(sim.pos.f.x[e] / TILE);
    expect(t.depthAt(tx, Math.floor(sim.pos.f.y[e] / TILE))).toBeLessThan(6);
    // Crossing: ordered to the far side, it is not turned back half way.
    const c = sim.spawnUnit(defineClass(sim, 2, SKIMMER_CLASS), at(3), at(3));
    sim.addEnergy(c, 1e6);
    sim.setDestination(c, at(34), at(3));
    for (let i = 0; i < 400 && sim.world.isAlive(c); i++) sim.step();
    expect(sim.world.isAlive(c)).toBe(true);
    expect(sim.pos.f.x[c] / TILE).toBeGreaterThan(30);
  });

  it('bots field hover units on a map with liquid, and the roster is unchanged on dry maps', () => {
    const wet = createMatch(4, 'lakeland');
    const dry = createMatch(4, 'crossroads');
    const names = (sim: Simulation) => setUpBot(sim, 2, CORNERS[3], 1).classes.map((b) => b.name);
    expect(names(wet)).toContain('Skimmer');
    expect(names(dry)).not.toContain('Skimmer');
  });

  it('every resource field on a liquid map can be reached by wheels', () => {
    for (const m of MAPS.filter((x) => x.liquids)) {
      const sim = createMatch(6, m.id);
      setUpPlayer(sim, 1, CORNERS[0], 500);
      const t = sim.terrain;
      const [sx, sy] = t.nearestWalkable(9, 10, 20)!;
      for (const e of sim.resource.dense) {
        const gx = Math.floor(sim.pos.f.x[e] / TILE);
        const gy = Math.floor(sim.pos.f.y[e] / TILE);
        const path = findPath(t, sx, sy, gx, gy, { climb: 0, clearance: 0 });
        const end = [path[path.length - 2], path[path.length - 1]];
        expect(Math.max(Math.abs(end[0] - gx), Math.abs(end[1] - gy)), `${m.id} field at ${gx},${gy}`).toBeLessThanOrEqual(1);
      }
    }
  });
});
