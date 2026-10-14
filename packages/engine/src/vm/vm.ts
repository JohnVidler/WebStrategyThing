import { Op } from './opcodes';
import { MAX_ARGS, type HostApi, type Program } from './types';

export const Fault = {
  None: 0,
  StackOverflow: 1,
  StackUnderflow: 2,
  DivByZero: 3,
  BadOpcode: 4,
} as const;

export const FAULT_NAMES = ['none', 'stack overflow', 'stack underflow', 'division by zero', 'bad opcode'];

/** Per-unit execution state (the flyweight's extrinsic state). Lives server-side only. */
export interface VmState {
  readonly program: Program;
  pc: number;
  sp: number;
  /** Cycles overspent by an expensive instruction, paid off at the start of the next run. */
  debt: number;
  fault: number;
  /** Completed passes (times the program reached its end). */
  halts: number;
  /** Cycles in the last run that are exempt from energy billing (yield, free builtins). */
  freeCycles: number;
  readonly stack: Int32Array;
  readonly mem: Int32Array;
}

export function createVm(program: Program, memSlots: number, stackDepth: number): VmState {
  if (program.slots > memSlots) {
    throw new Error(`Program needs ${program.slots} memory slots but only ${memSlots} are installed`);
  }
  const vm: VmState = {
    program,
    pc: 0,
    sp: 0,
    debt: 0,
    fault: Fault.None,
    halts: 0,
    freeCycles: 0,
    stack: new Int32Array(stackDepth),
    mem: new Int32Array(memSlots),
  };
  vm.mem.set(program.init);
  return vm;
}

export function rebootVm(vm: VmState): void {
  vm.pc = 0;
  vm.sp = 0;
  vm.debt = 0;
  vm.fault = Fault.None;
  vm.mem.fill(0);
  vm.mem.set(vm.program.init);
}

// Shared scratch buffer for builtin arguments. The VM is not re-entrant.
const ARGS = new Int32Array(MAX_ARGS);

/**
 * Executes until the cycle budget runs out, the program yields, or it reaches
 * the end (which rewinds it to the start for the next tick). Execution that
 * runs out of budget simply resumes next tick, so a slow CPU still runs the
 * same program — it just reacts more slowly.
 *
 * Every instruction costs 1 cycle; CALL additionally costs the builtin's cost.
 * Returns cycles consumed from this tick's budget.
 */
export function runVm<Ctx>(vm: VmState, api: HostApi<Ctx>, ctx: Ctx, budget: number): number {
  if (vm.fault) return 0;
  const code = vm.program.code;
  const stack = vm.stack;
  const mem = vm.mem;
  const depth = stack.length;
  let pc = vm.pc;
  let sp = vm.sp;
  let cycles = budget - vm.debt;
  let fault: number = Fault.None;
  let free = 0;
  vm.debt = 0;

  run: while (cycles > 0) {
    const op = code[pc];
    const arg = code[pc + 1];
    pc += 2;
    cycles--;

    switch (op) {
      case Op.Push:
        if (sp >= depth) { fault = Fault.StackOverflow; break run; }
        stack[sp++] = arg;
        break;
      case Op.Load:
        if (sp >= depth) { fault = Fault.StackOverflow; break run; }
        stack[sp++] = mem[arg];
        break;
      case Op.Store:
        if (sp < 1) { fault = Fault.StackUnderflow; break run; }
        mem[arg] = stack[--sp];
        break;
      case Op.Pop:
        if (sp < 1) { fault = Fault.StackUnderflow; break run; }
        sp--;
        break;
      case Op.Neg:
        if (sp < 1) { fault = Fault.StackUnderflow; break run; }
        stack[sp - 1] = -stack[sp - 1] | 0;
        break;
      case Op.Not:
        if (sp < 1) { fault = Fault.StackUnderflow; break run; }
        stack[sp - 1] = stack[sp - 1] === 0 ? 1 : 0;
        break;
      case Op.Add:
      case Op.Sub:
      case Op.Mul:
      case Op.Div:
      case Op.Mod:
      case Op.Eq:
      case Op.Ne:
      case Op.Lt:
      case Op.Le:
      case Op.Gt:
      case Op.Ge:
      case Op.BitAnd:
      case Op.BitOr: {
        if (sp < 2) { fault = Fault.StackUnderflow; break run; }
        const b = stack[--sp];
        const a = stack[sp - 1];
        let r: number;
        switch (op) {
          case Op.Add: r = (a + b) | 0; break;
          case Op.Sub: r = (a - b) | 0; break;
          case Op.Mul: r = Math.imul(a, b); break;
          case Op.Div:
            if (b === 0) { fault = Fault.DivByZero; break run; }
            r = (a / b) | 0;
            break;
          case Op.Mod:
            if (b === 0) { fault = Fault.DivByZero; break run; }
            r = a % b | 0;
            break;
          case Op.Eq: r = a === b ? 1 : 0; break;
          case Op.Ne: r = a !== b ? 1 : 0; break;
          case Op.Lt: r = a < b ? 1 : 0; break;
          case Op.Le: r = a <= b ? 1 : 0; break;
          case Op.Gt: r = a > b ? 1 : 0; break;
          case Op.BitAnd: r = a & b; break;
          case Op.BitOr: r = a | b; break;
          default: r = a >= b ? 1 : 0; break;
        }
        stack[sp - 1] = r;
        break;
      }
      case Op.Jmp:
        pc = arg;
        break;
      case Op.Jz:
        if (sp < 1) { fault = Fault.StackUnderflow; break run; }
        if (stack[--sp] === 0) pc = arg;
        break;
      case Op.Jnz:
        if (sp < 1) { fault = Fault.StackUnderflow; break run; }
        if (stack[--sp] !== 0) pc = arg;
        break;
      case Op.Call: {
        const b = api[arg];
        if (!b) { fault = Fault.BadOpcode; break run; }
        const n = b.argc;
        if (sp < n) { fault = Fault.StackUnderflow; break run; }
        sp -= n;
        if (sp >= depth) { fault = Fault.StackOverflow; break run; }
        for (let i = 0; i < n; i++) ARGS[i] = stack[sp + i];
        stack[sp++] = b.fn(ctx, ARGS) | 0;
        cycles -= b.cost;
        if (b.free) free += 1 + b.cost;
        break;
      }
      case Op.Yield:
        free += 1;
        break run;
      case Op.Halt:
        pc = 0;
        sp = 0;
        vm.halts++;
        break run;
      default:
        fault = Fault.BadOpcode;
        break run;
    }
  }

  vm.pc = pc;
  vm.sp = sp;
  vm.fault = fault;
  vm.freeCycles = free;
  if (cycles < 0) vm.debt = -cycles;
  return budget - Math.max(cycles, 0);
}
