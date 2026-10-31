import { describe, expect, it } from 'vitest';
import { SCOUT_CLASS, Simulation, TANK_CLASS, TILE, TaskType, defineClass, reachDistance, setShieldAngle } from '../src';

const at = (tiles: number) => tiles * TILE + TILE / 2;

function run(sim: Simulation, ticks: number, each?: () => void): void {
  for (let t = 0; t < ticks; t++) {
    sim.step();
    sim.commit();
    each?.();
  }
}

describe('attack-move stops to fight', () => {
  it('a tank ordered across open ground halts at weapon range of an enemy it meets, instead of marching on', () => {
    const sim = new Simulation({ width: 60, height: 20, seed: 1 });
    const tank = sim.spawnUnit(defineClass(sim, 1, TANK_CLASS), at(4), at(10));
    const dummy = sim.blueprints.define(2, 'Dummy', ['chassis.heavy', 'cpu.basic', 'battery.cell']);
    const enemy = sim.spawnUnit(dummy, at(40), at(10));
    sim.health.f.hp[enemy] = 1_000_000;
    sim.cargo.f.amount[tank] = 40;
    run(sim, 5);
    expect(sim.issueCommand(1, tank, TaskType.Attack, 55, 10, -1, false)).toBe(true);
    let closest = Infinity;
    run(sim, 600, () => {
      closest = Math.min(closest, sim.edgeDistance(tank, enemy));
    });
    // It stops where its sensor first sees the enemy (already inside cannon range), fires from there, and never walks on to it.
    expect(closest).toBeLessThanOrEqual(sim.stats(tank).weapon!.range);
    expect(closest).toBeGreaterThan(3 * TILE);
    expect(sim.pos.f.x[tank]).toBeLessThan(sim.pos.f.x[enemy]);
    expect(sim.health.f.hp[enemy]).toBeLessThan(1_000_000);
  });

  it('a plain move still marches straight past an enemy', () => {
    const sim = new Simulation({ width: 60, height: 20, seed: 1 });
    const scout = sim.spawnUnit(defineClass(sim, 1, SCOUT_CLASS), at(4), at(10));
    const dummy = sim.blueprints.define(2, 'Dummy', ['chassis.heavy', 'cpu.basic', 'battery.cell']);
    sim.spawnUnit(dummy, at(20), at(14));
    run(sim, 5);
    sim.issueCommand(1, scout, TaskType.Move, 55, 10, -1, false);
    run(sim, 700);
    expect(sim.pos.f.x[scout] / TILE).toBeGreaterThan(50);
  });
});

describe('reach counts an enemy shield', () => {
  it('measures to the arc, which lies nearer than the shielded unit', () => {
    const sim = new Simulation({ width: 40, height: 20, seed: 1 });
    const shooter = sim.spawnUnit(defineClass(sim, 1, SCOUT_CLASS), at(4), at(10));
    const bp = sim.blueprints.define(2, 'Shielded', ['chassis.heavy', 'cpu.basic', 'shield.emitter', 'battery.cell', 'battery.cell', 'battery.cell']);
    const target = sim.spawnUnit(bp, at(20), at(10));
    setShieldAngle(sim, target, 180);
    run(sim, 30);
    const edge = sim.edgeDistance(shooter, target);
    const reach = reachDistance(sim, shooter, target);
    expect(reach).toBeLessThan(edge);
    expect(edge - reach).toBeGreaterThanOrEqual(TILE); // the arc is at least a tile out from the hull
  });
});
