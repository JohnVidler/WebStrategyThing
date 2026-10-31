import { describe, expect, it } from 'vitest';
import { compileProgram, createFlow, FLOW_HOST, LIST_MAX, parseText, printText, runFlow, serialize, type FlowHost, type HostApi } from '../src';

// A tiny host with one list source, so the chain machinery is tested without the game.
interface Ctx {
  said: number[];
}
let items: number[] = [3, 1, 4, 1, 5, 9, 2, 6];
const api: HostApi<Ctx> = [
  { name: 'items', argc: 0, kind: 'query', cost: 3, list: true, fn: () => -1, fill: (_c, _a, out) => (out.set(items.slice(0, out.length)), items.length) },
  { name: 'upTo', argc: 1, kind: 'query', cost: 1, list: true, fn: () => -1, fill: (_c, a, out) => { let n = 0; for (let i = 1; i <= a[0] && n < out.length; i++) out[n++] = i; return n; } },
  { name: 'say', argc: 1, kind: 'action', cost: 0, fn: (c, a) => (c.said.push(a[0]), 0) },
  { name: 'twice', argc: 1, kind: 'query', cost: 2, fn: (_c, a) => a[0] * 2 },
  { name: 'calc', argc: 1, kind: 'query', cost: 0, fn: (_c, a) => a[0] },
  { name: 'rand', argc: 1, kind: 'query', cost: 1, fn: (_c, a) => Math.max(0, a[0] - 1) },
];
const host: FlowHost = { api, constants: new Map([['K', 9]]) };

const errorsOf = (src: string): string[] => parseText(src, host).errors.map((e) => e.message);

/** Runs `on(Idle)` with `result = <expr>;` and returns the variable, plus the cycles used. */
function value(expr: string, vars = '', label = expr): { result: number; used: number } {
  const src = `let result = 0;\n${vars}on(Idle, () => {\n  result = ${expr};\n});\n`;
  const parsed = parseText(src, host);
  expect(parsed.errors.map((e) => e.message)).toEqual([]);
  const p = compileProgram(serialize(parsed.doc), host);
  const fs = createFlow(p, 64, 8, 0);
  const used = runFlow(fs, api, { said: [] }, 100000, 0);
  expect(fs.fault, label).toBe(0);
  return { result: fs.mem[0], used };
}

describe('list chains', () => {
  it('filters, maps, sorts and takes, then ends with one number', () => {
    const cases: [string, number][] = [
      ['items().count()', 8],
      ['items().filter(x => x > 3).count()', 4],
      ['items().filter(x => x > 3).sum()', 24],
      ['items().map(x => x * 2).max()', 18],
      ['items().map(x => x * 2).min()', 2],
      ['items().sortBy(x => x).first()', 1],
      ['items().sortBy(x => x).at(2)', 2],
      ['items().sortBy(x => x).take(3).sum()', 4],
      ['items().sortByDesc(x => x).first()', 9],
      ['items().sortByDesc(x => x).last()', 1],
      ['items().minBy(x => 0 - x)', 9],
      ['items().maxBy(x => x % 5)', 4],
      ['items().reduce(0, (total, x) => total + x)', 31],
      ['items().reduce(1, (best, x) => best < x ? x : best)', 9],
      ['items().last()', 6],
      ['items().at(0)', 3],
      ['items().take(0).count()', 0],
      ['items().take(100).count()', 8],
    ];
    for (const [expr, expected] of cases) expect(value(expr, '', expr).result, expr).toBe(expected);
  });

  it('gives -1 or 0 for an empty list, and -1 for a position that is not there', () => {
    expect(value('items().filter(x => x > 100).first()').result).toBe(-1);
    expect(value('items().filter(x => x > 100).minBy(x => x)').result).toBe(-1);
    expect(value('items().filter(x => x > 100).random()').result).toBe(-1);
    expect(value('items().filter(x => x > 100).min()').result).toBe(0);
    expect(value('items().filter(x => x > 100).sum()').result).toBe(0);
    expect(value('items().at(99)').result).toBe(-1);
    expect(value('items().at(0 - 1)').result).toBe(-1);
  });

  it('sorts stably and picks the first of equals', () => {
    expect(value('items().sortBy(x => x % 2).first()').result).toBe(4); // the evens keep their order: 4, 2, 6
    expect(value('items().sortBy(x => x % 2).at(3)').result).toBe(3); // then the odds: 3, 1, 1, 5, 9
    expect(value('items().minBy(x => x % 2)').result).toBe(4);
    expect(value('items().maxBy(x => 1)').result).toBe(3);
  });

  it('random uses the unit\'s own rand()', () => {
    expect(value('items().random()').result).toBe(6); // the test host's rand(n) is n - 1
  });

  it('functions can use variables, constants, calls and the other parameter of a reduce', () => {
    expect(value('items().filter(x => x > limit).count()', 'let limit = 4;\n').result).toBe(3);
    expect(value('items().filter(x => x > K - 5).count()').result).toBe(3);
    expect(value('items().map(x => twice(x)).max()').result).toBe(18);
    expect(value('upTo(5).reduce(10, (a, x) => a - x)').result).toBe(-5);
  });

  it('a chain can sit in an expression and inside a condition', () => {
    expect(value('1 + items().count() * 2').result).toBe(17);
    expect(value('items().count() > 5 ? items().first() : items().last()').result).toBe(3);
    expect(value('upTo(3).sum() + upTo(4).sum()').result).toBe(16);
  });

  it('can be bound to a const and used as a number', () => {
    const src = 'on(Idle, () => {\n  const best = items().maxBy(x => x);\n  say(best);\n  const total = items().sum() - best;\n  say(total);\n});\n';
    const parsed = parseText(src, host);
    expect(parsed.errors).toEqual([]);
    const fs = createFlow(compileProgram(serialize(parsed.doc), host), 64, 8, 0);
    const ctx: Ctx = { said: [] };
    runFlow(fs, api, ctx, 100000, 0);
    expect(ctx.said).toEqual([9, 22]);
  });

  it('never holds more than LIST_MAX entries', () => {
    items = Array.from({ length: 100 }, (_, i) => i);
    try {
      expect(value('items().count()').result).toBe(LIST_MAX);
      expect(value('items().sum()').result).toBe((LIST_MAX * (LIST_MAX - 1)) / 2);
    } finally {
      items = [3, 1, 4, 1, 5, 9, 2, 6];
    }
  });

  it('costs by the entries visited, and the cost is bounded', () => {
    const small = value('upTo(2).filter(x => x > 0).count()').used;
    const big = value('upTo(20).filter(x => x > 0).count()').used;
    expect(big).toBeGreaterThan(small + 18 * 2); // at least the element cost for the 18 extra entries
    // The worst case: a full list through a function step. It stays far below the handler limit.
    const worst = value(`upTo(${LIST_MAX}).filter(x => x > 0).map(x => twice(x)).sortBy(x => 0 - x).minBy(x => x)`).used;
    expect(worst).toBeLessThan(2000);
  });
});

describe('list chains: text, checks and the editor form', () => {
  it('prints a chain and reads it back as the same program', () => {
    const src = [
      'let result = 0;',
      '',
      'on(Idle, () => {',
      '  const home = items().filter(x => x > 2).sortBy(x => x % 3).take(4).reduce(0, (a, x) => a + x);',
      '  result = home + upTo(3).count();',
      '});',
      '',
    ].join('\n');
    const a = parseText(src, host);
    expect(a.errors).toEqual([]);
    const printed = printText(a.doc, host);
    expect(printed).toBe(src);
    expect(serialize(parseText(printed, host).doc)).toBe(serialize(a.doc));
  });

  it('reads a const bound to any expression as a calc() call, and prints it back as a plain const', () => {
    const a = parseText('on(Idle, () => {\n  const n = K + 1;\n  say(n);\n});\n', host);
    expect(a.errors).toEqual([]);
    const first = a.doc.handlers[0].body[0];
    expect(first).toMatchObject({ k: 'call', fn: 'calc', result: 'n' });
    expect(printText(a.doc, host)).toContain('const n = K + 1;');
  });

  it('explains every way a chain can be wrong', () => {
    const idle = (stmt: string) => errorsOf(`let r = 0;\non(Idle, () => {\n  ${stmt}\n});\n`);
    expect(idle('r = items().filter(x => x > 1);')[0]).toMatch(/must end with a step that gives one number/);
    expect(idle('r = items().count().first();')[0]).toMatch(/must be the last step/);
    expect(idle('r = items();')[0]).toMatch(/returns a list/);
    expect(idle('items();')[0]).toMatch(/returns a list/);
    expect(idle('r = twice(2).first();')[0]).toMatch(/does not return a list/);
    expect(idle('r = items().nope();')[0]).toMatch(/Unknown list step \.nope\(\)/);
    expect(idle('r = items().filter(x => x > 1, 2).count();')[0]).toMatch(/function must come last/);
    expect(idle('r = items().filter(() => 1).count();')[0]).toMatch(/is written \.filter\(r => \.\.\.\)/);
    expect(idle('r = items().take(x => 1).count();')[0]).toMatch(/is written \.take\(n\)/);
    expect(idle('r = items().filter(x => x > upTo(2).count()).count();')[0]).toMatch(/cannot sit inside another chain/);
    expect(idle('r = items().take(upTo(2).count()).count();')[0]).toMatch(/cannot sit inside another chain/);
    expect(idle('r = items().filter(x => { return 1; }).count();')[0]).toMatch(/single expression/);
    expect(idle('r = items().filter(r => 1).count();')[0]).toMatch(/already used/);
    expect(idle('r = items().filter(x => y > 1).count();')[0]).toMatch(/Unknown name 'y'/);
    expect(idle('r = items().reduce(0, (a, a) => a);')[0]).toMatch(/already used/);
    expect(idle('r = foo.bar();')[0]).toMatch(/starts with a find function/);
  });

  it('a function parameter is only in scope inside its function', () => {
    const e = errorsOf('let r = 0;\non(Idle, () => {\n  r = items().filter(x => x > 1).count() + x;\n});\n');
    expect(e[0]).toMatch(/Unknown name 'x'/);
  });

  it('limits the steps in one chain', () => {
    const steps = '.take(5)'.repeat(9);
    expect(errorsOf(`let r = 0;\non(Idle, () => {\n  r = items()${steps}.count();\n});\n`)[0]).toMatch(/at most 8 steps/);
  });

  it('is part of the game language: find calls start chains, and a harvester program using them compiles', () => {
    const src = [
      'on(Idle, () => {',
      '  const depot = findDepots().minBy(d => dist(d) + 12 * crowdOver(d, 6, 4));',
      '  const field = findResourcesNear(depot, 10).take(4).minBy(r => distBetween(depot, r) + 6 * crowd(r, 3));',
      '  order(HARVEST, 0, 0, field);',
      '});',
      '',
    ].join('\n');
    const parsed = parseText(src, FLOW_HOST);
    expect(parsed.errors.map((e) => e.message)).toEqual([]);
    expect(() => compileProgram(serialize(parsed.doc), FLOW_HOST)).not.toThrow();
    expect(printText(parsed.doc, FLOW_HOST)).toBe(src);
  });
});
