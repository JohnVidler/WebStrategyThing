import { describe, expect, it } from 'vitest';
import {
  applyTick,
  CORNERS,
  compileUnitProgram,
  CpuState,
  createMatch,
  createMapTerrain,
  defineClass,
  HARVESTER_CLASS,
  MAPS,
  SCOUT_CLASS,
  encodeTick,
  findPath,
  GAME_COMPONENTS,
  Interest,
  Resource,
  RESOURCE_REGEN_INTERVAL_TICKS,
  visibleTo,
  Position,
  Simulation,
  StorageMode,
  TaskFlag,
  TaskType,
  Terrain,
  TILE,
  Unit,
  World,
  setUpPlayer,
  testRun,
  type ComponentDef,
} from '../src';
import { prog } from './helpers';

const at = (tiles: number) => tiles * TILE + TILE / 2;
const tileOf = (sim: Simulation, e: number) => [Math.floor(sim.pos.f.x[e] / TILE), Math.floor(sim.pos.f.y[e] / TILE)];

function run(sim: Simulation, ticks: number): void {
  for (let t = 0; t < ticks; t++) {
    sim.step();
    sim.commit();
  }
}

/** 24×24 map with a wall at x = 12 for y = 0..17 (gap at the bottom). */
function walledSim(): Simulation {
  const terrain = new Terrain(24, 24);
  for (let y = 0; y < 18; y++) terrain.passable[y * 24 + 12] = 0;
  return new Simulation({ width: 24, height: 24, seed: 3 }, terrain);
}

const MOVER = prog(`on(Order, { types: [MOVE], urgent: REPLACE }, (type, tx, ty) => {
  goTo(tx, ty);
});`);

/** Nearest free 1×1 spot well beyond any building's link reach (so it stays unlinked). */
function freeSpot(sim: Simulation, x: number, y: number): [number, number] {
  for (let r = 0; r < 20; r++) {
    for (let j = y - r; j <= y + r; j++) {
      for (let i = x - r; i <= x + r; i++) {
        if (!sim.terrain.footprintFree(i, j, 1)) continue;
        if (sim.unit.dense.some((e) => sim.stats(e).structure && Math.abs(sim.footprintOf(e).x - i) < 15 && Math.abs(sim.footprintOf(e).y - j) < 15)) continue;
        return [i, j];
      }
    }
  }
  throw new Error("no free spot");
}

function makeMatch(seed = 42) {
  const sim = createMatch(seed);
  setUpPlayer(sim, 1, CORNERS[0], 500);
  setUpPlayer(sim, 2, CORNERS[1], 500);
  const own = (owner: number, name: string) =>
    sim.unit.dense.filter((e) => sim.unit.f.owner[e] === owner && sim.blueprintOf(e)!.name === name);
  return { sim, own, cls: (owner: number, name: string) => sim.blueprints.find(owner, name)! };
}

describe('terrain and movement', () => {
  it('creates every selectable map deterministically with a clear player start', () => {
    for (const map of MAPS) {
      const sim = createMatch(0x5eed, map.id);
      const terrain = createMapTerrain(map.id);
      expect(sim.config.width).toBe(map.width);
      expect(sim.config.height).toBe(map.height);
      expect(terrain.isPassable(8, 9)).toBe(true);
      expect(terrain.encode()).toBe(createMapTerrain(map.id).encode());
      for (const e of sim.unit.dense) {
        expect(terrain.isPassable(Math.floor(sim.pos.f.x[e] / TILE), Math.floor(sim.pos.f.y[e] / TILE))).toBe(true);
      }
    }
    expect(new Set(MAPS.map((map) => `${map.width}x${map.height}`)).size).toBeGreaterThan(1);
  });

  it('lays out every map symmetrically, so no corner has a shortcut the others lack', () => {
    for (const map of MAPS) {
      const t = createMapTerrain(map.id);
      for (let y = 0; y < t.height; y++) {
        for (let x = 0; x < t.width; x++) {
          const here = t.isPassable(x, y);
          expect(t.isPassable(t.width - 1 - x, y)).toBe(here);
          expect(t.isPassable(x, t.height - 1 - y)).toBe(here);
        }
      }
    }
  });

  it('finds paths around obstacles', () => {
    const t = walledSim().terrain;
    const path = findPath(t, 2, 2, 20, 2);
    expect(path.slice(-2)).toEqual([20, 2]);
    let [x, y] = [2 * TILE + TILE / 2, 2 * TILE + TILE / 2];
    for (let i = 0; i < path.length; i += 2) {
      const nx = path[i] * TILE + TILE / 2;
      const ny = path[i + 1] * TILE + TILE / 2;
      expect(t.lineWalkable(x, y, nx, ny)).toBe(true);
      [x, y] = [nx, ny];
    }
  });

  it('ground units walk around walls; flying units fly over and land on passable cells', () => {
    const sim = walledSim();
    const walker = sim.blueprints.define(1, 'Walker', ['chassis.light', 'cpu.basic', 'motor.small']);
    const flyer = sim.blueprints.define(1, 'Flyer', ['chassis.light', 'cpu.basic', 'rotor']);
    sim.setProgram(walker.id, MOVER);
    sim.setProgram(flyer.id, MOVER);
    const w = sim.spawnUnit(walker, at(2), at(2));
    const f = sim.spawnUnit(flyer, at(2), at(4));
    sim.issueOrder(1, w, 20, 2, -1, false);
    sim.issueOrder(1, f, 12, 4, -1, false); // onto the wall
    let maxY = 0;
    for (let i = 0; i < 400; i++) {
      run(sim, 1);
      maxY = Math.max(maxY, tileOf(sim, w)[1]);
      const [x, y] = tileOf(sim, w);
      expect(sim.terrain.walkable(x, y)).toBe(true);
    }
    expect(tileOf(sim, w)).toEqual([20, 2]);
    expect(maxY).toBeGreaterThanOrEqual(18); // went round the bottom of the wall
    const [fx, fy] = tileOf(sim, f);
    expect(sim.terrain.walkable(fx, fy)).toBe(true);
    expect(Math.abs(fx - 12)).toBe(1);
    expect(fy).toBe(4);
  });

  it('pushes overlapping units apart and keeps them off buildings', () => {
    const sim = new Simulation({ width: 16, height: 16, seed: 1 });
    const bp = sim.blueprints.define(1, 'Blob', ['chassis.light', 'motor.small']);
    const a = sim.spawnUnit(bp, at(5), at(5));
    const b = sim.spawnUnit(bp, at(5), at(5));
    run(sim, 10);
    expect(Math.sqrt(sim.distSq(a, b))).toBeGreaterThan(0.5 * TILE);

    const pad = sim.blueprints.define(1, 'Block', ['frame.medium']);
    sim.spawnStructure(pad, 8, 8);
    const c = sim.spawnUnit(bp, at(8), at(8));
    const [x, y] = tileOf(sim, c);
    expect(sim.terrain.walkable(x, y)).toBe(true);
  });
});

describe('energy and power', () => {
  it('units without energy cannot think or move; charging pads refill only nearby own units', () => {
    const sim = new Simulation({ width: 20, height: 20, seed: 1 });
    const bot = sim.blueprints.define(1, 'Bot', ['chassis.light', 'cpu.basic', 'motor.small']);
    sim.setProgram(bot.id, MOVER);
    const pad = sim.blueprints.define(1, 'Pad', ['frame.small', 'charger.pad', 'battery.cell']);
    const p = sim.spawnStructure(pad, 5, 5);
    const near = sim.spawnUnit(bot, at(6), at(5));
    const far = sim.spawnUnit(bot, at(15), at(15));
    sim.energy.f.amount[near] = 0;
    sim.energy.f.amount[far] = 0;
    sim.issueOrder(1, far, 18, 18, -1, false);
    run(sim, 3);
    expect(sim.cpu.f.state[far]).toBe(CpuState.NoPower);
    expect(tileOf(sim, far)).toEqual([15, 15]);
    expect(sim.energy.f.amount[near]).toBeGreaterThan(0);
    expect(sim.energy.f.amount[p]).toBeLessThan(pad.stats.energyCapacity);
  });

  it('links nearby buildings into networks (antennas extend reach) and shares generation', () => {
    const sim = new Simulation({ width: 40, height: 40, seed: 1 });
    sim.tick = 300; // midday
    const solar = sim.blueprints.define(1, 'Solar', ['frame.medium', ...Array(8).fill('solar.panel')]);
    const sink = sim.blueprints.define(1, 'Sink', ['frame.small', 'battery.cell']);
    const pylon = sim.blueprints.define(1, 'Pylon', ['frame.small', 'antenna.large']);
    sim.spawnStructure(solar, 2, 2);
    const linked = sim.spawnStructure(sink, 5, 2, 0); // 1-tile gap: linked
    const viaPylon = sim.spawnStructure(sink, 20, 2, 0);
    const alone = sim.spawnStructure(sink, 30, 30, 0);
    sim.spawnStructure(pylon, 12, 2);
    run(sim, 20);
    expect(sim.energy.f.amount[linked]).toBeGreaterThan(0);
    expect(sim.energy.f.amount[viaPylon]).toBeGreaterThan(0);
    expect(sim.energy.f.amount[alone]).toBe(0);
    expect(sim.networkFor(linked)).toBe(sim.networkFor(viaPylon));
    expect(sim.networkFor(alone)).not.toBe(sim.networkFor(linked));
  });

  it('caps long antenna links by antenna count and building size, but not short links', () => {
    const throughput = (pylonParts: string[], pylonFrame = 'frame.small') => {
      const sim = new Simulation({ width: 40, height: 40, seed: 1 });
      sim.tick = 300; // midday
      const solar = sim.blueprints.define(1, 'Solar', ['frame.large', ...Array(20).fill('solar.panel')]);
      const sink = sim.blueprints.define(1, 'Sink', ['frame.small', 'battery.cell']);
      const pylon = sim.blueprints.define(1, 'Pylon', [pylonFrame, ...pylonParts]);
      sim.spawnStructure(solar, 2, 2);
      const near = sim.spawnStructure(sink, 5, 2, 0); // short link: uncapped
      const far = sim.spawnStructure(sink, 5, 12, 0); // reached over a long link through the pylon
      sim.spawnStructure(pylon, 5, 7);
      run(sim, 1);
      return { near: sim.energy.f.amount[near], far: sim.energy.f.amount[far], sim };
    };
    const one = throughput(['antenna.large']);
    expect(one.near).toBeGreaterThan(20); // not capped
    expect(one.far).toBeGreaterThan(0);
    expect(one.far).toBeLessThanOrEqual(20);
    const two = throughput(['antenna.large', 'antenna.large']);
    expect(two.far).toBeGreaterThan(one.far);
    expect(two.far).toBeLessThanOrEqual(40);
    const big = throughput(['antenna.large'], 'frame.medium');
    expect(big.far).toBeGreaterThan(one.far);
    expect(big.far).toBeLessThanOrEqual(40);
  });

  it('counts only what consumers actually received as delivered', () => {
    const sim = new Simulation({ width: 20, height: 20, seed: 1 });
    sim.tick = 300;
    const solar = sim.blueprints.define(1, 'Solar', ['frame.medium', ...Array(8).fill('solar.panel')]);
    const sink = sim.blueprints.define(1, 'Sink', ['frame.small', 'battery.cell']);
    const gen = sim.spawnStructure(solar, 2, 2);
    sim.spawnStructure(sink, 5, 2, 0);
    run(sim, 1);
    const net = sim.networkFor(gen)!;
    expect(net.delivered).toBeGreaterThan(0);
    expect(net.delivered).toBeLessThanOrEqual(net.supply);
    expect(net.demand).toBeGreaterThan(net.delivered - 1);
  });

  it('records the energy each member took from or gave to its network', () => {
    const sim = new Simulation({ width: 20, height: 20, seed: 1 });
    sim.tick = 300; // midday
    const solar = sim.blueprints.define(1, 'Solar', ['frame.medium', ...Array(8).fill('solar.panel')]);
    const sink = sim.blueprints.define(1, 'Sink', ['frame.small', 'battery.cell']);
    const gen = sim.spawnStructure(solar, 2, 2);
    const a = sim.spawnStructure(sink, 5, 2, 0);
    const b = sim.spawnStructure(sink, 7, 2, 0);
    run(sim, 1);
    const net = sim.networkFor(gen)!;
    const flowOf = (e: number) => net.flow[net.members.indexOf(e)];
    expect(flowOf(gen)).toBeLessThan(0);
    expect(flowOf(a)).toBeGreaterThan(0);
    expect(flowOf(b)).toBeGreaterThan(0);
    expect(net.flow.reduce((x, y) => x + y, 0)).toBe(0);
  });

  it('storage scripts decide when to charge and discharge', () => {
    const sim = new Simulation({ width: 20, height: 20, seed: 1 });
    sim.tick = 700; // night: no solar
    const storeBp = sim.blueprints.define(1, 'Store', ['frame.medium', 'cpu.basic', 'battery.bank', 'battery.bank']);
    sim.setProgram(storeBp.id, prog(`on(Idle, () => {
  if (netSupply() >= netDemand()) {
    config.storageMode(CHARGE_STORE);
  } else {
    config.storageMode(DISCHARGE);
  }
});`));
    const sink = sim.blueprints.define(1, 'Sink', ['frame.small', 'battery.cell']);
    const store = sim.spawnStructure(storeBp, 2, 2, 0.5);
    const consumer = sim.spawnStructure(sink, 4, 2, 0);
    const before = sim.energy.f.amount[store];
    run(sim, 2);
    expect(sim.storage.f.mode[store]).toBe(StorageMode.Discharge); // night, consumer empty: give power
    run(sim, 10); // discharge is rate-limited (STORAGE_DISCHARGE_FRACTION), so filling takes a few ticks
    expect(sim.energy.f.amount[consumer]).toBe(sink.stats.energyCapacity);
    expect(sim.energy.f.amount[store]).toBeLessThan(before);
    expect(sim.storage.f.mode[store]).toBe(StorageMode.Charge); // demand met: back to soaking up surplus
  });

  it('energy transfers need the full amount in hand and respect unit/building reach', () => {
    const sim = new Simulation({ width: 20, height: 20, seed: 1 });
    const bot = sim.blueprints.define(1, 'Bot', ['chassis.light', 'motor.small']);
    const pad = sim.blueprints.define(1, 'Pad', ['frame.small', 'battery.cell']);
    const giver = sim.spawnUnit(bot, at(5), at(5));
    const near = sim.spawnUnit(bot, at(6), at(5));
    const far = sim.spawnUnit(bot, at(8), at(5));
    sim.energy.f.amount[giver] = 100;
    sim.energy.f.amount[near] = 0;
    sim.energy.f.amount[far] = 0;
    expect(sim.transferEnergy(giver, near, 200)).toBe(0); // doesn't have that much
    expect(sim.transferEnergy(giver, near, 60)).toBe(60);
    expect(sim.transferEnergy(giver, far, 10)).toBe(0); // 3 tiles: beyond unit reach
    const b = sim.spawnStructure(pad, 10, 5);
    expect(sim.transferEnergy(b, far, 10)).toBe(10); // building reach is longer
    expect([sim.energy.f.amount[giver], sim.energy.f.amount[near]]).toEqual([40, 60]);
  });

  it('CPU energy follows the work done; a unit with nothing to do costs nothing', () => {
    const sim = new Simulation({ width: 20, height: 20, seed: 1 });
    const busy = sim.blueprints.define(1, 'Busy', ['chassis.light', 'cpu.fast']);
    const lazy = sim.blueprints.define(1, 'Lazy', ['chassis.light', 'cpu.fast']);
    const idle = sim.blueprints.define(1, 'Idle', ['chassis.light', 'cpu.fast']);
    // Busy always has a handler running; Lazy rests after one pass; Idle has no handler for anything that happens.
    sim.setProgram(busy.id, prog('let i = 0;\non(Idle, () => {\n  i = 0;\n  while (i < 300) {\n    i = i + 1;\n  }\n});'));
    sim.setProgram(lazy.id, prog('on(Idle, () => {\n  config.rest(600);\n});'));
    sim.setProgram(idle.id, prog('on(Order, () => {});'));
    const [b, l, y] = [busy, lazy, idle].map((bp, i) => sim.spawnUnit(bp, at(2 + i * 3), at(2)));
    run(sim, 100);
    const full = busy.stats.energyCapacity;
    expect(full - sim.energy.f.amount[b]).toBeGreaterThanOrEqual(55); // about 60 cycles/tick × 100 ticks / 100
    expect(full - sim.energy.f.amount[b]).toBeLessThanOrEqual(62);
    expect(sim.energy.f.amount[l]).toBe(full); // one short pass, then it rests
    expect(sim.energy.f.amount[y]).toBe(full); // events nobody handles cost nothing
  });

  it('a group ordered to one point spreads over free tiles near it', () => {
    const sim = new Simulation({ width: 20, height: 20, seed: 1 });
    const bot = sim.blueprints.define(1, 'Bot', ['chassis.light', 'cpu.basic', 'motor.small']);
    sim.setProgram(bot.id, MOVER);
    const units = [0, 1, 2, 3, 4].map((i) => sim.spawnUnit(bot, at(2), at(2 + i)));
    for (const u of units) sim.issueOrder(1, u, 12, 10, -1, false);
    const goals = units.map((u) => `${sim.tasks[u]!.x(0)},${sim.tasks[u]!.y(0)}`);
    expect(new Set(goals).size).toBe(5);
    expect(goals[0]).toBe('12,10');
    for (const u of units) expect(Math.max(Math.abs(sim.tasks[u]!.x(0) - 12), Math.abs(sim.tasks[u]!.y(0) - 10))).toBeLessThanOrEqual(1);
  });

  it('units can revive a flat unit: right-click it to SUPPLY energy', () => {
    // No charging pads here: only the scout can help.
    const sim = new Simulation({ width: 20, height: 20, seed: 1 });
    const scout = sim.spawnUnit(defineClass(sim, 1, SCOUT_CLASS), at(4), at(4));
    const harvester = sim.spawnUnit(defineClass(sim, 1, HARVESTER_CLASS), at(9), at(6));
    sim.energy.f.amount[harvester] = 0;
    run(sim, 2);
    expect(sim.cpu.f.state[harvester]).toBe(CpuState.NoPower);
    sim.issueOrder(1, scout, 0, 0, harvester, false);
    expect(sim.tasks[scout]!.type(0)).toBe(TaskType.Supply);
    run(sim, 300);
    expect(sim.energy.f.amount[harvester]).toBeGreaterThan(0);
    expect(sim.cpu.f.state[harvester]).not.toBe(CpuState.NoPower);
  });

  it('modules can be switched off by scripts and players, with limits', () => {
    const sim = new Simulation({ width: 20, height: 20, seed: 1 });
    const bot = sim.blueprints.define(1, 'Bot', ['chassis.light', 'cpu.basic', 'motor.small', 'armor.plate']);
    sim.setProgram(bot.id, prog('on(Spawned, () => {\n  config.setModule(2, 0);\n  config.setModule(1, 0);\n  config.setModule(3, 0);\n});'));
    const e = sim.spawnUnit(bot, at(3), at(3));
    run(sim, 2);
    expect(sim.stats(e).speed).toBe(0); // motor off
    expect(sim.stats(e).cyclesPerTick).toBe(20); // script may not switch off its last CPU
    expect(sim.modules.f.off[e]).toBe(0b100); // armour is passive: not switchable
    expect(sim.issueModule(1, e, 1, false)).toBe(true); // the player may
    expect(sim.stats(e).cyclesPerTick).toBe(0);
  });
});

describe('orders, buildings and the economy', () => {
  it('right-click queues context tasks; unqueued (urgent) orders replace the plan when the class asks for it', () => {
    const { sim, own } = makeMatch();
    const [s] = own(1, 'Scout');
    const [enemy] = own(2, 'Scout');
    sim.issueOrder(1, s, 20, 20, -1, true);
    sim.issueOrder(1, s, 0, 0, enemy, true);
    expect([sim.tasks[s]!.type(0), sim.tasks[s]!.type(1)]).toEqual([TaskType.Move, TaskType.Attack]);
    sim.issueOrder(1, s, 14, 4, -1, false);
    run(sim, 6);
    expect(sim.tasks[s]!.count).toBe(1);
    expect(sim.tasks[s]!.x(0)).toBe(14);
    expect(sim.tasks[s]!.flags(0)).toBe(TaskFlag.Player | TaskFlag.Urgent);
    expect(sim.activities[s]?.kind).toBe(1); // already walking to the new goal
    expect(() => sim.issueOrder(1, enemy, 0, 0, -1, false)).toThrow(/Not your unit/);
  });

  it('action buttons: common commands need the right modules; class buttons only reach their class', () => {
    const { sim, own } = makeMatch();
    const [s] = own(1, 'Scout');
    const [h] = own(1, 'Harvester');
    const [enemy] = own(2, 'Scout');
    const [storage] = own(1, 'Small Energy Storage');
    // Attack: scouts have guns, harvesters refuse.
    expect(sim.issueCommand(1, s, TaskType.Attack, 0, 0, enemy, true)).toBe(true);
    expect(sim.tasks[s]!.target(sim.tasks[s]!.count - 1)).toBe(sim.world.handle(enemy));
    expect(() => sim.issueCommand(1, h, TaskType.Attack, 0, 0, enemy, true)).toThrow(/cannot attack/);
    // Harvest on open ground picks the nearest field; Recharge the nearest pad.
    sim.issueCommand(1, h, TaskType.Harvest, 15, 13, -1, true);
    expect(sim.resource.has(sim.world.resolve(sim.tasks[h]!.target(sim.tasks[h]!.count - 1)))).toBe(true);
    sim.issueCommand(1, h, TaskType.Charge, 0, 0, -1, true);
    expect(sim.tasks[h]!.type(sim.tasks[h]!.count - 1)).toBe(TaskType.Charge);
    // Class buttons: the storage's "Hold charge" button puts it into HOLD.
    expect(() => sim.issueButton(1, h, 'hold_charge', 0, 0, -1, false)).toThrow(/no 'hold_charge' button/);
    sim.issueButton(1, storage, 'hold_charge', 0, 0, -1, false);
    run(sim, 10);
    expect(sim.storage.f.mode[storage]).toBe(StorageMode.Hold);
    sim.issueButton(1, storage, 'automatic', 0, 0, -1, false);
    run(sim, 10);
    expect(sim.storage.f.mode[storage]).not.toBe(StorageMode.Hold);
  });

  it('Button blocks become UI metadata, and their hotkeys may not clash with the common actions', () => {
    const p = compileUnitProgram(prog(`on(Button, { label: 'Boost', key: 'B' }, () => {});
on(Button, { label: 'Lay mine', aim: true }, () => {});`));
    expect(p.buttons).toEqual([
      { name: 'boost', label: 'Boost', key: 'B', aim: false, handler: 0 },
      { name: 'lay_mine', label: 'Lay mine', key: '', aim: true, handler: 1 },
    ]);
    expect(() => compileUnitProgram(prog(`on(Button, { label: 'Go', key: 'A' }, () => {});`))).toThrow(/taken by Attack/);
    expect(() => compileUnitProgram(prog(`on(Button, { label: 'Go' }, () => {});\non(Button, { label: 'go' }, () => {});`))).toThrow(/Two Button blocks/);
  });

  it('harvesters fill the silos and the base stays powered', () => {
    const { sim, own } = makeMatch();
    const start = sim.pool(1);
    run(sim, 1500);
    expect(sim.pool(1)).toBeGreaterThan(start + 200);
    for (const h of own(1, 'Harvester')) expect(sim.energy.f.amount[h]).toBeGreaterThan(0);
    const [hq] = own(1, 'HQ');
    expect(sim.cpu.f.state[hq]).not.toBe(CpuState.NoPower);
  });

  it('matter patches slowly regenerate to their starting amount and remain harvestable when empty', () => {
    const sim = new Simulation({ width: 20, height: 20, seed: 1 });
    const harvesterBp = sim.blueprints.define(1, 'Test Harvester', ['chassis.light', 'motor.small', 'cargo.bay']);
    const harvester = sim.spawnUnit(harvesterBp, at(10), at(10));
    const patch = sim.spawnResourcePatch(at(10), at(10), 2);
    const finiteMatter = sim.spawnResource(at(12), at(10), 2);
    sim.harvester.f.target[harvester] = sim.world.handle(patch);
    sim.resource.f.amount[finiteMatter] = 0;
    sim.tick = 1;

    run(sim, 1);
    expect(sim.world.isAlive(patch)).toBe(true);
    expect(sim.resource.f.amount[patch]).toBe(0);
    sim.harvester.f.target[harvester] = -1;
    run(sim, RESOURCE_REGEN_INTERVAL_TICKS - 2);
    expect(sim.resource.f.amount[patch]).toBe(0);
    run(sim, 1);
    expect(sim.resource.f.amount[patch]).toBe(1);
    run(sim, RESOURCE_REGEN_INTERVAL_TICKS * 2);
    expect(sim.resource.f.amount[patch]).toBe(2);
    expect(sim.resource.f.amount[finiteMatter]).toBe(0);
  });

  it('passes a rally point to produced units via the HQ script', () => {
    const { sim, own, cls } = makeMatch();
    const [hq] = own(1, 'HQ');
    sim.issueOrder(1, hq, 14, 3, -1, false);
    sim.enqueueProduction(1, hq, cls(1, 'Scout').id);
    const before = new Set(own(1, 'Scout'));
    run(sim, cls(1, 'Scout').stats.buildTime + 250);
    const made = own(1, 'Scout').filter((e) => !before.has(e));
    expect(made).toHaveLength(1);
    const [x, y] = tileOf(sim, made[0]);
    expect(Math.abs(x - 14) + Math.abs(y - 3)).toBeLessThanOrEqual(2);
  });

  it('producing a unit costs energy from its module count and types, spread over the build time', () => {
    const sim = new Simulation({ width: 32, height: 32, seed: 1 });
    const factory = defineClass(sim, 1, { name: 'F', parts: ['frame.medium', 'factory.basic', 'battery.bank', 'silo'], program: '' });
    const plain = sim.blueprints.define(1, 'Plain', ['chassis.light', 'motor.small']);
    const armed = sim.blueprints.define(1, 'Armed', ['chassis.light', 'motor.small', 'gun.light', 'armor.plate']);
    expect(plain.stats.buildEnergy).toBeGreaterThan(0);
    expect(armed.stats.buildEnergy).toBeGreaterThan(plain.stats.buildEnergy);
    const f = sim.spawnStructure(factory, 10, 10);
    sim.addStock(f, 1000);
    sim.energy.f.amount[f] = sim.stats(f).energyCapacity;
    const start = sim.energy.f.amount[f];
    sim.enqueueProduction(1, f, plain.id);
    run(sim, plain.stats.buildTime);
    const spent = start - sim.energy.f.amount[f];
    expect(spent).toBeGreaterThanOrEqual(plain.stats.buildEnergy);
    expect(sim.unit.dense.some((e) => sim.unit.f.blueprint[e] === plain.id)).toBe(true);
  });

  it('a building can only instruct a produced unit during that one visit', () => {
    const sim = new Simulation({ width: 32, height: 32, seed: 1 });
    const factory = defineClass(sim, 1, {
      name: 'Greedy',
      parts: ['frame.medium', 'cpu.fast', 'factory.basic', 'battery.bank', 'silo'],
      // Orders the visitor during the visit; also tries to order every 5 ticks with a handle it kept.
      program: prog('let kept = -1;\non(Visitor, (reason, who) => {\n  kept = who;\n  order(MOVE, 1, 1, who);\n});\non(Every, { ticks: 5 }, () => {\n  order(STOP, 0, 0, kept);\n});'),
    });
    const idle = sim.blueprints.define(1, 'Idle', ['chassis.light', 'cpu.basic', 'motor.small']);
    sim.setProgram(idle.id, MOVER);
    const f = sim.spawnStructure(factory, 10, 10);
    sim.addStock(f, 1000);
    sim.enqueueProduction(1, f, idle.id);
    run(sim, idle.stats.buildTime + 3);
    const made = sim.unit.dense.find((e) => sim.unit.f.blueprint[e] === idle.id)!;
    expect(sim.tasks[made]!.count).toBe(1); // the visit's order reached the unit and it is on its way
    expect(sim.tasks[made]!.type(0)).toBe(TaskType.Move);
    expect(sim.tasks[made]!.flags(0)).toBe(TaskFlag.Building);
    run(sim, 100); // the unit has long left; the factory's repeated order with the kept handle goes nowhere
    expect(sim.tasks[made]!.count).toBe(0); // it finished the trip, and no STOP ever arrived (or it would have been taken)
  });
});

describe('construction and resources', () => {
  it('builders construct a placed blueprint from the common pool', () => {
    const { sim, own, cls } = makeMatch();
    const [builder] = own(1, 'Builder');
    const silo = cls(1, 'Resource Silo');
    // Next to the HQ, so it links into the base grid (and so the silos).
    const site = sim.placeBlueprint(1, silo.id, 10, 3, [builder], false);
    expect(sim.isSite(site)).toBe(true);
    expect(sim.siteSupplied(site)).toBe(false); // networks rebuild at the next tick
    run(sim, 1);
    expect(sim.siteSupplied(site)).toBe(true);
    expect(sim.tasks[builder]!.type(0)).toBe(TaskType.Build);
    let carried = false;
    for (let t = 0; t < 600 && sim.isSite(site); t++) {
      run(sim, 1);
      carried ||= sim.cargo.f.amount[builder] > 0;
    }
    expect(carried).toBe(false); // supplied: paid straight from the pool
    expect(sim.isSite(site)).toBe(false);
    expect(sim.stockpile.has(site)).toBe(true);
    expect(sim.health.f.hp[site]).toBe(silo.stats.hp);
    expect(sim.poolCapacity(1)).toBeGreaterThan(2000);
  });

  it('remote (unlinked) sites need resources carried to them', () => {
    const { sim, own, cls } = makeMatch();
    const [builder] = own(1, 'Builder');
    const pad = cls(1, 'Charging Pad');
    const [x, y] = freeSpot(sim, 30, 30);
    const site = sim.placeBlueprint(1, pad.id, x, y, [builder], false);
    run(sim, 1);
    expect(sim.siteSupplied(site)).toBe(false);
    let carried = false;
    for (let t = 0; t < 4000 && sim.isSite(site); t++) {
      run(sim, 1);
      carried ||= sim.cargo.f.amount[builder] > 0;
    }
    expect(carried).toBe(true);
    expect(sim.isSite(site)).toBe(false);
  });

  it('silos fill only up to capacity; units can take resources back out', () => {
    const sim = new Simulation({ width: 20, height: 20, seed: 1 });
    const depot = sim.blueprints.define(1, 'Depot', ['frame.small', 'silo']);
    const hauler = sim.blueprints.define(1, 'Hauler', ['chassis.light', 'motor.small', 'cargo.bay']);
    const d = sim.spawnStructure(depot, 5, 5);
    const u = sim.spawnUnit(hauler, at(6), at(5));
    sim.addStock(d, 980);
    sim.cargo.f.amount[u] = 40;
    expect(sim.dock(u, d)).toBe(true);
    expect(sim.stockpile.f.amount[d]).toBe(1000);
    expect(sim.cargo.f.amount[u]).toBe(20); // no room for the rest
    expect(sim.take(u, d, 100)).toBe(20); // limited by cargo space
    expect(sim.cargo.f.amount[u]).toBe(40);
    expect(sim.pool(1)).toBe(980);
  });

  it('demolishing refunds: sites fully, buildings partly; towers build nearby sites', () => {
    const { sim, own, cls } = makeMatch();
    const site = sim.placeBlueprint(1, cls(1, 'Resource Silo').id, 10, 3, own(1, 'Builder'), false);
    run(sim, 60);
    const invested = sim.invested[site];
    expect(invested).toBeGreaterThan(0);
    expect(sim.isSite(site)).toBe(true);
    const before = sim.pool(1);
    expect(sim.demolish(1, site)).toBe(invested);
    expect(sim.pool(1)).toBe(before + invested);
    expect(sim.world.isAlive(site)).toBe(false);
    expect(() => sim.demolish(1, own(1, 'Scout')[0])).toThrow(/not a building/);
    const [pylon] = own(1, 'Power Pylon');
    sim.demolish(1, pylon);
    expect(sim.pool(1)).toBeGreaterThan(before + invested - 1);

    // A construction tower next to the HQ (grid-linked to its silos) builds a site within reach on its own.
    const tower = sim.spawnStructure(cls(1, 'Construction Tower'), 9, 4);
    const near = sim.placeBlueprint(1, cls(1, 'Wind Turbine').id, 11, 2, [], false);
    run(sim, 200);
    expect(sim.isSite(near)).toBe(false);
    expect(sim.world.isAlive(tower)).toBe(true);
  });

  it('idle builders spread over free sites before sharing one', () => {
    const { sim, own, cls } = makeMatch();
    const bp = cls(1, 'Builder');
    const a = sim.spawnUnit(bp, at(9), at(4));
    const b = sim.spawnUnit(bp, at(9), at(4));
    const wind = cls(1, 'Wind Turbine').id;
    const s1 = sim.placeBlueprint(1, wind, 11, 2, [], false);
    const s2 = sim.placeBlueprint(1, wind, 14, 2, [], false);
    const first = sim.nearestSite(a);
    sim.tasks[a]!.push(TaskType.Build, 0, 0, sim.world.handle(first), 0);
    const second = sim.nearestSite(b);
    expect(second).not.toBe(first);
    expect([s1, s2]).toContain(second);
    sim.tasks[b]!.push(TaskType.Build, 0, 0, sim.world.handle(second), 0);
    // Every site claimed: a third builder shares one rather than idling.
    const c = sim.spawnUnit(bp, at(9), at(4));
    expect([s1, s2]).toContain(sim.nearestSite(c));
    void own;
  });

  it('with fog on, buildings can only be placed inside own vision', () => {
    const { sim, cls, own } = makeMatch();
    sim.requirePlacementVision = true;
    const silo = cls(1, 'Resource Silo').id;
    const [hq] = own(1, 'HQ');
    const x = Math.round(sim.pos.f.x[hq] / TILE);
    const y = Math.round(sim.pos.f.y[hq] / TILE);
    expect(() => sim.placeBlueprint(1, silo, 22, 22, [], false)).toThrow(/vision/);
    expect(() => sim.placeBlueprint(1, silo, Math.max(0, x - 2), y, [], false)).not.toThrow(/vision/);
  });

  it('retired classes cannot be produced or placed until restored', () => {
    const { sim, own, cls } = makeMatch();
    const [hq] = own(1, 'HQ');
    sim.retireClass(1, cls(1, 'Scout').id, true);
    expect(() => sim.enqueueProduction(1, hq, cls(1, 'Scout').id)).toThrow(/retired/);
    sim.retireClass(1, cls(1, 'Resource Silo').id, true);
    expect(() => sim.placeBlueprint(1, cls(1, 'Resource Silo').id, 10, 3, [], false)).toThrow(/retired/);
    expect(() => sim.retireClass(2, cls(1, 'Scout').id, false)).toThrow(/Not your class/);
    sim.retireClass(1, cls(1, 'Scout').id, false);
    sim.enqueueProduction(1, hq, cls(1, 'Scout').id);
    expect(own(1, 'Scout').length).toBe(2); // existing scouts were never affected
  });

  it('designer test runs: a private sandbox reports movement, combat and errors', () => {
    const fighter = SCOUT_CLASS.parts;
    const run1 = testRun(fighter, SCOUT_CLASS.program, { ticks: 400, order: 'attack' });
    expect(run1.error).toBeUndefined();
    expect(run1.samples.length).toBeGreaterThan(3);
    expect(run1.notes.join(' ')).toMatch(/Fired \d+ shot/);
    expect(run1.buttons.map((b) => b.name)).toEqual(['hold_fire']);
    expect(testRun(fighter, prog('let k = 1;\non(Idle, () => {\n  k = 1 / (k - 1);\n});'), { ticks: 20 }).notes.join(' ')).toMatch(/Faulted.*division by zero/);
    expect(testRun(fighter, 'nonsense(', {}).error).toMatch(/not valid JSON/);
    expect(() => prog('on(Idle, () => {\n  if (fire(1)) {\n    stop();\n  }\n});')).toThrow(/fire\(\) is an action/);
    // A program the design cannot hold is rejected by the sandbox with the memory it needs.
    const big = prog(`on(Every, { ticks: 9 }, () => {\n${Array.from({ length: 30 }, (_, i) => `  moveTo(${i + 5}, 1);`).join('\n')}\n});`);
    expect(testRun(['chassis.light', 'cpu.basic'], big, {}).error).toMatch(/needs \d+ memory slots/);
    expect(testRun(['frame.small', 'motor.small'], '', {}).error).toBeDefined();
  });

  it('the HQ does not send builders off to harvest', () => {
    const { sim, own, cls } = makeMatch();
    const [hq] = own(1, 'HQ');
    const before = new Set(own(1, 'Builder'));
    sim.enqueueProduction(1, hq, cls(1, 'Builder').id);
    run(sim, cls(1, 'Builder').stats.buildTime + 30);
    const made = own(1, 'Builder').filter((e) => !before.has(e));
    expect(made).toHaveLength(1);
    expect(sim.tasks[made[0]]!.type(0)).not.toBe(TaskType.Harvest);
  });

  it('the Resource Silo sends docked harvesters to one of the nearest fields, chosen at random', () => {
    const { sim, own, cls } = makeMatch();
    const [scout] = own(1, 'Scout');
    const [tx, ty] = tileOf(sim, scout);
    const silo = sim.spawnStructure(cls(1, 'Resource Silo'), tx + 5, ty);
    const passiveHarvester = sim.blueprints.define(1, 'Passive Harvester', ['chassis.light', 'cpu.basic', 'motor.small', 'cargo.bay']);
    // It only follows orders: the silo's visit sends it to a field.
    sim.setProgram(passiveHarvester.id, prog('on(Order, { types: [HARVEST] }, (type, tx, ty, field) => {\n  harvest(field);\n});'));
    const nearest = sim.resource.dense
      .filter((e) => sim.resource.f.amount[e] >= 10)
      .sort((p, q) => Math.hypot(sim.pos.f.x[p] - sim.pos.f.x[silo], sim.pos.f.y[p] - sim.pos.f.y[silo]) - Math.hypot(sim.pos.f.x[q] - sim.pos.f.x[silo], sim.pos.f.y[q] - sim.pos.f.y[silo]))
      .slice(0, 4);
    const picked = new Set<number>();
    for (let i = 0; i < 12; i++) {
      for (const f of nearest) sim.resource.f.amount[f] = 500; // earlier harvesters must not run a field dry
      const harvester = sim.spawnUnit(passiveHarvester, sim.pos.f.x[silo], sim.pos.f.y[silo]);
      run(sim, 3);
      expect(sim.dock(harvester, silo)).toBe(true);
      run(sim, 2); // long enough for the silo to react, too short for the harvester to finish (and drop) the order
      const queue = sim.tasks[harvester]!;
      expect(queue.type(queue.count - 1)).toBe(TaskType.Harvest);
      const target = sim.world.resolve(queue.target(queue.count - 1));
      expect(nearest).toContain(target);
      picked.add(target);
    }
    expect(picked.size).toBeGreaterThan(1); // not always the same field
  });

  it('a harvester with nothing to do goes back to a storage building, and swaps a spent field for another', () => {
    const { sim, own } = makeMatch();
    const [harvester] = own(1, 'Harvester');
    sim.clearOrders(harvester);
    const hq = own(1, 'HQ')[0];
    run(sim, 600);
    // It found work again (or is at the HQ getting it): never left stalled and idle.
    const busy = sim.tasks[harvester]!.count > 0 || sim.cargo.f.amount[harvester] > 0 || sim.motion.f.moving[harvester] === 1;
    expect(busy || sim.edgeDistance(harvester, hq) <= 3 * TILE).toBe(true);

    const spent = sim.resource.dense.find((e) => sim.resource.f.amount[e] > 0)!;
    const hv = own(1, 'Harvester')[1] ?? harvester;
    sim.clearOrders(hv);
    sim.cargo.f.amount[hv] = 0; // a full harvester would deliver first rather than swap
    sim.resource.f.amount[spent] = 2;
    sim.pushOrder(hv, TaskType.Harvest, 0, 0, sim.world.handle(spent), 0);
    run(sim, 10);
    const q = sim.tasks[hv]!;
    expect(q.count).toBeGreaterThan(0);
    expect(sim.world.resolve(q.target(0))).not.toBe(spent);
  });
});

describe('simulation', () => {
  it('is deterministic for a given seed and command sequence', () => {
    const a = makeMatch();
    const b = makeMatch();
    for (const { sim, own, cls } of [a, b]) {
      sim.enqueueProduction(1, own(1, 'HQ')[0], cls(1, 'Harvester').id);
      sim.issueOrder(1, own(1, 'Scout')[0], 40, 40, -1, false);
    }
    for (let t = 0; t < 400; t++) {
      a.sim.step();
      b.sim.step();
      expect(encodeTick(b.sim.world, b.sim.tick, b.sim.events, false)).toEqual(
        encodeTick(a.sim.world, a.sim.tick, a.sim.events, false),
      );
      a.sim.commit();
      b.sim.commit();
    }
    expect([a.sim.pool(1), a.sim.pool(2)]).toEqual([b.sim.pool(1), b.sim.pool(2)]);
  });

  it('replicates to a mirror world via snapshot + deltas', () => {
    const { sim } = makeMatch();
    const mirror = new World(GAME_COMPONENTS);
    applyTick(mirror, encodeTick(sim.world, sim.tick, [], true));
    mirror.flush();
    let deltaBytes = 0;
    for (let t = 0; t < 300; t++) {
      sim.step();
      const packet = encodeTick(sim.world, sim.tick, sim.events, false);
      deltaBytes += packet.byteLength;
      sim.commit();
      applyTick(mirror, packet);
      mirror.flush();
    }
    for (const def of [Position, Unit] as ComponentDef[]) {
      const sa = sim.world.store(def);
      const sb = mirror.store(def);
      expect([...sb.dense].sort()).toEqual([...sa.dense].sort());
      for (const e of sa.dense) {
        for (const k of sa.keys) {
          // Positions travel at 1/64 tile precision.
          if (def === Position) expect(Math.abs(sb.f[k][e] - sa.f[k][e])).toBeLessThanOrEqual(8);
          else expect(sb.f[k][e]).toBe(sa.f[k][e]);
        }
      }
    }
    const snapshotBytes = encodeTick(sim.world, sim.tick, [], true).byteLength;
    expect(deltaBytes / 300).toBeLessThan(snapshotBytes);
  });

  it('fog of war: a client only holds what its own units can see, kept exact as things enter and leave view', () => {
    const { sim, own } = makeMatch();
    const stats = (e: number) => sim.stats(e);
    const mirror = new World(GAME_COMPONENTS);
    const interest = new Interest();
    applyTick(mirror, encodeTick(sim.world, sim.tick, [], true, interest.reset(visibleTo(sim.world, 1, stats))));
    mirror.flush();
    const enemyHq = own(2, 'HQ')[0];
    const [scout] = own(1, 'Scout');
    expect(mirror.isAlive(enemyHq)).toBe(false);
    expect(mirror.store(Resource).dense.length).toBe(sim.resource.dense.length); // the map is known
    const [ex, ey] = tileOf(sim, enemyHq);
    sim.issueOrder(1, scout, ex, ey + 4, -1, false);
    sim.health.f.hp[scout] = 50000; // the enemy's defenders must not end the walk before the base comes into view
    let sawHq = false;
    for (let t = 0; t < 600; t++) {
      sim.step();
      const view = interest.update(visibleTo(sim.world, 1, stats), sim.world.despawned);
      const packet = encodeTick(sim.world, sim.tick, sim.events, false, view);
      sim.commit();
      applyTick(mirror, packet);
      mirror.flush();
      sawHq ||= mirror.isAlive(enemyHq);
      // The mirror holds exactly the visible set, with up-to-date positions.
      const visible = visibleTo(sim.world, 1, stats);
      expect(new Set(mirror.store(Position).dense)).toEqual(visible);
      for (const e of visible) expect(Math.abs(mirror.store(Position).f.x[e] - sim.pos.f.x[e])).toBeLessThanOrEqual(8);
    }
    expect(sawHq).toBe(true);
  });
});
