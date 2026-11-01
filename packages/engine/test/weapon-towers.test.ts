import { describe, expect, it } from 'vitest';
import {
  ION_TICKS,
  ION_TOWER_CLASS,
  POINT_DEFENCE_TOWER_CLASS,
  RAIL_CHARGE_TICKS,
  RAIL_TOWER_CLASS,
  SMOKE_TOWER_CLASS,
  STARTER_CLASSES,
  SCOUT_CLASS,
  Simulation,
  TILE,
} from '../src';

const at = (tiles: number) => tiles * TILE + TILE / 2;
const tick = (sim: Simulation, n: number) => {
  for (let i = 0; i < n; i++) {
    sim.step();
    sim.commit();
  }
};

function tower(cls: { name: string; parts: readonly string[]; program: string }, owner = 1) {
  const sim = new Simulation({ width: 60, height: 40, seed: 11 });
  const bp = sim.blueprints.define(owner, cls.name, [...cls.parts]);
  if (cls.program) sim.setProgram(bp.id, cls.program);
  const t = sim.spawnStructure(bp, 10, 20);
  sim.energy.f.amount[t] = sim.stats(t).energyCapacity;
  return { sim, t };
}

describe('weapon towers', () => {
  it('are starter classes, and are buildings', () => {
    for (const c of [POINT_DEFENCE_TOWER_CLASS, RAIL_TOWER_CLASS, ION_TOWER_CLASS, SMOKE_TOWER_CLASS]) {
      expect(STARTER_CLASSES).toContain(c);
      expect(new Simulation({ width: 20, height: 20, seed: 1 }).blueprints.define(1, c.name, [...c.parts]).stats.structure).toBe(true);
    }
  });

  it('the Rail Tower charges at an enemy it senses, then hurts it', () => {
    const { sim, t } = tower(RAIL_TOWER_CLASS);
    const foeBp = sim.blueprints.define(2, 'Scout', [...SCOUT_CLASS.parts]);
    const foe = sim.spawnUnit(foeBp, at(16), at(20));
    sim.health.f.hp[foe] = 100000;
    const hp = sim.health.f.hp[foe];
    tick(sim, 30);
    expect(sim.rails.has(t)).toBe(true);
    tick(sim, RAIL_CHARGE_TICKS + 20);
    expect(sim.health.f.hp[foe]).toBeLessThan(hp);
  });

  it('the Ion Tower holds a module of an enemy it senses down, with no damage', () => {
    const { sim, t } = tower(ION_TOWER_CLASS);
    const foeBp = sim.blueprints.define(2, 'Scout', [...SCOUT_CLASS.parts]);
    const foe = sim.spawnUnit(foeBp, at(15), at(20));
    const hp = sim.health.f.hp[foe];
    tick(sim, 40);
    expect(sim.ionActive.has(foe) || sim.ionImmune[foe] > 0).toBe(true);
    expect(sim.health.f.hp[foe]).toBe(hp);
    expect(ION_TICKS).toBeGreaterThan(0);
    expect(sim.energy.f.amount[t]).toBeLessThan(sim.stats(t).energyCapacity);
  });

  it('the Smoke Tower screens itself when it is hit', () => {
    const { sim, t } = tower(SMOKE_TOWER_CLASS);
    const foeBp = sim.blueprints.define(2, 'Scout', [...SCOUT_CLASS.parts]);
    sim.spawnUnit(foeBp, at(16), at(20));
    tick(sim, 3);
    expect(sim.smoke.dense.length).toBe(0);
    sim.damage(t, 20, 2);
    tick(sim, 5);
    expect(sim.smoke.dense.length).toBe(3);
  });

  it('the Point Defence Tower needs no program and stops missiles', () => {
    const { sim, t } = tower(POINT_DEFENCE_TOWER_CLASS);
    const rocket = sim.blueprints.define(2, 'Rocket', ['chassis.heavy', 'cpu.basic', 'missile.medium', 'cargo.bay', 'cargo.bay', 'battery.cell']);
    const shooter = sim.spawnUnit(rocket, at(24), at(20));
    sim.cargo.f.amount[shooter] = 80;
    sim.weapon.f.target[shooter] = sim.world.handle(t);
    sim.step();
    const m = sim.missile.dense[0];
    expect(m).toBeDefined();
    sim.flights[m]!.speed = 0;
    sim.flights[m]!.ttl = 100000;
    sim.flights[m]!.hitChance = 1;
    sim.flights[m]!.x = sim.pos.f.x[m] = at(12);
    sim.flights[m]!.y = sim.pos.f.y[m] = at(20);
    sim.weapon.f.target[shooter] = -1;
    tick(sim, 60);
    expect(!sim.world.isAlive(m) || sim.health.f.hp[m] <= 0).toBe(true);
  });
});
