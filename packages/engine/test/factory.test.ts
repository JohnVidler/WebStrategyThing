import { describe, expect, it } from 'vitest';
import { CORNERS, createMatch, factoryRatePermille, setUpPlayer, Simulation } from '../src';

describe('factory speed', () => {
  it('full speed with enough modules, a tenth one short, nothing two short', () => {
    expect([factoryRatePermille(1, 1), factoryRatePermille(2, 1), factoryRatePermille(1, 2), factoryRatePermille(2, 3), factoryRatePermille(3, 3)]).toEqual([1000, 1000, 100, 100, 1000]);
    expect([factoryRatePermille(1, 3), factoryRatePermille(0, 1), factoryRatePermille(2, 4)]).toEqual([0, 0, 0]);
  });

  it('one module short builds at a tenth of the speed; two short cannot build it', () => {
    const sim = new Simulation({ width: 32, height: 32, seed: 1 });
    const medium = sim.blueprints.define(1, 'M', ['chassis.medium', 'motor.small']);
    const ticksToBuild = (modules: number, x: number) => {
      const cls = sim.blueprints.define(1, `F${modules}`, ['frame.large', ...Array<string>(modules).fill('factory.basic'), 'battery.bank', 'silo']);
      const f = sim.spawnStructure(cls, x, 10);
      sim.addStock(f, 5000);
      sim.addEnergy(f, 1e6);
      sim.enqueueProduction(1, f, medium.id);
      const before = sim.unit.dense.length;
      let n = 0;
      while (sim.unit.dense.length === before && n < 5000) {
        sim.step();
        n++;
      }
      return n;
    };
    const slow = ticksToBuild(1, 4);
    const full = ticksToBuild(2, 12);
    expect(full).toBeLessThan(slow);
    expect(slow / full).toBeGreaterThan(8);
    const heavy = sim.blueprints.define(1, 'H', ['chassis.heavy', 'motor.small']);
    const one = sim.spawnStructure(sim.blueprints.find(1, 'F1')!, 20, 20);
    sim.addStock(one, 5000);
    expect(() => sim.enqueueProduction(1, one, heavy.id)).toThrow(/too big for F1/);
  });

  it('the HQ has one factory module; the specialised factories have 1, 2 and 3', () => {
    const sim = createMatch(1);
    setUpPlayer(sim, 1, CORNERS[0], 500);
    const stats = (name: string) => sim.blueprints.find(1, name)?.stats.factoryModules;
    expect([stats('HQ'), stats('Light Factory'), stats('Vehicle Factory'), stats('Heavy Factory')]).toEqual([1, 1, 2, 3]);
  });
});
