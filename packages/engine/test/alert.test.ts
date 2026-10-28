import { describe, expect, it } from 'vitest';
import { applyTick, encodeTick, FLOW_HOST, MAX_NOTICES_PER_OWNER_TICK, NOTICE_KINDS, parseText, printText, GAME_COMPONENTS, Simulation, TILE, World } from '../src';
import { prog } from './helpers';

const lines = (...l: string[]): string => l.join('\n');
const unit = ['chassis.light', 'cpu.basic', 'battery.cell'];

describe('notify(text, kind)', () => {
  const make = (source: string, owner = 1) => {
    const sim = new Simulation({ width: 20, height: 20, seed: 1 });
    const bp = sim.blueprints.define(owner, 'Talker', unit);
    sim.setProgram(bp.id, prog(source));
    sim.spawnUnit(bp, 5 * TILE, 5 * TILE);
    return sim;
  };

  it('takes text in quotes and a NOTE_* kind', () => {
    const src = "on(Spawned, () => {\n  notify('Low power', NOTE_WARN);\n});\n";
    const parsed = parseText(src, FLOW_HOST);
    expect(parsed.errors.map((e) => e.message)).toEqual([]);
    expect(printText(parsed.doc, FLOW_HOST)).toBe(src);
    expect(parseText("on(Spawned, () => {\n  notify(5, 1);\n});", FLOW_HOST).errors[0].message).toMatch(/is text: write it in quotes/);
  });

  it('raises a pop-up for the unit owner with the kind and text', () => {
    const sim = make("on(Spawned, () => {\n  notify('HP: ' + hp(), NOTE_ERROR);\n});");
    sim.step();
    expect(sim.notices.map((n) => [n.owner, NOTICE_KINDS[n.kind], n.text.startsWith('HP: ')])).toEqual([[1, 'error', true]]);
    sim.commit();
    expect(sim.notices).toEqual([]);
  });

  it('clamps an out-of-range kind', () => {
    const sim = make("on(Spawned, () => {\n  notify('a', 99);\n});");
    sim.step();
    expect(sim.notices[0].kind).toBe(NOTICE_KINDS.length - 1);
  });

  it('lets a unit raise one every couple of seconds, and drops the rest', () => {
    const sim = make("on(Spawned, () => {\n  const a = notify('one', NOTE_INFO);\n  const b = notify('two', NOTE_INFO);\n});");
    sim.step();
    expect(sim.notices.map((n) => n.text)).toEqual(['one']);
  });

  it('caps what one player can raise in a tick', () => {
    const sim = new Simulation({ width: 20, height: 20, seed: 1 });
    const bp = sim.blueprints.define(1, 'Talker', unit);
    sim.setProgram(bp.id, prog("on(Spawned, () => {\n  notify('x', NOTE_OK);\n});"));
    for (let i = 0; i < 5; i++) sim.spawnUnit(bp, (5 + i) * TILE, 5 * TILE);
    sim.step();
    expect(sim.notices.length).toBe(MAX_NOTICES_PER_OWNER_TICK);
  });
});

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

  it('joins text, numbers and true/false with +, at run time', () => {
    const sim = new Simulation({ width: 20, height: 20, seed: 1 });
    const bp = sim.blueprints.define(1, 'Talker', unit);
    sim.setProgram(bp.id, prog(lines("let life = 42;", "on(Spawned, () => {", "  alert('HP: ' + life + ' ok=' + (life > 10) + ' ' + 1 + 2, 1000);", "});")));
    sim.spawnUnit(bp, 5 * TILE, 5 * TILE);
    sim.step();
    expect(sim.alerts.map((a) => a.text)).toEqual(['HP: 42 ok=true 12']);
  });

  it('keeps joined text to where text belongs, and cuts it at 40 characters', () => {
    const errors = (src: string) => parseText(src, FLOW_HOST).errors.map((e) => e.message);
    expect(errors(lines('let n = 0;', 'on(Spawned, () => {', "  moveTo('a' + n, 1);", '});'))[0]).toMatch(/only allowed where a function takes text/);
    expect(errors(lines('let n = 0;', 'on(Spawned, () => {', "  n = 'a' + 1;", '});'))[0]).toMatch(/only allowed where a function takes text/);
    const sim = new Simulation({ width: 20, height: 20, seed: 1 });
    const bp = sim.blueprints.define(1, 'Talker', unit);
    sim.setProgram(bp.id, prog(lines('let n = 123456;', 'on(Spawned, () => {', `  alert('${'x'.repeat(38)}' + n, 1000);`, '});')));
    sim.spawnUnit(bp, 5 * TILE, 5 * TILE);
    sim.step();
    expect(sim.alerts[0].text).toBe('x'.repeat(38) + '12');
  });
});
