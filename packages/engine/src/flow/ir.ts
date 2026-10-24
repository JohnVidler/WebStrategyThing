/**
 * The Flow IR: the one model behind both views of a program (the node graph and the
 * TypeScript-subset text). It is structured (nested statement lists, no goto), so
 * the text is a pretty-print of it and parsing text gives it back.
 *
 * Stored form: the JSON of a `FlowDoc` (see `serialize` / `parseDoc`).
 */

export const FLOW_FORMAT = 'wst-flow';
export const FLOW_VERSION = 1;

export type BinOp = '+' | '-' | '*' | '/' | '%' | '==' | '!=' | '<' | '<=' | '>' | '>=' | '&&' | '||' | '&' | '|';
export type UnOp = '-' | '!';

export type Expr =
  | { readonly k: 'num'; readonly v: number }
  /** Text in quotes. Only allowed where a built-in takes text (see `BuiltinSig.text`), such as `alert`. */
  | { readonly k: 'str'; readonly v: string }
  /** A variable, an event parameter, a call result or a constant (MOVE, ENEMY, ...). */
  | { readonly k: 'ref'; readonly name: string }
  | { readonly k: 'un'; readonly op: UnOp; readonly a: Expr }
  | { readonly k: 'bin'; readonly op: BinOp; readonly a: Expr; readonly b: Expr }
  | { readonly k: 'cond'; readonly c: Expr; readonly a: Expr; readonly b: Expr }
  /** A query (reads state, no effect). Actions are statements. */
  | { readonly k: 'call'; readonly fn: string; readonly args: readonly Expr[] };

/** True for text: a quoted string, or a `+` with text on either side (`'HP: ' + hp`). Only allowed where a built-in takes text. */
export function isTextExpr(e: Expr): boolean {
  return e.k === 'str' || (e.k === 'bin' && e.op === '+' && (isTextExpr(e.a) || isTextExpr(e.b)));
}

/** The pieces of a text expression in order, left to right: `'a' + 1 + 2` is ['a', 1, 2]; `1 + 2 + 'a'` is [1 + 2, 'a']. */
export function textParts(e: Expr): Expr[] {
  if (e.k === 'bin' && e.op === '+' && isTextExpr(e)) return [...(isTextExpr(e.a) ? textParts(e.a) : [e.a]), ...(isTextExpr(e.b) ? textParts(e.b) : [e.b])];
  return [e];
}

/** True for a value that prints as true / false: a comparison, logic or `!`. */
export const isBoolExpr = (e: Expr): boolean => (e.k === 'un' && e.op === '!') || (e.k === 'bin' && ['==', '!=', '<', '<=', '>', '>=', '&&', '||'].includes(e.op));

export type Stmt =
  /** An action, runtime setting or (discarded) query. `result` names a local bound to the return value. */
  | {
      readonly id: string;
      readonly k: 'call';
      readonly fn: string;
      readonly args: readonly Expr[];
      readonly result?: string;
      /** For a long-running call: what to do when it ends in each way, by outcome name. */
      readonly outcomes?: Readonly<Record<string, readonly Stmt[]>>;
    }
  | { readonly id: string; readonly k: 'set'; readonly name: string; readonly value: Expr }
  | { readonly id: string; readonly k: 'if'; readonly cond: Expr; readonly then: readonly Stmt[]; readonly else: readonly Stmt[] }
  | { readonly id: string; readonly k: 'while'; readonly cond: Expr; readonly body: readonly Stmt[] }
  /** Raises an event of the program's own (up to four values) for this unit's `on(Name)` blocks. */
  | { readonly id: string; readonly k: 'emit'; readonly event: string; readonly args: readonly Expr[] }
  | { readonly id: string; readonly k: 'comment'; readonly text: string };

/** Event source configuration: constants only. */
export type ConfigValue = number | string | readonly number[];

export interface Handler {
  readonly id: string;
  /** Event name, as in the events table (`Idle`, `Detected`, ...). */
  readonly event: string;
  readonly config: Readonly<Record<string, ConfigValue>>;
  /** Names for the event's parameters (data outputs of the event block). */
  readonly params: readonly string[];
  readonly body: readonly Stmt[];
  /** Comment lines written above the block. */
  readonly note?: string;
}

export interface VarDecl {
  readonly name: string;
  readonly init: number;
  /** Comment lines written above the declaration. */
  readonly note?: string;
}

/** Editor-only data: never needed to run the program. */
export interface FlowViews {
  readonly graph?: {
    /** Node id -> [x, y]. */
    readonly pos?: Readonly<Record<string, readonly [number, number]>>;
    /** Unfinished graph pieces (loose chains and expressions); the editor owns the shape. */
    readonly scratch?: unknown;
  };
}

/** A use of a built-in block (`use(HarvestLoop, { minMatter: 10 })`): a template that expands into plain variables and event blocks. */
export interface BlockUse {
  readonly id: string;
  readonly block: string;
  /** Only the settings the program wrote; the block's defaults fill in the rest. */
  readonly settings: Readonly<Record<string, ConfigValue>>;
  /** Comment lines written above the `use`. */
  readonly note?: string;
}

export interface FlowDoc {
  readonly format: typeof FLOW_FORMAT;
  readonly version: number;
  readonly vars: readonly VarDecl[];
  readonly handlers: readonly Handler[];
  /** Built-in blocks in use; they expand into more variables and handlers when the program is checked and compiled. */
  readonly blocks?: readonly BlockUse[];
  readonly views?: FlowViews;
}

export class FlowError extends Error {
  constructor(
    message: string,
    /** Offset range in the text, when the error came from parsing text. */
    readonly from?: number,
    readonly to?: number,
    /** Node id, when the error came from checking a document. */
    readonly node?: string,
  ) {
    super(message);
  }
}

export const emptyDoc = (): FlowDoc => ({ format: FLOW_FORMAT, version: FLOW_VERSION, vars: [], handlers: [] });

/** True for a stored flow program (as opposed to an empty string). */
export const isFlowSource = (source: string): boolean => source.trimStart().startsWith('{');

/** Canonical JSON: stable key order so equal programs have equal text. */
export function serialize(doc: FlowDoc): string {
  return JSON.stringify(doc, (_key, value: unknown) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const o = value as Record<string, unknown>;
      return Object.fromEntries(Object.keys(o).sort(keyOrder).map((key) => [key, o[key]]));
    }
    return value;
  });
}

const KEY_FIRST = ['format', 'version', 'id', 'k', 'event', 'name', 'fn', 'op'];
function keyOrder(a: string, b: string): number {
  const ia = KEY_FIRST.indexOf(a);
  const ib = KEY_FIRST.indexOf(b);
  if (ia >= 0 || ib >= 0) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Parses stored JSON. Shape problems throw FlowError; semantic checks are in `check`. */
export function parseDoc(source: string): FlowDoc {
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch {
    throw new FlowError('The program is not valid JSON');
  }
  const doc = raw as Partial<FlowDoc> | null;
  if (!doc || typeof doc !== 'object' || doc.format !== FLOW_FORMAT) throw new FlowError(`Not a ${FLOW_FORMAT} program`);
  if (doc.version !== FLOW_VERSION) throw new FlowError(`Unsupported flow version ${String(doc.version)}`);
  if (!Array.isArray(doc.vars) || !Array.isArray(doc.handlers)) throw new FlowError('Program needs vars and handlers');
  const problem = shapeProblem(doc);
  if (problem) throw new FlowError(problem);
  return doc as FlowDoc;
}

/** Deepest nesting of statements and expressions a stored program may have (the checker and compiler recurse over it). */
export const MAX_NESTING = 200;

const BIN_OP_SET: ReadonlySet<string> = new Set(['+', '-', '*', '/', '%', '==', '!=', '<', '<=', '>', '>=', '&&', '||', '&', '|']);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number';
const isConfigValue = (v: unknown): boolean => isNum(v) || isStr(v) || (Array.isArray(v) && v.every(isNum));

/**
 * Checks that stored JSON has the IR's shape, without recursion: a program from the network can be
 * nested deeper than the call stack, and a missing field would otherwise surface as a TypeError
 * deep in the checker. Returns the first problem, or null.
 */
function shapeProblem(doc: Record<string, unknown>): string | null {
  if (doc.blocks !== undefined && !Array.isArray(doc.blocks)) return 'blocks must be a list';
  for (const v of doc.vars as unknown[]) if (!isObj(v) || !isStr(v.name) || !isNum(v.init)) return 'Every variable needs a name and a start value';
  for (const b of (doc.blocks ?? []) as unknown[]) {
    if (!isObj(b) || !isStr(b.id) || !isStr(b.block) || !isObj(b.settings) || !Object.values(b.settings).every(isConfigValue)) return 'Malformed block use';
  }
  // Work list of [value, 's' (statement list) | 'e' (expression), depth].
  const work: [unknown, 's' | 'e', number][] = [];
  for (const h of doc.handlers as unknown[]) {
    if (!isObj(h) || !isStr(h.id) || !isStr(h.event) || !isObj(h.config) || !Array.isArray(h.params)) return 'Malformed event block';
    if (!h.params.every(isStr) || !Object.values(h.config).every(isConfigValue)) return `Malformed event block ${h.id}`;
    work.push([h.body, 's', 1]);
  }
  while (work.length) {
    const [v, kind, depth] = work.pop()!;
    if (depth > MAX_NESTING) return `The program is nested too deeply (more than ${MAX_NESTING} levels)`;
    const d = depth + 1;
    if (kind === 's') {
      if (!Array.isArray(v)) return 'Malformed statement list';
      for (const s of v as unknown[]) {
        if (!isObj(s) || !isStr(s.id)) return 'Malformed statement';
        switch (s.k) {
          case 'call':
            if (!isStr(s.fn) || !Array.isArray(s.args) || (s.result !== undefined && !isStr(s.result))) return `Malformed call ${s.id}`;
            for (const a of s.args) work.push([a, 'e', d]);
            if (s.outcomes !== undefined) {
              if (!isObj(s.outcomes)) return `Malformed call ${s.id}`;
              for (const chain of Object.values(s.outcomes)) work.push([chain, 's', d]);
            }
            break;
          case 'set':
            if (!isStr(s.name)) return `Malformed assignment ${s.id}`;
            work.push([s.value, 'e', d]);
            break;
          case 'if':
            work.push([s.cond, 'e', d], [s.then, 's', d], [s.else, 's', d]);
            break;
          case 'while':
            work.push([s.cond, 'e', d], [s.body, 's', d]);
            break;
          case 'emit':
            if (!isStr(s.event) || !Array.isArray(s.args)) return `Malformed emit ${s.id}`;
            for (const a of s.args) work.push([a, 'e', d]);
            break;
          case 'comment':
            if (!isStr(s.text)) return `Malformed comment ${s.id}`;
            break;
          default:
            return `Unknown statement kind in ${s.id}`;
        }
      }
      continue;
    }
    if (!isObj(v)) return 'Malformed expression';
    switch (v.k) {
      case 'num':
        if (!isNum(v.v)) return 'Malformed number';
        break;
      case 'str':
        if (!isStr(v.v)) return 'Malformed text';
        break;
      case 'ref':
        if (!isStr(v.name)) return 'Malformed name';
        break;
      case 'un':
        if (v.op !== '-' && v.op !== '!') return 'Unknown operator';
        work.push([v.a, 'e', d]);
        break;
      case 'bin':
        if (!isStr(v.op) || !BIN_OP_SET.has(v.op)) return 'Unknown operator';
        work.push([v.a, 'e', d], [v.b, 'e', d]);
        break;
      case 'cond':
        work.push([v.c, 'e', d], [v.a, 'e', d], [v.b, 'e', d]);
        break;
      case 'call':
        if (!isStr(v.fn) || !Array.isArray(v.args)) return 'Malformed call';
        for (const a of v.args) work.push([a, 'e', d]);
        break;
      default:
        return 'Unknown expression kind';
    }
  }
  return null;
}

/** A short stable id generator for new nodes (`n1`, `n2`, ...), continuing after the highest used (in the document, and among `reserved` ids such as the editor's loose pieces). */
export function idGenerator(doc?: FlowDoc, reserved: Iterable<string> = []): () => string {
  let max = 0;
  const seen = (id: string) => {
    const m = /^n(\d+)$/.exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  };
  const walk = (list: readonly Stmt[]) => {
    for (const s of list) {
      seen(s.id);
      if (s.k === 'if') (walk(s.then), walk(s.else));
      else if (s.k === 'while') walk(s.body);
      else if (s.k === 'call' && s.outcomes) for (const chain of Object.values(s.outcomes)) walk(chain);
    }
  };
  for (const h of doc?.handlers ?? []) (seen(h.id), walk(h.body));
  for (const b of doc?.blocks ?? []) seen(b.id);
  for (const id of reserved) seen(id);
  return () => `n${++max}`;
}
