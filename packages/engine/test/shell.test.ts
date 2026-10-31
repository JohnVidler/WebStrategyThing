import { describe, expect, it } from 'vitest';
import { ELEVATION_RANGE_PER_LEVEL, SimEvent, Simulation, TILE, elevationOf, rangeBonus } from '../src';

const at = (tiles: number) => tiles * TILE + TILE / 2;

const GUNNER = ['chassis.medium', 'cpu.basic', 'gun.cannon', 'cargo.bay', 'battery.cell'];
const DUMMY = ['chassis.heavy', 'cpu.basic', 'battery.cell'];

/** A cannon at (5, 10) and an enemy dummy `gap` tiles east of it on a bare 40x40 map. */
function setup(gap: number, seed = 1) {
  const sim = new Simulation({ width: 40, height: 40, seed });
  const gun = sim.blueprints.define(1, 'Gunner', GUNNER);
  const dummy = sim.blueprints.define(2, 'Dummy', DUMMY);
  const g = sim.spawnUnit(gun, at(5), at(10));
  const d = sim.spawnUnit(dummy, at(5 + gap), at(10));
  sim.cargo.f.amount[g] = 100;
  sim.health.f.hp[d] = 1_000_000;
  sim.commit();
  const aim = () => {
    sim.weapon.f.target[g] = sim.world.handle(d);
  };
  aim();
  return { sim, g, d, aim };
}

function run(sim: Simulation, ticks: number, onTick?: () => void): number[] {
  const events: number[] = [];
  for (let t = 0; t < ticks; t++) {
    sim.step();
    for (let i = 0; i < sim.events.length; i += 3) events.push(sim.events[i]);
    sim.commit();
    onTick?.();
  }
  return events;
}

describe('cannon shells', () => {
  it('fires a shell that takes time to arrive instead of hurting the target at once', () => {
    const { sim, d } = setup(6);
    const full = sim.health.f.hp[d];
    sim.step();
    expect(sim.shell.dense.length).toBe(1);
    expect(sim.health.f.hp[d]).toBe(full);
    sim.commit();
    const events = run(sim, 12);
    expect(events).toContain(SimEvent.ShellHit);
    expect(sim.health.f.hp[d]).toBeLessThan(full);
  });

  it('is removed a tick after it lands', () => {
    const { sim } = setup(6);
    run(sim, 30);
    // one shot every 20 ticks at most: nothing lingers from the first
    expect(sim.shell.dense.length).toBeLessThanOrEqual(2);
  });

  it('flies on past a target it misses and lands at the end of its range', () => {
    const { sim, d } = setup(6);
    sim.step(); // fires at where the dummy stands...
    sim.commit();
    sim.pos.f.y[d] = at(16); // ...which it then leaves
    const full = sim.health.f.hp[d];
    sim.weapon.f.target[sim.unit.dense.find((e) => sim.unit.f.owner[e] === 1)!] = -1;
    const events = run(sim, 30);
    expect(events).toContain(SimEvent.ShellLand);
    expect(events).not.toContain(SimEvent.ShellHit);
    expect(sim.health.f.hp[d]).toBe(full);
  });

  it('is stopped by rock higher than the shooter', () => {
    const { sim, d, aim } = setup(6);
    const w = sim.terrain.width;
    const i = 10 * w + 8;
    sim.terrain.passable[i] = 0;
    sim.terrain.heights[i] = 3;
    sim.terrain.version++;
    const full = sim.health.f.hp[d];
    const events = run(sim, 30, aim);
    expect(sim.health.f.hp[d]).toBe(full);
    expect(events.some((e) => e === SimEvent.ShellLand || e === SimEvent.ShellBounce)).toBe(true);
  });

  it('glances off now and then, and mostly explodes', () => {
    let hits = 0;
    let bounces = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const { sim, aim } = setup(5, seed);
      const events = run(sim, 5, aim);
      hits += events.filter((e) => e === SimEvent.ShellHit).length;
      bounces += events.filter((e) => e === SimEvent.ShellBounce).length;
    }
    expect(hits).toBeGreaterThan(20);
    expect(bounces).toBeGreaterThan(0);
    expect(bounces).toBeLessThan(hits);
  });

  it('is the same every run for a seed', () => {
    const a = run(setup(5, 3).sim, 40);
    const b = run(setup(5, 3).sim, 40);
    expect(a).toEqual(b);
  });

  it('reaches further from high ground', () => {
    const { sim, g, d } = setup(6);
    expect(rangeBonus(sim, g, d, 'cannon')).toBe(0);
    const w = sim.terrain.width;
    const i = 10 * w + 5;
    sim.terrain.passable[i] = 0;
    sim.terrain.heights[i] = 4;
    expect(elevationOf(sim, g)).toBeGreaterThan(0);
    expect(rangeBonus(sim, g, d, 'cannon')).toBe(elevationOf(sim, g) * ELEVATION_RANGE_PER_LEVEL);
    expect(rangeBonus(sim, g, d, 'tesla')).toBe(0);
    expect(rangeBonus(sim, d, g, 'cannon')).toBe(0); // the one below gets nothing
  });
});
