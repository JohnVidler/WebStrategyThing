import { describe, expect, it } from 'vitest';
import { BlueprintError, Simulation, TILE, WEAPONS_BY_SIZE, deriveStats } from '../src';
import { prog } from './helpers';

const TWO_GUNS = ['chassis.medium', 'cpu.basic', 'gun.light', 'gun.light', 'battery.cell'];

function duel(parts: string[]) {
  const sim = new Simulation({ width: 30, height: 30, seed: 1 });
  const bp = sim.blueprints.define(1, 'Shooter', parts);
  const dummy = sim.blueprints.define(2, 'Dummy', ['chassis.heavy', 'cpu.basic', 'armor.plate', 'battery.cell']);
  const a = sim.spawnUnit(bp, 10 * TILE, 10 * TILE);
  const b = sim.spawnUnit(dummy, 11 * TILE, 10 * TILE);
  sim.energy.f.amount[a] = bp.stats.energyCapacity;
  return { sim, bp, a, b };
}

describe('several weapons on one class', () => {
  it('limits the number of weapons by chassis size, and by footprint for buildings', () => {
    expect(WEAPONS_BY_SIZE[0]).toBe(1);
    expect(WEAPONS_BY_SIZE.every((n, i) => i === 0 || n >= WEAPONS_BY_SIZE[i - 1])).toBe(true);
    expect(() => deriveStats(['chassis.micro', 'cpu.basic', 'gun.light', 'gun.light'])).toThrow(/at most 1 weapon\b/);
    expect(deriveStats(TWO_GUNS).weapons).toHaveLength(2);
    expect(() => deriveStats(['frame.small', 'cpu.basic', 'gun.light', 'gun.light'])).toThrow(BlueprintError);
    expect(deriveStats(['frame.medium', 'cpu.basic', 'gun.light', 'gun.light', 'battery.cell']).weapons).toHaveLength(2);
  });

  it('keeps one state per weapon, and every locked weapon deals its damage', () => {
    const one = duel(['chassis.medium', 'cpu.basic', 'gun.light', 'battery.cell']);
    const two = duel(TWO_GUNS);
    expect(two.sim.weaponStores[0].has(two.a)).toBe(true);
    expect(two.sim.weaponStores[1].has(two.a)).toBe(true);
    expect(two.sim.weaponStores[2].has(two.a)).toBe(false);
    for (const d of [one, two]) {
      for (const store of d.sim.weaponStores) if (store.has(d.a)) store.f.target[d.a] = d.sim.world.handle(d.b);
    }
    const hp = one.sim.health.f.hp[one.b];
    one.sim.step();
    two.sim.step();
    expect(hp - one.sim.health.f.hp[one.b]).toBeGreaterThan(0);
    expect(hp - two.sim.health.f.hp[two.b]).toBe(2 * (hp - one.sim.health.f.hp[one.b]));
  });

  it('a weapon that has not been given a target holds fire', () => {
    const { sim, a, b } = duel(TWO_GUNS);
    sim.weaponStores[1].f.target[a] = sim.world.handle(b);
    const hp = sim.health.f.hp[b];
    sim.step();
    const one = hp - sim.health.f.hp[b];
    expect(one).toBeGreaterThan(0);
    const both = duel(TWO_GUNS);
    both.sim.weaponStores[0].f.target[both.a] = both.sim.world.handle(both.b);
    both.sim.weaponStores[1].f.target[both.a] = both.sim.world.handle(both.b);
    both.sim.step();
    expect(hp - both.sim.health.f.hp[both.b]).toBe(2 * one);
  });

  it('scripts count, index and filter the weapons, and aim one or all', () => {
    const parts = ['chassis.medium', 'cpu.basic', 'gun.light', 'laser.beam', 'sensor.short', 'battery.cell'];
    const run = (shoot: string) => {
      const { sim, bp, a, b } = duel(parts);
      const h = sim.world.handle(b);
      sim.setProgram(bp.id, prog([
        'let n = 0;',
        'let laser = -1;',
        'let range = 0;',
        'on(Spawned, () => {',
        '  n = self.modules.weapon.length;',
        '  laser = self.modules.weapon.filter(w => self.modules.weapon[w].kind === W_LASER).first();',
        '  range = self.modules.weapon[laser].range;',
        `  ${shoot.replace('H', String(h))}`,
        '});',
      ].join('\n')));
      sim.commit();
      for (let i = 0; i < 2; i++) {
        sim.step();
        sim.commit();
      }
      return { sim, a, h, mem: sim.flows[a]!.mem };
    };
    const only = run('self.modules.weapon[laser].fire(H);');
    expect([only.mem[0], only.mem[1]]).toEqual([2, 1]);
    expect(only.mem[2]).toBeGreaterThan(0);
    expect(only.sim.weaponStores[0].f.target[only.a]).toBe(-1);
    expect(only.sim.weaponStores[1].f.target[only.a]).toBe(only.h);
    const all = run('self.modules.weapon.fire(H);');
    expect(all.sim.weaponStores[0].f.target[all.a]).toBe(all.h);
    expect(all.sim.weaponStores[1].f.target[all.a]).toBe(all.h);
  });

  it('a switched-off weapon leaves a hole at its index instead of shifting the others', () => {
    const { sim, a } = duel(TWO_GUNS);
    expect(sim.stats(a).weapons.map((w) => w?.kind)).toEqual(['gun', 'gun']);
    sim.setModule(a, 2, false, false);
    const after = sim.stats(a);
    expect(after.weapons[0]).toBeNull();
    expect(after.weapons[1]?.kind).toBe('gun');
    expect(after.weapon).toBe(after.weapons[1]);
  });

  it('weapons share the cargo bay for matter', () => {
    const parts = ['chassis.medium', 'cpu.basic', 'gun.cannon', 'gun.cannon', 'cargo.bay', 'battery.cell'];
    const { sim, bp, a, b } = duel(parts);
    const matter = bp.stats.weapons[0]!.matter;
    expect(matter).toBeGreaterThan(0);
    sim.cargo.f.amount[a] = matter * 10;
    for (const store of sim.weaponStores) if (store.has(a)) store.f.target[a] = sim.world.handle(b);
    sim.step();
    expect(sim.cargo.f.amount[a]).toBe(matter * 8);
  });
});
