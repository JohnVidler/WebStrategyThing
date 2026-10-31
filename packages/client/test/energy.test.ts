import { describe, expect, it } from 'vitest';
import { daylight, FeatureKind, Simulation, wind } from '@wst/engine';
import { collapseByClass, generationPerTick, numberedNames, steamPerTick } from '../src/energy';

describe('generationPerTick', () => {
  it('matches what the simulation really generates, tick by tick, and moves with daylight and wind', () => {
    const sim = new Simulation({ width: 24, height: 24, seed: 5 });
    const solar = sim.blueprints.define(1, 'Solar', ['frame.medium', ...Array(8).fill('solar.panel')]);
    const turbine = sim.blueprints.define(1, 'Turbines', ['frame.small', 'wind.turbine', 'wind.turbine']);
    const sink = sim.blueprints.define(1, 'Sink', ['frame.small', 'battery.cell']);
    const a = sim.spawnStructure(solar, 2, 2);
    // Touching buildings: no link gap, so no transmission loss to muddy the comparison.
    const b = sim.spawnStructure(turbine, 4, 2);
    sim.spawnStructure(sink, 5, 2, 0);
    const stats = [sim.stats(a), sim.stats(b)];

    let expected = 0;
    let actual = 0;
    const seen = new Set<number>();
    for (let i = 0; i < 300; i++) {
      const sun = daylight(sim.tick);
      const air = wind(sim.config.seed, sim.tick);
      const perTick = stats.reduce((sum, s) => sum + generationPerTick(s.solar, s.wind, sun, air), 0);
      sim.step();
      expected += perTick;
      actual += sim.networkFor(a)!.supply;
      seen.add(Math.round(perTick * 10));
    }
    expect(actual).toBeGreaterThan(0);
    expect(Math.abs(expected - actual) / actual).toBeLessThan(0.03);
    expect(seen.size).toBeGreaterThan(20); // the figure keeps changing as the sun rises and the wind drifts
  });

  it('is zero at night without wind', () => {
    expect(generationPerTick(40, 0, 0, 80)).toBe(0);
    expect(generationPerTick(40, 0, 100, 0)).toBe(20);
  });
});

describe('numberedNames', () => {
  it('numbers only the names that repeat', () => {
    expect(numberedNames(['Silo', 'Tower', 'Silo'])).toEqual(['Silo 1', 'Tower', 'Silo 2']);
  });
});

describe('collapseByClass', () => {
  const b = (name: string, e: number) => ({ name, e });
  it('lists a few of a class one by one and many as one counted row', () => {
    const rows = collapseByClass([b('Bank', 1), b('Cell', 2), b('Bank', 3), b('Bank', 4), b('Bank', 5), b('Bank', 6)]);
    expect(rows.map((r) => r.label)).toEqual(['Bank (x5)', 'Cell']);
    expect(rows[0].items.map((i) => i.e)).toEqual([1, 3, 4, 5, 6]);
    const few = collapseByClass([b('Bank', 1), b('Bank', 2), b('Bank', 3)]);
    expect(few.map((r) => r.label)).toEqual(['Bank 1', 'Bank 2', 'Bank 3']);
    expect(new Set(few.map((r) => r.key)).size).toBe(3);
  });
});

describe('steamPerTick', () => {
  it('matches the simulation: only as many turbines run as there are vents under the building', () => {
    const sim = new Simulation({ width: 24, height: 24, seed: 5 });
    sim.spawnFeature(FeatureKind.Vent, 4, 4);
    const bp = sim.blueprints.define(1, 'Steam', ['frame.small', 'steam.turbine', 'steam.turbine']);
    const e = sim.spawnStructure(bp, 4, 4);
    sim.step();
    const s = sim.stats(e);
    expect(sim.networkFor(e)!.supply).toBe(steamPerTick(s.steam, s.steamTurbines, 1));
    expect(steamPerTick(s.steam, s.steamTurbines, 0)).toBe(0);
    expect(steamPerTick(s.steam, s.steamTurbines, 5)).toBe(steamPerTick(s.steam, s.steamTurbines, 2));
  });
});
