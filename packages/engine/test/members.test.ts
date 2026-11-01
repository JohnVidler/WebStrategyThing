import { describe, expect, it } from 'vitest';
import { FLOW_HOST, UNIT_API, compileUnitProgram, parseText, printText, serialize } from '../src';

const read = (body: string) => parseText(`on(Idle, () => {\n${body}\n});`, FLOW_HOST);
const messages = (body: string) => read(body).errors.map((e) => e.message);

describe('the self object tree', () => {
  it('reads properties, methods and module calls into the same flat calls', () => {
    const r = read("  if (self.hp < self.hpMax / 2) {\n    self.moveTo(1, 2);\n  }\n  self.modules['weapon'].fire(scan());\n  self.modules.shield.angle(90);");
    expect(r.errors).toEqual([]);
    const flat = read('  if (hp() < hpMax() / 2) {\n    moveTo(1, 2);\n  }\n  fire(scan());\n  config.shieldAngle(90);');
    expect(flat.errors).toEqual([]);
    expect(JSON.stringify(r.doc.handlers[0].body, (k, v) => (k === 'id' ? undefined : v))).toBe(JSON.stringify(flat.doc.handlers[0].body, (k, v) => (k === 'id' ? undefined : v)));
  });

  it('prints the tree form, and printing then reading is stable', () => {
    const flat = read('  if (hp() < 10) {\n    fire(scan());\n  }\n  config.shieldArc(120);\n  const e = me();');
    const text = printText(flat.doc, FLOW_HOST);
    expect(text).toContain('self.hp < 10');
    expect(text).toContain("self.modules.weapon.fire(scan())");
    expect(text).toContain('self.modules.shield.arc(120);');
    expect(text).toContain('const e = self.id;');
    const again = parseText(text, FLOW_HOST);
    expect(again.errors).toEqual([]);
    expect(printText(again.doc, FLOW_HOST)).toBe(text);
  });

  it('accepts gun for weapon, and prints weapon', () => {
    const r = read("  self.modules['gun'].fire(scan());");
    expect(r.errors).toEqual([]);
    expect(printText(r.doc, FLOW_HOST)).toContain("self.modules.weapon.fire(");
  });

  it('compiles a program written in the tree form', () => {
    expect(() => compileUnitProgram(serialize(read('  self.modules.weapon.fire(scan());\n  self.rest(5);\n  const e = self.energy;').doc))).not.toThrow();
  });

  it('explains wrong uses', () => {
    expect(messages('  self.modules.cannon.fire(1);')[0]).toMatch(/no module called 'cannon'.*weapon/);
    expect(messages('  self.modules.weapon.shoot(1);')[0]).toMatch(/does not exist.*fire/);
    expect(messages('  self.hpp();')[0]).toMatch(/self has no 'hpp'/);
    expect(messages('  const a = self.hp();')[0]).toMatch(/is a property/);
    expect(messages('  const a = self.moveTo;')[0]).toMatch(/is a function/);
    expect(messages('  other.hp;')).not.toEqual([]);
  });

  it('puts every mapped builtin at a unique place, and writes no name twice', () => {
    const seen = new Set<string>();
    for (const b of UNIT_API) {
      if (!b.member) continue;
      expect(seen.has(b.member), b.member).toBe(false);
      seen.add(b.member);
      if (b.prop) expect(b.argc, b.name).toBe(b.member.includes('[]') ? 1 : 0);
    }
    expect(seen.size).toBeGreaterThan(40);
  });

  it('indexes the weapons, counts them and picks one with a filter', () => {
    const src = [
      '  const n = self.modules.weapon.length;',
      '  const w = self.modules.weapon.filter(i => self.modules.weapon[i].kind === W_LASER).first();',
      '  self.modules.weapon[w].fire(scan());',
      '  self.modules.weapon[0].laserPower(10);',
      '  if (self.modules.weapon[0].range > 3) {',
      '    self.modules.weapon.fire(scan());',
      '  }',
    ].join('\n');
    const r = read(src);
    expect(r.errors).toEqual([]);
    const text = printText(r.doc, FLOW_HOST);
    expect(text).toContain('const n = self.modules.weapon.length;');
    expect(text).toContain('self.modules.weapon.filter(i => self.modules.weapon[i].kind === W_LASER).first()');
    expect(text).toContain('self.modules.weapon[w].fire(scan());');
    expect(text).toContain('self.modules.weapon[0].laserPower(10);');
    const again = parseText(text, FLOW_HOST);
    expect(again.errors).toEqual([]);
    expect(printText(again.doc, FLOW_HOST)).toBe(text);
    expect(() => compileUnitProgram(serialize(r.doc))).not.toThrow();
    expect(messages('  const k = self.modules.weapon.kind;')[0]).toMatch(/does not exist/);
    expect(messages('  const k = self.modules.weapon[0].kind();')[0]).toMatch(/is a property/);
  });
});
