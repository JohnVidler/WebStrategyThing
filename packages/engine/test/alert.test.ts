import { describe, expect, it } from 'vitest';
import { applyTick, encodeTick, FLOW_HOST, parseText, printText, GAME_COMPONENTS, Simulation, TILE, World } from '../src';
import { prog } from './helpers';

const unit = ['chassis.light', 'cpu.basic', 'battery.cell'];

describe('alert(text, duration_ms)', () => {
  const text = "on(Spawned, () => {\n  alert('Hello, it\\'s me', 2500);\n});\n";

  it('takes text in quotes and round-trips through the printer', () => {
    const parsed = parseText(text, FLOW_HOST);
    expect(parsed.errors.map((e) => e.message)).toEqual([]);
    expect(printText(parsed.doc, FLOW_HOST)).toBe(text);
  });

  it('rejects text where a number is expected, a number where text is expected, and long text', () => {
    const errors = (src: string) => parseText(src, FLOW_HOST).errors.map((e) => e.message);
    expect(errors("on(Spawned, () => {\n  moveTo('a', 1);\n});")[0]).toMatch(/only allowed where a function takes text/);
    expect(errors('on(Spawned, () => {\n  alert(5, 1000);\n});')[0]).toMatch(/is text: write it in quotes/);
    expect(errors(`on(Spawned, () => {\n  alert('${'x'.repeat(41)}', 1000);\n});`)[0]).toMatch(/limited to 40/);
  });

  it('counts each distinct text as one memory slot', () => {
    const one = parseText("on(Spawned, () => {\n  alert('a', 1000);\n  alert('a', 1000);\n});", FLOW_HOST);
    const two = parseText("on(Spawned, () => {\n  alert('a', 1000);\n  alert('b', 1000);\n});", FLOW_HOST);
    expect(two.memory.total - one.memory.total).toBe(1);
  });

  it('raises a bubble for the unit, converts milliseconds to ticks, and replaces an earlier one', () => {
    const sim = new Simulation({ width: 20, height: 20, seed: 1 });
    const bp = sim.blueprints.define(1, 'Talker', unit);
    sim.setProgram(bp.id, prog("on(Spawned, () => {\n  alert('first', 1000);\n  alert('hello there', 2550);\n});"));
    const e = sim.spawnUnit(bp, 5 * TILE, 5 * TILE);
    sim.step();
    expect(sim.alerts).toEqual([{ e, ticks: 26, text: 'hello there' }]);
    // The bubble travels to clients with the tick.
    const mirror = new World(GAME_COMPONENTS);
    const info = applyTick(mirror, encodeTick(sim.world, sim.tick, sim.events, true, undefined, sim.alerts));
    expect(info.alerts).toEqual([{ e, ticks: 26, text: 'hello there' }]);
    sim.commit();
    expect(sim.alerts).toEqual([]);
  });
});
