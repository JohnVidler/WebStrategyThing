import { describe, expect, it } from 'vitest';
import {
  DRONE_BAY_CAPACITY,
  ION_IMMUNITY_TICKS,
  ION_SHIELD_DRAIN,
  ION_TICKS,
  MAX_SMOKE,
  PD_COOLDOWN,
  RAIL_CHARGE_TICKS,
  RAIL_PIERCE,
  SMOKE_CANISTERS,
  SMOKE_COOLDOWN,
  SMOKE_TICKS,
  SHIELD_ENERGY_PER_DAMAGE,
  SLOT_CODES,
  Simulation,
  TILE,
  VisionGrid,
  inSight,
  setShieldAngle,
  smokeAt,
  smokeBlocks,
  throwSmoke,
  viewersOf,
  setDroneClass,
  launchDrones,
  recallDrones,
  fillBay,
  HIVE_CLASS,
  WASP_CLASS,
  SCOUT_CLASS,
  defineClass,
} from '../src';

const at = (tiles: number) => tiles * TILE + TILE / 2;
const tick = (sim: Simulation, n = 1) => {
  for (let i = 0; i < n; i++) {
    sim.step();
    sim.commit();
  }
};
const fill = (sim: Simulation, e: number) => {
  sim.energy.f.amount[e] = sim.stats(e).energyCapacity;
};

const DUMMY = ['chassis.heavy', 'cpu.basic', 'battery.cell'];

describe('smoke launcher', () => {
  const SMOKER = ['chassis.medium', 'cpu.basic', 'smoke.launcher', 'battery.cell'];

  it('throws three clouds, spends energy but no matter, then rests', () => {
    const sim = new Simulation({ width: 40, height: 30, seed: 3 });
    const bp = sim.blueprints.define(1, 'Smoker', SMOKER);
    const e = sim.spawnUnit(bp, at(10), at(15));
    fill(sim, e);
    const before = sim.energy.f.amount[e];
    expect(throwSmoke(sim, e, 0)).toBe(true);
    expect(sim.smoke.dense.length).toBe(SMOKE_CANISTERS);
    expect(sim.energy.f.amount[e]).toBe(before - bp.stats.smoke!.use);
    expect(throwSmoke(sim, e, 0)).toBe(false); // resting
    tick(sim, SMOKE_COOLDOWN);
    expect(throwSmoke(sim, e, 0)).toBe(true);
  });

  it('clouds last SMOKE_TICKS, then go; at most MAX_SMOKE exist', () => {
    const sim = new Simulation({ width: 40, height: 30, seed: 3 });
    const bp = sim.blueprints.define(1, 'Smoker', SMOKER);
    const e = sim.spawnUnit(bp, at(10), at(15));
    fill(sim, e);
    throwSmoke(sim, e, 0);
    tick(sim, SMOKE_TICKS - 2);
    expect(sim.smoke.dense.length).toBe(SMOKE_CANISTERS);
    tick(sim, 4);
    expect(sim.smoke.dense.length).toBe(0);
    expect(sim.smokeCount).toBe(0);
    // many launchers cannot flood the map
    const many = Array.from({ length: 60 }, (_, i) => sim.spawnUnit(bp, at(2 + (i % 30)), at(2 + Math.floor(i / 30))));
    for (const m of many) {
      fill(sim, m);
      throwSmoke(sim, m, 90);
    }
    expect(sim.smoke.dense.length).toBeLessThanOrEqual(MAX_SMOKE);
  });

  it('a cloud covers its tiles, blocks line of sight and hides an enemy from sensors', () => {
    const sim = new Simulation({ width: 40, height: 30, seed: 3 });
    const bp = sim.blueprints.define(1, 'Smoker', SMOKER);
    const e = sim.spawnUnit(bp, at(10), at(15));
    fill(sim, e);
    throwSmoke(sim, e, 0); // clouds at about (14, 15) and to each side
    tick(sim, 1);
    expect(smokeAt(sim, 14, 15)).toBe(true);
    expect(smokeAt(sim, 20, 15)).toBe(false);
    // a viewer west of the cloud cannot see an enemy just behind it; without smoke it can
    const watcher = sim.blueprints.define(2, 'Watcher', ['chassis.medium', 'cpu.basic', 'sensor.long']);
    const w = sim.spawnUnit(watcher, at(6), at(15));
    const target = sim.spawnUnit(sim.blueprints.define(1, 'Dummy', DUMMY), at(18), at(15));
    const viewers = viewersOf(sim.world, 2, (u) => sim.stats(u), undefined, 100, 0);
    expect(inSight(sim.terrain, viewers, sim.pos.f.x[target], sim.pos.f.y[target])).toBe(false);
    expect(smokeBlocks(sim, sim.pos.f.x[w], sim.pos.f.y[w], sim.pos.f.x[target], sim.pos.f.y[target])).toBe(true);
    tick(sim, SMOKE_TICKS + 2);
    expect(inSight(sim.terrain, viewersOf(sim.world, 2, (u) => sim.stats(u), undefined, 100, 0), sim.pos.f.x[target], sim.pos.f.y[target])).toBe(true);
    expect(VisionGrid.of(sim.terrain)).toBeTruthy();
  });

  it('a launcher that is broken or off does nothing', () => {
    const sim = new Simulation({ width: 40, height: 30, seed: 3 });
    const bp = sim.blueprints.define(1, 'Smoker', SMOKER);
    const e = sim.spawnUnit(bp, at(10), at(15));
    fill(sim, e);
    sim.setModule(e, 2, false, true);
    expect(throwSmoke(sim, e, 0)).toBe(false);
    expect(sim.smoke.dense.length).toBe(0);
  });
});

describe('point defence', () => {
  const GUARD = ['chassis.medium', 'cpu.basic', 'defence.point', 'battery.cell'];
  const ROCKET = ['chassis.heavy', 'cpu.basic', 'missile.medium', 'cargo.bay', 'cargo.bay', 'battery.cell'];
  const CANNON = ['chassis.medium', 'cpu.basic', 'gun.cannon', 'cargo.bay', 'battery.cell'];

  /** A guard for player 1 at (10, 15); a shooter for player 2 far east, with a missile in the air parked `near` tiles from the guard. */
  function missileSetup(near: number) {
    const sim = new Simulation({ width: 60, height: 30, seed: 5 });
    const g = sim.spawnUnit(sim.blueprints.define(1, 'Guard', GUARD), at(10), at(15));
    fill(sim, g);
    const shooter = sim.spawnUnit(sim.blueprints.define(2, 'Rocket', ROCKET), at(22), at(15));
    sim.cargo.f.amount[shooter] = 120;
    sim.weapon.f.target[shooter] = sim.world.handle(g);
    sim.step();
    const m = sim.missile.dense[0];
    sim.flights[m]!.speed = 0;
    sim.flights[m]!.ttl = 100000;
    sim.flights[m]!.hitChance = 1;
    sim.flights[m]!.x = sim.pos.f.x[m] = at(10 + near);
    sim.flights[m]!.y = sim.pos.f.y[m] = at(15);
    sim.weapon.f.target[shooter] = -1;
    return { sim, g, m };
  }

  it('shoots down an incoming enemy missile in range, paying energy for each shot', () => {
    const { sim, g, m } = missileSetup(2);
    const e0 = sim.energy.f.amount[g];
    tick(sim, 40);
    expect(!sim.world.isAlive(m) || sim.health.f.hp[m] <= 0).toBe(true);
    expect(sim.energy.f.amount[g]).toBeLessThan(e0);
  });

  it('ignores a missile out of range, does nothing without energy, and fires no faster than its cooldown', () => {
    const far = missileSetup(8);
    const hp = far.sim.health.f.hp[far.m];
    tick(far.sim, 40);
    expect(far.sim.health.f.hp[far.m]).toBe(hp);
    const flat = missileSetup(2);
    flat.sim.energy.f.amount[flat.g] = 0;
    const hp2 = flat.sim.health.f.hp[flat.m];
    tick(flat.sim, 20);
    expect(flat.sim.health.f.hp[flat.m]).toBe(hp2);
    const paced = missileSetup(2);
    paced.sim.flights[paced.m]!.hitChance = 1;
    paced.sim.health.f.hp[paced.m] = 100000;
    const e = paced.sim.energy.f.amount[paced.g];
    tick(paced.sim, PD_COOLDOWN * 5);
    const shots = (e - paced.sim.energy.f.amount[paced.g]) / paced.sim.stats(paced.g).defence!.use;
    expect(shots).toBeLessThanOrEqual(5 + 1);
    expect(shots).toBeGreaterThanOrEqual(3);
  });

  it('destroys some cannon shells, never an allied one', () => {
    let stopped = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const sim = new Simulation({ width: 60, height: 30, seed });
      const g = sim.spawnUnit(sim.blueprints.define(1, 'Guard', GUARD), at(10), at(15));
      fill(sim, g);
      const c = sim.spawnUnit(sim.blueprints.define(2, 'Cannon', CANNON), at(24), at(15));
      sim.cargo.f.amount[c] = 40;
      sim.weapon.f.target[c] = sim.world.handle(g);
      sim.weapon.f.cooldown[c] = 0;
      let landed = false;
      for (let i = 0; i < 80 && !landed; i++) {
        sim.step();
        for (let k = 0; k < sim.events.length; k += 3) if (sim.events[k] === 9 || sim.events[k] === 11) landed = true;
        sim.commit();
      }
      if (sim.health.f.hp[g] === sim.stats(g).hp) stopped++;
    }
    expect(stopped).toBeGreaterThan(0);
    expect(stopped).toBeLessThan(20);
  });
});

describe('railgun', () => {
  const RAIL = ['chassis.heavy', 'cpu.basic', 'rail.gun', 'battery.large', 'battery.large'];

  function line(count = 5, spacing = 1) {
    const sim = new Simulation({ width: 60, height: 30, seed: 9 });
    const bp = sim.blueprints.define(1, 'Rail', RAIL);
    const gun = sim.spawnUnit(bp, at(10), at(15));
    fill(sim, gun);
    const dummy = sim.blueprints.define(2, 'Dummy', DUMMY);
    const targets = Array.from({ length: count }, (_, i) => {
      const t = sim.spawnUnit(dummy, at(16 + i * spacing), at(15));
      sim.health.f.hp[t] = 10000;
      return t;
    });
    return { sim, gun, targets };
  }

  it('charges the full time, taking its energy at the start, then pierces up to RAIL_PIERCE with falloff', () => {
    const { sim, gun, targets } = line(6, 1);
    const w = sim.stats(gun).weapon!;
    sim.weapon.f.target[gun] = sim.world.handle(targets[0]);
    const e0 = sim.energy.f.amount[gun];
    tick(sim, 1);
    expect(sim.rails.has(gun)).toBe(true);
    expect(sim.energy.f.amount[gun]).toBeLessThanOrEqual(e0 - w.use + 5);
    tick(sim, RAIL_CHARGE_TICKS - 5);
    for (const t of targets) expect(sim.health.f.hp[t]).toBe(10000); // still charging
    tick(sim, 10);
    const dealt = targets.map((t) => 10000 - sim.health.f.hp[t]);
    expect(dealt.slice(0, RAIL_PIERCE).every((d) => d > 0)).toBe(true);
    expect(dealt[0]).toBe(w.damage);
    expect(dealt[1]).toBeLessThan(dealt[0]);
    expect(dealt[2]).toBeLessThan(dealt[1]);
    expect(dealt[RAIL_PIERCE]).toBe(0);
    expect(dealt[RAIL_PIERCE + 1]).toBe(0);
  });

  it('a charge breaks when the carrier takes a beating, loses its energy and rests', () => {
    const { sim, gun, targets } = line(2, 2);
    sim.weapon.f.target[gun] = sim.world.handle(targets[0]);
    tick(sim, 10);
    expect(sim.rails.has(gun)).toBe(true);
    sim.damage(gun, Math.ceil(sim.stats(gun).hp * 0.2), 2);
    tick(sim, 1);
    expect(sim.rails.has(gun)).toBe(false);
    expect(sim.charge.has(gun)).toBe(false);
    expect(sim.weapon.f.cooldown[gun]).toBeGreaterThan(0);
    tick(sim, RAIL_CHARGE_TICKS + 5);
    expect(sim.health.f.hp[targets[0]]).toBe(10000);
  });

  it('a stun breaks the charge; so does losing the target', () => {
    const a = line(2, 2);
    a.sim.weapon.f.target[a.gun] = a.sim.world.handle(a.targets[0]);
    tick(a.sim, 10);
    a.sim.stun(a.gun, 20);
    tick(a.sim, 1);
    expect(a.sim.rails.has(a.gun)).toBe(false);
    const b = line(2, 2);
    b.sim.weapon.f.target[b.gun] = b.sim.world.handle(b.targets[0]);
    tick(b.sim, 10);
    b.sim.health.f.hp[b.targets[0]] = 0;
    tick(b.sim, 1);
    expect(b.sim.rails.has(b.gun)).toBe(false);
  });

  it('does not hurt its own side and `charging(h)` is visible while it charges', () => {
    const { sim, gun, targets } = line(2, 2);
    const friend = sim.spawnUnit(sim.blueprints.define(1, 'Friend', DUMMY), at(13), at(15));
    const fhp = sim.health.f.hp[friend];
    sim.weapon.f.target[gun] = sim.world.handle(targets[0]);
    tick(sim, 3);
    expect(sim.charge.has(gun)).toBe(true);
    tick(sim, RAIL_CHARGE_TICKS + 2);
    expect(sim.health.f.hp[friend]).toBe(fhp);
    expect(10000 - sim.health.f.hp[targets[0]]).toBeGreaterThan(0);
  });

  it('rock stops the line', () => {
    const { sim, gun, targets } = line(2, 4);
    for (let y = 10; y <= 20; y++) {
      sim.terrain.passable[y * sim.terrain.width + 13] = 0;
      sim.terrain.heights[y * sim.terrain.width + 13] = 3;
    }
    sim.terrain.version++;
    sim.weapon.f.target[gun] = sim.world.handle(targets[0]);
    tick(sim, RAIL_CHARGE_TICKS + 5);
    expect(sim.health.f.hp[targets[0]]).toBe(10000);
  });
});

describe('ion gun', () => {
  const ION = ['chassis.medium', 'cpu.basic', 'ion.gun', 'battery.cell', 'battery.cell'];
  const TARGET = ['chassis.heavy', 'cpu.basic', 'motor.large', 'gun.light', 'battery.cell'];

  function duel(aim = 0) {
    const sim = new Simulation({ width: 40, height: 30, seed: 4 });
    const gun = sim.spawnUnit(sim.blueprints.define(1, 'Ion', ION), at(10), at(15));
    fill(sim, gun);
    const t = sim.spawnUnit(sim.blueprints.define(2, 'Target', TARGET), at(15), at(15));
    fill(sim, t);
    sim.weapon.f.aim[gun] = aim;
    sim.weapon.f.target[gun] = sim.world.handle(t);
    return { sim, gun, t };
  }

  it('holds the aimed module down for ION_TICKS, then it works again, then the target is immune for a while', () => {
    const { sim, gun, t } = duel(SLOT_CODES.weapon);
    expect(sim.stats(t).weapon).not.toBeNull();
    const e0 = sim.energy.f.amount[gun];
    tick(sim, 1);
    expect(sim.stats(t).weapon).toBeNull(); // the gun was held down
    expect(sim.stats(t).speed).toBeGreaterThan(0); // the motor was not
    expect(sim.energy.f.amount[gun]).toBeLessThanOrEqual(e0 - sim.stats(gun).weapon!.use + 5);
    tick(sim, ION_TICKS + 1);
    expect(sim.stats(t).weapon).not.toBeNull();
    // inside the immunity window a second bolt is wasted
    sim.weapon.f.cooldown[gun] = 0;
    tick(sim, 1);
    expect(sim.stats(t).weapon).not.toBeNull();
    tick(sim, ION_IMMUNITY_TICKS + 1);
    sim.weapon.f.cooldown[gun] = 0;
    tick(sim, 1);
    expect(sim.stats(t).weapon).toBeNull();
  });

  it('with nothing aimed it picks a random working switchable module, never a passive one', () => {
    const { sim, t } = duel(0);
    tick(sim, 1);
    const bp = sim.blueprintOf(t)!;
    const mask = sim.modules.f.ion[t];
    expect(mask).not.toBe(0);
    for (let i = 0; i < bp.parts.length; i++) if ((mask >>> i) & 1) expect(['cpu', 'motor', 'weapon']).toContain(bp.parts[i].split('.')[0] === 'gun' ? 'weapon' : bp.parts[i].split('.')[0]);
    expect(sim.ionActive.has(t)).toBe(true);
  });

  it('a held-down motor stops the unit; a script cannot switch it back on', () => {
    const { sim, t } = duel(SLOT_CODES.motor);
    tick(sim, 1);
    expect(sim.stats(t).speed).toBe(0);
    const bp = sim.blueprintOf(t)!;
    const motor = bp.parts.indexOf('motor.large');
    expect(sim.setModule(t, motor, true, true)).toBe(false);
  });

  it('an enemy shield stops the bolt and loses a flat amount of energy', () => {
    const { sim, gun, t } = duel(0);
    const shieldBp = sim.blueprints.define(2, 'Shielded', ['chassis.heavy', 'cpu.basic', 'shield.emitter', 'battery.cell', 'battery.cell']);
    const s = sim.spawnUnit(shieldBp, at(16), at(15));
    fill(sim, s);
    setShieldAngle(sim, s, 180);
    sim.weapon.f.target[gun] = -1;
    tick(sim, 30);
    sim.weapon.f.target[gun] = sim.world.handle(t);
    sim.weapon.f.cooldown[gun] = 0;
    const before = sim.energy.f.amount[s];
    tick(sim, 1);
    expect(sim.modules.f.ion[t]).toBe(0);
    expect(before - sim.energy.f.amount[s]).toBeGreaterThanOrEqual(ION_SHIELD_DRAIN - SHIELD_ENERGY_PER_DAMAGE);
  });
});

describe('drone bay', () => {
  const CARRIER = ['chassis.heavy', 'cpu.basic', 'motor.large', 'hangar.bay', 'cargo.hold', 'battery.large'];
  const DRONE = ['chassis.light', 'cpu.basic', 'rotor', 'gun.light'];

  function carrier() {
    const sim = new Simulation({ width: 40, height: 30, seed: 6 });
    const drone = sim.blueprints.define(1, 'Wasp', DRONE);
    const c = sim.spawnUnit(sim.blueprints.define(1, 'Hive', CARRIER), at(10), at(15));
    fill(sim, c);
    sim.cargo.f.amount[c] = 200;
    return { sim, c, drone };
  }

  it('only accepts small unit classes, builds drones up to capacity and no further, paying matter and energy', () => {
    const { sim, c, drone } = carrier();
    sim.blueprints.define(1, 'Tank', ['chassis.heavy', 'cpu.basic']);
    expect(setDroneClass(sim, c, 'Tank')).toBe(false);
    expect(setDroneClass(sim, c, 'Nothing')).toBe(false);
    expect(setDroneClass(sim, c, 'Wasp')).toBe(true);
    const matter0 = sim.cargo.f.amount[c];
    tick(sim, drone.stats.buildTime * 2 + 20);
    const bay = sim.bays.get(c)!;
    expect(bay.docked.length).toBe(1);
    expect(sim.cargo.f.amount[c]).toBeLessThan(matter0);
    tick(sim, drone.stats.buildTime * 4 + 40);
    expect(bay.docked.length).toBe(DRONE_BAY_CAPACITY);
    expect(sim.hangar.f.docked[c]).toBe(DRONE_BAY_CAPACITY);
    const units = sim.unit.dense.length;
    tick(sim, 100);
    expect(sim.unit.dense.length).toBe(units); // docked drones are not entities
    expect(bay.docked.length).toBe(DRONE_BAY_CAPACITY);
  });

  it('launches real drones one at a time and docks them again when recalled', () => {
    const { sim, c } = carrier();
    setDroneClass(sim, c, 'Wasp');
    tick(sim, 600);
    const bay = sim.bays.get(c)!;
    expect(bay.docked.length).toBe(DRONE_BAY_CAPACITY);
    const before = sim.unit.dense.length;
    expect(launchDrones(sim, c)).toBe(DRONE_BAY_CAPACITY);
    tick(sim, 1);
    expect(bay.out.length).toBe(1);
    expect(sim.unit.dense.length).toBe(before + 1);
    tick(sim, 10);
    expect(bay.out.length).toBe(DRONE_BAY_CAPACITY);
    expect(bay.docked.length).toBe(0);
    expect(recallDrones(sim, c)).toBe(DRONE_BAY_CAPACITY);
    tick(sim, 200);
    expect(bay.docked.length).toBe(DRONE_BAY_CAPACITY);
    expect(bay.out.length).toBe(0);
    expect(sim.unit.dense.length).toBe(before);
  });

  it('docked drones are mended and recharged; they die with the carrier, launched ones do not', () => {
    const { sim, c } = carrier();
    setDroneClass(sim, c, 'Wasp');
    tick(sim, 600);
    const bay = sim.bays.get(c)!;
    bay.docked[0].hp = 1;
    bay.docked[0].energy = 0;
    tick(sim, 30);
    expect(bay.docked[0].hp).toBeGreaterThan(1);
    expect(bay.docked[0].energy).toBeGreaterThan(0);
    launchDrones(sim, c);
    tick(sim, 3);
    const out = sim.world.resolve(bay.out[0]);
    expect(out).toBeGreaterThanOrEqual(0);
    sim.health.f.hp[c] = 0;
    tick(sim, 2);
    expect(sim.bays.has(c)).toBe(false);
    expect(sim.world.isAlive(out)).toBe(true);
  });
});

describe('Hive program', () => {
  it('launches its Wasps at an enemy 12 tiles away and they hurt it', () => {
    const sim = new Simulation({ width: 60, height: 40, seed: 3 });
    defineClass(sim, 1, WASP_CLASS);
    const hive = sim.spawnUnit(defineClass(sim, 1, HIVE_CLASS), at(10), at(20));
    const foe = sim.spawnUnit(defineClass(sim, 2, SCOUT_CLASS), at(22), at(20));
    sim.health.f.hp[foe] = 100000;
    sim.cargo.f.amount[hive] = 400;
    sim.commit();
    expect(fillBay(sim, hive)).toBe(true);
    tick(sim, 200);
    expect(sim.health.f.hp[foe]).toBeLessThan(100000);
  });
});
