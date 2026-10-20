import {
  EVENT_BY_NAME,
  MAX_TEXT,
  isIdentifier,
  type BinOp,
  type ConfigValue,
  type Expr,
  type FlowDoc,
  type FlowHost,
  type FlowViews,
  type Handler,
  type Stmt,
} from '@wst/engine';

/*
 * Graph edits as operations on the IR.
 *
 * The IR is the truth: the graph view never edits its own copy, it asks for one of these
 * operations and shows the program that comes back. Each operation takes a `Program` (the
 * IR plus the *scratch* area, where unfinished graph pieces live: statement chains and
 * expressions that are not attached to anything yet) and returns a new one, or throws an
 * `OpError` saying why the edit is not allowed. Nothing here touches the DOM.
 *
 * Structure rules (they are what keep every graph expressible as text):
 *  - execution wires form chains: each statement has one way in, and each exec output feeds one chain;
 *  - connecting an exec output replaces what it fed (that chain moves to the scratch area);
 *  - a data node (an operator or a query) feeds exactly one input; to reuse a value, bind it with `const`
 *    or keep it in a variable;
 *  - event parameters and call results can feed any number of inputs, but only where they are in scope.
 */

export class OpError extends Error {}

/** A statement chain or expression that is not attached to the program. Lives in `views.graph.scratch`. */
export interface Scratch {
  readonly chains: readonly (readonly Stmt[])[];
  readonly exprs: readonly { readonly id: string; readonly expr: Expr }[];
}

export const emptyScratch: Scratch = { chains: [], exprs: [] };

export interface Program {
  readonly doc: FlowDoc;
  readonly scratch: Scratch;
}

/** Where an exec output leads: the start of a handler, the statement after one, or a nested list. */
export type ExecRef =
  | { readonly k: 'start'; readonly handler: string }
  | { readonly k: 'next'; readonly stmt: string }
  | { readonly k: 'then'; readonly stmt: string }
  | { readonly k: 'else'; readonly stmt: string }
  | { readonly k: 'body'; readonly stmt: string }
  /** What follows when a long-running call ends in the given way. */
  | { readonly k: 'outcome'; readonly stmt: string; readonly name: string };

/** A data input: `owner` is a statement or scratch expression id, `path` leads to the input inside it. */
export interface Slot {
  readonly owner: string;
  readonly path: string;
}

export type DataSource =
  /** An event parameter or a call result, by name. */
  | { readonly k: 'local'; readonly name: string }
  /** A data node, by its node id. */
  | { readonly k: 'node'; readonly id: string };

/** Id of the graph node for the expression at `path` inside `owner`. */
export const exprNodeId = (owner: string, path: string): string => `${owner}#${path}`;
export const parseExprNodeId = (id: string): Slot => {
  const i = id.indexOf('#');
  return { owner: id.slice(0, i), path: id.slice(i + 1) };
};
export const isExprNodeId = (id: string): boolean => id.includes('#');
const join = (path: string, seg: string | number): string => (path ? `${path}.${seg}` : String(seg));

// --- plain-object plumbing (programs are small, so every op works on a copy) -------------------

type Mutable = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const cloneProgram = (p: Program): { doc: Mutable; scratch: Mutable } => clone({ doc: p.doc, scratch: p.scratch });

const segments = (path: string): (string | number)[] => (path ? path.split('.').map((s) => (/^\d+$/.test(s) ? Number(s) : s)) : []);

function getIn(root: Mutable, path: string): Mutable {
  let cur = root;
  for (const seg of segments(path)) {
    if (cur === undefined || cur === null) return undefined;
    cur = cur[seg];
  }
  return cur;
}

function setIn(root: Mutable, path: string, value: Mutable): void {
  const segs = segments(path);
  let cur = root;
  for (let i = 0; i < segs.length - 1; i++) cur = cur[segs[i]];
  cur[segs[segs.length - 1]] = value;
}

// --- finding things -------------------------------------------------------------------------

type ListRef =
  | { readonly handler: string }
  | { readonly stmt: string; readonly branch: 'then' | 'else' | 'body' }
  | { readonly stmt: string; readonly outcome: string }
  | { readonly chain: number };

interface Found {
  readonly list: Mutable[];
  readonly index: number;
  readonly stmt: Mutable;
  readonly ref: ListRef;
}

function findStmtIn(list: Mutable[], ref: ListRef, id: string): Found | undefined {
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    if (s.id === id) return { list, index: i, stmt: s, ref };
    if (s.k === 'if') {
      const hit = findStmtIn(s.then, { stmt: s.id, branch: 'then' }, id) ?? findStmtIn(s.else, { stmt: s.id, branch: 'else' }, id);
      if (hit) return hit;
    } else if (s.k === 'while') {
      const hit = findStmtIn(s.body, { stmt: s.id, branch: 'body' }, id);
      if (hit) return hit;
    } else if (s.k === 'call' && s.outcomes) {
      for (const [name, chain] of Object.entries(s.outcomes as Record<string, Mutable[]>)) {
        const hit = findStmtIn(chain, { stmt: s.id, outcome: name }, id);
        if (hit) return hit;
      }
    }
  }
  return undefined;
}

function findStmt(p: { doc: Mutable; scratch: Mutable }, id: string): Found | undefined {
  for (const h of p.doc.handlers) {
    const hit = findStmtIn(h.body, { handler: h.id }, id);
    if (hit) return hit;
  }
  for (let c = 0; c < p.scratch.chains.length; c++) {
    const hit = findStmtIn(p.scratch.chains[c], { chain: c }, id);
    if (hit) return hit;
  }
  return undefined;
}

/** The list an ExecRef starts, and where in it the chain begins. */
function chainAt(p: { doc: Mutable; scratch: Mutable }, ref: ExecRef): { list: Mutable[]; at: number } {
  switch (ref.k) {
    case 'start': {
      const h = p.doc.handlers.find((x: Handler) => x.id === ref.handler);
      if (!h) throw new OpError('That block no longer exists');
      return { list: h.body, at: 0 };
    }
    case 'next': {
      const f = findStmt(p, ref.stmt);
      if (!f) throw new OpError('That node no longer exists');
      return { list: f.list, at: f.index + 1 };
    }
    case 'outcome': {
      const f = findStmt(p, ref.stmt);
      if (!f || f.stmt.k !== 'call') throw new OpError('That node no longer exists');
      f.stmt.outcomes ??= {};
      return { list: (f.stmt.outcomes[ref.name] ??= []), at: 0 };
    }
    default: {
      const f = findStmt(p, ref.stmt);
      if (!f) throw new OpError('That node no longer exists');
      const list = ref.k === 'then' ? f.stmt.then : ref.k === 'else' ? f.stmt.else : f.stmt.body;
      if (!Array.isArray(list)) throw new OpError('That node has no such output');
      return { list, at: 0 };
    }
  }
}

const idsIn = (list: readonly Mutable[], out = new Set<string>()): Set<string> => {
  for (const s of list) {
    out.add(s.id);
    if (s.k === 'if') (idsIn(s.then, out), idsIn(s.else, out));
    else if (s.k === 'while') idsIn(s.body, out);
    else if (s.k === 'call' && s.outcomes) for (const chain of Object.values(s.outcomes as Record<string, Mutable[]>)) idsIn(chain, out);
  }
  return out;
};

/** A fresh `n<number>` id, above every id in the document and the scratch area. */
export function freshId(p: Program): string {
  let max = 0;
  const seen = (id: string) => {
    const m = /^n(\d+)/.exec(id);
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
  for (const h of p.doc.handlers) (seen(h.id), walk(h.body));
  for (const c of p.scratch.chains) walk(c);
  for (const e of p.scratch.exprs) seen(e.id);
  return `n${max + 1}`;
}

/** Drops outcome chains that ended up empty, and an outcomes object with nothing left in it. */
function pruneOutcomes(list: Mutable[]): void {
  for (const s of list) {
    if (s.k === 'if') (pruneOutcomes(s.then), pruneOutcomes(s.else));
    else if (s.k === 'while') pruneOutcomes(s.body);
    else if (s.k === 'call' && s.outcomes) {
      for (const [name, chain] of Object.entries(s.outcomes as Record<string, Mutable[]>)) {
        pruneOutcomes(chain);
        if (chain.length === 0) delete s.outcomes[name];
      }
      if (Object.keys(s.outcomes).length === 0) delete s.outcomes;
    }
  }
}

const tidy = (p: { doc: Mutable; scratch: Mutable }): Program => {
  for (const h of p.doc.handlers as Handler[]) pruneOutcomes(h.body as Mutable[]);
  for (const c of p.scratch.chains as Mutable[][]) pruneOutcomes(c);
  return tidied(p);
};

const tidied = (p: { doc: Mutable; scratch: Mutable }): Program => ({
  doc: p.doc as FlowDoc,
  scratch: { chains: (p.scratch.chains as Mutable[][]).filter((c) => c.length > 0), exprs: p.scratch.exprs } as Scratch,
});

// --- execution wires ---------------------------------------------------------------------------

/**
 * Wires an exec output to a statement: the chain starting at `to` (that statement and everything
 * after it) becomes what `from` feeds. What `from` fed before moves to the scratch area, and `to`
 * leaves wherever it was.
 */
export function connectExec(program: Program, from: ExecRef, to: string): Program {
  const p = cloneProgram(program);
  const target = findStmt(p, to);
  if (!target) throw new OpError('That node no longer exists');
  const tail = target.list.slice(target.index);
  if ('stmt' in from && idsIn(tail).has(from.stmt)) throw new OpError('That would make the program loop back on itself: use a while loop instead');
  // Take the chain out of where it was.
  target.list.splice(target.index);
  // (Locate the output again: removing the chain can only shorten the list it sits in.)
  const { list, at } = chainAt(p, from);
  const replaced = list.splice(at);
  list.push(...tail);
  if (replaced.length) p.scratch.chains.push(replaced);
  return tidy(p);
}

/** Cuts an exec wire: the chain it fed moves to the scratch area. */
export function disconnectExec(program: Program, from: ExecRef): Program {
  const p = cloneProgram(program);
  const { list, at } = chainAt(p, from);
  const cut = list.splice(at);
  if (cut.length) p.scratch.chains.push(cut);
  return tidy(p);
}

// --- data wires -------------------------------------------------------------------------------------

/** The expression at a slot (the thing wired or typed into that input). */
export function exprAt(p: Program, slot: Slot): Expr | undefined {
  return findOwnerRoot(clone({ doc: p.doc, scratch: p.scratch }), slot.owner, slot.path)?.value;
}

interface OwnerRoot {
  readonly holder: Mutable;
  readonly path: string;
  readonly value: Mutable;
}

/** Resolves (owner, path) to the object that holds the expression and the path inside it. */
function findOwnerRoot(p: { doc: Mutable; scratch: Mutable }, owner: string, path: string): OwnerRoot | undefined {
  const stmt = findStmt(p, owner)?.stmt;
  if (stmt) return { holder: stmt, path, value: getIn(stmt, path) };
  const scratch = p.scratch.exprs.find((e: { id: string }) => e.id === owner);
  if (scratch) {
    // A scratch expression is itself the root: the path starts at it ('' is the root).
    return { holder: scratch, path: path ? `expr.${path}` : 'expr', value: getIn(scratch, path ? `expr.${path}` : 'expr') };
  }
  return undefined;
}

const LITERAL_ZERO: Expr = { k: 'num', v: 0 };

/** Statement ids visible to a data input: the block's parameters and the results bound earlier on the same path. */
export function localsInScope(program: Program, stmtId: string): Set<string> {
  const names = new Set<string>();
  const handlerOf = (list: readonly Stmt[], params: readonly string[], target: string): boolean => {
    const walk = (l: readonly Stmt[], scope: string[]): boolean => {
      const here = [...scope];
      for (const s of l) {
        if (s.id === target) {
          for (const n of here) names.add(n);
          return true;
        }
        if (s.k === 'if') {
          if (walk(s.then, here) || walk(s.else, here)) return true;
        } else if (s.k === 'while') {
          if (walk(s.body, here)) return true;
        } else if (s.k === 'call' && s.outcomes) {
          for (const chain of Object.values(s.outcomes)) if (walk(chain, here)) return true;
        }
        if (s.k === 'call' && s.result !== undefined) here.push(s.result);
      }
      return false;
    };
    return walk(list, [...params]);
  };
  for (const h of program.doc.handlers) if (handlerOf(h.body, h.params, stmtId)) return names;
  for (const c of program.scratch.chains) if (handlerOf(c, [], stmtId)) return names;
  return names;
}

/** Id of the statement that owns a data node or slot owner (a scratch expression owns itself). */
const ownerStmt = (owner: string): string => owner;

/**
 * Wires a data source into an input. An event parameter or call result becomes a reference
 * (and may feed many inputs); a data node moves into the input (and feeds only it). Whatever was
 * in the input before: a node moves to the scratch area, a plain value is dropped.
 */
export function connectData(program: Program, source: DataSource, slot: Slot): Program {
  const p = cloneProgram(program);
  const dest = findOwnerRoot(p, slot.owner, slot.path);
  if (!dest) throw new OpError('That input no longer exists');
  let value: Mutable;
  if (source.k === 'local') {
    if (!/^[A-Za-z_]\w*$/.test(source.name)) throw new OpError('That value has no name yet');
    const scope = localsInScope(program, ownerStmt(slot.owner));
    if (findStmt(p, slot.owner) && !scope.has(source.name)) {
      throw new OpError(`${source.name} is not available here: a value can only be used after the node that makes it, on the same path`);
    }
    value = { k: 'ref', name: source.name };
  } else {
    const src = parseExprNodeId(source.id);
    // Wiring a node into itself or into one of its own inputs.
    if (src.owner === slot.owner && (src.path === '' || slot.path === src.path || slot.path.startsWith(src.path + '.'))) {
      throw new OpError('A node cannot feed itself');
    }
    const from = findOwnerRoot(p, src.owner, src.path);
    if (!from || from.value === undefined) throw new OpError('That node no longer exists');
    if (isConsumed(p, src)) throw new OpError('That node already feeds another input: reuse a value by binding it with const, or keep it in a variable');
    value = from.value;
    // Take it out of where it was (a scratch root disappears; a nested one is replaced by zero).
    if (p.scratch.exprs.some((e: { id: string }) => e.id === src.owner) && src.path === '') {
      p.scratch.exprs = p.scratch.exprs.filter((e: { id: string }) => e.id !== src.owner);
    } else {
      setIn(from.holder, from.path, clone(LITERAL_ZERO));
    }
  }
  // Recompute the destination after the source was taken out (ids of scratch roots may have gone).
  const target = findOwnerRoot(p, slot.owner, slot.path);
  if (!target) throw new OpError('That input no longer exists');
  const old = target.value;
  if (old && isNodeExpr(old)) p.scratch.exprs.push({ id: freshIdIn(p), expr: old });
  setIn(target.holder, target.path, value);
  return tidy(p);
}

/** Is this data node already wired into an input? (Scratch roots and nodes with no consumer are free.) */
function isConsumed(p: { doc: Mutable; scratch: Mutable }, src: Slot): boolean {
  return !(p.scratch.exprs.some((e: { id: string }) => e.id === src.owner) && src.path === '');
}

const isNodeExpr = (e: Mutable): boolean => e && e.k !== 'num' && e.k !== 'str' && e.k !== 'ref';

function freshIdIn(p: { doc: Mutable; scratch: Mutable }): string {
  return freshId({ doc: p.doc, scratch: p.scratch });
}

/**
 * Cuts a data wire: a node that fed the input moves to the scratch area (`detached` is its new
 * node id, so a drag that picked the wire up can carry on from it), and the input goes back to 0.
 */
export function disconnectData(program: Program, slot: Slot): { program: Program; detached?: string } {
  const p = cloneProgram(program);
  const at = findOwnerRoot(p, slot.owner, slot.path);
  if (!at) throw new OpError('That input no longer exists');
  const old = at.value;
  let detached: string | undefined;
  if (old && isNodeExpr(old)) {
    const id = freshIdIn(p);
    p.scratch.exprs.push({ id, expr: old });
    detached = exprNodeId(id, '');
  }
  setIn(at.holder, at.path, clone(LITERAL_ZERO));
  return { program: tidy(p), detached };
}

/** Types a value into an input: a whole number, or the name of a constant such as MOVE. */
export function setLiteral(program: Program, slot: Slot, text: string, host: FlowHost): Program {
  const trimmed = text.trim();
  const p = cloneProgram(program);
  const at = findOwnerRoot(p, slot.owner, slot.path);
  if (!at) throw new OpError('That input no longer exists');
  let value: Expr;
  if (at.value?.k === 'str') {
    // A text input takes what is typed, with or without quotes.
    const quoted = /^(['"])(.*)$/.exec(trimmed);
    value = { k: 'str', v: quoted ? quoted[2] : text };
    if (value.v.length > MAX_TEXT) throw new OpError(`Text is limited to ${MAX_TEXT} characters`);
  } else if (/^-?\d+$/.test(trimmed)) value = { k: 'num', v: Number(trimmed) };
  else if (host.constants.has(trimmed)) value = { k: 'ref', name: trimmed };
  else throw new OpError(`'${trimmed}' is not a whole number or a constant such as MOVE`);
  if (at.value && isNodeExpr(at.value)) throw new OpError('That input is wired to a node');
  setIn(at.holder, at.path, value);
  return tidy(p);
}

/** Changes the operator of a binary node. */
export function setOperator(program: Program, nodeId: string, op: BinOp): Program {
  const p = cloneProgram(program);
  const slot = parseExprNodeId(nodeId);
  const at = findOwnerRoot(p, slot.owner, slot.path);
  if (!at || at.value?.k !== 'bin') throw new OpError('That is not an operator');
  at.value.op = op;
  return tidy(p);
}

/** Switches a Get Variable node to another variable. */
export function setVariableRef(program: Program, nodeId: string, name: string): Program {
  const p = cloneProgram(program);
  const slot = parseExprNodeId(nodeId);
  const at = findOwnerRoot(p, slot.owner, slot.path);
  if (!at || at.value?.k !== 'ref') throw new OpError('That is not a variable');
  at.value.name = name;
  return tidy(p);
}

// --- node settings ---------------------------------------------------------------------------------------

export function setConfig(program: Program, handlerId: string, key: string, value: ConfigValue): Program {
  const p = cloneProgram(program);
  const h = p.doc.handlers.find((x: Handler) => x.id === handlerId);
  if (!h) throw new OpError('That block no longer exists');
  h.config = { ...h.config, [key]: value };
  return tidy(p);
}

export function setComment(program: Program, id: string, text: string): Program {
  const p = cloneProgram(program);
  const f = findStmt(p, id);
  if (!f || f.stmt.k !== 'comment') throw new OpError('That is not a note');
  f.stmt.text = text;
  return tidy(p);
}

/** Which variable a Set node assigns. */
export function setAssignTarget(program: Program, id: string, name: string): Program {
  const p = cloneProgram(program);
  const f = findStmt(p, id);
  if (!f || f.stmt.k !== 'set') throw new OpError('That is not a Set node');
  f.stmt.name = name;
  return tidy(p);
}

/** Names a call's result (so its value can be wired onward), or clears the name. */
export function setResultName(program: Program, id: string, name: string | undefined): Program {
  const p = cloneProgram(program);
  const f = findStmt(p, id);
  if (!f || f.stmt.k !== 'call') throw new OpError('That is not a call');
  if (name === undefined || name === '') delete f.stmt.result;
  else {
    if (!isIdentifier(name)) throw new OpError(`'${name}' is not a valid name`);
    f.stmt.result = name;
  }
  return tidy(p);
}

/** A result name for a call that has none yet, unique in the program (`<function>Result`, then 2, 3, ...). */
export function suggestResultName(program: Program, stmtId: string): string {
  const used = new Set<string>();
  const walk = (list: readonly Stmt[]) => {
    for (const s of list) {
      if (s.k === 'call' && s.result) used.add(s.result);
      if (s.k === 'if') (walk(s.then), walk(s.else));
      else if (s.k === 'while') walk(s.body);
      else if (s.k === 'call' && s.outcomes) for (const chain of Object.values(s.outcomes)) walk(chain);
    }
  };
  for (const h of program.doc.handlers) {
    walk(h.body);
    for (const n of h.params) used.add(n);
  }
  for (const c of program.scratch.chains) walk(c);
  const f = findStmt(cloneProgram(program), stmtId);
  const base = `${f && f.stmt.k === 'call' ? f.stmt.fn : 'value'}Result`;
  let name = base;
  for (let i = 2; used.has(name); i++) name = `${base}${i}`;
  return name;
}

// --- variables ---------------------------------------------------------------------------------------------

export function addVariable(program: Program, name: string, init: number, host: FlowHost): Program {
  if (!isIdentifier(name) || host.constants.has(name) || host.api.some((b) => b.name === name) || EVENT_BY_NAME.has(name)) {
    throw new OpError(`'${name}' cannot be used as a variable name`);
  }
  if (program.doc.vars.some((v) => v.name === name)) throw new OpError(`There is already a variable '${name}'`);
  const p = cloneProgram(program);
  p.doc.vars.push({ name, init });
  return tidy(p);
}

export function setVariableInit(program: Program, name: string, init: number): Program {
  const p = cloneProgram(program);
  const v = p.doc.vars.find((x: { name: string }) => x.name === name);
  if (!v) throw new OpError(`No variable '${name}'`);
  v.init = init;
  return tidy(p);
}

/** True if anything (a Get or Set node, in the program or the scratch area) uses the variable. */
export function variableUsed(program: Program, name: string): boolean {
  const text = JSON.stringify({ d: program.doc.handlers, s: program.scratch });
  return text.includes(`"name":"${name}"`);
}

export function deleteVariable(program: Program, name: string): Program {
  if (variableUsed(program, name)) throw new OpError(`'${name}' is still used: remove the nodes that read or set it first`);
  const p = cloneProgram(program);
  p.doc.vars = p.doc.vars.filter((v: { name: string }) => v.name !== name);
  return tidy(p);
}

// --- adding and deleting nodes ------------------------------------------------------------------------------

export type NewStatement =
  | { readonly k: 'call'; readonly fn: string; readonly argc: number }
  | { readonly k: 'set'; readonly name: string }
  | { readonly k: 'if' }
  | { readonly k: 'while' }
  | { readonly k: 'comment'; readonly text: string };

export type NewExpr =
  | { readonly k: 'bin'; readonly op: BinOp }
  | { readonly k: 'un'; readonly op: '-' | '!' }
  | { readonly k: 'cond' }
  | { readonly k: 'call'; readonly fn: string; readonly argc: number }
  | { readonly k: 'var'; readonly name: string };

/** Adds a loose statement (a one-node chain in the scratch area). Returns the program and the new node's id. */
export function addStatement(program: Program, what: NewStatement): { program: Program; id: string } {
  const p = cloneProgram(program);
  const id = freshIdIn(p);
  const zeros = (n: number): Expr[] => Array.from({ length: n }, () => clone(LITERAL_ZERO));
  let stmt: Stmt;
  switch (what.k) {
    case 'call': stmt = { id, k: 'call', fn: what.fn, args: zeros(what.argc) }; break;
    case 'set': stmt = { id, k: 'set', name: what.name, value: clone(LITERAL_ZERO) }; break;
    case 'if': stmt = { id, k: 'if', cond: clone(LITERAL_ZERO), then: [], else: [] }; break;
    case 'while': stmt = { id, k: 'while', cond: clone(LITERAL_ZERO), body: [] }; break;
    case 'comment': stmt = { id, k: 'comment', text: what.text }; break;
  }
  p.scratch.chains.push([stmt]);
  return { program: tidy(p), id };
}

/** Adds a loose data node. Returns the program and the new node's id. */
export function addExpression(program: Program, what: NewExpr): { program: Program; id: string } {
  const p = cloneProgram(program);
  const id = freshIdIn(p);
  const zero = () => clone(LITERAL_ZERO);
  let expr: Expr;
  switch (what.k) {
    case 'bin': expr = { k: 'bin', op: what.op, a: zero(), b: zero() }; break;
    case 'un': expr = { k: 'un', op: what.op, a: zero() }; break;
    case 'cond': expr = { k: 'cond', c: zero(), a: zero(), b: zero() }; break;
    case 'call': expr = { k: 'call', fn: what.fn, args: Array.from({ length: what.argc }, zero) }; break;
    case 'var': expr = { k: 'ref', name: what.name }; break;
  }
  p.scratch.exprs.push({ id, expr });
  return { program: tidy(p), id: exprNodeId(id, '') };
}

/** Adds an event block with its default settings (and no code). */
export function addHandler(program: Program, event: string): { program: Program; id: string } {
  const def = EVENT_BY_NAME.get(event);
  if (!def) throw new OpError(`Unknown event '${event}'`);
  if (!def.multi && program.doc.handlers.some((h) => h.event === event)) throw new OpError(`A class can only have one ${event} block`);
  const p = cloneProgram(program);
  const id = freshIdIn(p);
  p.doc.handlers.push({ id, event, config: {}, params: [...def.params], body: [] });
  return { program: tidy(p), id };
}

/**
 * Deletes a node. A statement leaves its chain closed up (what followed it now follows what
 * preceded it); chains nested inside it go to the scratch area. A data node's inputs go with
 * it; the input it fed goes back to 0. An event block's code goes to the scratch area.
 */
export function deleteNode(program: Program, id: string): Program {
  const p = cloneProgram(program);
  if (isExprNodeId(id)) {
    const slot = parseExprNodeId(id);
    if (slot.path === '' && p.scratch.exprs.some((e: { id: string }) => e.id === slot.owner)) {
      p.scratch.exprs = p.scratch.exprs.filter((e: { id: string }) => e.id !== slot.owner);
    } else {
      const at = findOwnerRoot(p, slot.owner, slot.path);
      if (!at) throw new OpError('That node no longer exists');
      setIn(at.holder, at.path, clone(LITERAL_ZERO));
    }
    return tidy(p);
  }
  const hi = p.doc.handlers.findIndex((h: Handler) => h.id === id);
  if (hi >= 0) {
    const [h] = p.doc.handlers.splice(hi, 1);
    if (h.body.length) p.scratch.chains.push(h.body);
    return tidy(p);
  }
  const f = findStmt(p, id);
  if (!f) throw new OpError('That node no longer exists');
  const [stmt] = f.list.splice(f.index, 1);
  const nested: Mutable[][] =
    stmt.k === 'if'
      ? [stmt.then, stmt.else]
      : stmt.k === 'while'
        ? [stmt.body]
        : stmt.k === 'call' && stmt.outcomes
          ? Object.values(stmt.outcomes as Record<string, Mutable[]>)
          : [];
  for (const list of nested) if (list.length) p.scratch.chains.push(list);
  return tidy(p);
}

// --- reading the scratch area out of the editor-only views ----------------------------------------------------------

/** Splits a stored views block into the layout and the scratch area. */
export function scratchOf(views: FlowViews | undefined): Scratch {
  const raw = (views?.graph as { scratch?: Scratch } | undefined)?.scratch;
  return raw ? { chains: raw.chains ?? [], exprs: raw.exprs ?? [] } : emptyScratch;
}

/** Views with the scratch area replaced (an empty one is left out of the stored form). */
export function withScratch(views: FlowViews | undefined, scratch: Scratch): FlowViews {
  const graph = { ...(views?.graph ?? {}) } as { pos?: Record<string, readonly [number, number]>; scratch?: Scratch };
  if (scratch.chains.length || scratch.exprs.length) graph.scratch = scratch;
  else delete graph.scratch;
  return { ...views, graph } as FlowViews;
}
