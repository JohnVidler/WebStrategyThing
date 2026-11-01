import { describe, expect, it } from 'vitest';
import { clampControl, compileUnitProgram, FLOW_HOST, parseDoc, parseText, printText, serialize, Simulation, TILE } from '../src';
import { prog } from './helpers';

const unit = ['chassis.light', 'cpu.basic', 'battery.cell'];
const text = [
  'let power = 5;',
  'let lamp = 1;',
  "slider(power, { label: 'Light power', min: 0, max: 10 });",
  "toggle(lamp, { label: 'Lamp' });",
  '',
  'on(Idle, () => {',
  '});',
  '',
].join('\n');
const errors = (src: string) => parseText(src, FLOW_HOST).errors.map((e) => e.message);

describe('slider and toggle controls', () => {
  it('round-trips through the text and the stored form', () => {
    const parsed = parseText(text, FLOW_HOST);
    expect(parsed.errors.map((e) => e.message)).toEqual([]);
    expect(parsed.doc.controls).toEqual([
      { name: 'power', kind: 'slider', label: 'Light power', min: 0, max: 10, step: 1 },
      { name: 'lamp', kind: 'toggle', label: 'Lamp', min: 0, max: 1, step: 1 },
    ]);
    expect(printText(parsed.doc, FLOW_HOST)).toBe(text);
    expect(printText(parseDoc(serialize(parsed.doc)), FLOW_HOST)).toBe(text);
  });

  it('fills in defaults: label is the variable, range 0 to 100', () => {
    const doc = parseText('let gain = 50;\nslider(gain);\non(Idle, () => {\n});', FLOW_HOST).doc;
    expect(doc.controls).toEqual([{ name: 'gain', kind: 'slider', label: 'gain', min: 0, max: 100, step: 1 }]);
  });

  it('rejects controls that cannot work', () => {
    expect(errors('slider(nope);')[0]).toMatch(/needs a variable/);
    expect(errors('let a = 1;\nslider(a, { min: 5, max: 5 });')[0]).toMatch(/lower than its max/);
    expect(errors('let a = 50;\nslider(a, { max: 10 });')[0]).toMatch(/outside its slider range/);
    expect(errors('let a = 2;\ntoggle(a);')[0]).toMatch(/0 or 1/);
    expect(errors('let a = 1;\nslider(a, { max: 9, step: 20 });')[0]).toMatch(/step/);
    expect(errors(`let a = 1;\nslider(a, { label: '${'x'.repeat(25)}' });`)[0]).toMatch(/1-24 characters/);
    expect(errors('let a = 1;\nslider(a);\nslider(a);')[0]).toMatch(/already has a control/);
    expect(errors('let a = 1;\nslider(a, { color: 3 });')[0]).toMatch(/no setting 'color'/);
    const many = Array.from({ length: 9 }, (_, i) => `let v${i} = 1;\nslider(v${i});`).join('\n');
    expect(errors(many)[0]).toMatch(/At most 8 controls/);
  });

  it('clamps and snaps what the player sets', () => {
    const c = { name: 'a', kind: 'slider', label: 'a', min: 0, max: 10, step: 4 } as const;
    expect([-5, 0, 1, 2, 3, 6, 9, 10, 99].map((v) => clampControl(c, v))).toEqual([0, 0, 0, 4, 4, 8, 8, 8, 8]);
    expect(clampControl({ ...c, kind: 'toggle' }, 7)).toBe(1);
    expect(clampControl({ ...c, kind: 'toggle' }, 0)).toBe(0);
  });

  it('the spotlight block gives the player a Light power slider that sets the beam', () => {
    const sim = new Simulation({ width: 40, height: 40, seed: 1 });
    const bp = sim.blueprints.define(1, 'Lamp', ['frame.small', 'cpu.basic', 'light.spot', 'battery.bank']);
    sim.setProgram(bp.id, prog('use(Spotlight);'));
    const tower = sim.spawnStructure(bp, 5, 20);
    for (let t = 0; t < 10; t++) sim.step();
    expect(sim.controlValues(tower)).toEqual([5]);
    expect(sim.lights[tower]!.wantPower).toBe(5);
    sim.issueControl(1, tower, 'spotlight_power', 2);
    for (let t = 0; t < 10; t++) sim.step();
    expect(sim.lights[tower]!.wantPower).toBe(2);
  });

  it('writes the variable of own units, and refuses others', () => {
    const sim = new Simulation({ width: 20, height: 20, seed: 1 });
    const bp = sim.blueprints.define(1, 'Lamp', unit);
    sim.setProgram(bp.id, prog(text));
    const e = sim.spawnUnit(bp, 5 * TILE, 5 * TILE);
    sim.step();
    expect(compileUnitProgram(prog(text)).controls.map((c) => c.name)).toEqual(['power', 'lamp']);
    expect(sim.controlValues(e)).toEqual([5, 1]);
    sim.issueControl(1, e, 'power', 99);
    sim.issueControl(1, e, 'lamp', 0);
    expect(sim.controlValues(e)).toEqual([10, 0]);
    expect(() => sim.issueControl(1, e, 'missing', 1)).toThrow(/no 'missing' control/);
    expect(() => sim.issueControl(2, e, 'power', 1)).toThrow();
  });
});
