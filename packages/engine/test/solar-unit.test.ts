import { describe, expect, it } from 'vitest';
import { defineClass, deriveStats, hitTableOf, MOBILE_SOLAR_INTEGRITY_PERCENT, MOBILE_SOLAR_MASS_FACTOR, NEUTRAL_CLASS, PARTS, Simulation, TILE } from '../src';

describe('solar panels on mobile units', () => {
  const make = (parts: string[]) => {
    const sim = new Simulation({ width: 30, height: 30, seed: 1 });
    const bp = sim.blueprints.define(0, 'Solar walker', parts);
    const e = sim.spawnUnit(bp, 10 * TILE, 10 * TILE);
    return { sim, e };
  };

  it('charge a drained unit by day and not at night', () => {
    const { sim, e } = make(['chassis.light', 'cpu.basic', 'motor.small', 'solar.panel']);
    sim.energy.f.amount[e] = 0;
    sim.devSun = 0;
    for (let i = 0; i < 100; i++) sim.step();
    expect(sim.energy.f.amount[e]).toBe(0);
    sim.devSun = 100;
    for (let i = 0; i < 100; i++) sim.step();
    expect(sim.energy.f.amount[e]).toBeGreaterThan(50);
    expect(sim.energy.f.amount[e]).toBeLessThan(75); // a quarter of a building's 2.5 a tick
  });

  it('are heavier, more fragile and weaker on a mobile unit than on a building', () => {
    const unit = deriveStats(['chassis.light', 'solar.panel']);
    const bare = deriveStats(['chassis.light']);
    const panelMass = PARTS['solar.panel'].mass;
    expect(unit.mass - bare.mass).toBe(panelMass * MOBILE_SOLAR_MASS_FACTOR);
    const mobileHit = hitTableOf(['chassis.light', 'solar.panel']);
    const buildingHit = hitTableOf(['frame.medium', 'solar.panel']);
    expect(mobileHit.integrity[1]).toBeLessThan(buildingHit.integrity[1]);
    expect(mobileHit.integrity[1]).toBe(Math.floor((buildingHit.integrity[1] * MOBILE_SOLAR_INTEGRITY_PERCENT) / 100));
  });

  it('keep a neutral Wanderer alive through many day and night cycles', () => {
    const sim = new Simulation({ width: 40, height: 40, seed: 3 });
    const bp = defineClass(sim, 0, NEUTRAL_CLASS);
    const e = sim.spawnUnit(bp, 20 * TILE, 20 * TILE);
    let lowest = Infinity;
    let highest = 0;
    let travelled = 0;
    for (let i = 0; i < 20000; i++) {
      sim.step();
      const a = sim.energy.f.amount[e];
      lowest = Math.min(lowest, a);
      highest = Math.max(highest, a);
      travelled += sim.motion.f.moving[e];
    }
    expect(sim.world.isAlive(e)).toBe(true);
    expect(lowest).toBeGreaterThan(0); // never runs flat: it rests below a quarter
    expect(highest).toBeGreaterThan(sim.stats(e).energyCapacity * 0.9); // and fills up when resting
    expect(travelled).toBeGreaterThan(100); // but still wanders
  });
});
