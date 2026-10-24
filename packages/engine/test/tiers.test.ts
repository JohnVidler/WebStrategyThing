import { describe, expect, it } from 'vitest';
import {
  COLOSSUS_CLASS,
  CORNERS,
  createMatch,
  defineClass,
  deriveStats,
  findPath,
  generateTerrain,
  JUGGERNAUT_CLASS,
  MITE_CLASS,
  Rng,
  SCOUT_CLASS,
  setUpPlayer,
  sizeCostMultiplier,
  Simulation,
  STARTER_CLASSES,
  STRIDER_CLASS,
  TaskType,
  Terrain,
  TILE,
  UNIT_API,
  WALKER_CLASS,
  type Mobility,
} from '../src';

const at = (t: number) => t * TILE + TILE / 2;

/** An open map with a vertical rock wall `thick` cells thick at x = 10..10+thick-1 from y = 0 to `to` (exclusive). */
function walled(thick: number, to = 20, size = 24): Terrain {
  const passable = new Uint8Array(size * size).fill(1);
  for (let y = 0; y < to; y++) for (let x = 10; x < 10 + thick; x++) passable[y * size + x] = 0;
  return new Terrain(size, size, passable);
}

/** Tiles visited by a path (waypoints joined by straight lines), as "x,y". */
function cellsOn(t: Terrain, sx: number, sy: number, path: number[]): Set<string> {
  const out = new Set<string>();
  let [x0, y0] = [sx + 0.5, sy + 0.5];
  for (let i = 0; i < path.length; i += 2) {
    const [x1, y1] = [path[i] + 0.5, path[i + 1] + 0.5];
    const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 4) || 1;
    for (let s = 0; s <= steps; s++) out.add(`${Math.floor(x0 + ((x1 - x0) * s) / steps)},${Math.floor(y0 + ((y1 - y0) * s) / steps)}`);
    [x0, y0] = [x1, y1];
  }
  void t;
  return out;
}

describe('size tiers', () => {
  it('the ladder runs micro to colossus, with radius, factory need and clearance', () => {
    const tier = (id: string) => deriveStats([id, 'cpu.basic']);
    const sizes = ['chassis.micro', 'chassis.light', 'chassis.medium', 'chassis.heavy', 'chassis.superheavy', 'chassis.colossus'].map(tier);
    expect(sizes.map((s) => s.size)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(sizes.map((s) => s.clearance)).toEqual([0, 0, 0, 0, 1, 1]);
    for (let i = 1; i < sizes.length; i++) expect(sizes[i].radius).toBeGreaterThan(sizes[i - 1].radius);
    // The long chassis keep the tier of their base size.
    expect(deriveStats(['chassis.long.medium']).size).toBe(2);
  });

  it('heavy modules need a big hull; legs do not mix with wheels', () => {
    expect(() => deriveStats(['chassis.light', 'gun.rotary'])).toThrow(/super-heavy chassis or bigger/);
    expect(() => deriveStats(['chassis.heavy', 'legs.colossus'])).toThrow(/colossus chassis/);
    expect(() => deriveStats(['chassis.medium', 'legs.light', 'motor.small'])).toThrow(/Legs cannot be mixed/);
    expect(deriveStats(['chassis.medium', 'legs.heavy']).climb).toBe(2);
    // Buildings take heavy batteries whatever their size.
    expect(deriveStats(['frame.small', 'battery.large']).energyCapacity).toBeGreaterThan(0);
  });

  it('every new starter class is valid, and only the Titan Works builds the biggest at full speed', () => {
    for (const c of [MITE_CLASS, STRIDER_CLASS, WALKER_CLASS, JUGGERNAUT_CLASS, COLOSSUS_CLASS]) expect(deriveStats(c.parts).speed).toBeGreaterThan(0);
    const sim = createMatch(1);
    setUpPlayer(sim, 1, CORNERS[0], 2000);
    // A colossus is a late-game purchase: stock a few extra silos so the pool can pay for one.
    for (let i = 0; i < 8; i++) sim.addStock(sim.spawnStructure(sim.blueprints.find(1, 'Resource Silo')!, 12 + i * 3, 40), 1e6);
    expect(sim.blueprints.find(1, 'Titan Works')?.stats.factoryTiers).toBe(0b110000);
    expect(STARTER_CLASSES.length).toBeLessThanOrEqual(48);
    const colossus = sim.blueprints.find(1, 'Colossus')!;
    const heavy = sim.spawnStructure(sim.blueprints.find(1, 'Heavy Factory')!, 30, 30);
    expect(() => sim.enqueueProduction(1, heavy, colossus.id)).toThrow(/no colossus factory module/);
    const titan = sim.spawnStructure(sim.blueprints.find(1, 'Titan Works')!, 40, 40);
    sim.enqueueProduction(1, titan, colossus.id);
    const built = () => sim.unit.dense.some((e) => sim.unit.f.blueprint[e] === colossus.id);
    // Off the grid here, so keep its store full (five factory modules draw more than its own battery holds).
    for (let i = 0; i < colossus.stats.buildTime + 20 && !built(); i++) {
      sim.addEnergy(titan, 1e6);
      sim.step();
    }
    expect(built()).toBe(true);
  });
});

describe('terrain height', () => {
  it('rock height is depth inside the outcrop; cliffs are high from the edge', () => {
    const size = 9;
    const passable = new Uint8Array(size * size).fill(1);
    for (let y = 2; y <= 6; y++) for (let x = 2; x <= 6; x++) passable[y * size + x] = 0;
    const t = new Terrain(size, size, passable);
    expect([t.heightAt(1, 4), t.heightAt(2, 4), t.heightAt(3, 4), t.heightAt(4, 4)]).toEqual([0, 1, 2, 3]);
    expect(t.heightAt(-1, 0)).toBe(10);
    const cliff = new Uint8Array(size * size).fill(1);
    t.computeHeights(cliff);
    expect([t.heightAt(1, 4), t.heightAt(2, 4), t.heightAt(4, 4)]).toEqual([0, 3, 3]);
  });

  it('the wire form carries the heights', () => {
    const t = generateTerrain(40, 40, new Rng(5), [{ x: 8, y: 8, r: 4 }], 'dense');
    const back = Terrain.decode(40, 40, t.encode());
    expect(back.encode()).toBe(t.encode());
    for (let i = 0; i < 40 * 40; i++) expect(back.passable[i]).toBe(t.passable[i]);
    // Generated maps have cliffs (heights of 3 and more on an outcrop's rim).
    let cliffRim = 0;
    for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) if (t.heightAt(x, y) >= 3 && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => t.heightAt(x + dx, y + dy) === 0)) cliffRim++;
    expect(cliffRim).toBeGreaterThan(0);
  });
});

describe('legs', () => {
  const crossing = (thick: number, climb: number) => {
    const t = walled(thick);
    const path = findPath(t, 4, 5, 16, 5, { climb, clearance: 0 });
    const end = [path[path.length - 2], path[path.length - 1]];
    return { reached: end[0] === 16 && end[1] === 5, straight: path.length <= 4, over: [...cellsOn(t, 4, 5, path)].some((c) => !t.isPassable(Number(c.split(',')[0]), Number(c.split(',')[1]))) };
  };

  it('wheels go round a wall; light legs step over a wall one tile thick but not three', () => {
    expect(crossing(1, 0)).toMatchObject({ reached: true, over: false, straight: false });
    expect(crossing(1, 1)).toMatchObject({ reached: true, over: true, straight: true });
    // Three thick: the middle is height 2, too high for light legs (they go round, over the wall's low end); heavy legs walk straight over.
    expect(crossing(3, 1)).toMatchObject({ reached: true, straight: false });
    expect(crossing(3, 2)).toMatchObject({ reached: true, over: true, straight: true });
  });

  it('only colossus legs cross a cliff', () => {
    const t = walled(1);
    t.computeHeights(new Uint8Array(24 * 24).fill(1));
    expect(t.heightAt(10, 5)).toBe(3);
    const over = (climb: number) => [...cellsOn(t, 4, 5, findPath(t, 4, 5, 16, 5, { climb, clearance: 0 }))].includes('10,5');
    expect([over(1), over(2), over(9)]).toEqual([false, false, true]);
  });

  it('a Strider walks onto rock in the simulation, at half speed', () => {
    const sim = new Simulation({ width: 24, height: 24, seed: 1 }, walled(1));
    const strider = sim.spawnUnit(defineClass(sim, 1, { ...STRIDER_CLASS, program: '' }), at(8), at(5));
    sim.addEnergy(strider, 1e6);
    sim.setDestination(strider, at(13), at(5));
    let onRock = false;
    for (let i = 0; i < 200 && !onRock; i++) {
      sim.step();
      onRock ||= !sim.terrain.isPassable(Math.floor(sim.pos.f.x[strider] / TILE), Math.floor(sim.pos.f.y[strider] / TILE));
    }
    expect(onRock).toBe(true);
    const before = sim.pos.f.x[strider];
    sim.step();
    expect(sim.pos.f.x[strider] - before).toBeLessThanOrEqual(Math.ceil(sim.stats(strider).speed / 2) + 1);
  });

  it('programs can read size, climb and height', () => {
    const sim = new Simulation({ width: 24, height: 24, seed: 1 }, walled(1));
    const e = sim.spawnUnit(defineClass(sim, 1, { ...WALKER_CLASS, program: '' }), at(4), at(4));
    const other = sim.spawnUnit(defineClass(sim, 1, { ...MITE_CLASS, program: '' }), at(5), at(4));
    const ctx = { sim, e, bp: sim.blueprintOf(e)!, stats: sim.stats(e) };
    const call = (name: string, ...args: number[]) => UNIT_API.find((b) => b.name === name)!.fn(ctx, Int32Array.from(args));
    expect([call('size'), call('climb'), call('unitSize', sim.world.handle(other)), call('heightAt', 10, 5), call('heightAt', 4, 4)]).toEqual([2, 2, 0, 1, 0]);
  });
});

describe('clearance (big hulls)', () => {
  /** A wall across the map with a gap `gap` tiles wide at y = 11.. */
  function gapped(gap: number, size = 24): Terrain {
    const passable = new Uint8Array(size * size).fill(1);
    for (let y = 0; y < size; y++) if (y < 11 || y >= 11 + gap) passable[y * size + 10] = 0;
    return new Terrain(size, size, passable);
  }
  const big: Mobility = { climb: 0, clearance: 1 };

  it('a super-heavy never plans through a one- or two-tile gap; a light unit does', () => {
    for (const gap of [1, 2]) {
      const t = gapped(gap);
      const path = findPath(t, 4, 12, 16, 12, big);
      expect(path[path.length - 2]).toBeLessThan(10); // stops short on its own side
      const small = findPath(t, 4, 12, 16, 12);
      expect(small.slice(-2)).toEqual([16, 12]);
    }
    const wide = findPath(gapped(3), 4, 12, 16, 12, big);
    expect(wide.slice(-2)).toEqual([16, 12]);
  });

  it('a big hull that starts in a tight spot squeezes out', () => {
    // A one-wide corridor from (2..20, 12) with rock above and below.
    const size = 24;
    const passable = new Uint8Array(size * size).fill(1);
    for (let x = 2; x < 20; x++) {
      passable[11 * size + x] = 0;
      passable[13 * size + x] = 0;
    }
    const t = new Terrain(size, size, passable);
    expect(t.fits(10, 12, big)).toBe(false);
    const path = findPath(t, 10, 12, 10, 18, big);
    expect(path.slice(-2)).toEqual([10, 18]);
  });

  it('a Juggernaut drives round a narrow gap in the simulation', () => {
    const sim = new Simulation({ width: 24, height: 24, seed: 1 }, gapped(1));
    const j = sim.spawnUnit(defineClass(sim, 1, { ...JUGGERNAUT_CLASS, program: '' }), at(4), at(12));
    sim.addEnergy(j, 1e6);
    sim.setDestination(j, at(16), at(12));
    for (let i = 0; i < 300; i++) {
      sim.step();
      expect(Math.floor(sim.pos.f.x[j] / TILE)).toBeLessThan(10);
    }
  });
});

describe('colossus balance', () => {
  /** Colossus (owner 1) against `n` scouts (owner 2) on open ground; the scouts attack-move onto it. */
  function fight(n: number): boolean {
    const sim = new Simulation({ width: 48, height: 48, seed: 3 });
    const big = sim.spawnUnit(defineClass(sim, 1, COLOSSUS_CLASS), at(10), at(24));
    sim.addEnergy(big, 1e6);
    const scout = defineClass(sim, 2, SCOUT_CLASS);
    const scouts: number[] = [];
    for (let i = 0; i < n; i++) {
      const e = sim.spawnUnit(scout, at(34 + (i % 4)), at(18 + Math.floor(i / 4)));
      sim.addEnergy(e, 1e6);
      scouts.push(e);
    }
    sim.step();
    for (const e of scouts) sim.issueCommand(2, e, TaskType.Attack, 10, 24, -1, false);
    for (let t = 0; t < 3000 && sim.world.isAlive(big) && scouts.some((e) => sim.world.isAlive(e)); t++) {
      sim.step();
      sim.commit();
    }
    return sim.world.isAlive(big);
  }

  it('beats ten scouts', () => {
    expect(fight(10)).toBe(true);
  });

  // Costs grow exponentially with size, so the biggest hulls are late-game purchases (no longer
  // "worth their cost in scouts": their price is set by the size tier, not their strength).
  it('each size tier above medium costs 2.5 times the one below, for matter and production energy', () => {
    const cost = (c: { parts: readonly string[] }) => deriveStats(c.parts);
    const [j, c] = [cost(JUGGERNAUT_CLASS), cost(COLOSSUS_CLASS)];
    expect(c.cost / j.cost).toBeGreaterThan(2.5 * (c.mass / j.mass) * 0.9);
    expect(c.cost).toBeGreaterThan(10 * cost(SCOUT_CLASS).cost * 20);
    expect(sizeCostMultiplier(2)).toBe(1);
    expect(sizeCostMultiplier(3)).toBe(2.5);
    expect(sizeCostMultiplier(5)).toBeCloseTo(15.625);
  });
});
