import { buttonName, checkDoc, type MemoryUse } from './check';
import { COST, STATEMENT_COST, VARIABLE_READ_COST, WIRED_NODE_COST, LOCAL_READ_COST } from './cost';
import { EVENT_BY_NAME, EventId, type EventDef } from './events';
import type { FlowHost } from './host';
import { FlowError, parseDoc, type ConfigValue, type Expr, type FlowDoc, type Handler, type Stmt } from './ir';

/**
 * Programs compile to a flat instruction list of [op, arg, cost] triples. Control flow
 * is conditional jumps, so a handler can pause between statements (at a `Stmt` marker)
 * and resume next tick with nothing to save but a program counter. Costs are attached
 * by the compiler from the IR (see cost.ts); the runtime just adds them up.
 */
export const Op = {
  End: 0,
  /** Start of a statement: the only place a handler may pause. */
  Stmt: 1,
  Push: 2,
  Load: 3,
  Store: 4,
  LoadL: 5,
  StoreL: 6,
  Pop: 7,
  Neg: 8,
  Not: 9,
  Add: 10,
  Sub: 11,
  Mul: 12,
  Div: 13,
  Mod: 14,
  Eq: 15,
  Ne: 16,
  Lt: 17,
  Le: 18,
  Gt: 19,
  Ge: 20,
  BitAnd: 21,
  BitOr: 22,
  Jmp: 23,
  Jz: 24,
  Jnz: 25,
  Call: 26,
  /** A long-running call with chains attached: the next instruction (Cont) names its outcome table. */
  Latent: 27,
  /** Data for the Latent before it: the outcome table's index. */
  Cont: 28,
} as const;

export const OP_STRIDE = 3;
/** Fixed expression stack: deeper expressions are rejected at compile time. */
export const STACK_SIZE = 32;

export interface CompiledHandler {
  readonly index: number;
  readonly event: EventDef;
  /** Settings as written (defaults filled in by `configValue`). */
  readonly config: Readonly<Record<string, ConfigValue>>;
  /** Instruction index of the first instruction. */
  readonly entry: number;
  readonly params: readonly string[];
  readonly id: string;
}

/** A player-facing action button declared by a `Button` block. */
export interface ProgramButton {
  readonly name: string;
  readonly label: string;
  /** Hotkey: one upper-case letter, or ''. */
  readonly key: string;
  /** The player picks a point or unit on the map after pressing it. */
  readonly aim: boolean;
  /** Index of the handler that runs when it is pressed. */
  readonly handler: number;
}

/** Compiled program: immutable and shared by every unit of a class; per-unit state is in run.ts. */
export interface FlowProgram {
  /** The stored text (JSON) this was compiled from. */
  readonly source: string;
  readonly doc: FlowDoc;
  readonly code: Int32Array;
  readonly varNames: readonly string[];
  readonly varInit: Int32Array;
  /** Size of a handler's local frame (event parameters and call results). */
  readonly nLocals: number;
  /** Memory the program occupies (variables, distinct literals, locals). */
  readonly memory: MemoryUse;
  readonly slots: number;
  readonly handlers: readonly CompiledHandler[];
  /** Event id -> indices of the handlers for it. */
  readonly byEvent: readonly (readonly number[])[];
  readonly buttons: readonly ProgramButton[];
  /** Outcome tables of long-running calls: for each outcome, the instruction its chain starts at (or -1). */
  readonly tables: readonly Int32Array[];
  /** The handler each outcome table belongs to. */
  readonly tableHandler: readonly number[];
  /** Text written in quotes in the program; a text argument is passed to a builtin as an index into this. */
  readonly strings: readonly string[];
}

/** Every problem found in a program, as one error (the first is the message). */
export class FlowCompileError extends FlowError {
  constructor(readonly errors: readonly FlowError[]) {
    super(errors.length > 1 ? `${errors[0].message} (and ${errors.length - 1} more)` : errors[0].message, errors[0].from, errors[0].to, errors[0].node);
  }
}

/** A handler's setting, with the schema's default when the program did not write it. */
export function configValue(h: { readonly event: EventDef; readonly config: Readonly<Record<string, ConfigValue>> }, name: string): ConfigValue {
  const v = h.config[name];
  if (v !== undefined) return v;
  return h.event.config.find((f) => f.name === name)!.default;
}
export const configInt = (h: Parameters<typeof configValue>[0], name: string): number => configValue(h, name) as number;
export const configInts = (h: Parameters<typeof configValue>[0], name: string): readonly number[] => configValue(h, name) as readonly number[];

const BIN_OPS: Record<string, number> = {
  '+': Op.Add, '-': Op.Sub, '*': Op.Mul, '/': Op.Div, '%': Op.Mod, '==': Op.Eq, '!=': Op.Ne, '<': Op.Lt, '<=': Op.Le, '>': Op.Gt, '>=': Op.Ge, '&': Op.BitAnd, '|': Op.BitOr,
};

/** Compiles stored program text (JSON). Throws FlowCompileError listing every problem. */
export function compileProgram(source: string, host: FlowHost, reservedKeys?: ReadonlyMap<string, string>): FlowProgram {
  return compileDoc(parseDoc(source), host, source, reservedKeys);
}

export function compileDoc(doc: FlowDoc, host: FlowHost, source: string, reservedKeys?: ReadonlyMap<string, string>): FlowProgram {
  const analysis = checkDoc(doc, host, reservedKeys);
  if (analysis.errors.length) throw new FlowCompileError(analysis.errors);

  const apiIndex = new Map(host.api.map((b, i) => [b.name, i]));
  const varIndex = new Map(doc.vars.map((v, i) => [v.name, i]));
  const code: number[] = [];
  const emit = (op: number, arg = 0, cost = 0): number => {
    code.push(op, arg, cost);
    return code.length / OP_STRIDE - 1;
  };
  const here = () => code.length / OP_STRIDE;
  const patch = (at: number, target: number) => {
    code[at * OP_STRIDE + 1] = target;
  };

  const handlers: CompiledHandler[] = [];
  const tables: Int32Array[] = [];
  const strings: string[] = [];
  const tableHandler: number[] = [];
  let nLocals = 0;
  const errors: FlowError[] = [];

  for (const h of doc.handlers) {
    const def = EVENT_BY_NAME.get(h.event)!;
    const handlerIndex = handlers.length;
    /** Chains that run later, when a long-running call ends; compiled after the handler's own code. */
    const deferred: (() => void)[] = [];
    // Locals: event parameters first, then call results, scoped to their block.
    const slots = new Map<string, number>();
    const live: string[] = [];
    const declare = (name: string): number => {
      slots.set(name, live.length);
      live.push(name);
      nLocals = Math.max(nLocals, live.length);
      return live.length - 1;
    };
    for (const p of h.params) declare(p);

    const expr = (e: Expr): void => {
      switch (e.k) {
        case 'num':
          emit(Op.Push, e.v);
          break;
        case 'str': {
          let at = strings.indexOf(e.v);
          if (at < 0) at = strings.push(e.v) - 1;
          emit(Op.Push, at);
          break;
        }
        case 'ref': {
          const local = slots.get(e.name);
          if (local !== undefined) emit(Op.LoadL, local, LOCAL_READ_COST);
          else if (varIndex.has(e.name)) emit(Op.Load, varIndex.get(e.name)!, VARIABLE_READ_COST);
          else emit(Op.Push, host.constants.get(e.name)!);
          break;
        }
        case 'un':
          expr(e.a);
          emit(e.op === '-' ? Op.Neg : Op.Not, 0, WIRED_NODE_COST);
          break;
        case 'bin':
          if (e.op === '&&' || e.op === '||') {
            expr(e.a);
            const skip = emit(e.op === '&&' ? Op.Jz : Op.Jnz, 0, WIRED_NODE_COST);
            expr(e.b);
            emit(Op.Not);
            emit(Op.Not);
            const end = emit(Op.Jmp);
            patch(skip, here());
            emit(Op.Push, e.op === '&&' ? 0 : 1);
            patch(end, here());
          } else {
            expr(e.a);
            expr(e.b);
            emit(BIN_OPS[e.op], 0, WIRED_NODE_COST);
          }
          break;
        case 'cond': {
          expr(e.c);
          const other = emit(Op.Jz, 0, WIRED_NODE_COST);
          expr(e.a);
          const end = emit(Op.Jmp);
          patch(other, here());
          expr(e.b);
          patch(end, here());
          break;
        }
        case 'call':
          for (const a of e.args) expr(a);
          emit(Op.Call, apiIndex.get(e.fn)!, WIRED_NODE_COST);
          break;
      }
    };

    const entry = here();
    const block = (list: readonly Stmt[]): void => {
      const mark = live.length;
      for (const s of list) {
        switch (s.k) {
          case 'comment':
            break;
          case 'call': {
            emit(Op.Stmt, 0, STATEMENT_COST);
            for (const a of s.args) expr(a);
            const idx = apiIndex.get(s.fn)!;
            const sig = host.api[idx];
            if (s.outcomes && sig.outcomes) {
              const table = new Int32Array(sig.outcomes.length).fill(-1);
              const tableId = tables.length;
              tables.push(table);
              tableHandler.push(handlerIndex);
              emit(Op.Latent, idx);
              emit(Op.Cont, tableId);
              // Each chain runs in the frame the call was made in, so it sees the same names.
              const scope = [...live];
              sig.outcomes.forEach((name, i) => {
                const chain = s.outcomes![name];
                if (!chain || chain.length === 0) return;
                deferred.push(() => {
                  live.length = 0;
                  live.push(...scope);
                  slots.clear();
                  scope.forEach((n, k) => slots.set(n, k));
                  table[i] = here();
                  block(chain);
                  emit(Op.End);
                });
              });
            } else {
              emit(Op.Call, idx);
            }
            if (s.result !== undefined) emit(Op.StoreL, declare(s.result));
            else emit(Op.Pop);
            break;
          }
          case 'set':
            emit(Op.Stmt, 0, STATEMENT_COST);
            expr(s.value);
            emit(Op.Store, varIndex.get(s.name)!);
            break;
          case 'if': {
            emit(Op.Stmt, 0, STATEMENT_COST);
            expr(s.cond);
            const toElse = emit(Op.Jz);
            block(s.then);
            if (s.else.length) {
              const toEnd = emit(Op.Jmp);
              patch(toElse, here());
              block(s.else);
              patch(toEnd, here());
            } else {
              patch(toElse, here());
            }
            break;
          }
          case 'while': {
            const top = emit(Op.Stmt, 0, STATEMENT_COST);
            expr(s.cond);
            const out = emit(Op.Jz);
            block(s.body);
            emit(Op.Jmp, top);
            patch(out, here());
            break;
          }
        }
      }
      // Locals declared in this block go out of scope.
      while (live.length > mark) slots.delete(live.pop()!);
    };
    block(h.body);
    emit(Op.End);
    while (deferred.length) deferred.shift()!();
    handlers.push({ index: handlers.length, event: def, config: h.config, entry, params: h.params, id: h.id });
  }

  if (code.length / OP_STRIDE > 32000) errors.push(new FlowError('The program is too long'));
  if (errors.length) throw new FlowCompileError(errors);

  const byEvent: number[][] = [];
  for (const h of handlers) (byEvent[h.event.id] ??= []).push(h.index);
  const buttons: ProgramButton[] = [];
  doc.handlers.forEach((h: Handler, i) => {
    if (h.event !== 'Button') return;
    buttons.push({
      name: buttonName(h),
      label: String(configValue(handlers[i], 'label')),
      key: String(configValue(handlers[i], 'key')),
      aim: configInt(handlers[i], 'aim') === 1,
      handler: i,
    });
  });

  return {
    source,
    doc,
    code: Int32Array.from(code),
    varNames: doc.vars.map((v) => v.name),
    varInit: Int32Array.from(doc.vars.map((v) => v.init)),
    nLocals,
    memory: analysis.memory,
    slots: analysis.memory.total,
    handlers,
    byEvent,
    buttons,
    tables,
    tableHandler,
    strings,
  };
}

/** True if the program has any block for the event (the "unhandled events cost nothing" test). */
export const handles = (p: FlowProgram, eventId: number): boolean => (p.byEvent[eventId]?.length ?? 0) > 0;
export { COST, EventId };
