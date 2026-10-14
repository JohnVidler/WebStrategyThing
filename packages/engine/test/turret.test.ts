import { describe, expect, it } from 'vitest';
import { LASER_TURRET_CLASS, SCOUT_CLASS, Simulation, TILE } from '../src';

describe('laser turret', () => {
  it('shoots an enemy in range', () => {
    const sim = new Simulation({ width: 30, height: 30, seed: 1 });
    const turretBp = sim.blueprints.define(1, 'Laser Turret', [...LASER_TURRET_CLASS.parts]);
    sim.setProgram(turretBp.id, LASER_TURRET_CLASS.program);
    const scoutBp = sim.blueprints.define(2, 'Scout', [...SCOUT_CLASS.parts]);
    const turret = sim.spawnStructure(turretBp, 10, 10);
    const enemy = sim.spawnUnit(scoutBp, 14 * TILE, 10 * TILE);
    const hp = sim.health.f.hp[enemy];
    for (let i = 0; i < 30; i++) {
      sim.step();
      sim.commit();
    }
    expect(sim.weapon.has(turret)).toBe(true);
    expect(!sim.world.isAlive(enemy) || sim.health.f.hp[enemy] < hp).toBe(true);
  });
});

describe('laser power', () => {
  it('scales damage with the energy per shot and defaults to full power', () => {
    const run = (power: number): number => {
      const sim = new Simulation({ width: 30, height: 30, seed: 1 });
      const bp = sim.blueprints.define(1, 'L', ['chassis.medium', 'cpu.basic', 'laser.beam', 'battery.cell']);
      const a = sim.spawnUnit(bp, 10 * TILE, 10 * TILE);
      const b = sim.spawnUnit(bp, 11 * TILE, 10 * TILE);
      sim.energy.f.amount[a] = bp.stats.energyCapacity;
      sim.weapon.f.power[a] = power;
      sim.weapon.f.target[a] = sim.world.handle(b);
      const before = sim.health.f.hp[b];
      sim.step();
      return before - sim.health.f.hp[b];
    };
    const full = run(0);
    expect(full).toBeGreaterThan(0);
    expect(run(10)).toBeLessThan(full);
  });
});
