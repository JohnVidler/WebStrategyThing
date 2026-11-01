import { describe, expect, it } from 'vitest';
import { ACCEL_TICKS_BASE, ACCEL_TICKS_PER_TILE, CORNER_MIN_SPEED, defineClass, Simulation, TILE } from '../src';

const at = (t: number) => t * TILE + TILE / 2;

function unit(sim: Simulation, parts: string[], x = 5, y = 20) {
  const cls = defineClass(sim, 1, { name: parts[0], parts, program: '' });
  const e = sim.spawnUnit(cls, at(x), at(y));
  sim.addEnergy(e, 1e6);
  return e;
}

/** Ticks until the unit first moves at its top speed on a long straight run. */
function ticksToTop(parts: string[]): number {
  const sim = new Simulation({ width: 80, height: 40, seed: 1 });
  const e = unit(sim, parts);
  sim.setDestination(e, at(75), at(20));
  const top = sim.stats(e).speed;
  for (let t = 1; t < 200; t++) {
    sim.step();
    if (sim.speedNow[e] >= top) return t;
  }
  return -1;
}

describe('acceleration and cornering', () => {
  it('starts from a standstill and reaches top speed gradually', () => {
    const sim = new Simulation({ width: 80, height: 40, seed: 1 });
    const e = unit(sim, ['chassis.light', 'cpu.basic', 'motor.small']);
    sim.setDestination(e, at(75), at(20));
    const top = sim.stats(e).speed;
    sim.step();
    expect(sim.speedNow[e]).toBeGreaterThan(0);
    expect(sim.speedNow[e]).toBeLessThan(top);
    for (let i = 0; i < 40; i++) sim.step();
    expect(sim.speedNow[e]).toBe(top);
  });

  it('big hulls accelerate more slowly than small ones', () => {
    const small = ticksToTop(['chassis.micro', 'cpu.basic', 'motor.small']);
    const light = ticksToTop(['chassis.light', 'cpu.basic', 'motor.small']);
    const heavy = ticksToTop(['chassis.heavy', 'cpu.basic', 'motor.huge']);
    expect(small).toBeGreaterThan(0);
    expect(light).toBeGreaterThanOrEqual(small);
    expect(heavy).toBeGreaterThan(light);
    expect(heavy).toBeLessThanOrEqual(Math.ceil(ACCEL_TICKS_BASE + ACCEL_TICKS_PER_TILE) + 2);
  });

  it('stands still again after arriving', () => {
    const sim = new Simulation({ width: 80, height: 40, seed: 1 });
    const e = unit(sim, ['chassis.light', 'cpu.basic', 'motor.small']);
    sim.setDestination(e, at(9), at(20));
    for (let i = 0; i < 100; i++) sim.step();
    expect(sim.motion.f.moving[e]).toBe(0);
    expect(sim.speedNow[e]).toBe(0);
  });

  it('slows down for a sharp corner and speeds up again after it', () => {
    const sim = new Simulation({ width: 80, height: 40, seed: 1 });
    const e = unit(sim, ['chassis.light', 'cpu.basic', 'motor.small'], 5, 10);
    const top = sim.stats(e).speed;
    sim.setDestination(e, at(40), at(10));
    for (let i = 0; i < 40 && (sim.speedNow[e] ?? 0) < top; i++) sim.step();
    expect(sim.speedNow[e]).toBe(top);
    // A right-angle turn in the route: the waypoint list is [corner, goal].
    sim.paths[e] = [sim.pos.f.x[e] + 6 * TILE, sim.pos.f.y[e], sim.pos.f.x[e] + 6 * TILE, sim.pos.f.y[e] + 20 * TILE];
    let slowest = top;
    for (let i = 0; i < 60; i++) {
      sim.step();
      slowest = Math.min(slowest, sim.speedNow[e]);
    }
    expect(slowest).toBeLessThanOrEqual(Math.ceil(top * CORNER_MIN_SPEED) + 1);
    expect(slowest).toBeGreaterThan(0);
    expect(sim.speedNow[e]).toBeGreaterThan(slowest);
  });

  it('does not slow down on a straight route through a waypoint', () => {
    const sim = new Simulation({ width: 80, height: 40, seed: 1 });
    const e = unit(sim, ['chassis.light', 'cpu.basic', 'motor.small'], 5, 10);
    const top = sim.stats(e).speed;
    sim.setDestination(e, at(40), at(10));
    for (let i = 0; i < 40 && (sim.speedNow[e] ?? 0) < top; i++) sim.step();
    sim.paths[e] = [sim.pos.f.x[e] + 6 * TILE, sim.pos.f.y[e], sim.pos.f.x[e] + 20 * TILE, sim.pos.f.y[e]];
    for (let i = 0; i < 20; i++) {
      sim.step();
      expect(sim.speedNow[e]).toBe(top);
    }
  });
});
