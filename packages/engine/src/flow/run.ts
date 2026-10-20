import { MAX_TEXT } from './check';
import { COST } from './cost';
import { EventId } from './events';
import { configInt, configInts, OP_STRIDE, Op, STACK_SIZE, handles, type FlowProgram } from './compile';
import { MAX_ARGS, type HostApi } from './host';

export const Fault = {
  None: 0,
  StackOverflow: 1,
  StackUnderflow: 2,
  DivByZero: 3,
  BadOpcode: 4,
  /** One handler ran longer than COST.HANDLER_LIMIT cycles. */
  TooLong: 5,
} as const;

export const FAULT_NAMES = ['none', 'stack overflow', 'stack underflow', 'division by zero', 'bad opcode', 'handler ran too long'];

const EVENT_SLOTS = 5; // handler index, then up to four event arguments. A negative handler index is a continuation: -1 - slot in `pendings`.
/** Pending one-shot timers (`after`) a unit may hold. */
const MAX_TIMERS = 8;

/** A chain waiting to run because a long-running call ended: where it starts and the frame it was started in. */
export interface Pending {
  readonly handler: number;
  readonly entry: number;
  readonly frame: Int32Array;
  /** The call that ended was made while handling an order, so the chain is part of working that order. */
  readonly order: boolean;
}

/** Per-unit execution state (the flyweight's extrinsic state). Server and sandbox only. */
export interface FlowState {
  readonly program: FlowProgram;
  readonly mem: Int32Array;
  readonly locals: Int32Array;
  readonly stack: Int32Array;
  /** Instruction index, and expression stack depth (always 0 between statements). */
  pc: number;
  sp: number;
  /** Handler currently running, or -1. */
  running: number;
  /** Cycles available. Never above one tick's worth; negative while repaying an overdraft. */
  balance: number;
  /** Cycles the running handler has used, against COST.HANDLER_LIMIT. */
  handlerCycles: number;
  fault: number;
  // Event queue: a ring of [handler, a0..a3].
  readonly queue: Int32Array;
  readonly capacity: number;
  head: number;
  length: number;
  /** Events lost to a full queue. */
  dropped: number;
  /** Handlers completed. */
  handled: number;
  /** First tick the Idle handler may fire again, and the tick until which `rest()` holds it back. */
  idleDue: number;
  restUntil: number;
  /** Next tick each handler's timer or sensor sweep is due (Every, Detected), by handler index. */
  readonly nextDue: Int32Array;
  /** One-shot timers: [dueTick, id] pairs. */
  readonly timers: number[];
  /** Whether the energy thresholds have fired and not yet re-armed. */
  lowFired: boolean;
  fullFired: boolean;
  /** Outcome table of the long-running call being made right now (-1 when it has no chains). */
  latentTable: number;
  /** Continuations queued by ended activities. */
  readonly pendings: (Pending | undefined)[];
  /** The running handler is working an order (an Order block, or a chain started from one). */
  orderContext: boolean;
  /** Tick the EnergyLow event last fired. */
  lowAt: number;
  /** Tick the Free event is due again (0: not repeating). */
  freeAt: number;
  /** The unit should be told it is Free the next time its handlers have all finished and nothing is running. */
  freePending: boolean;
}

export function createFlow(program: FlowProgram, memSlots: number, queueCapacity: number, tick: number, reason = 0): FlowState {
  if (program.slots > memSlots) {
    throw new Error(`Program needs ${program.slots} memory slots but only ${memSlots} are installed`);
  }
  const fs: FlowState = {
    program,
    mem: new Int32Array(Math.max(1, program.varInit.length)),
    locals: new Int32Array(Math.max(4, program.nLocals)),
    stack: new Int32Array(STACK_SIZE),
    pc: 0,
    sp: 0,
    running: -1,
    balance: 0,
    handlerCycles: 0,
    fault: Fault.None,
    queue: new Int32Array(Math.max(1, queueCapacity) * EVENT_SLOTS),
    capacity: Math.max(1, queueCapacity),
    head: 0,
    length: 0,
    dropped: 0,
    handled: 0,
    idleDue: 0,
    restUntil: 0,
    nextDue: new Int32Array(program.handlers.length),
    timers: [],
    lowFired: false,
    fullFired: false,
    latentTable: -1,
    pendings: [],
    orderContext: false,
    lowAt: 0,
    freeAt: 0,
    freePending: false,
  };
  boot(fs, tick, reason);
  return fs;
}

/** Starts (or restarts after a crash) from a clean state and raises Spawned. `reason`: 0 first start, 1 rebooted. */
export function boot(fs: FlowState, tick: number, reason: number): void {
  const p = fs.program;
  fs.mem.fill(0);
  fs.mem.set(p.varInit);
  fs.locals.fill(0);
  fs.pc = 0;
  fs.sp = 0;
  fs.running = -1;
  fs.balance = 0;
  fs.handlerCycles = 0;
  fs.fault = Fault.None;
  fs.head = 0;
  fs.length = 0;
  fs.idleDue = tick;
  fs.restUntil = 0;
  fs.timers.length = 0;
  fs.lowFired = false;
  fs.fullFired = false;
  fs.latentTable = -1;
  fs.orderContext = false;
  fs.lowAt = 0;
  fs.freeAt = 0;
  fs.pendings.length = 0;
  fs.freePending = handles(p, EventId.Free);
  for (const h of p.handlers) {
    if (h.event.id === EventId.Every) fs.nextDue[h.index] = tick + configInt(h, 'ticks');
    else if (h.event.id === EventId.Detected) fs.nextDue[h.index] = tick + 1;
  }
  for (const i of p.byEvent[EventId.Spawned] ?? []) enqueue(fs, i, reason, 0, 0, 0);
}

/** Low-priority events lose their place to important ones when the queue is full. */
const isPeriodic = (fs: FlowState, handlerIndex: number): boolean => {
  if (handlerIndex < 0) return false;
  const id = fs.program.handlers[handlerIndex].event.id;
  return id === EventId.Every || id === EventId.Timer || id === EventId.Detected;
};

/** Adds an event for one handler. A full queue drops the oldest periodic event first, else this one. */
export function enqueue(fs: FlowState, handler: number, a0: number, a1: number, a2: number, a3: number): boolean {
  if (fs.length >= fs.capacity) {
    let victim = -1;
    for (let i = 0; i < fs.length; i++) {
      const slot = ((fs.head + i) % fs.capacity) * EVENT_SLOTS;
      if (isPeriodic(fs, fs.queue[slot])) {
        victim = i;
        break;
      }
    }
    if (victim < 0) {
      fs.dropped++;
      return false;
    }
    // Remove the victim by shifting the later entries up one place.
    for (let i = victim; i < fs.length - 1; i++) {
      const from = ((fs.head + i + 1) % fs.capacity) * EVENT_SLOTS;
      const to = ((fs.head + i) % fs.capacity) * EVENT_SLOTS;
      for (let k = 0; k < EVENT_SLOTS; k++) fs.queue[to + k] = fs.queue[from + k];
    }
    fs.length--;
    fs.dropped++;
  }
  const slot = ((fs.head + fs.length) % fs.capacity) * EVENT_SLOTS;
  fs.queue[slot] = handler;
  fs.queue[slot + 1] = a0;
  fs.queue[slot + 2] = a1;
  fs.queue[slot + 3] = a2;
  fs.queue[slot + 4] = a3;
  fs.length++;
  return true;
}

/**
 * Queues the chain of a long-running call's outcome. It runs as its own short handler, in a copy of the frame the call was made in.
 * Returns false if the queue was full and the chain was dropped.
 */
export function enqueueContinuation(fs: FlowState, handler: number, entry: number, frame: Int32Array, order = false): boolean {
  let slot = fs.pendings.findIndex((p) => p === undefined);
  if (slot < 0) slot = fs.pendings.length;
  fs.pendings[slot] = { handler, entry, frame, order };
  if (enqueue(fs, -1 - slot, 0, 0, 0, 0)) return true;
  fs.pendings[slot] = undefined;
  return false;
}

/** Raises an event for every block of `eventId` whose filter accepts it (`accept` sees the handler index). Returns how many blocks took it. */
export function raise(fs: FlowState, eventId: number, a0 = 0, a1 = 0, a2 = 0, a3 = 0, accept?: (handler: number) => boolean): number {
  const list = fs.program.byEvent[eventId];
  if (!list) return 0;
  let taken = 0;
  for (const h of list) {
    if (accept && !accept(h)) continue;
    taken++;
    enqueue(fs, h, a0, a1, a2, a3);
  }
  return taken;
}

/** Does any handler of `eventId` exist? Callers check this first so unhandled events cost nothing. */
export const handled = (fs: FlowState, eventId: number): boolean => handles(fs.program, eventId);

/** Sets a one-shot timer (`after`). False if the unit holds too many. */
export function addTimer(fs: FlowState, due: number, id: number): boolean {
  if (fs.timers.length >= MAX_TIMERS * 2) return false;
  fs.timers.push(due, id);
  return true;
}

/** Fires the repeating `Every` blocks and one-shot timers that are due. Cheap when there are none. */
export function tickTimers(fs: FlowState, tick: number): void {
  const p = fs.program;
  const every = p.byEvent[EventId.Every];
  if (every) {
    for (const h of every) {
      if (tick >= fs.nextDue[h]) {
        const period = configInt(p.handlers[h], 'ticks');
        fs.nextDue[h] = tick + period;
        enqueue(fs, h, 0, 0, 0, 0);
      }
    }
  }
  if (fs.timers.length) {
    const t = fs.timers;
    for (let i = 0; i < t.length; i += 2) {
      if (tick < t[i]) continue;
      const id = t[i + 1];
      t.splice(i, 2);
      i -= 2;
      raise(fs, EventId.Timer, id, 0, 0, 0, (h) => {
        const ids = configInts(p.handlers[h], 'ids');
        return ids.length === 0 || ids.includes(id);
      });
    }
  }
}

/** True if the unit has anything to do this tick, so idle units can be skipped without running anything. */
export function hasWork(fs: FlowState, tick: number): boolean {
  if (fs.running >= 0 || fs.length > 0 || fs.balance < 0 || fs.timers.length) return true;
  const p = fs.program;
  return p.byEvent[EventId.Idle] !== undefined && tick >= fs.idleDue && tick >= fs.restUntil;
}

// Shared scratch buffer for builtin arguments. The interpreter is not re-entrant.
const ARGS = new Int32Array(MAX_ARGS);

export interface RunHooks {
  /** A handler is about to start (`handler` is its index, `args` the event arguments). */
  start?(handler: number, args: Int32Array): void;
  /** The running handler finished (or crashed). */
  end?(handler: number): void;
}

const EVENT_ARGS = new Int32Array(4);

/**
 * Runs the unit's CPU for one tick: gives it `cyclesPerTick` cycles, then takes events off
 * the queue (or fires Idle if nothing is waiting) and runs their handlers, pausing between
 * statements when the cycles are spent and resuming next tick. A statement is never split:
 * it runs whole while the balance is above zero and may overdraw it; the overdraft is
 * repaid from later ticks, so even a huge statement completes on a small CPU.
 *
 * Returns the cycles consumed this tick.
 */
/** The text of the program that is running, for builtins that take text (an argument is an index into this). */
export const running: { strings: readonly string[]; dynamic: string[] } = { strings: [], dynamic: [] };

/** The text a text argument stands for: written in the program, or joined while it ran (valid until the next statement). */
export const textAt = (handle: number): string => (handle < running.strings.length ? running.strings[handle] : running.dynamic[handle - running.strings.length]) ?? '';

export function runFlow<Ctx>(fs: FlowState, api: HostApi<Ctx>, ctx: Ctx, cyclesPerTick: number, tick: number, hooks?: RunHooks): number {
  if (fs.fault) return 0;
  const p = fs.program;
  running.strings = p.strings;
  const code = p.code;
  const stack = fs.stack;
  const mem = fs.mem;
  const locals = fs.locals;
  fs.balance = Math.min(cyclesPerTick, fs.balance + cyclesPerTick);
  let used = 0;

  for (;;) {
    if (fs.balance <= 0) break;
    if (fs.running < 0) {
      let handler = -1;
      if (fs.length > 0) {
        const slot = fs.head * EVENT_SLOTS;
        handler = fs.queue[slot];
        EVENT_ARGS[0] = fs.queue[slot + 1];
        EVENT_ARGS[1] = fs.queue[slot + 2];
        EVENT_ARGS[2] = fs.queue[slot + 3];
        EVENT_ARGS[3] = fs.queue[slot + 4];
        fs.head = (fs.head + 1) % fs.capacity;
        fs.length--;
        if (handler < 0) {
          // A chain of a long-running call: start it with the frame it was made in.
          const pending = fs.pendings[-1 - handler];
          fs.pendings[-1 - handler] = undefined;
          if (!pending) continue;
          fs.running = pending.handler;
          fs.orderContext = pending.order;
          fs.pc = pending.entry;
          fs.sp = 0;
          fs.handlerCycles = 0;
          locals.fill(0);
          locals.set(pending.frame.subarray(0, locals.length));
          EVENT_ARGS.fill(0);
          hooks?.start?.(pending.handler, EVENT_ARGS);
          handler = -2;
        }
      } else {
        const idle = p.byEvent[EventId.Idle]?.[0];
        if (idle === undefined || tick < fs.idleDue || tick < fs.restUntil) break;
        handler = idle;
        fs.idleDue = tick + configInt(p.handlers[idle], 'interval');
        EVENT_ARGS.fill(0);
      }
      if (handler !== -2) {
        fs.orderContext = p.handlers[handler].event.id === EventId.Order;
        fs.running = handler;
        fs.pc = p.handlers[handler].entry;
        fs.sp = 0;
        fs.handlerCycles = 0;
        locals.fill(0);
        locals[0] = EVENT_ARGS[0];
        locals[1] = EVENT_ARGS[1];
        locals[2] = EVENT_ARGS[2];
        locals[3] = EVENT_ARGS[3];
        hooks?.start?.(handler, EVENT_ARGS);
      }
    }

    // Run the current handler until it ends, pauses, or crashes.
    let pc = fs.pc;
    let sp = fs.sp;
    let fault: number = Fault.None;
    let paused = false;
    let finished = false;

    run: for (;;) {
      const i = pc * OP_STRIDE;
      const op = code[i];
      const arg = code[i + 1];
      const cost = code[i + 2];
      if (op === Op.Stmt && fs.balance <= 0) {
        paused = true;
        break;
      }
      pc++;
      if (cost) {
        fs.balance -= cost;
        used += cost;
        fs.handlerCycles += cost;
      }

      switch (op) {
        case Op.End:
          finished = true;
          break run;
        case Op.Stmt:
          if (running.dynamic.length) running.dynamic.length = 0;
          break;
        case Op.Push:
          if (sp >= STACK_SIZE) { fault = Fault.StackOverflow; break run; }
          stack[sp++] = arg;
          break;
        case Op.Load:
          if (sp >= STACK_SIZE) { fault = Fault.StackOverflow; break run; }
          stack[sp++] = mem[arg];
          break;
        case Op.LoadL:
          if (sp >= STACK_SIZE) { fault = Fault.StackOverflow; break run; }
          stack[sp++] = locals[arg];
          break;
        case Op.Store:
          if (sp < 1) { fault = Fault.StackUnderflow; break run; }
          mem[arg] = stack[--sp];
          break;
        case Op.StoreL:
          if (sp < 1) { fault = Fault.StackUnderflow; break run; }
          locals[arg] = stack[--sp];
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
        case Op.Add: case Op.Sub: case Op.Mul: case Op.Div: case Op.Mod:
        case Op.Eq: case Op.Ne: case Op.Lt: case Op.Le: case Op.Gt: case Op.Ge:
        case Op.BitAnd: case Op.BitOr: {
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
        case Op.Latent: {
          const b = api[arg];
          if (!b) { fault = Fault.BadOpcode; break run; }
          const n = b.argc;
          if (sp < n) { fault = Fault.StackUnderflow; break run; }
          sp -= n;
          for (let k = 0; k < n; k++) ARGS[k] = stack[sp + k];
          // The next instruction names the outcome table; the call starts the job and files it for later.
          fs.latentTable = code[pc * OP_STRIDE + 1];
          pc++;
          fs.pc = pc;
          stack[sp++] = b.fn(ctx, ARGS) | 0;
          fs.latentTable = -1;
          if (b.cost) {
            fs.balance -= b.cost;
            used += b.cost;
            fs.handlerCycles += b.cost;
          }
          break;
        }
        case Op.Concat: {
          const template = p.templates[arg];
          let numbers = 0;
          for (const piece of template) if (typeof piece !== 'string') numbers++;
          if (sp < numbers) { fault = Fault.StackUnderflow; break run; }
          let at = sp - numbers;
          let text = '';
          for (const piece of template) {
            text += typeof piece === 'string' ? piece : piece === 1 ? (stack[at++] !== 0 ? 'true' : 'false') : String(stack[at++]);
          }
          sp -= numbers;
          if (sp >= STACK_SIZE) { fault = Fault.StackOverflow; break run; }
          stack[sp++] = p.strings.length + running.dynamic.push(text.slice(0, MAX_TEXT)) - 1;
          break;
        }
        case Op.Emit: {
          if (sp < 4) { fault = Fault.StackUnderflow; break run; }
          sp -= 4;
          raise(fs, arg, stack[sp], stack[sp + 1], stack[sp + 2], stack[sp + 3]);
          break;
        }
        case Op.Call: {
          const b = api[arg];
          if (!b) { fault = Fault.BadOpcode; break run; }
          const n = b.argc;
          if (sp < n) { fault = Fault.StackUnderflow; break run; }
          sp -= n;
          for (let k = 0; k < n; k++) ARGS[k] = stack[sp + k];
          stack[sp++] = b.fn(ctx, ARGS) | 0;
          if (b.cost) {
            fs.balance -= b.cost;
            used += b.cost;
            fs.handlerCycles += b.cost;
          }
          break;
        }
        default:
          fault = Fault.BadOpcode;
          break run;
      }
      if (fs.handlerCycles > COST.HANDLER_LIMIT) {
        fault = Fault.TooLong;
        break;
      }
    }

    fs.pc = pc;
    fs.sp = sp;
    if (fault) {
      fs.fault = fault;
      hooks?.end?.(fs.running);
      return used;
    }
    if (finished) {
      hooks?.end?.(fs.running);
      fs.running = -1;
      fs.handled++;
      continue;
    }
    if (paused) break;
  }
  return used;
}

/** Wipes the unit's queue, memory and any running handler, then raises Spawned with reason 1 (a reboot). */
export const reboot = (fs: FlowState, tick: number): void => boot(fs, tick, 1);
