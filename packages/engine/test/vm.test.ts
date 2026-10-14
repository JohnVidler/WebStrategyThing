import { describe, expect, it } from 'vitest';
import { CompileError, compile, createVm, Fault, runVm, type Builtin } from '../src';

const calls: number[] = [];
const API: Builtin<null>[] = [
  { name: 'out', argc: 1, cost: 0, fn: (_c, a) => (calls.push(a[0]), 0) },
  { name: 'pricey', argc: 0, cost: 50, fn: () => 7 },
];

function boot(src: string, mem = 16, stack = 16) {
  calls.length = 0;
  return createVm(compile(src, API), mem, stack);
}

describe('compiler + vm', () => {
  it('evaluates integer expressions with precedence', () => {
    const vm = boot('out(1 + 2 * 3 - -4 / 2)  out(7 % 3 == 1 && !(2 > 3))');
    runVm(vm, API, null, 1000);
    expect(calls).toEqual([9, 1]);
  });

  it('keeps variables between ticks and applies var initialisers once', () => {
    const vm = boot('var n = 10\nn = n + 1\nout(n)');
    runVm(vm, API, null, 1000);
    runVm(vm, API, null, 1000);
    expect(calls).toEqual([11, 12]);
  });

  it('suspends when the cycle budget runs out and resumes next tick', () => {
    const vm = boot('var i = 0\nwhile i < 5 { out(i) i = i + 1 }');
    let ticks = 0;
    while (calls.length < 5 && ticks < 100) {
      runVm(vm, API, null, 4);
      ticks++;
    }
    expect(calls).toEqual([0, 1, 2, 3, 4]);
    expect(ticks).toBeGreaterThan(1);
  });

  it('yield ends the tick early', () => {
    const vm = boot('out(1)\nyield\nout(2)');
    const used = runVm(vm, API, null, 1000);
    expect(calls).toEqual([1]);
    expect(used).toBeLessThan(10);
    runVm(vm, API, null, 1000);
    expect(calls).toEqual([1, 2]);
  });

  it('carries the cost of expensive builtins as debt', () => {
    const vm = boot('var r = 0\nr = pricey()');
    expect(runVm(vm, API, null, 10)).toBe(10);
    expect(vm.debt).toBeGreaterThan(0);
    // Paying off the debt consumes whole ticks before the Store runs.
    let ticks = 1;
    while (vm.mem[0] !== 7 && ticks < 100) {
      runVm(vm, API, null, 10);
      ticks++;
    }
    expect(ticks).toBeGreaterThanOrEqual(5);
  });

  it('short-circuits && and ||', () => {
    const vm = boot('var a = 0\nif a != 0 && pricey() == 7 { out(1) } else { out(0) }\nif 1 || pricey() { out(2) }');
    const used = runVm(vm, API, null, 1000);
    expect(calls).toEqual([0, 2]);
    expect(used).toBeLessThan(50);
  });

  it('supports bitwise operators (binding tighter than comparisons) and host constants', () => {
    calls.length = 0;
    const consts = new Map([['URGENT', 4]]);
    const vm = createVm(compile('out(5 & URGENT == 4)\nout(1 | 2 + 4)', API, consts), 4, 16);
    runVm(vm, API, null, 1000);
    expect(calls).toEqual([1, 7]);
    expect(() => compile('var URGENT = 1', API, consts)).toThrow(/constant/);
  });

  it('faults on division by zero', () => {
    const vm = boot('var z = 0\nout(1 / z)');
    runVm(vm, API, null, 100);
    expect(vm.fault).toBe(Fault.DivByZero);
  });

  it('reports compile errors with positions', () => {
    expect(() => compile('var a = 1\nb = 2', API)).toThrowError(CompileError);
    try {
      compile('var a = 1\nout(a, a)', API);
    } catch (e) {
      expect(e).toBeInstanceOf(CompileError);
      expect((e as CompileError).line).toBe(2);
    }
  });

  it('refuses programs needing more memory than installed', () => {
    expect(() => createVm(compile('var a\nvar b\nvar c', API), 2, 8)).toThrow(/memory/);
  });
});
