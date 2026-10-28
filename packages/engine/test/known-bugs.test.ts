import { describe, expect, it } from 'vitest';
import { Simulation } from '../src';

/** Known failing cases, kept as expected failures until someone owns the fix. When a fix lands the test starts passing, which `it.fails` reports as a failure: turn it into a plain `it`. */
describe('known bugs', () => {
  it.fails('transmission loss takes a share of the energy, not a whole unit from every generator each tick', () => {
    // Two wind turbines with one tile of gap between them and a battery: the link gap costs 0.01% of the
    // output (TRANSMISSION_LOSS_PER_TILE), but `powerSystem` floors each generator's output a second time
    // after applying the loss (systems.ts, `gen[i] = Math.floor(gen[i] * efficiency)`), so every generator
    // making a few energy per tick loses at least 1 whenever there is any gap at all.
    const run = (gap: number): number => {
      const sim = new Simulation({ width: 24, height: 24, seed: 5 });
      const turbine = sim.blueprints.define(1, 'Turbines', ['frame.small', 'wind.turbine', 'wind.turbine']);
      const sink = sim.blueprints.define(1, 'Sink', ['frame.small', 'battery.cell']);
      const a = sim.spawnStructure(turbine, 2, 2);
      sim.spawnStructure(sink, 3 + gap, 2, 0);
      let total = 0;
      for (let i = 0; i < 200; i++) {
        sim.step();
        total += sim.networkFor(a)!.supply;
      }
      return total;
    };
    const touching = run(0);
    const gapped = run(1);
    expect(touching).toBeGreaterThan(100);
    expect(gapped / touching).toBeGreaterThan(0.95); // today about 0.5
  });
});
