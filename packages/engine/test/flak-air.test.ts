import { describe, expect, it } from 'vitest';
import { FLAK_AIR_DAMAGE, FLAK_CLASS, FLAK_TURRET_CLASS, HAWK_CLASS, SCOUT_CLASS, Simulation, TILE } from '../src';

const step = (sim: Simulation, n: number) => {
  for (let i = 0; i < n; i++) {
    sim.step();
    sim.commit();
  }
};

function setup() {
  const sim = new Simulation({ width: 40, height: 30, seed: 7 });
  // No program: these tests aim the weapon by hand.
  const flakBp = sim.blueprints.define(1, FLAK_CLASS.name, [...FLAK_CLASS.parts]);
  const hawkBp = sim.blueprints.define(2, HAWK_CLASS.name, [...HAWK_CLASS.parts]);
  const scoutBp = sim.blueprints.define(2, SCOUT_CLASS.name, [...SCOUT_CLASS.parts]);
  const allyHawk = sim.blueprints.define(1, 'AllyHawk', [...HAWK_CLASS.parts]);
  return { sim, flakBp, hawkBp, scoutBp, allyHawk };
}

describe('flak against aircraft', () => {
  it('a burst hurts an enemy flier it is aimed at, for FLAK_AIR_DAMAGE', () => {
    const { sim, flakBp, hawkBp } = setup();
    const flak = sim.spawnUnit(flakBp, 10 * TILE, 15 * TILE);
    const hawk = sim.spawnUnit(hawkBp, 14 * TILE, 15 * TILE);
    expect(sim.stats(hawk).flying).toBe(true);
    const hp = sim.health.f.hp[hawk];
    sim.weapon.f.target[flak] = sim.world.handle(hawk);
    sim.weapon.f.cooldown[flak] = 0;
    sim.step();
    sim.commit();
    expect(sim.health.f.hp[hawk]).toBe(hp - FLAK_AIR_DAMAGE);
  });

  it('does not lock on an enemy ground unit and does not hurt one beside a flier', () => {
    const { sim, flakBp, hawkBp, scoutBp } = setup();
    const flak = sim.spawnUnit(flakBp, 10 * TILE, 15 * TILE);
    const scout = sim.spawnUnit(scoutBp, 14 * TILE, 15 * TILE);
    const hawk = sim.spawnUnit(hawkBp, 14.5 * TILE, 15 * TILE);
    const scoutHp = sim.health.f.hp[scout];
    sim.weapon.f.target[flak] = sim.world.handle(scout);
    step(sim, 3);
    expect(sim.weapon.f.target[flak]).toBe(-1);
    expect(sim.health.f.hp[scout]).toBe(scoutHp);
    sim.weapon.f.target[flak] = sim.world.handle(hawk);
    sim.weapon.f.cooldown[flak] = 0;
    sim.step();
    sim.commit();
    expect(sim.health.f.hp[hawk]).toBeLessThan(sim.stats(hawk).hp);
    expect(sim.health.f.hp[scout]).toBe(scoutHp);
  });

  it('does not hurt allied fliers in the burst, and will not target them', () => {
    const { sim, flakBp, hawkBp, allyHawk } = setup();
    const flak = sim.spawnUnit(flakBp, 10 * TILE, 15 * TILE);
    const enemy = sim.spawnUnit(hawkBp, 14 * TILE, 15 * TILE);
    const friend = sim.spawnUnit(allyHawk, 14.4 * TILE, 15 * TILE);
    const friendHp = sim.health.f.hp[friend];
    sim.weapon.f.target[flak] = sim.world.handle(friend);
    step(sim, 3);
    expect(sim.weapon.f.target[flak]).toBe(-1);
    sim.weapon.f.target[flak] = sim.world.handle(enemy);
    sim.weapon.f.cooldown[flak] = 0;
    sim.step();
    sim.commit();
    expect(sim.health.f.hp[friend]).toBe(friendHp);
  });

  it('a flak turret on its own program shoots down an aircraft that flies over it', () => {
    const { sim, hawkBp } = setup();
    const bp = sim.blueprints.define(1, FLAK_TURRET_CLASS.name, [...FLAK_TURRET_CLASS.parts]);
    sim.setProgram(bp.id, FLAK_TURRET_CLASS.program);
    const turret = sim.spawnStructure(bp, 10, 15);
    sim.energy.f.amount[turret] = sim.stats(turret).energyCapacity;
    const hawk = sim.spawnUnit(hawkBp, 13 * TILE, 15 * TILE);
    const hp = sim.health.f.hp[hawk];
    step(sim, 40);
    expect(!sim.world.isAlive(hawk) || sim.health.f.hp[hawk] < hp).toBe(true);
  });
});
