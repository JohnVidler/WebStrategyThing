import { describe, expect, it } from 'vitest';
import {
  expandBlocks,
  ActivityKind,
  FLOW_HOST,
  parseText,
  printText,
  serialize,
  STARTER_CLASSES,
  Simulation,
  TaskFlag,
  TaskType,
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

const world = () => new Simulation({ width: 40, height: 40, seed: 1 });
const unit = ['chassis.light', 'cpu.basic', 'motor.small', 'battery.cell'];

describe('outcome chains in the language', () => {
  const text = [
    'let n = 0;',
    '',
    'on(Order, { types: [MOVE], urgent: REPLACE }, (type, tx, ty) => {',
    '  const started = goTo(tx, ty, {',
    '    arrived: () => {',
    '      n = n + tx;',
    '    },',
    '    blocked: () => {',
    '      n = 0;',
    '    },',
    '  });',
    '});',
    '',
  ].join('\n');

  it('round-trips between text and the stored program, keeping the chains', () => {
    const parsed = parseText(text, FLOW_HOST);
    expect(parsed.errors.map((e) => e.message)).toEqual([]);
    const call = parsed.doc.handlers[0].body[0];
    expect(call.k === 'call' && Object.keys(call.outcomes ?? {})).toEqual(['arrived', 'blocked']);
    expect(printText(parsed.doc, FLOW_HOST)).toBe(text);
    expect(serialize(parseText(printText(parsed.doc, FLOW_HOST), FLOW_HOST).doc)).toBe(serialize(parsed.doc));
  });

  it('knows which outcomes each call can end in', () => {
    const errors = (src: string) => parseText(src, FLOW_HOST).errors.map((e) => e.message);
    expect(errors('on(Order, () => {\n  goTo(1, 2, {\n    full: () => {},\n  });\n});')[0]).toMatch(/goTo\(\) ends in: arrived, blocked/);
    expect(errors('on(Order, () => {\n  stop({\n    arrived: () => {},\n  });\n});')[0]).toMatch(/no outcomes/);
    // A chain sees what was in scope at the call, and its own results stay inside it.
    expect(errors('on(Order, (type, tx, ty) => {\n  goTo(tx, ty, {\n    arrived: () => {\n      const e = energy();\n      moveTo(tx, e);\n    },\n  });\n  moveTo(e, 0);\n});')[0]).toMatch(/Unknown name 'e'/);
  });
});

describe('activities', () => {
  it('goTo walks without the program and runs the arrived chain in the frame of the call', () => {
    const sim = world();
    const bp = sim.blueprints.define(1, 'Walker', unit);
    sim.setProgram(
      bp.id,
      prog('let landed = 0;\non(Order, { types: [MOVE], urgent: REPLACE }, (type, tx, ty) => {\n  goTo(tx, ty, {\n    arrived: () => {\n      landed = tx * 100 + ty;\n    },\n  });\n});'),
    );
    const e = sim.spawnUnit(bp, at(5), at(5));
    run(sim, 2);
    sim.issueOrder(1, e, 12, 7, -1, false);
    let used = 0;
    for (let t = 0; t < 200 && sim.flows[e]!.mem[0] === 0; t++) {
      sim.step();
      used += sim.cpu.f.used[e];
      sim.commit();
    }
    expect(sim.flows[e]!.mem[0]).toBe(1207); // the chain saw tx and ty from the order
    expect(used).toBeLessThan(40); // the walk itself costs the program nothing
    expect(Math.round(sim.pos.f.x[e] / TILE)).toBe(12);
    expect(sim.activities[e]).toBeUndefined();
  });

  it('an activity started while handling an order finishes that order when it ends without a chain', () => {
    const sim = world();
    const bp = sim.blueprints.define(1, 'Walker', unit);
    sim.setProgram(bp.id, prog('let freed = 0;\non(Order, { types: [MOVE] }, (type, tx, ty) => {\n  goTo(tx, ty);\n});\non(Free, () => {\n  freed = freed + 1;\n});'));
    const e = sim.spawnUnit(bp, at(5), at(5));
    run(sim, 3);
    expect(sim.flows[e]!.mem[0]).toBe(1); // freshly built: free once
    sim.issueOrder(1, e, 9, 5, -1, true);
    sim.issueOrder(1, e, 9, 9, -1, true); // queued behind the first
    expect(sim.tasks[e]!.count).toBe(2);
    run(sim, 150);
    expect(sim.tasks[e]!.count).toBe(0); // both done, one after the other
    expect(Math.round(sim.pos.f.y[e] / TILE)).toBe(9);
    expect(sim.flows[e]!.mem[0]).toBe(2); // and told it is free again, once
  });

  it('an urgent order replaces the plan and cancels the current job; a queued one waits', () => {
    const sim = world();
    const bp = sim.blueprints.define(1, 'Walker', unit);
    sim.setProgram(bp.id, prog('on(Order, { types: [MOVE], urgent: REPLACE }, (type, tx, ty) => {\n  goTo(tx, ty);\n});'));
    const e = sim.spawnUnit(bp, at(5), at(5));
    run(sim, 2);
    sim.issueOrder(1, e, 30, 5, -1, false);
    sim.issueOrder(1, e, 30, 30, -1, true); // waits
    expect(sim.tasks[e]!.count).toBe(2);
    run(sim, 10);
    sim.issueOrder(1, e, 5, 30, -1, false); // urgent: everything before it goes
    expect(sim.tasks[e]!.count).toBe(1);
    expect(sim.tasks[e]!.y(0)).toBe(30);
    expect(sim.tasks[e]!.flags(0) & TaskFlag.Urgent).toBeTruthy();
    run(sim, 2);
    expect(sim.activities[e]?.y).toBe(30); // the new walk has started; the old one was cancelled
  });

  it('swapOrder hands a job on: the new order is worked and the old one is gone', () => {
    const sim = world();
    const bp = sim.blueprints.define(1, 'Walker', unit);
    sim.setProgram(
      bp.id,
      prog('on(Order, { types: [MOVE] }, (type, tx, ty) => {\n  goTo(tx, ty, {\n    arrived: () => {\n      swapOrder(STOP, 0, 0, -1);\n    },\n  });\n});\non(Order, { types: [STOP] }, () => {\n  stop();\n  nextOrder();\n});'),
    );
    const e = sim.spawnUnit(bp, at(5), at(5));
    run(sim, 2);
    sim.issueOrder(1, e, 8, 5, -1, true);
    run(sim, 80);
    expect(sim.tasks[e]!.count).toBe(0);
    expect(sim.activities[e]).toBeUndefined();
  });

  it('suspendActivity puts a job aside and resumeActivity brings it back where it was', () => {
    const sim = world();
    const bp = sim.blueprints.define(1, 'Walker', unit);
    sim.setProgram(
      bp.id,
      prog('on(Order, { types: [MOVE] }, (type, tx, ty) => {\n  goTo(tx, ty);\n});\non(Button, { label: "Pause" }, () => {\n  suspendActivity();\n});\non(Button, { label: "Go on" }, () => {\n  resumeActivity();\n});'),
    );
    const e = sim.spawnUnit(bp, at(5), at(5));
    run(sim, 2);
    sim.issueOrder(1, e, 25, 5, -1, true);
    run(sim, 10);
    sim.issueButton(1, e, 'pause', 0, 0, -1, false);
    run(sim, 3);
    expect(sim.activities[e]).toBeUndefined();
    const stopped = sim.pos.f.x[e];
    run(sim, 10);
    expect(sim.pos.f.x[e]).toBe(stopped); // really stopped
    expect(sim.tasks[e]!.count).toBe(1); // the order is still there
    sim.issueButton(1, e, 'go_on', 0, 0, -1, false);
    run(sim, 200);
    expect(Math.round(sim.pos.f.x[e] / TILE)).toBe(25);
    expect(sim.tasks[e]!.count).toBe(0);
  });

  it('a job that cannot even start ends at once, so its chain still runs', () => {
    const sim = world();
    const bp = sim.blueprints.define(1, 'Statue', ['chassis.light', 'cpu.basic', 'battery.cell']); // no motor
    sim.setProgram(bp.id, prog('let stuck = 0;\non(Button, { label: "Go" }, () => {\n  goTo(5, 5, {\n    blocked: () => {\n      stuck = 1;\n    },\n  });\n});'));
    const e = sim.spawnUnit(bp, at(3), at(3));
    run(sim, 2);
    sim.issueButton(1, e, 'go', 0, 0, -1, false);
    run(sim, 5);
    expect(sim.flows[e]!.mem[0]).toBe(1);
  });

  it('Free repeats while a unit stays free, and stops while it is busy', () => {
    const sim = world();
    const bp = sim.blueprints.define(1, 'Looker', unit);
    sim.setProgram(bp.id, prog('let looks = 0;\non(Free, { repeat: 10 }, () => {\n  looks = looks + 1;\n});\non(Order, { types: [MOVE] }, (type, tx, ty) => {\n  goTo(tx, ty);\n});'));
    const e = sim.spawnUnit(bp, at(5), at(5));
    run(sim, 55);
    expect(sim.flows[e]!.mem[0]).toBeGreaterThanOrEqual(5);
    sim.issueOrder(1, e, 35, 35, -1, true);
    run(sim, 3);
    const before = sim.flows[e]!.mem[0];
    run(sim, 40); // walking: not free
    expect(sim.flows[e]!.mem[0]).toBe(before);
    expect(sim.activities[e]?.kind).toBe(ActivityKind.GoTo);
  });

  it('EnergyLow repeats while the unit stays low, so an interrupted recharge is tried again', () => {
    const sim = world();
    const bp = sim.blueprints.define(1, 'Drainer', unit);
    sim.setProgram(bp.id, prog('let lows = 0;\non(EnergyLow, { below: 50 }, () => {\n  lows = lows + 1;\n});'));
    const e = sim.spawnUnit(bp, at(5), at(5));
    run(sim, 2);
    sim.energy.f.amount[e] = Math.floor(bp.stats.energyCapacity * 0.2);
    run(sim, 250);
    expect(sim.flows[e]!.mem[0]).toBeGreaterThanOrEqual(2);
    expect(sim.flows[e]!.mem[0]).toBeLessThanOrEqual(4);
  });
});

describe('starter programs', () => {
  it('react to events: none of them hooks Idle, and the busy ones need almost no CPU', () => {
    for (const c of STARTER_CLASSES) {
      if (!c.program) continue;
      const doc = parseText(c.text ?? '', FLOW_HOST).doc;
      expect(doc.blocks?.length, `${c.name} is made of built-in blocks`).toBeGreaterThan(0);
      expect(doc.handlers, `${c.name} needs no event blocks of its own`).toEqual([]);
      expect(
        expandBlocks(doc, FLOW_HOST).handlers.map((h) => h.event),
        c.name,
      ).not.toContain('Idle');
    }
  });

  it('keep their orders: the HQ keeps its rally point as the one order in its list', () => {
    const sim = world();
    const hq = sim.blueprints.define(1, 'HQ', ['frame.large', 'cpu.fast', 'battery.cell']);
    const text = STARTER_CLASSES.find((c) => c.name === 'HQ')!.program;
    sim.setProgram(hq.id, text);
    const b = sim.spawnStructure(hq, 10, 10);
    run(sim, 2);
    sim.issueOrder(1, b, 20, 20, -1, false);
    sim.issueOrder(1, b, 22, 18, -1, false);
    expect(sim.tasks[b]!.count).toBe(1);
    expect(sim.tasks[b]!.type(0)).toBe(TaskType.Move);
    expect([sim.tasks[b]!.x(0), sim.tasks[b]!.y(0)]).toEqual([22, 18]);
    run(sim, 2);
    expect(sim.flows[b]!.mem[0]).toBe(22);
  });
});
