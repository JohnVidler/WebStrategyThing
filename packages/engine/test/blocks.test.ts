import { describe, expect, it } from 'vitest';
import { BLOCKS, compileProgram, expandOne, FLOW_HOST, parseText, printText, serialize } from '../src';

const text = ['use(TakeOrders, { urgent: REPLACE });', 'use(HarvestLoop, { minMatter: 12 });', 'use(EngageEnemies, { watch: [ENEMY, MISSILE], holdFireKey: \'G\' });', ''].join('\n');

describe('built-in blocks', () => {
  it('round-trip through the text as one statement each', () => {
    const parsed = parseText(text, FLOW_HOST);
    expect(parsed.errors.map((e) => e.message)).toEqual([]);
    expect(parsed.doc.blocks?.map((b) => b.block)).toEqual(['TakeOrders', 'HarvestLoop', 'EngageEnemies']);
    expect(printText(parsed.doc, FLOW_HOST)).toBe(text);
  });

  it('every block expands into a program that checks and compiles with its defaults', () => {
    for (const def of BLOCKS) {
      const parsed = parseText(`use(${def.name});`, FLOW_HOST);
      expect(parsed.errors.map((e) => `${def.name}: ${e.message}`)).toEqual([]);
      expect(() => compileProgram(serialize(parsed.doc), FLOW_HOST)).not.toThrow();
    }
  });

  it('cost what the expanded program costs, and Expand gives the same program as plain blocks', () => {
    const parsed = parseText(text, FLOW_HOST);
    let doc = parsed.doc;
    const before = compileProgram(serialize(doc), FLOW_HOST);
    for (const b of doc.blocks ?? []) doc = expandOne(doc, b.id, FLOW_HOST);
    expect(doc.blocks).toBeUndefined();
    const plain = parseText(printText(doc, FLOW_HOST), FLOW_HOST);
    expect(plain.errors.map((e) => e.message)).toEqual([]);
    const after = compileProgram(serialize(plain.doc), FLOW_HOST);
    expect(Array.from(after.code)).toEqual(Array.from(before.code));
    expect(after.slots).toBe(before.slots);
  });

  it('refuse unknown blocks and settings, and use twice', () => {
    const errors = (src: string) => parseText(src, FLOW_HOST).errors.map((e) => e.message);
    expect(errors('use(Nope);')[0]).toMatch(/Unknown block/);
    expect(errors('use(HarvestLoop, { speed: 3 });')[0]).toMatch(/no setting 'speed'/);
    expect(errors('use(HarvestLoop, { minMatter: 5000 });')[0]).toMatch(/at most 1000/);
    expect(errors('use(RadarPing);\nuse(RadarPing);')[0]).toMatch(/used twice/);
  });
});
