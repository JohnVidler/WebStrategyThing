import { describe, expect, it } from 'vitest';
import {
  FLAMER_CLASS,
  SCOUT_CLASS,
  TANK_CLASS,
  defineClass,
  deriveStats,
  FLAME_BURN_DAMAGE,
  FLAME_BURN_TICKS,
  FLAME_SHOTS_PER_MATTER,
  FLAME_BURST_COUNT,
  FLAME_VULNERABILITY,
  MAX_FLAMES,
  Sky,
  SimEvent,
  Simulation,
  TILE,
  lobFlame,
  setShieldAngle,
} from '../src';

const at = (tiles: number) => tiles * TILE + TILE / 2;

const FLAMER = ['chassis.medium', 'cpu.basic', 'flame.projector', 'cargo.bay', 'battery.cell'];
const DUMMY = ['chassis.heavy', 'cpu.basic', 'battery.cell'];
const SHIELDED = ['chassis.heavy', 'cpu.basic', 'shield.emitter', 'battery.cell', 'battery.cell', 'battery.cell'];

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

/** A flamethrower (owner 1) at (5, 10) aimed at a dummy of owner 2 `gap` tiles east. */
function setup(gap: number, targetParts: readonly string[] = DUMMY) {
  const sim = new Simulation({ width: 40, height: 40, seed: 1 });
  const flamer = sim.spawnUnit(sim.blueprints.define(1, 'Flamer', FLAMER), at(5), at(10));
  const dummy = sim.spawnUnit(sim.blueprints.define(2, 'Dummy', targetParts), at(5 + gap), at(10));
  sim.cargo.f.amount[flamer] = 100;
  sim.health.f.hp[dummy] = 1_000_000;
  sim.commit();
  return { sim, flamer, dummy, aim: () => (sim.weapon.f.target[flamer] = sim.world.handle(dummy)) };
}

describe('flamethrower', () => {
  it('uses matter as fuel', () => {
    const { sim, flamer, aim } = setup(6);
    aim();
    const before = sim.cargo.f.amount[flamer];
    sim.step();
    expect(sim.cargo.f.amount[flamer]).toBe(before - sim.stats(flamer).weapon!.matter);
    sim.cargo.f.amount[flamer] = 0;
    sim.commit();
    sim.weapon.f.cooldown[flamer] = 0;
    const count = sim.flame.dense.length;
    run(sim, 30);
    // Dry, it can still finish the matter it has paid for (a few fireballs), then no more.
    expect(sim.flame.dense.length - count).toBeLessThan(FLAME_SHOTS_PER_MATTER);
  });

  it('lobs a slow fireball that does no damage in the air, then lands and burns in place', () => {
    const { sim, dummy, aim } = setup(7);
    const full = sim.health.f.hp[dummy];
    aim();
    sim.step();
    expect(sim.flame.dense.length).toBe(1);
    const e = sim.flame.dense[0];
    expect(sim.flame.f.state[e]).toBe(0);
    const x0 = sim.pos.f.x[e];
    sim.commit();
    run(sim, 6);
    expect(sim.pos.f.x[e]).toBeGreaterThan(x0);
    expect(sim.pos.f.x[e] - x0).toBeLessThan(3 * TILE); // slow
    expect(sim.health.f.hp[dummy]).toBe(full);
    const events = run(sim, 40);
    expect(events).toContain(SimEvent.FlameLand);
    expect(sim.flame.f.state[e]).toBe(1);
    const landed = sim.pos.f.x[e];
    run(sim, 10);
    expect(sim.pos.f.x[e]).toBe(landed); // stuck
    expect(sim.health.f.hp[dummy]).toBeLessThan(full);
  });

  it('burns for a while at a low, steady rate, then goes out', () => {
    const sim = new Simulation({ width: 40, height: 40, seed: 1 });
    const dummy = sim.spawnUnit(sim.blueprints.define(2, 'Dummy', DUMMY), at(10), at(10));
    sim.health.f.hp[dummy] = 10_000;
    lobFlame(sim, at(10), at(10), at(10), at(10), 1);
    sim.commit();
    run(sim, 3);
    const start = sim.health.f.hp[dummy];
    run(sim, 20);
    const lost = start - sim.health.f.hp[dummy];
    expect(lost).toBeGreaterThan(0);
    expect(lost).toBeLessThanOrEqual(FLAME_BURN_DAMAGE * 5);
    run(sim, FLAME_BURN_TICKS + 5);
    expect(sim.flame.dense.length).toBe(0);
  });

  it('burns every unit, the thrower’s own side and neutrals included', () => {
    const sim = new Simulation({ width: 40, height: 40, seed: 1 });
    const bp = sim.blueprints.define(1, 'Dummy', DUMMY);
    const mine = sim.spawnUnit(bp, at(10), at(10));
    const ally = sim.spawnUnit(sim.blueprints.define(3, 'Dummy', DUMMY), at(11), at(10));
    const far = sim.spawnUnit(bp, at(25), at(25));
    for (const e of [mine, ally, far]) sim.health.f.hp[e] = 10_000;
    lobFlame(sim, at(10.5), at(10), at(10.5), at(10), 1);
    sim.commit();
    run(sim, 30);
    expect(sim.health.f.hp[mine]).toBeLessThan(10_000);
    expect(sim.health.f.hp[ally]).toBeLessThan(10_000);
    expect(sim.health.f.hp[far]).toBe(10_000);
  });

  it('burns out faster in the rain, in proportion to how wet it is', () => {
    const lifetime = (intensity: number): number => {
      const sim = new Simulation({ width: 40, height: 40, seed: 1 });
      sim.weather.setDev(Sky.Rain, intensity, 0, 0);
      lobFlame(sim, at(10), at(10), at(10), at(10), 1);
      sim.commit();
      let ticks = 0;
      while (sim.flame.dense.length > 0 && ticks < 1000) {
        run(sim, 1);
        ticks++;
      }
      return ticks;
    };
    const dry = lifetime(0);
    const drizzle = lifetime(50);
    const downpour = lifetime(100);
    expect(dry).toBeGreaterThan(FLAME_BURN_TICKS);
    expect(drizzle).toBeLessThan(dry);
    expect(downpour).toBeLessThan(drizzle);
    expect(downpour).toBeLessThan(dry / 2);
  });

  it('burns buildings that stand in it', () => {
    const sim = new Simulation({ width: 40, height: 40, seed: 1 });
    const bp = sim.blueprints.define(2, 'Tower', ['frame.small', 'cpu.basic', 'battery.bank']);
    const b = sim.spawnStructure(bp, 10, 10);
    const full = sim.health.f.hp[b];
    lobFlame(sim, at(10), at(10), at(10), at(10), 1);
    sim.commit();
    run(sim, 30);
    expect(sim.health.f.hp[b]).toBeLessThan(full);
  });

  it('makes a unit that carries one take extra damage', () => {
    const sim = new Simulation({ width: 40, height: 40, seed: 1 });
    const flamer = sim.spawnUnit(sim.blueprints.define(1, 'Flamer', FLAMER), at(5), at(5));
    const plain = sim.spawnUnit(sim.blueprints.define(1, 'Dummy', DUMMY), at(8), at(5));
    const f0 = sim.health.f.hp[flamer];
    const p0 = sim.health.f.hp[plain];
    sim.damage(flamer, 10, 2);
    sim.damage(plain, 10, 2);
    expect(f0 - sim.health.f.hp[flamer]).toBe(10 * FLAME_VULNERABILITY);
    expect(p0 - sim.health.f.hp[plain]).toBe(10);
  });

  it('throws fireballs in every direction when it dies', () => {
    const sim = new Simulation({ width: 60, height: 60, seed: 1 });
    const flamer = sim.spawnUnit(sim.blueprints.define(1, 'Flamer', FLAMER), at(30), at(30));
    sim.commit();
    sim.health.f.hp[flamer] = 0;
    run(sim, 1);
    expect(sim.flame.dense.length).toBe(FLAME_BURST_COUNT);
    // They fan out round the spot, not all one way.
    const heading = (e: number) => Math.atan2(sim.flameFlights[e]!.vy, sim.flameFlights[e]!.vx);
    const spread = sim.flame.dense.map(heading);
    expect(Math.max(...spread) - Math.min(...spread)).toBeGreaterThan(Math.PI);
    run(sim, 60);
    expect(sim.flame.dense.every((e) => sim.flame.f.state[e] === 1)).toBe(true);
  });

  it('is turned back by an enemy shield instead of landing behind it', () => {
    const { sim, flamer, dummy, aim } = setup(8, SHIELDED);
    setShieldAngle(sim, dummy, 180);
    run(sim, 30); // the shield swings into place
    aim();
    run(sim, 1);
    sim.weapon.f.target[flamer] = -1; // one shot is enough
    run(sim, 70);
    const wall = sim.pos.f.x[dummy] - sim.shields[dummy]!.range;
    expect(sim.flame.dense.length).toBeGreaterThan(0);
    for (const e of sim.flame.dense) {
      expect(sim.flame.f.state[e]).toBe(1);
      expect(sim.pos.f.x[e]).toBeLessThan(wall + 1); // on the thrower's side of the arc
    }
    expect(sim.pos.f.x[flamer]).toBeLessThan(wall);
  });

  it('never has more than the cap alive', () => {
    const sim = new Simulation({ width: 60, height: 60, seed: 1 });
    for (let i = 0; i < MAX_FLAMES + 50; i++) lobFlame(sim, at(10), at(10), at(20), at(20), 1);
    expect(sim.flame.dense.length).toBe(MAX_FLAMES);
  });

  it('sets off a tight group of flamers in a chain, but not a spread-out one', () => {
    const alive = (gap: number): number => {
      const sim = new Simulation({ width: 60, height: 60, seed: 3 });
      const bp = defineClass(sim, 1, { ...FLAMER_CLASS, program: '' });
      const ids = [0, 1, 2, 3, 4].map((i) => sim.spawnUnit(bp, at(20 + i * gap), at(30)));
      sim.commit();
      sim.health.f.hp[ids[0]] = 0;
      run(sim, 300);
      return ids.filter((e) => sim.world.isAlive(e) && sim.health.f.hp[e] > 0).length;
    };
    expect(alive(1.5)).toBe(0);
    expect(alive(5)).toBeGreaterThanOrEqual(4);
  });

  it('is a costly unit', () => {
    expect(deriveStats(FLAMER_CLASS.parts).cost).toBeGreaterThan(deriveStats(TANK_CLASS.parts).cost * 1.3);
  });

  it('the Flamer program burns an enemy but holds fire when one of its own stands beside the target', () => {
    const fires = (friendNear: boolean): number => {
      const sim = new Simulation({ width: 60, height: 60, seed: 3 });
      sim.spawnUnit(defineClass(sim, 1, FLAMER_CLASS), at(20), at(30));
      const foe = sim.spawnUnit(defineClass(sim, 2, { ...SCOUT_CLASS, program: '' }), at(25), at(30));
      sim.health.f.hp[foe] = 100_000;
      if (friendNear) sim.spawnUnit(defineClass(sim, 1, { ...SCOUT_CLASS, program: '' }), at(26), at(30));
      sim.commit();
      let most = 0;
      for (let t = 0; t < 120; t++) {
        sim.step();
        most = Math.max(most, sim.flame.dense.length);
        sim.commit();
      }
      return most;
    };
    expect(fires(false)).toBeGreaterThan(0);
    expect(fires(true)).toBe(0);
  });

  it('fires a stream of fireballs, paying one matter for every few', () => {
    const { sim, flamer, aim } = setup(8);
    aim();
    const before = sim.cargo.f.amount[flamer];
    let launched = 0;
    for (let t = 0; t < 20; t++) {
      const n = sim.flame.dense.length;
      sim.step();
      if (sim.flame.dense.length > n) launched++;
      sim.commit();
    }
    expect(launched).toBeGreaterThanOrEqual(8); // about one every other tick
    const spent = before - sim.cargo.f.amount[flamer];
    expect(spent).toBeLessThanOrEqual(Math.ceil(launched / FLAME_SHOTS_PER_MATTER));
    expect(spent).toBeGreaterThan(0);
  });
});
