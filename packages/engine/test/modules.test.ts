import { describe, expect, it } from 'vitest';
import { Caps, SCRIPT_CONSTANTS, Simulation, SLOT_CODES, TILE, UNIT_API } from '../src';

const at = (tiles: number) => tiles * TILE + TILE / 2;

function run(sim: Simulation, ticks: number): void {
  for (let t = 0; t < ticks; t++) {
    sim.step();
    sim.commit();
  }
}

const M_MOTOR = SLOT_CODES.motor;
const M_WEAPON = SLOT_CODES.weapon;
const newSim = () => new Simulation({ width: 40, height: 40, seed: 1 });
const WALKER = ['chassis.medium', 'cpu.basic', 'legs.heavy', 'gun.light', 'battery.cell'];

/** A unit with plenty of hit points, so only module damage decides what breaks. */
function tough(parts: string[]) {
  const sim = newSim();
  const bp = sim.blueprints.define(1, 'T', parts);
  const e = sim.spawnUnit(bp, at(10), at(10));
  sim.health.f.hp[e] = 1_000_000;
  return { sim, bp, e };
}

describe('module damage', () => {
  it('a shot aimed at the legs breaks them, and a unit on broken legs cannot move', () => {
    const { sim, bp, e } = tough(WALKER);
    expect(sim.stats(e).speed).toBeGreaterThan(0);
    const legs = bp.parts.indexOf('legs.heavy');
    sim.damage(e, 10, 2, M_MOTOR);
    expect(sim.modules.f.broken[e]).toBe(0); // 10 of 30: scratched
    sim.damage(e, 25, 2, M_MOTOR);
    expect((sim.modules.f.broken[e] >>> legs) & 1).toBe(1);
    expect(sim.stats(e).speed).toBe(0);
    expect(sim.stats(e).caps & Caps.Move).toBe(0);
    expect(sim.setDestination(e, at(20), at(20))).toBe(-1);
    expect(sim.health.f.hp[e]).toBe(1_000_000 - 35); // the hull took the damage too
  });

  it('legs break far sooner than the same hits would break wheels', () => {
    const hitsToBreak = (parts: string[]): number => {
      const { sim, e } = tough(parts);
      let n = 0;
      while (sim.modules.f.broken[e] === 0 && n < 100) {
        sim.damage(e, 5, 2, M_MOTOR);
        n++;
      }
      return n;
    };
    expect(hitsToBreak(['chassis.medium', 'cpu.basic', 'legs.heavy'])).toBeLessThan(hitsToBreak(['chassis.medium', 'cpu.basic', 'motor.large']));
  });

  it('aims at a class of module, and a broken weapon cannot fire', () => {
    const { sim, bp, e } = tough(WALKER);
    const gun = bp.parts.indexOf('gun.light');
    for (let i = 0; i < 20 && !((sim.modules.f.broken[e] >>> gun) & 1); i++) sim.damage(e, 5, 2, M_WEAPON);
    expect((sim.modules.f.broken[e] >>> gun) & 1).toBe(1);
    expect(sim.modules.f.broken[e]).toBe((1 << gun) >>> 0); // nothing else was touched
    expect(sim.stats(e).weapon).toBeNull();
  });

  it('with no working module of the aimed kind, the hit lands on a random one instead', () => {
    const { sim, e } = tough(WALKER);
    for (let i = 0; i < 200; i++) sim.damage(e, 1, 2, SLOT_CODES.radar); // no radar fitted
    const dmg = sim.moduleDamage[e]!;
    expect(dmg).toBeDefined();
    expect(sim.moduleDamageOf(e)).toBeGreaterThan(0);
  });

  it('"any" spreads hits over the modules, the same way every time', () => {
    const spread = () => {
      const { sim, e } = tough(['chassis.heavy', 'cpu.basic', 'motor.large', 'gun.light', 'cargo.bay', 'sensor.short', 'battery.cell']);
      for (let i = 0; i < 60; i++) sim.damage(e, 1, 2); // aim defaults to any
      return Array.from(sim.moduleDamage[e]!);
    };
    const first = spread();
    expect(spread()).toEqual(first);
    expect(first.filter((d) => d > 0).length).toBeGreaterThanOrEqual(4);
    expect(first[0]).toBe(0); // the chassis is never hit
  });

  it('armour and batteries soak up hits that land on them', () => {
    const wear = (parts: string[]) => {
      const { sim, e } = tough(parts);
      for (let i = 0; i < 40; i++) sim.damage(e, 1, 2);
      return sim.moduleDamageOf(e);
    };
    const bare = wear(['chassis.heavy', 'cpu.basic', 'motor.large', 'gun.light']);
    const shielded = wear(['chassis.heavy', 'cpu.basic', 'motor.large', 'gun.light', 'armor.plate', 'armor.plate', 'armor.plate', 'armor.plate']);
    expect(shielded).toBeLessThan(bare);
  });

  it('a broken module stays off: scripts cannot switch it on, and it reads as off', () => {
    const { sim, bp, e } = tough(WALKER);
    const gun = bp.parts.indexOf('gun.light');
    for (let i = 0; i < 20; i++) sim.damage(e, 5, 2, M_WEAPON);
    expect(sim.setModule(e, gun, true, true)).toBe(false);
    const ctx = { sim, e, bp, stats: sim.stats(e) };
    const call = (name: string, ...args: number[]) => UNIT_API.find((b) => b.name === name)!.fn(ctx, Int32Array.from(args));
    expect(call('moduleOn', gun)).toBe(0);
    expect(call('moduleBroken', gun)).toBe(1);
    expect(call('moduleBroken', 0)).toBe(0);
    expect(call('brokenOf', sim.world.handle(e))).toBe(1);
  });

  it('a script sets the aim with config.aim, and it reaches the shot', () => {
    const sim = newSim();
    const bp = sim.blueprints.define(1, 'Shooter', ['chassis.medium', 'cpu.basic', 'gun.light', 'battery.cell']);
    const victim = sim.blueprints.define(2, 'Walker', WALKER);
    const a = sim.spawnUnit(bp, at(10), at(10));
    const b = sim.spawnUnit(victim, at(11), at(10));
    sim.health.f.hp[b] = 1_000_000;
    const ctx = { sim, e: a, bp, stats: sim.stats(a) };
    const aim = UNIT_API.find((x) => x.name === 'aim')!;
    expect(aim.kind).toBe('config');
    expect(aim.fn(ctx, Int32Array.from([M_MOTOR]))).toBe(M_MOTOR);
    expect(sim.weapon.f.aim[a]).toBe(M_MOTOR);
    expect(SCRIPT_CONSTANTS.get('M_MOTOR')).toBe(M_MOTOR);
    expect(SCRIPT_CONSTANTS.get('M_ANY')).toBe(0);
    sim.weapon.f.target[a] = sim.world.handle(b);
    run(sim, 200);
    const legs = victim.parts.indexOf('legs.heavy');
    expect((sim.modules.f.broken[b] >>> legs) & 1).toBe(1);
    expect(sim.stats(b).speed).toBe(0);
  });
});

describe('repairing modules', () => {
  const setup = () => {
    const sim = newSim();
    sim.tick = 300; // midday
    const tower = sim.blueprints.define(1, 'Tower', ['frame.small', 'cpu.basic', 'repair.beam', 'battery.bank', 'silo']);
    const walker = sim.blueprints.define(1, 'Walker', WALKER);
    const t = sim.spawnStructure(tower, 5, 5);
    sim.energy.f.amount[t] = sim.stats(t).energyCapacity;
    sim.addStock(t, 200);
    const w = sim.spawnUnit(walker, at(6), at(5));
    sim.repairer.f.target[t] = sim.world.handle(w);
    return { sim, w, t, walker };
  };

  it('mends broken legs before the hull, and the unit walks again', () => {
    const { sim, w, walker } = setup();
    const maxHp = sim.stats(w).hp;
    sim.damage(w, 40, 2, M_MOTOR);
    expect(sim.stats(w).speed).toBe(0);
    const hp = sim.health.f.hp[w];
    run(sim, 1);
    expect(sim.health.f.hp[w]).toBe(hp); // the first mending went to the legs
    run(sim, 12);
    expect(sim.modules.f.broken[w]).toBe(0);
    expect(sim.moduleDamageOf(w)).toBe(0);
    expect(sim.stats(w).speed).toBeGreaterThan(0);
    run(sim, 30);
    expect(sim.health.f.hp[w]).toBe(maxHp);
    expect(walker.parts.length).toBeGreaterThan(0);
  });

  it('costs matter for module points too', () => {
    const { sim, w, t } = setup();
    sim.damage(w, 40, 2, M_MOTOR);
    const before = sim.stockpile.f.amount[t];
    run(sim, 4);
    expect(sim.stockpile.f.amount[t]).toBeLessThan(before);
  });

  it('a unit with nothing wrong is left alone', () => {
    const { sim, w, t } = setup();
    const before = sim.energy.f.amount[t];
    run(sim, 3);
    expect(sim.energy.f.amount[t]).toBeGreaterThanOrEqual(before);
    expect(sim.modules.f.broken[w]).toBe(0);
  });
});
