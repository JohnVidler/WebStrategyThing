import { describe, expect, it } from 'vitest';
import { CORNERS, createMatch, factoryCanBuild, setUpPlayer, Simulation, Production } from '../src';

const BUILDS = (sim: Simulation, factory: string) => {
  const tiers = sim.blueprints.find(1, factory)!.stats.factoryTiers;
  return [0, 1, 2, 3, 4, 5].filter((s) => factoryCanBuild(tiers, s));
};

describe('typed factory modules', () => {
  it('a module builds exactly its own size tier', () => {
    expect([0, 1, 2, 3, 4, 5].map((s) => factoryCanBuild(1 << 2, s))).toEqual([false, false, true, false, false, false]);
    expect(factoryCanBuild(0, 1)).toBe(false);
  });

  it('the starter buildings build only the sizes they are meant for', () => {
    const sim = createMatch(1);
    setUpPlayer(sim, 1, CORNERS[0], 500);
    expect(BUILDS(sim, 'HQ')).toEqual([1, 2]);
    expect(BUILDS(sim, 'Light Factory')).toEqual([0, 1]);
    expect(BUILDS(sim, 'Vehicle Factory')).toEqual([2]);
    expect(BUILDS(sim, 'Heavy Factory')).toEqual([3]);
    expect(BUILDS(sim, 'Titan Works')).toEqual([4, 5]);
  });

  it('refuses a unit whose size the building has no module for, with a clear message', () => {
    const sim = new Simulation({ width: 32, height: 32, seed: 1 });
    const heavy = sim.blueprints.define(1, 'H', ['chassis.heavy', 'motor.small']);
    const light = sim.blueprints.define(1, 'L', ['chassis.light', 'motor.small']);
    const bp = sim.blueprints.define(1, 'F', ['frame.large', 'factory.heavy', 'battery.bank', 'silo']);
    const f = sim.spawnStructure(bp, 4, 4);
    sim.addStock(f, 5000);
    expect(() => sim.enqueueProduction(1, f, light.id)).toThrow(/light unit: F has no light factory module/);
    sim.enqueueProduction(1, f, heavy.id);
  });

  it('a design saved with the old factory module still loads, as a light factory', () => {
    const sim = new Simulation({ width: 32, height: 32, seed: 1 });
    const bp = sim.blueprints.define(1, 'Old', ['frame.medium', 'factory.basic', 'factory.basic', 'battery.bank']);
    expect(bp.stats.factory).toBe(true);
    expect(factoryCanBuild(bp.stats.factoryTiers, 1)).toBe(true);
    expect(factoryCanBuild(bp.stats.factoryTiers, 2)).toBe(false);
  });
});

describe('production queue', () => {
  function setup() {
    const sim = new Simulation({ width: 32, height: 32, seed: 1 });
    const unit = sim.blueprints.define(1, 'U', ['chassis.light', 'motor.small']);
    const bp = sim.blueprints.define(1, 'F', ['frame.large', 'factory.light', 'battery.bank', 'silo']);
    const f = sim.spawnStructure(bp, 4, 4);
    sim.addStock(f, 5000);
    sim.addEnergy(f, 1e6);
    return { sim, unit, f };
  }

  it('replicates the whole queue behind the front item', () => {
    const { sim, unit, f } = setup();
    for (let i = 0; i < 4; i++) sim.enqueueProduction(1, f, unit.id);
    sim.step();
    const p = sim.world.store(Production).f;
    expect([p.blueprint[f], p.q1[f], p.q2[f], p.q3[f], p.q4[f], p.queued[f]]).toEqual([unit.id, unit.id, unit.id, unit.id, 0, 4]);
  });

  it('removing an item refunds its matter; removing the front item resets the work on it', () => {
    const { sim, unit, f } = setup();
    const start = sim.pool(1);
    sim.enqueueProduction(1, f, unit.id);
    sim.enqueueProduction(1, f, unit.id);
    expect(sim.pool(1)).toBe(start - 2 * unit.stats.cost);
    for (let i = 0; i < 10; i++) sim.step();
    expect(sim.productionTicks[f]).toBeGreaterThan(0);
    sim.dequeueProduction(1, f, 0);
    expect(sim.productionTicks[f]).toBe(0);
    expect(sim.productionQueue[f]).toHaveLength(1);
    sim.dequeueProduction(1, f, 0);
    expect(sim.pool(1)).toBe(start);
    expect(() => sim.dequeueProduction(1, f, 0)).toThrow(/Nothing queued/);
    expect(() => sim.dequeueProduction(2, f, 0)).toThrow();
  });
});
