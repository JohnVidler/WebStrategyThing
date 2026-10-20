import { describe, expect, it } from 'vitest';
import {
  alignIds,
  compileProgram,
  createFlow,
  enqueue,
  EventId,
  FlowCompileError,
  Fault,
  FLOW_HOST,
  hasWork,
  parseText,
  printText,
  raise,
  reboot,
  runFlow,
  serialize,
  STARTER_CLASSES,
  tickTimers,
  addTimer,
  type FlowHost,
  type HostApi,
} from '../src';

// A tiny host so costs and semantics can be tested without the game.
interface Ctx {
  calls: number[][];
}
const api: HostApi<Ctx> = [
  { name: 'act', argc: 1, kind: 'action', cost: 5, fn: (c, a) => (c.calls.push([a[0]]), 7) },
  { name: 'act2', argc: 2, kind: 'action', cost: 0, fn: (c, a) => (c.calls.push([a[0], a[1]]), 0) },
  { name: 'ask', argc: 0, kind: 'query', cost: 0, fn: () => 3 },
  { name: 'tune', argc: 1, kind: 'config', cost: 0, fn: (c, a) => (c.calls.push([-a[0]]), 1) },
];
const host: FlowHost = { api, constants: new Map([['K', 9]]) };
const text = (src: string) => {
  const { doc, errors } = parseText(src, host);
  expect(errors.map((e) => e.message)).toEqual([]);
  return doc;
};
const compile = (src: string) => compileProgram(serialize(text(src)), host);

/** Runs one tick with a big budget and returns the cycles used and what was called. */
function once(src: string, setup?: (fs: ReturnType<typeof createFlow>) => void, budget = 100000) {
  const p = compile(src);
  const fs = createFlow(p, 64, 8, 0);
  const ctx: Ctx = { calls: [] };
  setup?.(fs);
  const used = runFlow(fs, api, ctx, budget, 0);
  return { used, ctx, fs, p };
}

describe('text form', () => {
  it('round-trips every starter program: print(parse(text)) is stable and parse(print(doc)) is the same program', () => {
    for (const c of STARTER_CLASSES) {
      if (!c.text) continue;
      const a = parseText(c.text, FLOW_HOST);
      expect(a.errors, c.name).toEqual([]);
      const t = printText(a.doc, FLOW_HOST);
      const b = parseText(t, FLOW_HOST);
      expect(b.errors, c.name).toEqual([]);
      expect(serialize(b.doc), c.name).toBe(serialize(a.doc));
      expect(printText(b.doc, FLOW_HOST), c.name).toBe(t);
    }
  });

  it('prints expressions with the fewest parentheses that keep their meaning', () => {
    const cases = [
      'a - (b - c)', 'a - b - c', 'a * (b + c)', 'a + b * c', '!(a < b)', '-a', '(a & 1) === 0', 'a === 0 && (b || c)', 'a && b && c',
      'a < b ? a : b', '(a || b) && c', 'a - -1', '1 - (2 - 3)', 'a % 2 === 1',
    ];
    for (const e of cases) {
      const src = `let a = 0;\nlet b = 0;\nlet c = 0;\non(Idle, () => {\n  a = ${e};\n});\n`;
      const doc = text(src);
      const printed = printText(doc, host);
      expect(printed).toContain(`a = ${e};`);
      expect(serialize(text(printed))).toBe(serialize(doc));
    }
  });

  it('keeps comments, config values and constants by name', () => {
    const src = `// how many\nlet n = 0;\n\n// a sensor\non(Detected, { watch: [K], range: 6 }, (kind, h) => {\n  // note\n  tune(1);\n});\n`;
    const out = printText(parseText(src, host).doc, host);
    expect(out).toContain('// how many');
    expect(out).toContain('// a sensor');
    expect(out).toContain('// note');
    expect(out).toContain('config.tune(1);');
  });

  it('reports every problem with where it is', () => {
    const bad = parseText(
      [
        'let x = 0;',
        'on(Nope, () => {});',
        'on(Idle, () => {',
        '  x += 1;',
        '  for (;;) {}',
        '  const y = 5;',
        '  act(1) + 1;',
        '});',
        'foo();',
      ].join('\n'),
      host,
    );
    const messages = bad.errors.map((e) => e.message);
    expect(messages.some((m) => /Unknown event 'Nope'/.test(m))).toBe(true);
    expect(messages.some((m) => /plain '='/.test(m))).toBe(true);
    expect(messages.some((m) => /not supported/.test(m))).toBe(true);
    expect(messages.some((m) => /const must be bound to a call/.test(m))).toBe(true);
    expect(messages.some((m) => /top level/.test(m))).toBe(true);
    expect(bad.errors.every((e) => e.from !== undefined && e.to !== undefined)).toBe(true);
    // Syntax errors are located too.
    expect(parseText('on(Idle, () => { act(1; });', host).errors[0].message).toBe('Syntax error');
  });

  it('keeps ids of statements that stay in place across a text edit', () => {
    const a = text('on(Idle, () => {\n  act(1);\n  act(2);\n});');
    const b = alignIds(a, parseText('on(Idle, () => {\n  act(5);\n  act(2);\n  act(3);\n});', host).doc);
    expect(b.handlers[0].id).toBe(a.handlers[0].id);
    expect(b.handlers[0].body[0].id).toBe(a.handlers[0].body[0].id);
    expect(b.handlers[0].body[1].id).toBe(a.handlers[0].body[1].id);
    expect(b.handlers[0].body[2].id).not.toBe(b.handlers[0].body[1].id);
  });
});

describe('checking', () => {
  // parseText reports both syntax and program problems, each with its place in the text.
  const errorsOf = (src: string) => parseText(src, host).errors.map((e) => e.message);

  it('keeps actions out of expressions, and runtime settings in the config namespace', () => {
    expect(errorsOf('on(Idle, () => {\n  if (act(1)) {\n  }\n});')).toEqual([expect.stringMatching(/act\(\) is an action/)]);
    expect(parseText('on(Idle, () => {\n  tune(1);\n});', host).errors[0].message).toMatch(/config\.tune/);
    expect(parseText('on(Idle, () => {\n  config.act(1);\n});', host).errors[0].message).toMatch(/not a runtime setting/);
    expect(errorsOf('on(Idle, () => {\n  const x = ask();\n  act(x + ask());\n});')).toEqual([]);
  });

  it('resolves names, arity and block scope', () => {
    expect(errorsOf('on(Idle, () => {\n  act(nope);\n});')).toEqual([expect.stringMatching(/Unknown name 'nope'/)]);
    expect(errorsOf('on(Idle, () => {\n  act(1, 2);\n});')).toEqual([expect.stringMatching(/takes 1 argument/)]);
    expect(errorsOf('on(Idle, () => {\n  if (1) {\n    const x = ask();\n  }\n  act(x);\n});')).toEqual([expect.stringMatching(/Unknown name 'x'/)]);
    expect(parseText('on(Idle, () => {\n  const ask = 1;\n});', host).errors[0].message).toMatch(/must be bound to a call/);
    expect(errorsOf('on(Idle, () => {\n  const ask = ask();\n});')[0]).toMatch(/already used/);
    expect(errorsOf('let a = 0;\non(Idle, () => {\n  K = 1;\n});')[0]).toMatch(/Only variables can be assigned/);
  });

  it('checks events: one block for single events, known settings, ranges, button keys', () => {
    expect(errorsOf('on(Idle, () => {});\non(Idle, () => {});')).toEqual([expect.stringMatching(/only have one Idle/)]);
    expect(parseText('on(Idle, { nope: 1 }, () => {});', host).errors[0].message).toMatch(/no setting 'nope'/);
    expect(errorsOf('on(Idle, { interval: 0 }, () => {});')[0]).toMatch(/at least 1/);
    expect(errorsOf('on(Order, (a, b, c, d, e) => {});')[0]).toMatch(/only 4 parameter/);
    expect(errorsOf("on(Button, { label: 'A', key: 'x' }, () => {});")[0]).toMatch(/upper-case/);
    expect(errorsOf('on(Every, { ticks: 5 }, () => {});\non(Every, { ticks: 9 }, () => {});')).toEqual([]); // several are fine
  });

  it('counts memory: variables, distinct literals (not -1, 0, 1) and the largest handler locals', () => {
    const p = compile(
      'let a = 0;\nlet b = 5;\non(Idle, () => {\n  act(7);\n  act(7);\n  act(8);\n  act(1);\n  act(-1);\n  const x = ask();\n});\non(Order, (t, x) => {\n  const y = ask();\n});',
    );
    expect(p.memory).toEqual({ vars: 2, literals: 2, locals: 3, total: 7 });
    expect(() => createFlow(p, 6, 4, 0)).toThrow(/needs 7 memory slots/);
  });

  it('reports all problems at once from the compiler', () => {
    const { doc } = parseText('on(Idle, () => {\n  act(a);\n  act(b);\n});', host);
    try {
      compileProgram(serialize(doc), host);
      throw new Error('should not compile');
    } catch (err) {
      expect(err).toBeInstanceOf(FlowCompileError);
      expect((err as FlowCompileError).errors).toHaveLength(2);
    }
  });
});

describe('cost: nodes executed plus wires followed', () => {
  // A statement is its node (1) plus the exec wire into it (1); a wired expression node is 1 + 1;
  // reading a variable is a Get node on a wire (2); reading an event parameter or call result is just the wire (1);
  // literals and named constants are free; a call adds its own cost (act = 5).
  it('charges what runs, and only what runs', () => {
    expect(once('on(Idle, () => {});').used).toBe(0);
    expect(once('on(Idle, () => {\n  act(1);\n});').used).toBe(2 + 5);
    expect(once('on(Idle, () => {\n  act(K);\n});').used).toBe(2 + 5); // named constants are free
    expect(once('let x = 3;\non(Idle, () => {\n  act(x);\n});').used).toBe(2 + 2 + 5); // + a Get Variable on a wire
    expect(once('on(Idle, () => {\n  act(1 + 2);\n});').used).toBe(2 + 2 + 5); // + one operator node on a wire
    expect(once('on(Idle, () => {\n  act(ask());\n});').used).toBe(2 + 2 + 5); // a query is a node on a wire
    expect(once('on(Idle, () => {\n  const r = ask();\n  act(r);\n});').used).toBe(2 + 2 + 1 + 5); // result read: just the wire
    expect(once('on(Idle, () => {\n  if (0) {\n    act(1);\n  }\n});').used).toBe(2); // a branch not taken costs nothing
    expect(once('on(Idle, () => {\n  if (1) {\n    act(1);\n  }\n});').used).toBe(2 + 2 + 5);
    expect(once('on(Idle, () => {\n  if (1) {\n    act(1);\n  } else {\n    act(2);\n    act(2);\n  }\n});').used).toBe(2 + 2 + 5);
  });

  it('charges event parameters as wires and loops per iteration', () => {
    const p = compile('on(Order, (type, x) => {\n  act2(type, x);\n});');
    const fs = createFlow(p, 64, 4, 0);
    enqueue(fs, 0, 5, 6, 0, 0);
    const ctx: Ctx = { calls: [] };
    // Spawned is not handled here, so only the Order event runs: 2 (statement) + 1 + 1 (two wires).
    expect(runFlow(fs, api, ctx, 1000, 0)).toBe(4);
    expect(ctx.calls).toEqual([[5, 6]]);

    const loop = once('let i = 0;\non(Idle, () => {\n  i = 0;\n  while (i < 3) {\n    i = i + 1;\n  }\n});');
    const check = 2 + (2 + 2); // while statement + (compare node on a wire + Get Variable)
    const body = 2 + (2 + 2); // set statement + (add node on a wire + Get Variable)
    expect(loop.used).toBe(2 /* i = 0 */ + 3 * (check + body) + check);
  });

  it('events nobody handles cost nothing: they are never queued', () => {
    const p = compile('on(Idle, () => {\n  act(1);\n});');
    const fs = createFlow(p, 64, 4, 0);
    raise(fs, EventId.Order, 1, 2, 3, 4);
    raise(fs, EventId.Damaged, 1);
    expect(fs.length).toBe(0);
    expect(fs.dropped).toBe(0);
  });
});

describe('running', () => {
  it('pauses between statements when the cycles run out and resumes next tick, in order', () => {
    const body = Array.from({ length: 10 }, (_, i) => `  act(${i + 2});`).join('\n');
    const p = compile(`on(Spawned, () => {\n${body}\n});`);
    const fs = createFlow(p, 64, 4, 0);
    const ctx: Ctx = { calls: [] };
    let ticks = 0;
    let total = 0;
    while (ticks < 40 && ctx.calls.length < 10) {
      total += runFlow(fs, api, ctx, 20, ticks);
      ticks++;
    }
    expect(ctx.calls.map((c) => c[0])).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(total).toBe(70);
    expect(ticks).toBeGreaterThan(3); // 20 cycles a tick fit about three 7-cycle statements
  });

  it('lets a statement overdraw and then repays the overdraft before the next one starts', () => {
    const p = compile('on(Order, () => {\n  act(1);\n});');
    const fs = createFlow(p, 64, 4, 0);
    const ctx: Ctx = { calls: [] };
    enqueue(fs, 0, 0, 0, 0, 0);
    enqueue(fs, 0, 0, 0, 0, 0);
    // Budget of 3 cycles a tick: each handler is 7, so it overdraws to -4, and the next one waits.
    const perTick: number[] = [];
    for (let t = 0; t < 8; t++) perTick.push(runFlow(fs, api, ctx, 3, t));
    expect(ctx.calls).toHaveLength(2);
    expect(perTick.reduce((a, b) => a + b, 0)).toBe(14);
    expect(perTick[0]).toBe(7); // the whole statement ran in the first tick
    expect(perTick[1]).toBe(0); // then the CPU is still paying off the overdraft
    expect(perTick[2]).toBe(7); // and the second handler starts once the balance is positive again
  });

  it('Idle fires only when nothing else is waiting or running, and not while resting or before its interval', () => {
    const p = compile('on(Idle, { interval: 3 }, () => {\n  act(1);\n});\non(Order, () => {\n  act2(1, 1);\n});');
    const fs = createFlow(p, 64, 4, 0);
    const ctx: Ctx = { calls: [] };
    const fires: number[] = [];
    for (let t = 0; t < 10; t++) {
      const before = ctx.calls.length;
      runFlow(fs, api, ctx, 100, t);
      if (ctx.calls.length > before) fires.push(t);
    }
    expect(fires).toEqual([0, 3, 6, 9]);

    // An Order in the queue goes first; Idle follows in the same tick when it is due and nothing is left.
    ctx.calls.length = 0;
    enqueue(fs, 1, 0, 0, 0, 0);
    runFlow(fs, api, ctx, 100, 12);
    expect(ctx.calls).toEqual([[1, 1], [1]]);
  });

  it('runs one-shot timers and repeating Every blocks, and skips idle units cheaply', () => {
    const p = compile('on(Every, { ticks: 4 }, () => {\n  act(1);\n});\non(Timer, { ids: [2] }, (id) => {\n  act(id);\n});');
    const fs = createFlow(p, 64, 8, 0);
    const ctx: Ctx = { calls: [] };
    expect(addTimer(fs, 6, 2)).toBe(true);
    expect(addTimer(fs, 7, 9)).toBe(true); // an id the block does not accept
    const log: string[] = [];
    for (let t = 0; t < 14; t++) {
      tickTimers(fs, t);
      const before = ctx.calls.length;
      if (hasWork(fs, t)) runFlow(fs, api, ctx, 100, t);
      for (const c of ctx.calls.slice(before)) log.push(`${t}:${c[0]}`);
    }
    expect(log).toEqual(['4:1', '6:2', '8:1', '12:1']);
    const lazy = createFlow(compile('on(Order, () => {});'), 64, 4, 0);
    runFlow(lazy, api, ctx, 100, 0);
    expect(hasWork(lazy, 1)).toBe(false);
  });

  it('drops the oldest periodic event when the queue is full, else the new one, and says so', () => {
    const p = compile('on(Every, { ticks: 9 }, () => {});\non(Order, () => {});');
    const fs = createFlow(p, 64, 2, 0);
    enqueue(fs, 0, 0, 0, 0, 0); // Every
    enqueue(fs, 1, 1, 0, 0, 0); // Order
    expect(enqueue(fs, 1, 2, 0, 0, 0)).toBe(true); // full: the periodic one makes room
    expect(fs.dropped).toBe(1);
    expect(fs.length).toBe(2);
    expect(enqueue(fs, 0, 0, 0, 0, 0)).toBe(false); // a periodic event cannot displace an order
    expect(enqueue(fs, 1, 3, 0, 0, 0)).toBe(false); // nothing periodic left to drop
    expect(fs.dropped).toBe(3);
  });

  it('faults on division by zero or a handler that runs too long, and a reboot starts clean', () => {
    const div = once('let k = 1;\non(Idle, () => {\n  k = 5 / (k - 1);\n});');
    expect(div.fs.fault).toBe(Fault.DivByZero);
    const spin = once('let i = 0;\non(Idle, () => {\n  while (1) {\n    i = i + 1;\n  }\n});');
    expect(spin.fs.fault).toBe(Fault.TooLong);
    expect(spin.used).toBeGreaterThan(4000);
    reboot(spin.fs, 5);
    expect(spin.fs.fault).toBe(Fault.None);
    expect(spin.fs.mem[0]).toBe(0);
    expect(spin.fs.running).toBe(-1);
  });

  it('boots with a Spawned event, reason 0 the first time and 1 after a reboot', () => {
    const p = compile('on(Spawned, (reason) => {\n  act(reason);\n});');
    const fs = createFlow(p, 64, 4, 0);
    const ctx: Ctx = { calls: [] };
    runFlow(fs, api, ctx, 100, 0);
    reboot(fs, 1);
    runFlow(fs, api, ctx, 100, 1);
    expect(ctx.calls).toEqual([[0], [1]]);
  });
});
