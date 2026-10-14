import { describe, expect, it } from 'vitest';
import {
  BUILDER_ENERGY_RESERVE,
  DECAY_TICKS,
  Simulation,
  TESLA_STUN_TICKS,
  TILE,
  buildEnergyCost,
  powerLinks,
  type PowerNode,
} from '../src';

const at = (tiles: number) => tiles * TILE + TILE / 2;

function run(sim: Simulation, ticks: number): void {
  for (let t = 0; t < ticks; t++) {
    sim.step();
    sim.commit();
  }
}

const newSim = () => new Simulation({ width: 40, height: 40, seed: 1 });
const SCOUT = ['chassis.light', 'cpu.basic', 'motor.small', 'sensor.short', 'gun.light'];

describe('tesla coil', () => {
  it('stuns everything in range, friend or foe, and a carrying vehicle for half as long', () => {
    const sim = newSim();
    const bp = sim.blueprints.define(1, 'Tesla', ['chassis.medium', 'cpu.basic', 'motor.small', 'tesla.coil', 'battery.cell']);
    const scout = sim.blueprints.define(2, 'Scout', SCOUT);
    const friend = sim.blueprints.define(1, 'Friend', SCOUT);
    const far = sim.blueprints.define(2, 'Far', SCOUT);
    const tesla = sim.spawnUnit(bp, at(10), at(10));
    const enemy = sim.spawnUnit(scout, at(11), at(10));
    const ally = sim.spawnUnit(friend, at(10), at(11));
    const distant = sim.spawnUnit(far, at(30), at(30));
    sim.weapon.f.target[tesla] = sim.world.handle(enemy);
    sim.step();
    sim.commit();
    expect(sim.stunUntil[enemy]).toBe(sim.tick - 1 + TESLA_STUN_TICKS);
    expect(sim.stunUntil[ally]).toBeGreaterThan(sim.tick);
    expect(sim.stunUntil[tesla]).toBe(sim.tick - 1 + TESLA_STUN_TICKS / 2);
    expect(sim.stunUntil[distant]).toBe(0);
  });

  it('recharges slowly between discharges', () => {
    const sim = newSim();
    const bp = sim.blueprints.define(1, 'Tesla', ['frame.small', 'cpu.basic', 'tesla.coil', 'battery.bank']);
    const scout = sim.blueprints.define(2, 'Scout', SCOUT);
    const tesla = sim.spawnStructure(bp, 10, 10);
    const enemy = sim.spawnUnit(scout, at(11), at(10));
    sim.weapon.f.target[tesla] = sim.world.handle(enemy);
    run(sim, 1);
    const first = sim.stunUntil[enemy];
    run(sim, 20);
    expect(sim.stunUntil[enemy]).toBe(first);
  });
});

describe('cannon', () => {
  it('spends carried matter per shot and does not fire without any', () => {
    const sim = newSim();
    const cannon = sim.blueprints.define(1, 'Cannon', ['chassis.medium', 'cpu.basic', 'cargo.bay', 'gun.cannon', 'battery.cell']);
    const target = sim.blueprints.define(2, 'Target', SCOUT);
    const e = sim.spawnUnit(cannon, at(10), at(10));
    const t = sim.spawnUnit(target, at(13), at(10));
    sim.weapon.f.target[e] = sim.world.handle(t);
    const hp = sim.health.f.hp[t];
    run(sim, 30);
    expect(sim.health.f.hp[t]).toBe(hp);
    sim.cargo.f.amount[e] = 9;
    run(sim, 1);
    expect(sim.cargo.f.amount[e]).toBe(6);
    expect(sim.health.f.hp[t]).toBeLessThan(hp);
  });
});

describe('building energy', () => {
  const builderParts = ['chassis.medium', 'cpu.basic', 'motor.large', 'build.arm', 'cargo.bay', 'battery.cell'];

  it('is paid by an off-grid builder, in proportion to the matter invested', () => {
    const sim = newSim();
    const builder = sim.blueprints.define(1, 'Builder', builderParts);
    const house = sim.blueprints.define(1, 'Small', ['frame.small', 'cpu.basic']);
    const b = sim.spawnUnit(builder, at(10), at(10));
    const site = sim.spawnStructure(house, 11, 10, 1, false);
    sim.cargo.f.amount[b] = 40;
    sim.builder.f.target[b] = sim.world.handle(site);
    const before = sim.energy.f.amount[b];
    run(sim, 1);
    const matter = sim.invested[site];
    expect(matter).toBeGreaterThan(0);
    expect(before - sim.energy.f.amount[b]).toBeGreaterThanOrEqual(Math.floor((matter * buildEnergyCost(1)) / house.stats.cost));
  });

  it('stops at the reserve so the builder can still reach a charger', () => {
    const sim = newSim();
    const builder = sim.blueprints.define(1, 'Builder', builderParts);
    const house = sim.blueprints.define(1, 'Small', ['frame.small', 'cpu.basic']);
    const b = sim.spawnUnit(builder, at(10), at(10));
    const site = sim.spawnStructure(house, 11, 10, 1, false);
    sim.cargo.f.amount[b] = 40;
    sim.builder.f.target[b] = sim.world.handle(site);
    const reserve = Math.floor(builder.stats.energyCapacity * BUILDER_ENERGY_RESERVE);
    sim.energy.f.amount[b] = reserve;
    run(sim, 5);
    expect(sim.invested[site]).toBe(0);
  });
});

describe('decay', () => {
  it('turns a unit without energy into a matter block worth its cost', () => {
    const sim = newSim();
    const bp = sim.blueprints.define(1, 'Drone', ['chassis.light', 'cpu.basic', 'motor.small']);
    const e = sim.spawnUnit(bp, at(10), at(10));
    sim.energy.f.amount[e] = 0;
    run(sim, DECAY_TICKS - 1);
    expect(sim.world.isAlive(e)).toBe(true);
    run(sim, 2);
    expect(sim.world.isAlive(e)).toBe(false);
    const blocks = sim.world.query(sim.resource.def);
    expect([...blocks].some((r) => sim.resource.f.amount[r] === bp.stats.cost)).toBe(true);
    expect(sim.tally(1).lostUnits).toBe(1);
  });

  it('is cancelled by recharging', () => {
    const sim = newSim();
    const bp = sim.blueprints.define(1, 'Drone', ['chassis.light', 'cpu.basic', 'motor.small']);
    const e = sim.spawnUnit(bp, at(10), at(10));
    sim.energy.f.amount[e] = 0;
    run(sim, DECAY_TICKS - 5);
    sim.energy.f.amount[e] = 100;
    run(sim, 20);
    expect(sim.world.isAlive(e)).toBe(true);
  });
});

describe('power links', () => {
  const node = (e: number, x: number, site = false): PowerNode => ({ e, owner: 1, x, y: 0, size: 1, reach: 3, site });

  it('keeps a tree and never bridges through a construction site', () => {
    // 0 -- 1(site) -- 2: the site sits between two buildings that are otherwise out of reach
    const nodes = [node(0, 0), node(1, 3, true), node(2, 6)];
    const links = powerLinks(nodes);
    expect(links.every(([a, b]) => nodes[a].site !== true || nodes[b].site !== true)).toBe(true);
    const joined = (a: number, b: number) => links.some(([i, j]) => (i === a && j === b) || (i === b && j === a));
    expect(joined(0, 2)).toBe(false);
  });

  it('hangs a site off its nearest finished building only', () => {
    const nodes = [node(0, 0), node(1, 2), node(2, 3, true)];
    const siteLinks = powerLinks(nodes).filter(([a, b]) => a === 2 || b === 2);
    expect(siteLinks).toHaveLength(1);
  });

  it('uses fewer links than a full mesh', () => {
    const nodes = [node(0, 0), node(1, 1), node(2, 2), node(3, 3)];
    expect(powerLinks(nodes)).toHaveLength(3);
  });
});

describe('scoreboard tallies', () => {
  it('counts creations, losses and kills, and scores resources plus owned cost', () => {
    const sim = newSim();
    const laser = sim.blueprints.define(1, 'Turret', ['frame.small', 'cpu.basic', 'laser.beam', 'battery.bank']);
    const victim = sim.blueprints.define(2, 'Victim', ['chassis.light', 'cpu.basic']);
    const turret = sim.spawnStructure(laser, 10, 10);
    const v = sim.spawnUnit(victim, at(14), at(10));
    expect(sim.tally(1).createdBuildings).toBe(1);
    expect(sim.tally(2).createdUnits).toBe(1);
    expect(sim.score(1)).toBe(laser.stats.cost);
    sim.weapon.f.target[turret] = sim.world.handle(v);
    run(sim, 60);
    expect(sim.world.isAlive(v)).toBe(false);
    expect(sim.tally(1).destroyedUnits).toBe(1);
    expect(sim.tally(2).lostUnits).toBe(1);
    expect(sim.score(2)).toBe(0);
  });
});

describe('factory scripts', () => {
  it('queue units themselves with queueUnit()', () => {
    const sim = newSim();
    sim.blueprints.define(1, 'Drone', ['chassis.light', 'cpu.basic', 'motor.small']);
    const fac = sim.blueprints.define(1, 'Factory', ['frame.medium', 'cpu.basic', 'factory.basic', 'silo']);
    sim.setProgram(fac.id, 'if queueLength() == 0 { queueUnit(0) }');
    const b = sim.spawnStructure(fac, 10, 10);
    sim.stockpile.f.amount[b] = 500;
    run(sim, 3);
    expect(sim.productionQueue[b]?.length).toBeGreaterThan(0);
    expect(sim.stockpile.f.amount[b]).toBeLessThan(500);
  });
});

describe('storage discharge', () => {
  it('is limited to a share of capacity per tick', () => {
    const sim = newSim();
    sim.tick = 700; // night
    const storeBp = sim.blueprints.define(1, 'Store', ['frame.medium', 'cpu.basic', 'battery.bank', 'battery.bank']);
    sim.setProgram(storeBp.id, 'storageMode(DISCHARGE)\nsleep(4)');
    const sink = sim.blueprints.define(1, 'Sink', ['frame.small', 'battery.bank']);
    const store = sim.spawnStructure(storeBp, 2, 2);
    const consumer = sim.spawnStructure(sink, 4, 2, 0);
    run(sim, 3);
    const perTick = Math.ceil(storeBp.stats.energyCapacity * 0.02);
    expect(sim.energy.f.amount[consumer]).toBeLessThanOrEqual(perTick * 3);
    expect(sim.energy.f.amount[consumer]).toBeGreaterThan(0);
    void store;
  });
});

describe('design upload', () => {
  const parts = ['chassis.light', 'cpu.basic', 'motor.small'];

  it('merging leaves classes the set does not mention, replacing retires them', () => {
    const sim = newSim();
    const a = sim.blueprints.define(1, 'A', parts);
    const b = sim.blueprints.define(1, 'B', parts);
    sim.loadDesigns(1, [{ name: 'A', parts, program: '', retired: false }], 40, true);
    expect(b.retired).toBe(false);
    sim.loadDesigns(1, [{ name: 'A', parts, program: '', retired: false }], 40, false);
    expect(a.retired).toBe(false);
    expect(b.retired).toBe(true);
  });
});

describe('transmission losses', () => {
  const supplyWith = (sinkX: number | undefined): number => {
    const sim = newSim();
    sim.tick = 300; // midday
    const solar = sim.blueprints.define(1, 'Solar', ['frame.medium', ...Array(8).fill('solar.panel')]);
    const sink = sim.blueprints.define(1, 'Sink', ['frame.small', 'battery.cell']);
    const gen = sim.spawnStructure(solar, 2, 2);
    if (sinkX !== undefined) sim.spawnStructure(sink, sinkX, 2, 0);
    run(sim, 1);
    return sim.networkFor(gen)!.supply;
  };

  it('costs a share of generation per tile of link gap, and nothing for touching buildings', () => {
    expect(supplyWith(undefined)).toBe(4);
    expect(supplyWith(4)).toBe(4); // touching: no gap
    expect(supplyWith(5)).toBeLessThan(4); // one tile apart
  });
});
