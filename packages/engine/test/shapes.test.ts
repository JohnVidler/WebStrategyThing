import { describe, expect, it } from 'vitest';
import { ARTILLERY_CLASS, deriveStats, PARTS, PART_TUNING, Simulation } from '../src';

const SHAPED = ['frame.l', 'frame.t', 'frame.plus', 'frame.u', 'frame.h'];

describe('shaped building frames', () => {
  it('cover fewer tiles than their box and carry modules in proportion', () => {
    const slotsPerTile = (id: string) => PART_TUNING[id].slots! / deriveStats([id]).area;
    for (const id of SHAPED) {
      const s = deriveStats([id]);
      expect(s.footprint).toBe(3);
      expect(s.area).toBe(PARTS[id].shape!.join('').split('X').length - 1);
      expect(s.area).toBeLessThan(9);
      expect(slotsPerTile(id)).toBeGreaterThanOrEqual(3);
      expect(slotsPerTile(id)).toBeLessThanOrEqual(3.6);
    }
    expect([deriveStats(['frame.l']).area, deriveStats(['frame.h']).area, deriveStats(['frame.large']).area]).toEqual([5, 7, 9]);
    expect(deriveStats(['frame.h']).shape).toEqual(['X.X', 'XXX', 'X.X']);
    expect(deriveStats(['frame.large']).shape).toBeNull();
  });

  it('block only their own tiles, so two L frames can interlock and units can stand in the gaps', () => {
    const sim = new Simulation({ width: 24, height: 24, seed: 1 });
    const l = sim.blueprints.define(1, 'L', ['frame.l', 'cpu.basic']);
    const first = sim.spawnStructure(l, 4, 4);
    // The L covers the left column and the bottom row of its box.
    expect(sim.terrain.walkable(5, 4)).toBe(true);
    expect(sim.terrain.walkable(6, 5)).toBe(true);
    expect(sim.terrain.walkable(4, 4)).toBe(false);
    expect(sim.terrain.walkable(6, 6)).toBe(false);
    // Another L fits into the empty corner of the first one (its own box overlaps).
    expect(sim.terrain.footprintFree(5, 4, 3, l.stats.shape)).toBe(false); // its left column would sit on (5,6)
    expect(sim.terrain.footprintFree(5, 3, 3, l.stats.shape)).toBe(true);
    sim.destroyEntity(first);
    expect(sim.terrain.walkable(4, 4)).toBe(true);
    expect(sim.terrain.walkable(6, 6)).toBe(true);
  });

  it('cost building energy per covered tile', () => {
    const sim = new Simulation({ width: 24, height: 24, seed: 1 });
    expect(deriveStats(['frame.h']).area * 250).toBe(1750);
    expect(sim.blueprints.define(1, 'H', ['frame.h', 'cpu.basic']).stats.area).toBe(7);
  });
});

describe('double-long chassis', () => {
  it('have more modules than the standard chassis of their size class', () => {
    const pairs: [string, string][] = [['chassis.light', 'chassis.long.light'], ['chassis.medium', 'chassis.long.medium'], ['chassis.heavy', 'chassis.long.heavy']];
    for (const [normal, long] of pairs) {
      expect(PARTS[long].long).toBe(true);
      expect(PARTS[long].size).toBe(PARTS[normal].size);
      expect(PART_TUNING[long].slots!).toBeGreaterThan(PART_TUNING[normal].slots!);
      expect(deriveStats([long, 'cpu.basic', 'motor.small']).long).toBe(true);
    }
  });

  it('the artillery class out-ranges every sensor and fires from a long chassis', () => {
    const stats = deriveStats([...ARTILLERY_CLASS.parts]);
    expect(stats.long).toBe(true);
    expect(stats.weapon!.range).toBeGreaterThan(stats.sensorRange / 32);
    expect(stats.weapon!.range).toBeGreaterThan(PART_TUNING['missile.large'].weapon!.range);
  });
});
