import { describe, expect, it } from 'vitest';
import { applyTick, createMapTerrain, createMatch, encodeTick, FEATURES, FeatureKind, GAME_COMPONENTS, MAPS, Simulation, TILE, visibleTo, World } from '../src';

const featuresOf = (sim: Simulation, kind: number) => sim.feature.dense.filter((e) => sim.feature.f.kind[e] === kind);
const tileOf = (sim: Simulation, e: number) => [Math.floor(sim.pos.f.x[e] / TILE), Math.floor(sim.pos.f.y[e] / TILE)] as const;

describe('map features', () => {
  it('puts vents (in mirrored fours) and scenery on every generated map', () => {
    for (const map of MAPS) {
      const sim = createMatch(7, map.id);
      expect(featuresOf(sim, FeatureKind.Vent).length % 4, map.id).toBe(0);
      expect(featuresOf(sim, FeatureKind.Vent).length, map.id).toBeGreaterThan(0);
      const scenery = sim.feature.dense.filter((e) => FEATURES[sim.feature.f.kind[e]].solid);
      expect(scenery.length, map.id).toBeGreaterThan(0);
    }
  });

  it('is the same for the same seed and does not move the fields', () => {
    const a = createMatch(11, 'crossroads');
    const b = createMatch(11, 'crossroads');
    expect(a.feature.dense.map((e) => [a.feature.f.kind[e], ...tileOf(a, e)])).toEqual(b.feature.dense.map((e) => [b.feature.f.kind[e], ...tileOf(b, e)]));
    expect(a.resource.dense.length).toBe(b.resource.dense.length);
  });

  it('scenery blocks its tiles, vents do not, and neither sits in a base area', () => {
    const sim = createMatch(3, 'crossroads');
    for (const e of sim.feature.dense) {
      const kind = sim.feature.f.kind[e];
      const [x, y] = tileOf(sim, e);
      expect(sim.terrain.occupied[y * sim.config.width + x] > 0).toBe(FEATURES[kind].solid);
      // The starting areas are centred on (8, 9) in the top-left layout, mirrored per corner.
      for (const [cx, cy] of [[8, 9], [sim.config.width - 8, sim.config.height - 9]]) expect(Math.hypot(x - cx, y - cy)).toBeGreaterThan(8);
    }
  });

  it('a steam turbine makes steady power only over a vent, by day or night', () => {
    const sim = new Simulation({ width: 24, height: 24, seed: 1 });
    sim.spawnFeature(FeatureKind.Vent, 4, 4);
    const bp = sim.blueprints.define(1, 'Steam', ['frame.small', 'steam.turbine', 'steam.turbine']);
    const on = sim.spawnStructure(bp, 4, 4);
    const off = sim.spawnStructure(bp, 12, 12);
    for (const tick of [300, 700]) {
      sim.tick = tick;
      sim.step();
      // One vent under a building with two turbines: one turbine's worth, 1 x 2 energy per tick.
      expect(sim.networkFor(on)!.supply).toBe(2);
      expect(sim.networkFor(off)!.supply).toBe(0);
    }
  });

  it('the map features reach every client whole, however far away', () => {
    const sim = createMatch(5, 'crossroads');
    const mirror = new World(GAME_COMPONENTS);
    applyTick(mirror, encodeTick(sim.world, sim.tick, [], true, undefined));
    mirror.flush();
    expect(mirror.store(sim.feature.def).dense.length).toBe(sim.feature.dense.length);
    expect(visibleTo(sim.world, 1, (e) => sim.stats(e)).has(sim.feature.dense[0])).toBe(true);
  });
  it('scenery never cuts any open ground off from the rest', () => {
    for (const id of ['crossroads', 'highlands', 'badlands', 'bastion']) {
      const sim = createMatch(9, id);
      const bare = createMapTerrain(id, 9);
      const reach = (t: { width: number; height: number; walkable(x: number, y: number): boolean }, sx: number, sy: number) => {
        const seen = new Set<number>([sy * t.width + sx]);
        const stack = [[sx, sy]];
        while (stack.length) {
          const [x, y] = stack.pop()!;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= t.width || ny >= t.height || !t.walkable(nx, ny) || seen.has(ny * t.width + nx)) continue;
            seen.add(ny * t.width + nx);
            stack.push([nx, ny]);
          }
        }
        return seen.size;
      };
      const solid = sim.feature.dense.filter((e) => FEATURES[sim.feature.f.kind[e]].solid);
      let blocked = 0;
      for (const e of solid) blocked += FEATURES[sim.feature.f.kind[e]].size ** 2;
      expect(reach(sim.terrain, 8, 9), id).toBe(reach(bare, 8, 9) - blocked);
    }
  });
});
