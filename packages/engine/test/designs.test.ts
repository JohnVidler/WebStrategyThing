import { describe, expect, it } from 'vitest';
import {
  classifyDesigns,
  CORNERS,
  createMatch,
  defaultDesigns,
  defaultHash,
  DESIGNS_BUILD,
  designHash,
  makeDesignFile,
  parseDesignFile,
  resolveDesigns,
  SCOUT_CLASS,
  setUpPlayer,
  type DesignEntry,
} from '../src';

const scout = (program = SCOUT_CLASS.program): DesignEntry => ({ name: 'Scout', parts: [...SCOUT_CLASS.parts], program });

describe('design files', () => {
  it('round-trips through JSON and records the build and per-class base', () => {
    const file = makeDesignFile([scout(), { name: 'Mine', parts: ['chassis.light', 'cpu.basic'], program: 'sleep(5)' }]);
    const back = parseDesignFile(JSON.parse(JSON.stringify(file)));
    expect(back.build).toBe(DESIGNS_BUILD);
    expect(back.classes[0].base).toBe(defaultHash('Scout'));
    expect(back.classes[1].base).toBeNull();
    expect(() => parseDesignFile({ format: 'nope' })).toThrow(/Not a WebStrategyThing/);
  });

  it('tells player edits, outdated defaults, upstream conflicts and broken classes apart', () => {
    const old = designHash(SCOUT_CLASS.parts, 'sleep(1)'); // pretend this was the default when saved
    const file = parseDesignFile({
      format: 'wst-designs',
      version: 1,
      build: 'older',
      savedAt: '',
      classes: [
        { ...scout(), base: old }, // identical to today's default
        { ...scout('sleep(1)'), name: 'Scout', base: old }, // the old default, untouched -> take the new one
        { ...scout('sleep(2)'), name: 'Scout', base: old }, // edited an old default -> ask
        { ...scout('sleep(3)'), name: 'Scout', base: defaultHash('Scout') }, // edited today's default -> keep
        { name: 'Custom', parts: ['chassis.light', 'cpu.basic'], program: 'sleep(5)' },
        { name: 'Broken', parts: ['chassis.light', 'no.such.part'], program: '' },
        { name: 'Bad code', parts: ['chassis.light', 'cpu.basic'], program: 'nonsense(' },
      ],
    });
    const statuses = classifyDesigns(file).map((c) => c.status);
    expect(statuses).toEqual(['default', 'outdated', 'conflict', 'modified', 'custom', 'invalid', 'invalid']);
    const keepMine = resolveDesigns(classifyDesigns(file), () => true).map((e) => e.program);
    expect(keepMine).toEqual([SCOUT_CLASS.program, SCOUT_CLASS.program, 'sleep(2)', 'sleep(3)', 'sleep(5)']);
    const takeDefault = resolveDesigns(classifyDesigns(file), () => false).map((e) => e.program);
    expect(takeDefault[2]).toBe(SCOUT_CLASS.program);
  });
});

describe('loading designs into a match', () => {
  it('updates programs in place, replaces changed parts, retires classes not in the set', () => {
    const sim = createMatch(5);
    setUpPlayer(sim, 1, CORNERS[0], 300);
    const original = sim.blueprints.find(1, 'Scout')!;
    const custom = sim.blueprints.define(1, 'Old custom', ['chassis.light', 'cpu.basic']);
    const entries: DesignEntry[] = defaultDesigns().map((d) =>
      d.name === 'Scout' ? { ...d, program: 'sleep(9)' } : d.name === 'Hawk' ? { ...d, parts: d.parts.map((p) => (p === 'gun.light' ? 'armor.plate' : p)) } : d,
    );
    entries.push({ name: 'New custom', parts: ['chassis.light', 'cpu.basic'], program: 'sleep(4)' });
    const report = sim.loadDesigns(1, entries, 40);
    expect(report.errors).toEqual([]);
    expect(original.program?.source).toBe('sleep(9)'); // same parts: updated in place
    expect(report.updated).toBe(1);
    const hawks = sim.blueprints.ownedBy(1).filter((b) => b.name === 'Hawk');
    expect(hawks.map((b) => b.retired)).toEqual([true, false]); // new parts: new class, old one retired
    expect(custom.retired).toBe(true); // not in the set
    expect(sim.blueprints.find(1, 'New custom')?.program?.source).toBe('sleep(4)');
    expect(report.defined).toBe(2);

    // Reset: back to the defaults (the replacement Hawk steps aside for the default one).
    const reset = sim.loadDesigns(1, defaultDesigns(), 40);
    expect(reset.errors).toEqual([]);
    expect(original.program?.source).toBe(SCOUT_CLASS.program);
    const active = sim.blueprints.ownedBy(1).filter((b) => !b.retired);
    expect(active.map((b) => b.name).sort()).toEqual(defaultDesigns().map((d) => d.name).sort());
    expect(active.find((b) => b.name === 'Hawk')!.parts).toEqual(defaultDesigns().find((d) => d.name === 'Hawk')!.parts);
  });

  it('reports bad entries without stopping the rest', () => {
    const sim = createMatch(5);
    setUpPlayer(sim, 1, CORNERS[0], 300);
    const report = sim.loadDesigns(
      1,
      [...defaultDesigns(), { name: 'Bad', parts: ['nope'], program: '' }, { name: 'Bad code', parts: ['chassis.light', 'cpu.basic'], program: 'x(' }],
      40,
    );
    expect(report.errors.length).toBe(2);
    expect(sim.blueprints.find(1, 'Bad code')).toBeDefined(); // defined; only its program was rejected
  });
});
