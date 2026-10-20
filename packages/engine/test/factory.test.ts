import { describe, expect, it } from 'vitest';
import { CORNERS, createMatch, setUpPlayer, Simulation } from '../src';

describe('factory size', () => {
  it('limits the chassis a building can produce to its factory modules: 1 light, 2 medium, 3 heavy', () => {
    const sim = new Simulation({ width: 32, height: 32, seed: 1 });
    const light = sim.blueprints.define(1, 'L', ['chassis.light', 'motor.small']);
    const medium = sim.blueprints.define(1, 'M', ['chassis.medium', 'motor.small']);
    const heavy = sim.blueprints.define(1, 'H', ['chassis.heavy', 'motor.small']);
    const build = (name: string, modules: number, x: number) => {
      const cls = sim.blueprints.define(1, name, ['frame.large', ...Array<string>(modules).fill('factory.basic'), 'battery.bank', 'silo']);
      const f = sim.spawnStructure(cls, x, 10);
      sim.addStock(f, 5000);
      return f;
    };
    const one = build('One', 1, 4);
    const two = build('Two', 2, 10);
    const three = build('Three', 3, 16);
    expect(sim.stats(three).factoryModules).toBe(3);
    sim.enqueueProduction(1, one, light.id);
    expect(() => sim.enqueueProduction(1, one, medium.id)).toThrow(/needs a factory with 2 factory modules/);
    sim.enqueueProduction(1, two, medium.id);
    expect(() => sim.enqueueProduction(1, two, heavy.id)).toThrow(/needs a factory with 3 factory modules; Two has 2/);
    sim.enqueueProduction(1, three, heavy.id);
  });

  it('the HQ and the specialised factories follow the same rule', () => {
    const sim = createMatch(1);
    setUpPlayer(sim, 1, CORNERS[0], 500);
    const stats = (name: string) => sim.blueprints.find(1, name)?.stats.factoryModules;
    expect([stats('HQ'), stats('Light Factory'), stats('Vehicle Factory'), stats('Heavy Factory')]).toEqual([2, 1, 2, 3]);
  });
});
