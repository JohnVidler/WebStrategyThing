import { describe, expect, it } from 'vitest';
import {
  CpuState,
  CORNERS,
  createMatch,
  defineClass,
  DetectKind,
  DetectSort,
  resolveSweep,
  SCOUT_CLASS,
  sensorSweep,
  setUpPlayer,
  Simulation,
  TILE,
} from '../src';
import { prog } from './helpers';

const at = (tiles: number) => tiles * TILE + TILE / 2;

function run(sim: Simulation, ticks: number): void {
  for (let t = 0; t < ticks; t++) {
    sim.step();
    sim.commit();
  }
}

/** A class whose program counts how often its block ran (in the first variable). */
const counter = (block: string) => prog(`let n = 0;\n${block}`);
const count = (sim: Simulation, e: number) => sim.flows[e]!.mem[0];

function world() {
  return new Simulation({ width: 40, height: 40, seed: 1 });
}

describe('events from the game', () => {
  it('Order blocks filter by order type; an order no block wants is dropped, and a wanted one stays while it is worked', () => {
    const sim = world();
    const bp = sim.blueprints.define(1, 'Listener', ['chassis.light', 'cpu.basic', 'motor.small', 'gun.light']);
    sim.setProgram(bp.id, counter('on(Order, { types: [ATTACK] }, () => {\n  n = n + 1;\n});'));
    const e = sim.spawnUnit(bp, at(5), at(5));
    run(sim, 2);
    sim.issueOrder(1, e, 20, 20, -1, true); // MOVE: not accepted by the block
    run(sim, 2);
    expect(count(sim, e)).toBe(0);
    expect(sim.tasks[e]!.count).toBe(0); // nobody wanted it
    const enemy = sim.spawnUnit(sim.blueprints.define(2, 'Target', ['chassis.light']), at(8), at(5));
    sim.issueOrder(1, e, 0, 0, enemy, true); // ATTACK
    run(sim, 2);
    expect(count(sim, e)).toBe(1);
  });

  it('Button blocks run on their own press, with the picked tile for aimed buttons', () => {
    const sim = world();
    const bp = sim.blueprints.define(1, 'Pressable', ['chassis.light', 'cpu.basic', 'motor.small']);
    sim.setProgram(
      bp.id,
      prog(`let a = 0;\nlet b = 0;\nlet picked = 0;\non(Button, { label: 'One' }, () => {\n  a = a + 1;\n});\non(Button, { label: 'Two', aim: true }, (px, py) => {\n  b = b + 1;\n  picked = px;\n});`),
    );
    const e = sim.spawnUnit(bp, at(5), at(5));
    run(sim, 2);
    sim.issueButton(1, e, 'two', 11, 7, -1, false);
    sim.issueButton(1, e, 'one', 0, 0, -1, false);
    sim.issueButton(1, e, 'one', 0, 0, -1, false);
    run(sim, 6);
    const mem = sim.flows[e]!.mem;
    expect([mem[0], mem[1], mem[2]]).toEqual([2, 1, 11]);
    expect(sim.tasks[e]!.count).toBe(0); // buttons are events, not tasks
  });

  it('Visitor blocks run per visit; while one runs the building may order that unit', () => {
    const { sim } = (() => {
      const s = world();
      return { sim: s };
    })();
    const hq = defineClass(sim, 1, {
      name: 'Depot',
      parts: ['frame.medium', 'cpu.fast', 'factory.basic', 'battery.bank', 'silo'],
      program: prog(`let docked = 0;\non(Visitor, { reasons: [PRODUCED] }, (reason, who) => {\n  order(MOVE, 3, 3, who);\n});\non(Visitor, { reasons: [DOCKED] }, () => {\n  docked = docked + 1;\n});`),
    });
    const drone = sim.blueprints.define(1, 'Drone', ['chassis.light', 'cpu.basic', 'motor.small']);
    sim.setProgram(drone.id, prog('on(Order, { types: [MOVE] }, (type, tx, ty) => {\n  goTo(tx, ty);\n});'));
    const f = sim.spawnStructure(hq, 10, 10);
    sim.addStock(f, 1000);
    sim.enqueueProduction(1, f, drone.id);
    run(sim, drone.stats.buildTime + 30);
    const made = sim.unit.dense.find((e) => sim.unit.f.blueprint[e] === drone.id)!;
    expect(sim.tasks[made]!.count).toBe(1);
    expect(sim.tasks[made]!.type(0)).toBe(1); // MOVE
    expect(sim.flows[f]!.mem[0]).toBe(0); // the docked block did not run for a produced unit
    sim.addVisitor(f, made, 2); // docked
    run(sim, 3);
    expect(sim.flows[f]!.mem[0]).toBe(1);
    expect(sim.visiting[f]).toBe(-1); // the link ends with the handler
  });

  it('Arrived fires when a trip ends; Damaged respects its minimum; EnergyLow fires once and re-arms', () => {
    const sim = world();
    const bp = sim.blueprints.define(1, 'Watcher', ['chassis.light', 'cpu.basic', 'motor.small']);
    sim.setProgram(
      bp.id,
      prog(
        [
          'let arrived = 0;',
          'let low = 0;',
          'let hurt = 0;',
          'on(Arrived, () => {\n  arrived = arrived + 1;\n});',
          'on(EnergyLow, { below: 50 }, () => {\n  low = low + 1;\n});',
          'on(Damaged, { minAmount: 1 }, (amount) => {\n  hurt = hurt + amount;\n});',
        ].join('\n'),
      ),
    );
    const e = sim.spawnUnit(bp, at(5), at(5));
    run(sim, 2);
    sim.setDestination(e, at(9), at(5));
    run(sim, 60);
    expect(sim.flows[e]!.mem[0]).toBe(1);
    // Energy: drop below 50% once; it fires once, then fires again only after recovering above 55%.
    sim.energy.f.amount[e] = Math.floor(bp.stats.energyCapacity * 0.3);
    run(sim, 3);
    expect(sim.flows[e]!.mem[1]).toBe(1);
    run(sim, 5);
    expect(sim.flows[e]!.mem[1]).toBe(1);
    sim.energy.f.amount[e] = bp.stats.energyCapacity;
    run(sim, 3);
    sim.energy.f.amount[e] = Math.floor(bp.stats.energyCapacity * 0.3);
    run(sim, 3);
    expect(sim.flows[e]!.mem[1]).toBe(2);
    // Damage from a real shot.
    const attacker = sim.spawnUnit(defineClass(sim, 2, SCOUT_CLASS), at(7), at(5));
    sim.issueCommand(2, attacker, 2, 0, 0, e, false);
    run(sim, 40);
    expect(sim.flows[e]!.mem[2]).toBeGreaterThan(0);
  });

  it('rest() holds Idle back while other events still arrive', () => {
    const sim = world();
    const bp = sim.blueprints.define(1, 'Napper', ['chassis.light', 'cpu.basic']);
    sim.setProgram(bp.id, prog('let n = 0;\non(Idle, () => {\n  n = n + 1;\n  config.rest(20);\n});\non(Button, { label: "Poke" }, () => {\n  n = n + 100;\n});'));
    const e = sim.spawnUnit(bp, at(5), at(5));
    run(sim, 15);
    expect(count(sim, e)).toBe(1); // one Idle, then resting
    sim.issueButton(1, e, 'poke', 0, 0, -1, false);
    run(sim, 3);
    expect(count(sim, e)).toBe(101); // events are not held back
    run(sim, 30);
    expect(count(sim, e)).toBeGreaterThanOrEqual(102); // Idle came back
    expect(sim.cpu.f.state[e]).toBeDefined();
  });

  it('a unit with no handler for anything never runs and never pays', () => {
    const sim = world();
    const bp = sim.blueprints.define(1, 'Silent', ['chassis.light', 'cpu.basic', 'motor.small']);
    sim.setProgram(bp.id, prog('on(Button, { label: "Nothing" }, () => {});'));
    const e = sim.spawnUnit(bp, at(5), at(5));
    const before = sim.energy.f.amount[e];
    run(sim, 200);
    expect(sim.energy.f.amount[e]).toBe(before);
    expect(sim.cpu.f.state[e]).toBe(CpuState.Sleeping);
    expect(sim.cpu.f.used[e]).toBe(0);
  });
});

describe('the sensor: configured on the Detected block, limited by the hardware', () => {
  const detected = (cfg: string) => prog(`let last = -1;\nlet seen = 0;\non(Detected, ${cfg}, (kind, h) => {\n  last = h;\n  seen = seen + 1;\n});`);

  it('clamps what the installed sensor cannot do, and says so', () => {
    const sim = world();
    const short = sim.blueprints.define(1, 'Short', ['chassis.light', 'cpu.basic', 'sensor.short']);
    const long = sim.blueprints.define(1, 'Long', ['chassis.light', 'cpu.basic', 'sensor.long']);
    const none = sim.blueprints.define(1, 'Blind', ['chassis.light', 'cpu.basic']);
    const asked = '{ watch: [ENEMY, RESOURCE, DAMAGED_ALLY], range: 30, interval: 2, sort: WEAKEST, limit: 5 }';
    const handlerOf = (bp: typeof short) => {
      const p = sim.setProgram(bp.id, detected(asked));
      return p.handlers[0];
    };
    const s = resolveSweep(handlerOf(short), short.stats);
    expect(s.sweep).toMatchObject({ watch: [DetectKind.Enemy], range: 6 * TILE, interval: 2, sort: DetectSort.Nearest, limit: 1 });
    expect(s.notes).toHaveLength(4);
    const l = resolveSweep(handlerOf(long), long.stats);
    expect(l.sweep).toMatchObject({ watch: [1, 2, 3], range: 14 * TILE, sort: DetectSort.Weakest, limit: 3 });
    expect(l.notes).toHaveLength(2); // range and limit: the long sensor reaches 14 tiles and reports 3
    expect(resolveSweep(handlerOf(none), none.stats).notes.join(' ')).toMatch(/needs a sensor/);
  });

  it('reports in priority order, then the chosen sort, up to the limit', () => {
    const sim = world();
    const long = sim.blueprints.define(1, 'Long', ['chassis.light', 'cpu.basic', 'sensor.long']);
    const foe = sim.blueprints.define(2, 'Foe', ['chassis.light', 'armor.plate']);
    const me = sim.spawnUnit(long, at(10), at(10));
    const near = sim.spawnUnit(sim.blueprints.define(2, 'Soft', ['chassis.light']), at(12), at(10));
    const far = sim.spawnUnit(foe, at(18), at(10));
    const field = sim.spawnResource(at(14), at(10), 100);
    sim.spatial.rebuild(sim.pos.f.x, sim.pos.f.y, sim.pos.dense, sim.world.capacity);
    const h = (e: number) => sim.world.handle(e);
    const sweep = (watch: number[], sort: number, limit: number) => ({ watch, range: 14 * TILE, interval: 1, sort, limit });
    expect(sensorSweep(sim, me, sweep([1], DetectSort.Nearest, 3))).toEqual([1, h(near), 1, h(far)]);
    expect(sensorSweep(sim, me, sweep([1], DetectSort.Strongest, 3))).toEqual([1, h(far), 1, h(near)]); // armour: more hit points
    expect(sensorSweep(sim, me, sweep([2, 1], DetectSort.Nearest, 3))).toEqual([2, h(field), 1, h(near), 1, h(far)]); // watch order is priority
    expect(sensorSweep(sim, me, sweep([2, 1], DetectSort.Nearest, 1))).toEqual([2, h(field)]);
    expect(sensorSweep(sim, me, { ...sweep([1], DetectSort.Nearest, 3), range: 1 * TILE })).toEqual([]);
  });

  it('sweeps cost the sensor energy, raise events only when something is found, and respect the interval', () => {
    const sim = world();
    const bp = sim.blueprints.define(1, 'Watcher', ['chassis.light', 'cpu.basic', 'sensor.short', 'battery.cell']);
    sim.setProgram(bp.id, detected('{ watch: [ENEMY], interval: 5 }'));
    const e = sim.spawnUnit(bp, at(10), at(10));
    const full = sim.energy.f.amount[e];
    run(sim, 50);
    expect(sim.energy.f.amount[e]).toBe(full - 10 * bp.stats.sensorUse); // ten sweeps at one energy each, nothing found
    expect(sim.flows[e]!.mem[1]).toBe(0);
    expect(sim.cpu.f.state[e]).toBe(CpuState.Sleeping); // nothing to run: no cycles either
    const foe = sim.spawnUnit(sim.blueprints.define(2, 'Foe', ['chassis.light']), at(13), at(10));
    run(sim, 12);
    expect(sim.flows[e]!.mem[1]).toBeGreaterThanOrEqual(2);
    expect(sim.flows[e]!.mem[0]).toBe(sim.world.handle(foe));
  });

  it('a Detected block needs no CPU time of its own: a turret-style class reacts without any Idle polling', () => {
    const { sim } = (() => {
      const s = createMatch(3);
      setUpPlayer(s, 1, CORNERS[0], 100);
      return { sim: s };
    })();
    const bp = sim.blueprints.define(1, 'Sentry', ['frame.small', 'cpu.basic', 'sensor.long', 'gun.light', 'battery.bank']);
    sim.setProgram(bp.id, prog('on(Detected, { watch: [ENEMY], interval: 2 }, (kind, target) => {\n  fire(target);\n});'));
    const tx = 20;
    const sentry = sim.spawnStructure(bp, tx, 20);
    const foe = sim.spawnUnit(sim.blueprints.define(2, 'Foe', ['chassis.light']), at(tx + 4), at(20));
    run(sim, 60);
    expect(sim.world.isAlive(foe)).toBe(false);
    void sentry;
  });
});

describe('performance: 1024 units', () => {
  it('runs a tick well inside the budget, with reactive units costing nothing between events', () => {
    const sim = new Simulation({ width: 96, height: 96, seed: 1 });
    const active = defineClass(sim, 1, SCOUT_CLASS);
    const reactive = sim.blueprints.define(1, 'Reactive', ['chassis.light', 'cpu.basic', 'motor.small']);
    sim.setProgram(reactive.id, prog('on(Order, () => {\n  nextOrder();\n});'));
    // 256 per player in the real limit; here 1024 units in all, half with a polling Idle handler.
    for (let i = 0; i < 1024; i++) {
      const x = 2 + (i % 64) * 1.4;
      const y = 2 + Math.floor(i / 64) * 5;
      sim.spawnUnit(i % 2 ? active : reactive, at(Math.floor(x)), at(Math.floor(y)));
    }
    run(sim, 20); // warm up
    const started = Date.now();
    const ticks = 60;
    run(sim, ticks);
    const perTick = (Date.now() - started) / ticks;
    // The real tick budget is 100 ms; this ceiling is generous so the test does not flake on a slow machine.
    expect(perTick).toBeLessThan(50);
    const asleep = sim.unit.dense.filter((e) => sim.cpu.f.state[e] === CpuState.Sleeping).length;
    expect(asleep).toBeGreaterThan(400);
  });
});
