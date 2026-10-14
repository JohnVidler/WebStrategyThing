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
