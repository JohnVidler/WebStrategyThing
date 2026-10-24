import { describe, expect, it } from 'vitest';
import { compileUnitProgram, FlowError, Simulation, Terrain, TILE } from '../src';
import { prog } from './helpers';

/*
 * Regression tests for the bugs found in the 2026-10-24 engine review (REVIEW.md, "Engine and flow
 * pass"): programs and events a player controls must never crash the server or wedge a unit.
 */

const at = (t: number) => t * TILE + TILE / 2;

function run(sim: Simulation, ticks: number): void {
  for (let t = 0; t < ticks; t++) {
    sim.step();
    sim.commit();
  }
}

describe('hardening (2026-10-24 review)', () => {
  it('stored programs with the wrong shape are refused with a FlowError', () => {
    const doc = (handlers: unknown, vars: unknown = []) => JSON.stringify({ format: 'wst-flow', version: 1, vars, handlers });
    const body = (stmt: unknown) => doc([{ id: 'n1', event: 'Idle', config: {}, params: [], body: [stmt] }]);
    for (const src of [
      doc([{}]),
      doc([{ id: 'n1', event: 'Idle', config: {}, body: [] }]),
      doc([], [{ name: 'v' }]),
      body(null),
      body({ id: 'n2', k: 'set', name: 'v' }),
      body({ id: 'n2', k: 'if', cond: { k: 'num', v: 1 }, then: [] }),
      body({ id: 'n2', k: 'call', fn: 'stop' }),
      body({ id: 'n2', k: 'goto' }),
      body({ id: 'n2', k: 'set', name: 'v', value: { k: 'bin', op: '**', a: { k: 'num', v: 1 }, b: { k: 'num', v: 1 } } }),
    ]) {
      expect(() => compileUnitProgram(src), src).toThrow(FlowError);
    }
  });

  it('deeply nested statements are refused too', () => {
    let body = '[]';
    for (let i = 0; i < 300; i++) body = `[{"id":"w${i}","k":"while","cond":{"k":"num","v":0},"body":${body}}]`;
    const src = `{"format":"wst-flow","version":1,"vars":[],"handlers":[{"id":"n1","event":"Idle","config":{},"params":[],"body":${body}}]}`;
    expect(() => compileUnitProgram(src)).toThrow(/nested too deeply/);
  });

  it('a player order is not lost when the unit\'s event queue is full', () => {
    const sim = new Simulation({ width: 24, height: 24, seed: 1 }, new Terrain(24, 24));
    const bp = sim.blueprints.define(1, 'Walker', ['chassis.light', 'cpu.basic', 'motor.small']);
    sim.setProgram(bp.id, prog(`on(Damaged, (amount, attacker) => {
  alert('hit', 100);
});
on(Order, { types: [MOVE] }, (type, tx, ty) => {
  goTo(tx, ty);
});`));
    const e = sim.spawnUnit(bp, at(2), at(2));
    run(sim, 1);
    for (let i = 0; i < 40; i++) sim.damage(e, 0, 2); // a burst of hits fills the queue with Damaged events
    sim.issueOrder(1, e, 20, 2, -1, true);
    run(sim, 300);
    expect(Math.floor(sim.pos.f.x[e] / TILE)).toBe(20);
    expect(sim.tasks[e]!.count).toBe(0);
  });

  it('the server compile path refuses Button hotkeys taken by common actions', () => {
    // Stored JSON, as a design upload reaches the server (the text path checks this; compileUnitProgram does not).
    const doc = { format: 'wst-flow', version: 1, vars: [], handlers: [{ id: 'n1', event: 'Button', config: { label: 'Go', key: 'M' }, params: [], body: [] }] };
    expect(() => compileUnitProgram(JSON.stringify(doc))).toThrow(/taken by Move/);
  });

  it('an expression deeper than the stack is refused when compiled, not at run time', () => {
    const deep = Array.from({ length: 40 }, (_, i) => `(${i + 2} + `).join('') + '1' + ')'.repeat(40);
    expect(() => compileUnitProgram(prog(`let v = 0;\non(Idle, () => {\n  v = ${deep};\n});`))).toThrow();
  });

  it('a deeply nested stored program is refused with a FlowError, not a stack overflow', () => {
    // ~120 KB, well under the server's 1 MB message limit. A RangeError escapes Match.apply and the tick loop.
    const depth = 5000;
    const value = '{"k":"un","op":"-","a":'.repeat(depth) + '{"k":"num","v":1}' + '}'.repeat(depth);
    const src = `{"format":"wst-flow","version":1,"vars":[{"name":"v","init":0}],"handlers":[{"id":"n1","event":"Idle","config":{},"params":[],"body":[{"id":"n2","k":"set","name":"v","value":${value}}]}]}`;
    expect(() => compileUnitProgram(src)).toThrow(FlowError);
  });

  it('a chain started from a Visitor handler cannot crash the simulation', () => {
    const sim = new Simulation({ width: 24, height: 24, seed: 1 }, new Terrain(24, 24));
    sim.spawnResource(20 * TILE, 20 * TILE, 100); // entity 0, generation 0, as in every real match
    const depot = sim.blueprints.define(1, 'Depot', ['frame.small', 'cpu.basic']);
    sim.setProgram(depot.id, prog(`let c = 0;
on(Visitor, (reason, who) => {
  goTo(1, 1, { blocked: () => { c = visitorCaps(); } });
});`));
    const b = sim.spawnStructure(depot, 2, 2);
    const unit = sim.blueprints.define(1, 'Unit', ['chassis.light', 'cpu.basic', 'motor.small']);
    const e = sim.spawnUnit(unit, at(6), at(6));
    run(sim, 1);
    sim.addVisitor(b, e, 1);
    expect(() => run(sim, 5)).not.toThrow();
  });
});
