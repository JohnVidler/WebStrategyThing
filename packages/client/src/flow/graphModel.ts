import {
  BLOCK_BY_NAME,
  COST,
  configToText,
  EVENT_BY_NAME,
  MAX_CUSTOM_PARAMS,
  LOCAL_READ_COST,
  STATEMENT_COST,
  VARIABLE_READ_COST,
  WIRED_NODE_COST,
  type BinOp,
  type BuiltinSig,
  type Expr,
  type FlowHost,
  type Handler,
  type Stmt,
} from '@wst/engine';
import { exprNodeId, isExprNodeId, parseExprNodeId, type Program, type Slot } from './graphOps';

/*
 * The graph as plain data, built from the program (the IR plus the scratch area). The graph
 * view draws it, and every edit goes back through graphOps, never to this model. Nothing here
 * touches the DOM.
 */

export type NodeKind =
  /** Entry point: red, carries the event source's settings. */
  | 'event'
  /** A one-shot effect now: orange. */
  | 'action'
  /** Reads state: blue. */
  | 'query'
  /** A runtime setting of a module or the CPU: teal, gear. */
  | 'config'
  /** Maths, comparison, logic, select: grey. */
  | 'logic'
  /** Get Variable: green. */
  | 'variable'
  /** Branch, While, Set: grey-violet. */
  | 'flow'
  /** A note. */
  | 'note'
  /** A built-in block: a card with settings that stands for several event blocks. */
  | 'block';

export type PortType = 'exec' | 'data';

export interface Port {
  readonly key: string;
  readonly label: string;
  readonly type: PortType;
}

/** A field on a node: a pin's typed-in default, an event setting, a variable choice, a note's text. */
export interface Control {
  readonly key: string;
  readonly label: string;
  readonly type: 'number' | 'text' | 'select' | 'multiline';
  readonly value: string;
  readonly options?: readonly string[];
  readonly hint?: string;
}

export interface GNode {
  readonly id: string;
  readonly kind: NodeKind;
  readonly title: string;
  readonly subtitle?: string;
  readonly inputs: readonly Port[];
  readonly outputs: readonly Port[];
  readonly controls: readonly Control[];
  /** Cycles this node costs when it runs (its own node, the wire into it, and a call's cost). */
  readonly cost: number;
  /** Part of the scratch area: not attached to the program. */
  readonly loose: boolean;
  readonly doc?: string;
  readonly problem?: string;
  /** Buttons on the card (a block's Expand). */
  readonly actions?: readonly { readonly key: string; readonly label: string; readonly title: string }[];
  /** Events a block raises, for the player's own blocks to hook. */
  readonly emits?: readonly string[];
}

export interface GEdge {
  readonly id: string;
  readonly type: PortType;
  readonly from: { readonly node: string; readonly key: string };
  readonly to: { readonly node: string; readonly key: string };
}

export interface GraphModel {
  readonly nodes: readonly GNode[];
  readonly edges: readonly GEdge[];
}

export const BIN_OPS: readonly BinOp[] = ['+', '-', '*', '/', '%', '==', '!=', '<', '<=', '>', '>=', '&&', '||', '&', '|'];
export const OP_TITLE: Readonly<Record<string, string>> = { '&&': 'AND', '||': 'OR', '!': 'NOT', '==': '=', '!=': '≠', '<=': '≤', '>=': '≥', '&': 'bit AND', '|': 'bit OR' };

const KIND_LABEL = { query: 'query', action: 'action', config: 'runtime setting' } as const;
/** Input keys for call arguments and operator operands. */
export const argKey = (i: number): string => `arg:${i}`;
export const paramKey = (name: string): string => `p:${name}`;

/** The slot (owner and path) an input pin stands for: `nodeId` is a statement or a data node, `key` one of its input keys. */
export function slotForInput(nodeId: string, key: string): Slot {
  const at = key.startsWith('arg:') ? `args.${key.slice(4)}` : key;
  if (!isExprNodeId(nodeId)) return { owner: nodeId, path: at };
  const { owner, path } = parseExprNodeId(nodeId);
  return { owner, path: path ? `${path}.${at}` : at };
}

// --- building ----------------------------------------------------------------------------------------

interface Source {
  readonly node: string;
  readonly key: string;
}

export function buildGraph(program: Program, host: FlowHost, problems: ReadonlyMap<string, string> = new Map()): GraphModel {
  const api = new Map(host.api.map((b) => [b.name, b]));
  const vars = program.doc.vars.map((v) => v.name);
  const nodes: GNode[] = [];
  const edges: GEdge[] = [];
  let edgeCount = 0;
  const edge = (type: PortType, from: Source, to: Source) => edges.push({ id: `e${edgeCount++}`, type, from: { node: from.node, key: from.key }, to: { node: to.node, key: to.key } });

  const literalText = (e: Expr): string | undefined => {
    if (e.k === 'num') return String(e.v);
    if (e.k === 'str') return `'${e.v}'`;
    if (e.k === 'ref' && host.constants.has(e.name)) return e.name;
    return undefined;
  };

  /**
   * Adds the node for a data expression feeding `to`, or a wire from a local, or nothing (a literal
   * is a typed-in default on the input pin). Returns the control to show on the pin, if any.
   */
  const feed = (e: Expr, owner: string, path: string, to: Source, locals: ReadonlyMap<string, Source>, loose: boolean): Control | undefined => {
    const lit = literalText(e);
    if (lit !== undefined) {
      return { key: to.key, label: '', type: 'number', value: lit, hint: e.k === 'ref' ? 'a named constant' : undefined };
    }
    if (e.k === 'ref') {
      if (host.constants.has(e.name)) return undefined;
      if (vars.includes(e.name)) {
        const id = exprNodeId(owner, path);
        nodes.push({
          id, kind: 'variable', title: 'Get', inputs: [], outputs: [{ key: 'out', label: '', type: 'data' }],
          controls: [{ key: 'var', label: '', type: 'select', value: e.name, options: vars }],
          cost: VARIABLE_READ_COST, loose, doc: `Reads the variable ${e.name}`, problem: problems.get(owner),
        });
        edge('data', { node: id, key: 'out' }, to);
        return undefined;
      }
      const src = locals.get(e.name);
      if (src) {
        edge('data', src, to);
        return undefined;
      }
      // Not a variable, constant or anything in scope: show it as typed text so it can be fixed.
      return { key: to.key, label: '', type: 'text', value: e.name, hint: `'${e.name}' is not available here` };
    }
    const id = exprNodeId(owner, path);
    const node = exprNode(e, id, owner, path, locals, loose);
    nodes.push(node);
    edge('data', { node: id, key: 'out' }, to);
    return undefined;
  };

  const exprNode = (e: Expr, id: string, owner: string, path: string, locals: ReadonlyMap<string, Source>, loose: boolean): GNode => {
    const controls: Control[] = [];
    const inputs: Port[] = [];
    const sub = (key: string, label: string, child: Expr, at: string) => {
      inputs.push({ key, label, type: 'data' });
      const c = feed(child, owner, at, { node: id, key }, locals, loose);
      if (c) controls.push({ ...c, label });
    };
    const base = { id, loose, problem: problems.get(owner), outputs: [{ key: 'out', label: '', type: 'data' }] as Port[] };
    const at = (seg: string) => (path ? `${path}.${seg}` : seg);
    switch (e.k) {
      case 'bin': {
        sub('a', 'A', e.a, at('a'));
        sub('b', 'B', e.b, at('b'));
        controls.unshift({ key: 'op', label: '', type: 'select', value: e.op, options: BIN_OPS });
        return { ...base, kind: 'logic', title: OP_TITLE[e.op] ?? e.op, inputs, controls, cost: WIRED_NODE_COST, doc: 'Operator' };
      }
      case 'un': {
        sub('a', 'A', e.a, at('a'));
        return { ...base, kind: 'logic', title: OP_TITLE[e.op] ?? e.op, inputs, controls, cost: WIRED_NODE_COST, doc: e.op === '!' ? 'Logical not' : 'Negate' };
      }
      case 'cond': {
        sub('c', 'if', e.c, at('c'));
        sub('a', 'then', e.a, at('a'));
        sub('b', 'else', e.b, at('b'));
        return { ...base, kind: 'logic', title: 'Select', inputs, controls, cost: WIRED_NODE_COST, doc: 'Picks one of two values (the other is not evaluated)' };
      }
      case 'call': {
        const b = api.get(e.fn);
        e.args.forEach((a, i) => sub(argKey(i), b?.args?.[i] ?? `arg ${i + 1}`, a, at(`args.${i}`)));
        return { ...base, kind: 'query', title: e.fn, subtitle: 'query', inputs, controls, cost: WIRED_NODE_COST + (b?.cost ?? 0), doc: b?.doc };
      }
      default:
        return { ...base, kind: 'logic', title: '?', inputs, controls, cost: 0 };
    }
  };

  /** A statement chain: each statement's `next` output feeds the following one's `in`. Returns the id of the first node. */
  const chain = (list: readonly Stmt[], from: Source | undefined, scope: Map<string, Source>, loose: boolean): void => {
    let prev = from;
    for (const s of list) {
      const id = s.id;
      const problem = problems.get(id);
      const here = new Map(scope);
      let node: GNode;
      switch (s.k) {
        case 'comment':
          node = {
            id, kind: 'note', title: 'Note', inputs: [{ key: 'in', label: '', type: 'exec' }], outputs: [{ key: 'next', label: '', type: 'exec' }],
            controls: [{ key: 'text', label: '', type: 'multiline', value: s.text }], cost: 0, loose, doc: 'A comment, kept in the text and the graph',
          };
          nodes.push(node);
          break;
        case 'call': {
          const b = api.get(s.fn) as BuiltinSig | undefined;
          const controls: Control[] = [];
          const inputs: Port[] = [{ key: 'in', label: '', type: 'exec' }];
          s.args.forEach((a, i) => {
            const label = b?.args?.[i] ?? `arg ${i + 1}`;
            inputs.push({ key: argKey(i), label, type: 'data' });
            const c = feed(a, id, `args.${i}`, { node: id, key: argKey(i) }, here, loose);
            if (c) controls.push({ ...c, label });
          });
          const kind: NodeKind = b?.kind === 'config' ? 'config' : b?.kind === 'query' ? 'query' : 'action';
          // A long-running call has a pin for each way it can end, after the one for what happens straight away.
          const ends: Port[] = (b?.outcomes ?? []).map((name) => ({ key: `out:${name}`, label: name, type: 'exec' as const }));
          node = {
            id, kind, title: s.fn, subtitle: b ? (b.outcomes ? 'activity' : KIND_LABEL[b.kind]) : 'unknown',
            inputs,
            outputs: [{ key: 'next', label: ends.length ? 'Started' : '', type: 'exec' }, ...ends, { key: 'result', label: s.result ?? 'result', type: 'data' }],
            controls, cost: STATEMENT_COST + (b?.cost ?? 0), loose, doc: b?.doc, problem,
          };
          nodes.push(node);
          // What follows an outcome runs later, in the frame of the call: it sees what is in scope here, not the call's result.
          for (const name of b?.outcomes ?? []) {
            const chainOf = s.outcomes?.[name];
            if (chainOf?.length) chain(chainOf, { node: id, key: `out:${name}` }, new Map(scope), loose);
          }
          if (s.result !== undefined) scope.set(s.result, { node: id, key: 'result' });
          break;
        }
        case 'emit': {
          const controls: Control[] = [
            { key: 'event', label: 'event', type: 'text', value: s.event, hint: 'The event to raise: your own, starting with a capital letter' },
            { key: 'values', label: 'values', type: 'select', value: String(s.args.length), options: Array.from({ length: MAX_CUSTOM_PARAMS + 1 }, (_, n) => String(n)) },
          ];
          const names = program.doc.handlers.find((h) => h.event === s.event)?.params ?? [];
          const inputs: Port[] = [{ key: 'in', label: '', type: 'exec' }];
          s.args.forEach((a, i) => {
            const label = names[i] ?? `value ${i + 1}`;
            inputs.push({ key: argKey(i), label, type: 'data' });
            const c = feed(a, id, `args.${i}`, { node: id, key: argKey(i) }, here, loose);
            if (c) controls.push({ ...c, label });
          });
          node = {
            id, kind: 'action', title: 'emit', subtitle: s.event, inputs, outputs: [{ key: 'next', label: '', type: 'exec' }],
            controls, cost: STATEMENT_COST, loose, doc: `Raises ${s.event}: every block of that event in this unit runs`, problem,
          };
          nodes.push(node);
          break;
        }
        case 'set': {
          const controls: Control[] = [{ key: 'var', label: '', type: 'select', value: s.name, options: vars }];
          const c = feed(s.value, id, 'value', { node: id, key: 'value' }, here, loose);
          if (c) controls.push({ ...c, label: 'value' });
          node = {
            id, kind: 'flow', title: 'Set', subtitle: 'variable',
            inputs: [{ key: 'in', label: '', type: 'exec' }, { key: 'value', label: 'value', type: 'data' }],
            outputs: [{ key: 'next', label: '', type: 'exec' }], controls, cost: STATEMENT_COST, loose, doc: 'Assigns a variable', problem,
          };
          nodes.push(node);
          break;
        }
        case 'if': {
          const controls: Control[] = [];
          const c = feed(s.cond, id, 'cond', { node: id, key: 'cond' }, here, loose);
          if (c) controls.push({ ...c, label: 'condition' });
          node = {
            id, kind: 'flow', title: 'Branch', subtitle: 'if',
            inputs: [{ key: 'in', label: '', type: 'exec' }, { key: 'cond', label: 'condition', type: 'data' }],
            outputs: [{ key: 'then', label: 'True', type: 'exec' }, { key: 'else', label: 'False', type: 'exec' }, { key: 'next', label: 'Done', type: 'exec' }],
            controls, cost: STATEMENT_COST, loose, doc: 'Runs one of two chains, then continues from Done', problem,
          };
          nodes.push(node);
          chain(s.then, { node: id, key: 'then' }, new Map(here), loose);
          chain(s.else, { node: id, key: 'else' }, new Map(here), loose);
          break;
        }
        case 'while': {
          const controls: Control[] = [];
          const c = feed(s.cond, id, 'cond', { node: id, key: 'cond' }, here, loose);
          if (c) controls.push({ ...c, label: 'condition' });
          node = {
            id, kind: 'flow', title: 'While', subtitle: 'loop',
            inputs: [{ key: 'in', label: '', type: 'exec' }, { key: 'cond', label: 'condition', type: 'data' }],
            outputs: [{ key: 'body', label: 'Loop', type: 'exec' }, { key: 'next', label: 'Done', type: 'exec' }],
            controls, cost: STATEMENT_COST, loose, doc: 'Repeats the loop chain while the condition holds, then continues from Done', problem,
          };
          nodes.push(node);
          chain(s.body, { node: id, key: 'body' }, new Map(here), loose);
          break;
        }
      }
      if (prev) edge('exec', prev, { node: id, key: 'in' });
      prev = { node: id, key: 'next' };
    }
  };

  for (const u of program.doc.blocks ?? []) {
    const def = BLOCK_BY_NAME.get(u.block);
    nodes.push({
      id: u.id, kind: 'block', title: u.block, subtitle: def?.group ?? 'unknown block', inputs: [], outputs: [],
      controls: (def?.settings ?? []).map((f) => ({ key: `set:${f.name}`, label: f.name, type: 'text' as const, value: configToText(u.block, f, u.settings[f.name], host), hint: f.doc })),
      actions: [{ key: 'expand', label: 'Expand', title: 'Turn this block into the plain event blocks it is made of, so you can change anything (it cannot be turned back)' }],
      emits: def?.emits, cost: 0, loose: false, doc: def?.doc, problem: problems.get(u.id),
    });
  }
  for (const h of program.doc.handlers) {
    const scope = new Map<string, Source>(h.params.map((p) => [p, { node: h.id, key: paramKey(p) }]));
    nodes.push(eventNode(h, host, problems.get(h.id)));
    chain(h.body, { node: h.id, key: 'start' }, scope, false);
  }
  for (const c of program.scratch.chains) chain(c, undefined, new Map(), true);
  for (const x of program.scratch.exprs) {
    const id = exprNodeId(x.id, '');
    // A loose expression: its root is a node with no consumer.
    if (x.expr.k === 'ref' && vars.includes(x.expr.name)) {
      nodes.push({
        id, kind: 'variable', title: 'Get', inputs: [], outputs: [{ key: 'out', label: '', type: 'data' }],
        controls: [{ key: 'var', label: '', type: 'select', value: x.expr.name, options: vars }], cost: VARIABLE_READ_COST, loose: true,
      });
    } else if (x.expr.k !== 'num' && x.expr.k !== 'str' && x.expr.k !== 'ref') {
      nodes.push(exprNode(x.expr, id, x.id, '', new Map(), true));
    }
  }
  return { nodes, edges };
}

function eventNode(h: Handler, host: FlowHost, problem: string | undefined): GNode {
  const def = EVENT_BY_NAME.get(h.event);
  const own: Control[] = def
    ? []
    : [
        { key: 'evname', label: 'name', type: 'text', value: h.event, hint: 'The name of this event (renames it everywhere)' },
        { key: 'evparams', label: 'values', type: 'text', value: h.params.join(', '), hint: 'Names for the values an emit passes, up to four' },
      ];
  const controls: Control[] = own.concat((def?.config ?? []).map((f) => ({
    key: `cfg:${f.name}`,
    label: f.name,
    type: 'text' as const,
    value: configToText(h.event, f, h.config[f.name], host),
    hint: f.doc,
  })));
  return {
    id: h.id, kind: 'event', title: h.event,
    subtitle: def ? 'event' : 'own event',
    inputs: [],
    outputs: [{ key: 'start', label: '', type: 'exec' }, ...h.params.map((p) => ({ key: paramKey(p), label: p, type: 'data' as const }))],
    controls, cost: 0, loose: false, doc: def?.doc, problem,
  };
}

/** Cycles on the most expensive path through a handler's chain, counting only what that path runs (loops count once). */
export function handlerWorstCase(h: Handler, host: FlowHost): number {
  const api = new Map(host.api.map((b) => [b.name, b]));
  const exprCost = (e: Expr, locals: ReadonlySet<string>): number => {
    switch (e.k) {
      case 'num':
      case 'str': return 0;
      case 'ref': return host.constants.has(e.name) ? 0 : locals.has(e.name) ? LOCAL_READ_COST : VARIABLE_READ_COST;
      case 'un': return WIRED_NODE_COST + exprCost(e.a, locals);
      case 'bin': return WIRED_NODE_COST + exprCost(e.a, locals) + exprCost(e.b, locals);
      case 'cond': return WIRED_NODE_COST + exprCost(e.c, locals) + exprCost(e.a, locals) + exprCost(e.b, locals);
      case 'call': return WIRED_NODE_COST + (api.get(e.fn)?.cost ?? 0) + e.args.reduce((n, a) => n + exprCost(a, locals), 0);
    }
  };
  const list = (stmts: readonly Stmt[], locals: Set<string>): number => {
    let total = 0;
    for (const s of stmts) {
      switch (s.k) {
        case 'comment': break;
        case 'call':
          total += STATEMENT_COST + (api.get(s.fn)?.cost ?? 0) + s.args.reduce((n, a) => n + exprCost(a, locals), 0);
          if (s.result) locals.add(s.result);
          break;
        case 'emit': total += STATEMENT_COST + s.args.reduce((n, a) => n + exprCost(a, locals), 0); break;
        case 'set': total += STATEMENT_COST + exprCost(s.value, locals); break;
        case 'if': total += STATEMENT_COST + exprCost(s.cond, locals) + Math.max(list(s.then, new Set(locals)), list(s.else, new Set(locals))); break;
        case 'while': total += STATEMENT_COST + exprCost(s.cond, locals) + list(s.body, new Set(locals)); break;
      }
    }
    return total;
  };
  return Math.min(list(h.body, new Set(h.params)), COST.HANDLER_LIMIT);
}
