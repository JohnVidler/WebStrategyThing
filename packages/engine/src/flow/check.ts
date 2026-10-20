import { FREE_LITERALS } from './cost';
import { customEventDef, customEventNames, EVENT_BY_NAME, isCustomEventName, MAX_CUSTOM_EVENTS, MAX_CUSTOM_PARAMS, type ConfigField, type EventDef } from './events';
import type { FlowHost } from './host';
import { FlowError, isTextExpr, textParts, type ConfigValue, type Expr, type FlowDoc, type Handler, type Stmt } from './ir';

export const RESERVED_WORDS: ReadonlySet<string> = new Set([
  'on', 'emit', 'use', 'config', 'let', 'const', 'var', 'if', 'else', 'while', 'for', 'return', 'true', 'false', 'function', 'break', 'continue',
]);

export const MAX_BUTTONS = 12;
export const MAX_BUTTON_LABEL = 20;

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const isIdentifier = (s: string): boolean => NAME.test(s);

/** What a program occupies in memory (decision O4/P1): variables, distinct literals, and the largest handler's locals. */
export interface MemoryUse {
  readonly vars: number;
  /** Distinct literal values other than the free ones (-1, 0, 1). */
  readonly literals: number;
  /** Event parameters plus call results of the biggest handler. */
  readonly locals: number;
  readonly total: number;
}

export interface Analysis {
  readonly errors: readonly FlowError[];
  readonly memory: MemoryUse;
}

/** Stable default name of a Button block: its explicit name, else its label as an identifier. */
export function buttonName(h: Handler): string {
  const name = h.config.name;
  if (typeof name === 'string' && name) return name;
  const label = typeof h.config.label === 'string' ? h.config.label : 'Button';
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'button';
}

/**
 * Checks a program against the host: names resolve, calls have the right kind and arity,
 * event configuration matches its schema. Collects every error (does not stop at the first).
 */
/** The longest text a program can write in quotes. */
export const MAX_TEXT = 40;

export function checkDoc(doc: FlowDoc, host: FlowHost, reservedKeys?: ReadonlyMap<string, string>): Analysis {
  const errors: FlowError[] = [];
  const fail = (message: string, node?: string) => errors.push(new FlowError(message, undefined, undefined, node));
  const api = new Map(host.api.map((b) => [b.name, b]));
  const literals = new Set<number>();
  const strings = new Set<string>();

  const vars = new Set<string>();
  for (const v of doc.vars) {
    const at = `var:${v.name}`;
    if (!isIdentifier(v.name) || RESERVED_WORDS.has(v.name)) fail(`'${v.name}' is not a valid variable name`, at);
    else if (vars.has(v.name)) fail(`Variable '${v.name}' is declared twice`, at);
    else if (host.constants.has(v.name) || api.has(v.name) || EVENT_BY_NAME.has(v.name)) fail(`'${v.name}' is already a built-in name`, at);
    else if (!Number.isInteger(v.init) || (v.init | 0) !== v.init) fail(`Variable '${v.name}' needs an integer start value`, at);
    vars.add(v.name);
  }

  const custom = customEventNames(doc);
  if (custom.length > MAX_CUSTOM_EVENTS) fail(`At most ${MAX_CUSTOM_EVENTS} events of your own per class (found ${custom.length})`);
  const seen = new Set<string>();
  const buttons = new Set<string>();
  let maxLocals = 0;

  for (const h of doc.handlers) {
    const def = EVENT_BY_NAME.get(h.event) ?? (isCustomEventName(h.event) ? customEventDef(h.event) : undefined);
    if (!def) {
      fail(`Unknown event '${h.event}' (your own events start with a capital letter)`, h.id);
      continue;
    }
    if (!def.multi && seen.has(def.name)) fail(`A class can only have one ${def.name} block`, h.id);
    seen.add(def.name);
    checkConfig(h, def, fail, reservedKeys);
    if (def.name === 'Button') {
      const name = buttonName(h);
      if (buttons.has(name)) fail(`Two Button blocks are called '${name}'`, h.id);
      buttons.add(name);
      if (buttons.size > MAX_BUTTONS) fail(`At most ${MAX_BUTTONS} buttons per class`, h.id);
      const label = h.config.label;
      if (typeof label === 'string' && (!label.trim() || label.length > MAX_BUTTON_LABEL)) fail(`Button labels must be 1-${MAX_BUTTON_LABEL} characters`, h.id);
    }

    // Locals (event parameters, then call results) are scoped to their block.
    const locals = new Set<string>();
    const declared: string[] = [];
    if (!EVENT_BY_NAME.has(def.name) && h.params.length > MAX_CUSTOM_PARAMS) fail(`An event of your own carries at most ${MAX_CUSTOM_PARAMS} values`, h.id);
    else if (h.params.length > def.params.length) fail(`${def.name} has only ${def.params.length} parameter(s): ${def.params.join(', ') || 'none'}`, h.id);
    for (const p of h.params) declareLocal(p, h.id);

    function declareLocal(name: string, node: string): void {
      if (!isIdentifier(name) || RESERVED_WORDS.has(name)) fail(`'${name}' is not a valid name`, node);
      else if (locals.has(name) || vars.has(name) || host.constants.has(name) || api.has(name)) fail(`'${name}' is already used`, node);
      locals.add(name);
      declared.push(name);
      maxLocals = Math.max(maxLocals, locals.size);
    }

    const expr = (e: Expr, node: string): void => {
      switch (e.k) {
        case 'num':
          if (!Number.isInteger(e.v) || (e.v | 0) !== e.v) fail(`${String(e.v)} is not a whole number`, node);
          else if (!FREE_LITERALS.has(e.v)) literals.add(e.v);
          break;
        case 'str':
          fail('Text in quotes is only allowed where a function takes text, such as alert()', node);
          break;
        case 'ref':
          if (!locals.has(e.name) && !vars.has(e.name) && !host.constants.has(e.name)) fail(`Unknown name '${e.name}'`, node);
          break;
        case 'un':
          expr(e.a, node);
          break;
        case 'bin':
          if (isTextExpr(e)) {
            fail('Text in quotes is only allowed where a function takes text, such as alert()', node);
            break;
          }
          expr(e.a, node);
          expr(e.b, node);
          break;
        case 'cond':
          expr(e.c, node);
          expr(e.a, node);
          expr(e.b, node);
          break;
        case 'call': {
          const b = api.get(e.fn);
          if (!b) fail(`Unknown function '${e.fn}'`, node);
          else if (b.kind !== 'query') {
            fail(`${b.name}() ${b.kind === 'action' ? 'is an action' : 'is a runtime setting'}: call it as a statement${b.kind === 'config' ? ' (config.' + b.name + ')' : ''}, not inside an expression`, node);
          } else if (e.args.length !== b.argc) fail(`${b.name}() takes ${b.argc} argument(s), not ${e.args.length}`, node);
          callArgs(b, e.args, node);
          break;
        }
      }
    };

    const callArgs = (b: { name: string; text?: readonly number[] } | undefined, args: readonly Expr[], node: string): void => {
      args.forEach((a, i) => {
        if (!b?.text?.includes(i)) return expr(a, node);
        if (!isTextExpr(a)) return fail(`Argument ${i + 1} of ${b.name}() is text: write it in quotes (or join values with +, as 'HP: ' + hp)`, node);
        for (const part of textParts(a)) {
          if (part.k !== 'str') {
            expr(part, node);
            continue;
          }
          if (part.v.length > MAX_TEXT) fail(`Text is limited to ${MAX_TEXT} characters`, node);
          else if (/[\u0000-\u001f]/.test(part.v)) fail('Text cannot contain line breaks or control characters', node);
          strings.add(part.v);
        }
      });
    };

    const block = (list: readonly Stmt[]): void => {
      const mark = declared.length;
      for (const s of list) {
        switch (s.k) {
          case 'comment':
            break;
          case 'call': {
            const b = api.get(s.fn);
            if (!b) fail(`Unknown function '${s.fn}'`, s.id);
            else if (s.args.length !== b.argc) fail(`${b.name}() takes ${b.argc} argument(s), not ${s.args.length}`, s.id);
            callArgs(b, s.args, s.id);
            if (s.outcomes) {
              for (const [name, chain] of Object.entries(s.outcomes)) {
                if (!b?.outcomes?.includes(name)) {
                  fail(b?.outcomes ? `${b.name}() ends in: ${b.outcomes.join(', ')} (not '${name}')` : `${s.fn}() has no outcomes to attach chains to`, s.id);
                } else {
                  // A chain runs later, in the frame the call was made in: what is in scope now is in scope there.
                  block(chain);
                }
              }
            }
            if (s.result !== undefined) declareLocal(s.result, s.id);
            break;
          }
          case 'emit':
            if (EVENT_BY_NAME.has(s.event)) fail(`${s.event} is a built-in event: emit() is for events of your own`, s.id);
            else if (!isCustomEventName(s.event)) fail(`'${s.event}' is not a valid event name (start with a capital letter)`, s.id);
            if (s.args.length > MAX_CUSTOM_PARAMS) fail(`emit() carries at most ${MAX_CUSTOM_PARAMS} values`, s.id);
            for (const a of s.args) expr(a, s.id);
            break;
          case 'set':
            if (!vars.has(s.name)) fail(`Only variables can be assigned; '${s.name}' is not one (declare it with let)`, s.id);
            expr(s.value, s.id);
            break;
          case 'if':
            expr(s.cond, s.id);
            block(s.then);
            block(s.else);
            break;
          case 'while':
            expr(s.cond, s.id);
            block(s.body);
            break;
        }
      }
      while (declared.length > mark) locals.delete(declared.pop()!);
    };
    block(h.body);
  }

  const memory: MemoryUse = {
    vars: vars.size,
    literals: literals.size + strings.size,
    locals: maxLocals,
    total: vars.size + literals.size + strings.size + maxLocals,
  };
  return { errors, memory };
}

function checkConfig(h: Handler, def: EventDef, fail: (m: string, node?: string) => void, reservedKeys?: ReadonlyMap<string, string>): void {
  const known = new Map(def.config.map((f) => [f.name, f]));
  for (const [key, value] of Object.entries(h.config)) {
    const field = known.get(key);
    if (!field) {
      fail(`${def.name} has no setting '${key}'${def.config.length ? ` (it has: ${def.config.map((f) => f.name).join(', ')})` : ''}`, h.id);
      continue;
    }
    const problem = configProblem(field, value);
    if (problem) fail(`${def.name} ${key}: ${problem}`, h.id);
  }
  const key = h.config.key;
  if (def.name === 'Button' && typeof key === 'string' && key) {
    if (!/^[A-Z]$/.test(key)) fail(`Button key must be one upper-case letter, not '${key}'`, h.id);
    else if (reservedKeys?.has(key)) fail(`Button key '${key}' is taken by ${reservedKeys.get(key)}`, h.id);
  }
}

export function configProblem(field: ConfigField, value: ConfigValue): string | null {
  if (field.type === 'string') return typeof value === 'string' ? null : 'needs text';
  if (field.type === 'ints') {
    return Array.isArray(value) && value.every((n) => Number.isInteger(n)) ? null : 'needs a list of whole numbers, such as [MOVE]';
  }
  if (typeof value !== 'number' || !Number.isInteger(value)) return 'needs a whole number';
  if (field.min !== undefined && value < field.min) return `must be at least ${field.min}`;
  if (field.max !== undefined && value > field.max) return `must be at most ${field.max}`;
  return null;
}
