import { describe, expect, it } from 'vitest';
import { FLOW_HOST, parseText, printText, Simulation, TILE } from '../src';
import { prog } from './helpers';

const unit = ['chassis.light', 'cpu.basic', 'battery.cell'];

describe('events of the program\'s own', () => {
  const text = [
    'let seen = 0;',
    '',
    'on(Spawned, () => {',
    '  emit(Greeted, 7, 3);',
    '});',
    '',
    'on(Greeted, (who, times) => {',
    '  seen = who * times;',
    '});',
    '',
  ].join('\n');

  it('round-trips through the text', () => {
    const parsed = parseText(text, FLOW_HOST);
    expect(parsed.errors.map((e) => e.message)).toEqual([]);
    expect(printText(parsed.doc, FLOW_HOST)).toBe(text);
  });

  it('lets one block raise an event another block handles, with values', () => {
    const sim = new Simulation({ width: 20, height: 20, seed: 1 });
    const bp = sim.blueprints.define(1, 'Talker', unit);
    sim.setProgram(bp.id, prog(text));
    const e = sim.spawnUnit(bp, 5 * TILE, 5 * TILE);
    for (let i = 0; i < 5; i++) sim.step();
    const fs = sim.flows[e]!;
    expect(fs.mem[fs.program.varNames.indexOf('seen')]).toBe(21);
  });

  it('rejects bad names and emitting a built-in event', () => {
    const errors = (src: string) => parseText(src, FLOW_HOST).errors.map((e) => e.message);
    expect(errors('on(Spawned, () => {\n  emit(Idle);\n});')[0]).toMatch(/built-in event/);
    expect(errors('on(Spawned, () => {\n  emit(a, 1, 2, 3, 4, 5);\n});')[0]).toMatch(/at most 4|valid event name/);
    expect(errors('on(thing, () => {\n});')[0]).toMatch(/Unknown event/);
  });

  it('costs nothing when nobody handles the event', () => {
    const none = parseText('on(Spawned, () => {\n  emit(Nobody, 1);\n});', FLOW_HOST);
    expect(none.errors).toEqual([]);
  });
});
