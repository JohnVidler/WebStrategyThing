import { describe, expect, it } from 'vitest';
import {
  BlueprintError,
  DEFAULT_DESIGNS,
  LIGHT_TILES_PER_ENERGY,
  LIGHT_TURN_PER_TICK,
  Simulation,
  TILE,
  inVision,
  lightAngleOf,
  lightBlocked,
  outwardBearing,
  setLightAngle,
  setLightPower,
  viewersOf,
  visibleTo,
} from '../src';

const at = (t: number) => t * TILE + TILE / 2;
const PARTS = ['frame.small', 'cpu.basic', 'light.spot', 'battery.bank'];

function setup(parts = PARTS) {
  const sim = new Simulation({ width: 80, height: 40, seed: 1 });
  const bp = sim.blueprints.define(1, 'Lamp', parts);
  const dummy = sim.blueprints.define(2, 'Dummy', ['chassis.light', 'cpu.basic']);
  const tower = sim.spawnStructure(bp, 5, 20);
  return { sim, bp, dummy, tower };
}

const run = (sim: Simulation, ticks: number) => {
  for (let t = 0; t < ticks; t++) {
    sim.step();
    sim.commit();
  }
};

const sees = (sim: Simulation, owner: number, e: number) => visibleTo(sim.world, owner, (x) => sim.stats(x), sim.terrain).has(e);

describe('spotlight module', () => {
  it('gives a class a light, and only one', () => {
    const { sim, bp, tower } = setup();
    expect(bp.stats.light).toEqual({ power: 5, maxPower: 10 });
    expect(sim.lights[tower]).toBeDefined();
    expect(() => sim.blueprints.define(1, 'Two', [...PARTS, 'light.spot'])).toThrow(BlueprintError);
  });

  it('lights a beam whose length is proportional to the power it is given', () => {
    const { sim, tower } = setup();
    run(sim, 1);
    const viewers = () => viewersOf(sim.world, 1, (e) => sim.stats(e)).filter((v) => v.half !== undefined);
    expect(viewers()).toHaveLength(1);
    expect(viewers()[0].r).toBe(5 * LIGHT_TILES_PER_ENERGY * TILE);
  });

  it('shows what is along the beam and nothing beside it', () => {
    const { sim, dummy, tower } = setup();
    const ahead = sim.spawnUnit(dummy, at(20), at(20)); // 15 tiles east: beyond the building's own sight
    const behind = sim.spawnUnit(dummy, at(5), at(35));
    sim.lights[tower]!.want = sim.lights[tower]!.head = 0; // east
    run(sim, 1);
    expect(sees(sim, 1, ahead)).toBe(true);
    expect(sees(sim, 1, behind)).toBe(false);
    // The same unit without the light is out of sight.
    const dark = setup(['frame.small', 'cpu.basic', 'battery.bank']);
    const far = dark.sim.spawnUnit(dark.dummy, at(20), at(20));
    run(dark.sim, 1);
    expect(sees(dark.sim, 1, far)).toBe(false);
  });

  it('reaches further with more power, and does not reach past its length', () => {
    const { sim, dummy, tower } = setup();
    const far = sim.spawnUnit(dummy, at(35), at(20)); // 30 tiles: past 5 power (20 tiles)
    sim.lights[tower]!.want = sim.lights[tower]!.head = 0;
    run(sim, 1);
    expect(sees(sim, 1, far)).toBe(false);
    expect(setLightPower(sim, tower, 8)).toBe(8); // 32 tiles
    run(sim, 1);
    expect(sees(sim, 1, far)).toBe(true);
    expect(setLightPower(sim, tower, 99)).toBe(10); // the module's most
  });

  it('is stopped by rock like any other sight', () => {
    const { sim, dummy, tower } = setup();
    const far = sim.spawnUnit(dummy, at(20), at(20));
    for (let y = 15; y < 25; y++) sim.terrain.passable[y * sim.terrain.width + 12] = 0;
    sim.lights[tower]!.want = sim.lights[tower]!.head = 0;
    run(sim, 1);
    expect(sees(sim, 1, far)).toBe(false);
  });

  it('pays its power every tick, and goes dark when it cannot', () => {
    const { sim, tower } = setup();
    const before = sim.energy.f.amount[tower];
    run(sim, 1);
    expect(sim.energy.f.amount[tower]).toBe(before - 5);
    expect(sim.light.f.power[tower]).toBe(50);
    sim.energy.f.amount[tower] = 2;
    run(sim, 1);
    expect(sim.light.f.power[tower]).toBe(0);
    expect(viewersOf(sim.world, 1, (e) => sim.stats(e)).filter((v) => v.half !== undefined)).toHaveLength(0);
  });

  it('dims as the stored energy falls from 100 to 30 units, shortening the beam, whatever the battery size', () => {
    const beam = (sim: Simulation) => viewersOf(sim.world, 1, (e) => sim.stats(e)).filter((v) => v.half !== undefined)[0]?.r ?? 0;
    const at = (parts: string[], energy: number) => {
      const { sim, tower } = setup(parts);
      sim.energy.f.amount[tower] = energy;
      run(sim, 1);
      return { power: sim.light.f.power[tower], dim: sim.light.f.dim[tower], r: beam(sim) };
    };
    const full = at(PARTS, 100);
    expect(full.dim).toBe(255);
    expect(full.r).toBe(5 * LIGHT_TILES_PER_ENERGY * TILE);
    expect(at(PARTS, 5000).dim).toBe(255);
    const half = at(PARTS, 65); // halfway between 30 and 100
    expect(half.dim).toBeGreaterThan(120);
    expect(half.dim).toBeLessThan(135);
    expect(half.r).toBeGreaterThan(full.r * 0.45);
    expect(half.r).toBeLessThan(full.r * 0.55);
    const faint = at(PARTS, 35);
    expect(faint.power).toBeGreaterThan(0);
    expect(faint.r).toBeLessThan(half.r);
    expect(at(PARTS, 30)).toEqual({ power: 0, dim: 0, r: 0 });
    // The same amounts dim the same with two battery banks as with one.
    expect(at([...PARTS, 'battery.bank'], 65)).toEqual(half);
  });

  it('can be switched off with power 0, and with the module', () => {
    const { sim, tower } = setup();
    expect(setLightPower(sim, tower, 0)).toBe(0);
    run(sim, 1);
    expect(sim.light.f.power[tower]).toBe(0);
    setLightPower(sim, tower, 5);
    sim.setModule(tower, PARTS.indexOf('light.spot'), false, false);
    run(sim, 1);
    expect(sim.light.f.power[tower]).toBe(0);
    expect(setLightPower(sim, tower, 5)).toBe(-1);
  });

  it('turns at a limited speed towards the angle a program gives', () => {
    const { sim, tower } = setup();
    sim.lights[tower]!.head = 0;
    expect(setLightAngle(sim, tower, 180)).toBe(180);
    run(sim, 1);
    expect(Math.abs(sim.lights[tower]!.head)).toBeCloseTo(LIGHT_TURN_PER_TICK, 5);
    run(sim, 100);
    expect(Math.abs(Math.abs(sim.lights[tower]!.head) - Math.PI)).toBeLessThan(0.01);
    expect(lightAngleOf(sim, tower)).toBe(180);
  });

  it('shows nothing to the other side', () => {
    const { sim, dummy, tower } = setup();
    sim.spawnUnit(dummy, at(20), at(20)); // owned by player 2 (the blueprint is theirs)
    const other = sim.blueprints.define(2, 'Watcher', ['chassis.light', 'cpu.basic']);
    sim.spawnUnit(other, at(70), at(5));
    sim.lights[tower]!.want = sim.lights[tower]!.head = 0;
    run(sim, 1);
    expect(viewersOf(sim.world, 2, (e) => sim.stats(e)).filter((v) => v.half !== undefined)).toHaveLength(0);
    expect(inVision(viewersOf(sim.world, 1, (e) => sim.stats(e)), at(20), at(20))).toBe(true);
  });
});

describe('Spotlight Tower default class', () => {
  const towerSim = () => {
    const sim = new Simulation({ width: 80, height: 40, seed: 1 });
    const tpl = DEFAULT_DESIGNS.get('Spotlight Tower')!;
    const bp = sim.blueprints.define(1, tpl.name, tpl.parts);
    sim.setProgram(bp.id, tpl.program);
    const e = sim.spawnStructure(bp, 5, 20);
    return { sim, e };
  };

  it('sweeps the beam round while nothing is in sight, and lights it', () => {
    const { sim, e } = towerSim();
    run(sim, 2);
    const first = sim.lights[e]!.want;
    run(sim, 30);
    expect(sim.lights[e]!.want).not.toBeCloseTo(first, 1);
    expect(sim.light.f.power[e]).toBeGreaterThan(0); // a little dimmed by the energy it has used
  });

  it('turns to follow an enemy its sensor finds', () => {
    const { sim, e } = towerSim();
    const dummy = sim.blueprints.define(2, 'Dummy', ['chassis.light', 'cpu.basic']);
    sim.spawnUnit(dummy, at(5), at(28)); // 8 tiles south of the tower
    sim.spatial.rebuild(sim.pos.f.x, sim.pos.f.y, sim.pos.dense, sim.world.capacity);
    run(sim, 60);
    expect(lightAngleOf(sim, e)).toBe(90);
  });
});

describe('looking outwards', () => {
  const spawnTower = (x: number, y: number, program = true) => {
    const sim = new Simulation({ width: 80, height: 40, seed: 1 });
    const tpl = DEFAULT_DESIGNS.get('Spotlight Tower')!;
    const bp = sim.blueprints.define(1, tpl.name, tpl.parts);
    if (program) sim.setProgram(bp.id, tpl.program);
    const e = sim.spawnStructure(bp, x, y);
    const friend = sim.blueprints.define(1, 'Friend', ['chassis.light', 'cpu.basic']);
    const wall = sim.blueprints.define(1, 'Wall', ['frame.small', 'cpu.basic']);
    return { sim, e, friend, wall };
  };
  const apart = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

  it('points away from the allied units and buildings round it, else away from the middle of the map', () => {
    const { sim, e, wall } = spawnTower(30, 20);
    sim.spawnStructure(wall, 26, 20); // home lies to the west
    sim.spatial.rebuild(sim.pos.f.x, sim.pos.f.y, sim.pos.dense, sim.world.capacity);
    expect(apart(outwardBearing(sim, e), 0)).toBeLessThan(5);
    const lone = spawnTower(5, 20);
    expect(apart(outwardBearing(lone.sim, lone.e), 180)).toBeLessThan(5); // the map's middle is east of it
  });

  it('sees an allied unit in the beam, but not a building, a far one or one off to the side', () => {
    const { sim, e, friend, wall } = spawnTower(30, 20);
    sim.spawnUnit(friend, at(36), at(20)); // 6 tiles east
    sim.spawnStructure(wall, 30, 26); // a building to the south
    sim.spatial.rebuild(sim.pos.f.x, sim.pos.f.y, sim.pos.dense, sim.world.capacity);
    expect(lightBlocked(sim, e, 0)).toBe(true);
    expect(lightBlocked(sim, e, 15)).toBe(true); // within the beam's width and margin
    expect(lightBlocked(sim, e, 30)).toBe(false);
    expect(lightBlocked(sim, e, 60)).toBe(false);
    expect(lightBlocked(sim, e, 90)).toBe(false); // only a building lies that way
    expect(lightBlocked(sim, e, 180)).toBe(false);
  });

  it('pans left and right across the way out, not all the way round', () => {
    const { sim, e, wall } = spawnTower(30, 20);
    sim.spawnStructure(wall, 26, 20); // so out is east (0 degrees)
    const seen: number[] = [];
    for (let i = 0; i < 300; i++) {
      run(sim, 1);
      const a = lightAngleOf(sim, e);
      seen.push(a > 180 ? a - 360 : a);
    }
    expect(Math.max(...seen)).toBeLessThanOrEqual(66);
    expect(Math.min(...seen)).toBeGreaterThanOrEqual(-66);
    expect(Math.max(...seen)).toBeGreaterThan(50);
    expect(Math.min(...seen)).toBeLessThan(-50);
  });

  it('turns back rather than shine on an allied unit', () => {
    const { sim, e, friend, wall } = spawnTower(30, 20);
    // Home lies to the west (the unit's own pull is cancelled by the building to the north), so out is east.
    for (const [x, y] of [[24, 20], [25, 20], [26, 20], [27, 20], [28, 16]]) sim.spawnStructure(wall, x, y);
    sim.spawnUnit(friend, at(38), at(24)); // about 27 degrees south of east, 9 tiles out
    const seen: number[] = [];
    for (let i = 0; i < 300; i++) {
      run(sim, 1);
      const a = lightAngleOf(sim, e);
      seen.push(a > 180 ? a - 360 : a);
    }
    expect(Math.max(...seen)).toBeLessThan(12); // it never turns far enough to light the unit
    expect(Math.min(...seen)).toBeLessThan(-50); // but still pans the other way
  });
});
