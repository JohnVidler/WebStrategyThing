import { parser } from '@lezer/javascript';
import type { SyntaxNode } from '@lezer/common';
import { checkDoc, type MemoryUse } from './check';
import { configNumberText } from './config';
import { EVENT_BY_NAME, type EventDef } from './events';
import type { FlowHost } from './host';
import {
  emptyDoc,
  FlowError,
  idGenerator,
  type BinOp,
  type ConfigValue,
  type Expr,
  type FlowDoc,
  type Handler,
  type Stmt,
  type VarDecl,
} from './ir';

/*
 * The text form of a program: a strict subset of TypeScript.
 *
 *   let target = -1;
 *   on(Detected, { watch: [ENEMY], range: 6 }, (kind, h) => {
 *     const foe = scan();          // queries inside expressions, actions as statements
 *     if (kind === ENEMY) fire(h);
 *     config.laserPower(12);       // runtime settings live in the config namespace
 *   });
 *
 * `parseText` reads it into the IR (collecting every error, with source ranges) and
 * `printText` writes the IR back deterministically, so `parse(print(doc))` is the same
 * program and `print(parse(text))` is its formatted text.
 */

const tsParser = parser.configure({ dialect: 'ts' });

// --- precedence (JavaScript's) -----------------------------------------------------------

const PREC: Record<BinOp, number> = {
  '||': 1, '&&': 2, '|': 3, '&': 4, '==': 5, '!=': 5, '<': 6, '<=': 6, '>': 6, '>=': 6, '+': 8, '-': 8, '*': 9, '/': 9, '%': 9,
};
const PREC_COND = 0;
const PREC_UNARY = 10;
const PREC_ATOM = 11;

// ============================================================================================
// Parsing
// ============================================================================================

export interface ParseResult {
  readonly doc: FlowDoc;
  /** Syntax problems and program problems (unknown names, wrong kinds of call, ...), each with its range in the text. */
  readonly errors: readonly FlowError[];
  /** How many of `errors` are syntax problems (the text did not parse into a faithful program). The rest are checks on a parsed program. */
  readonly syntaxErrors: number;
  /** What the program would occupy in memory. */
  readonly memory: MemoryUse;
}

/**
 * Reads program text. With `prev`, statements that sit in the same place as in the previous
 * document keep their ids (and so their graph positions), see `alignIds`.
 */
export function parseText(text: string, host: FlowHost, prev?: FlowDoc, reserved?: Iterable<string>): ParseResult {
  const errors: FlowError[] = [];
  const tree = tsParser.parse(text);
  const next = idGenerator(prev, reserved);
  const apiByName = new Map(host.api.map((b) => [b.name, b]));
  /** Where each node came from (its first line), so problems found later can point at the text. */
  const ranges = new Map<string, { from: number; to: number }>();
  const firstLine = (n: { from: number; to: number }) => {
    const nl = text.indexOf('\n', n.from);
    return { from: n.from, to: nl >= 0 ? Math.min(n.to, nl) : n.to };
  };
  const mk = (n: { from: number; to: number }): string => {
    const id = next();
    ranges.set(id, firstLine(n));
    return id;
  };

  const err = (message: string, n: { from: number; to: number }) => errors.push(new FlowError(message, n.from, n.to));
  const src = (n: { from: number; to: number }) => text.slice(n.from, n.to);

  // Syntax errors first: the tree is still walked so the user sees every problem at once.
  let syntax = 0;
  tree.iterate({
    enter(n) {
      if (n.type.isError && syntax++ < 4) errors.push(new FlowError('Syntax error', n.from, Math.max(n.to, n.from + 1)));
    },
  });

  /** Children of a node, skipping punctuation and comments, plus the comments in source order. */
  const kids = (n: SyntaxNode): SyntaxNode[] => {
    const out: SyntaxNode[] = [];
    for (let c = n.firstChild; c; c = c.nextSibling) out.push(c);
    return out;
  };

  const constEval = (n: SyntaxNode): number | undefined => {
    switch (n.name) {
      case 'Number': {
        const v = Number(src(n));
        return Number.isInteger(v) ? v : undefined;
      }
      case 'BooleanLiteral':
        return src(n) === 'true' ? 1 : 0;
      case 'VariableName':
        return host.constants.get(src(n));
      case 'ParenthesizedExpression':
        return constEval(n.firstChild!.nextSibling!);
      case 'UnaryExpression': {
        const [op, a] = kids(n);
        const v = constEval(a);
        if (v === undefined) return undefined;
        return src(op) === '-' ? -v : undefined;
      }
      case 'BinaryExpression': {
        const [a, op, b] = kids(n);
        const x = constEval(a);
        const y = constEval(b);
        if (x === undefined || y === undefined) return undefined;
        switch (src(op)) {
          case '|': return x | y;
          case '&': return x & y;
          case '+': return x + y;
          case '-': return x - y;
          case '*': return x * y;
          default: return undefined;
        }
      }
      default:
        return undefined;
    }
  };

  // --- expressions ---
  const expr = (n: SyntaxNode): Expr => {
    switch (n.name) {
      case 'Number': {
        const v = Number(src(n));
        if (!Number.isInteger(v)) err('Only whole numbers are supported', n);
        return { k: 'num', v: Number.isInteger(v) ? v : 0 };
      }
      case 'BooleanLiteral':
        return { k: 'num', v: src(n) === 'true' ? 1 : 0 };
      case 'String':
        return { k: 'str', v: src(n).slice(1, -1).replace(/\\(['"\\])/g, '$1') };
      case 'VariableName':
        return { k: 'ref', name: src(n) };
      case 'ParenthesizedExpression':
        return expr(n.firstChild!.nextSibling!);
      case 'UnaryExpression': {
        const [op, a] = kids(n);
        const o = src(op);
        if (o === '-') {
          if (a.name === 'Number') {
            const v = Number(src(a));
            return { k: 'num', v: -v };
          }
          return { k: 'un', op: '-', a: expr(a) };
        }
        if (o === '!') return { k: 'un', op: '!', a: expr(a) };
        err(`Operator '${o}' is not supported`, op);
        return { k: 'num', v: 0 };
      }
      case 'BinaryExpression': {
        const [a, op, b] = kids(n);
        let o = src(op);
        if (o === '===') o = '==';
        else if (o === '!==') o = '!=';
        if (!(o in PREC)) {
          err(`Operator '${o}' is not supported (use + - * / % == != < <= > >= && || & |)`, op);
          return { k: 'num', v: 0 };
        }
        return { k: 'bin', op: o as BinOp, a: expr(a), b: expr(b) };
      }
      case 'ConditionalExpression': {
        const [c, , a, , b] = kids(n);
        return { k: 'cond', c: expr(c), a: expr(a), b: expr(b) };
      }
      case 'CallExpression': {
        const [callee, args] = kids(n);
        if (callee.name !== 'VariableName') {
          err('Only built-in functions can be called inside expressions', callee);
          return { k: 'num', v: 0 };
        }
        return { k: 'call', fn: src(callee), args: argList(args) };
      }
      default:
        err(`This kind of expression is not supported: ${n.name}`, n);
        return { k: 'num', v: 0 };
    }
  };

  const argList = (args: SyntaxNode): Expr[] => kids(args).filter((c) => !['(', ')', ','].includes(c.name)).map(expr);

  // --- statements ---
  const callStmt = (n: SyntaxNode, result?: string): Stmt | undefined => {
    const [callee, args] = kids(n);
    let fn: string;
    if (callee.name === 'VariableName') {
      fn = src(callee);
      if (apiByName.get(fn)?.kind === 'config') err(`${fn}() is a runtime setting: write config.${fn}(...)`, callee);
    } else if (callee.name === 'MemberExpression' && src(callee.firstChild!) === 'config') {
      fn = src(callee.lastChild!);
      const b = apiByName.get(fn);
      if (b && b.kind !== 'config') err(`${fn}() is not a runtime setting: write ${fn}(...)`, callee);
    } else {
      err('Only built-in functions can be called', callee);
      return undefined;
    }
    // The last argument of a long-running call may be an object of outcome chains.
    const argNodes = kids(args).filter((c) => !['(', ')', ','].includes(c.name));
    let outcomes: Record<string, Stmt[]> | undefined;
    const last = argNodes.at(-1);
    if (last && last.name === 'ObjectExpression' && apiByName.has(fn) && !apiByName.get(fn)!.outcomes) {
      err(`${fn}() has no outcomes to attach chains to`, last);
      argNodes.pop();
    }
    if (last && last.name === 'ObjectExpression' && apiByName.get(fn)?.outcomes) {
      argNodes.pop();
      outcomes = {};
      for (const prop of kids(last).filter((c) => c.name === 'Property')) {
        const parts = kids(prop);
        const key = src(parts[0]);
        const fnNode = parts.at(-1)!;
        const block = fnNode.name === 'ArrowFunction' ? kids(fnNode).find((c) => c.name === 'Block') : undefined;
        if (parts.length < 3 || !block) err(`Write the outcome as ${key}: () => { ... }`, prop);
        else outcomes[key] = body(block);
      }
    }
    const id = mk(n);
    return { id, k: 'call', fn, args: argNodes.map(expr), ...(result !== undefined ? { result } : {}), ...(outcomes ? { outcomes } : {}) };
  };

  const stmt = (n: SyntaxNode): Stmt[] => {
    switch (n.name) {
      case 'LineComment':
        return [{ id: mk(n), k: 'comment', text: src(n).replace(/^\/\/ ?/, '') }];
      case 'BlockComment':
        return [{ id: mk(n), k: 'comment', text: src(n).replace(/^\/\*\s?|\s?\*\/$/g, '') }];
      case 'ExpressionStatement': {
        const e = n.firstChild!;
        if (e.name === 'AssignmentExpression') {
          const [target, eq, value] = kids(e);
          if (src(eq) !== '=') {
            err(`Use plain '=' (write x = x + 1 instead of ${src(eq)})`, eq);
            return [];
          }
          if (target.name !== 'VariableName') {
            err('Only variables can be assigned', target);
            return [];
          }
          return [{ id: mk(n), k: 'set', name: src(target), value: expr(value) }];
        }
        if (e.name === 'CallExpression') {
          const s = callStmt(e);
          return s ? [s] : [];
        }
        err('This statement does nothing: write a call or an assignment', n);
        return [];
      }
      case 'VariableDeclaration': {
        const [kw, name, , value] = kids(n);
        if (src(kw) !== 'const') {
          err('Declare variables at the top of the program with let; inside a block only const results are allowed', kw);
          return [];
        }
        if (!value || value.name !== 'CallExpression') {
          err('A const must be bound to a call, such as: const foe = scan();', n);
          return [];
        }
        const s = callStmt(value, src(name));
        return s ? [s] : [];
      }
      case 'IfStatement': {
        const parts = kids(n);
        const cond = parts[1];
        const thenNode = parts[2];
        const elseIdx = parts.findIndex((p) => p.name === 'else');
        const elseNode = elseIdx >= 0 ? parts[elseIdx + 1] : undefined;
        return [{ id: mk(n), k: 'if', cond: expr(cond), then: body(thenNode), else: elseNode ? body(elseNode) : [] }];
      }
      case 'WhileStatement': {
        const [, cond, b] = kids(n);
        return [{ id: mk(n), k: 'while', cond: expr(cond), body: body(b) }];
      }
      case ';':
        return [];
      default:
        err(`This statement is not supported: ${n.name}`, n);
        return [];
    }
  };

  const body = (n: SyntaxNode): Stmt[] => {
    if (n.name !== 'Block') return stmt(n);
    return kids(n).filter((c) => c.name !== '{' && c.name !== '}').flatMap(stmt);
  };

  // --- top level ---
  const vars: VarDecl[] = [];
  const handlers: Handler[] = [];
  let note: string[] = [];
  const takeNote = (): string | undefined => {
    const n = note.length ? note.join('\n') : undefined;
    note = [];
    return n;
  };

  const configOf = (def: EventDef, obj: SyntaxNode): Record<string, ConfigValue> => {
    const out: Record<string, ConfigValue> = {};
    for (const prop of kids(obj).filter((c) => c.name === 'Property')) {
      const parts = kids(prop);
      const key = src(parts[0]);
      const value = parts.at(-1)!;
      if (parts.length < 3) {
        err(`Write the setting as ${key}: value`, prop);
        continue;
      }
      const field = def.config.find((f) => f.name === key);
      if (!field) {
        err(`${def.name} has no setting '${key}'${def.config.length ? ` (it has: ${def.config.map((f) => f.name).join(', ')})` : ''}`, parts[0]);
        continue;
      }
      if (field.type === 'string') {
        if (value.name === 'String') out[key] = src(value).slice(1, -1).replace(/\\(['"\\])/g, '$1');
        else err(`${key} needs text in quotes`, value);
      } else if (field.type === 'ints') {
        if (value.name !== 'ArrayExpression') {
          err(`${key} needs a list, such as [A, B]`, value);
          continue;
        }
        const list: number[] = [];
        for (const item of kids(value).filter((c) => !['[', ']', ','].includes(c.name))) {
          const v = constEval(item);
          if (v === undefined) err('Settings can only use numbers and named constants', item);
          else list.push(v);
        }
        out[key] = list;
      } else {
        const v = constEval(value);
        if (v === undefined) err('Settings can only use numbers and named constants', value);
        else out[key] = v;
      }
    }
    return out;
  };

  const handler = (call: SyntaxNode, comment: string | undefined): void => {
    const args = kids(kids(call)[1]).filter((c) => !['(', ')', ','].includes(c.name));
    const evNode = args[0];
    if (!evNode || evNode.name !== 'VariableName') {
      err('on() needs an event name first, such as on(Idle, () => { ... })', call);
      return;
    }
    const def = EVENT_BY_NAME.get(src(evNode));
    if (!def) {
      err(`Unknown event '${src(evNode)}' (events: ${[...EVENT_BY_NAME.keys()].join(', ')})`, evNode);
      return;
    }
    const fnNode = args.at(-1);
    if (!fnNode || fnNode.name !== 'ArrowFunction') {
      err(`on(${def.name}, ...) needs a function at the end: () => { ... }`, call);
      return;
    }
    let config: Record<string, ConfigValue> = {};
    if (args.length === 3) {
      if (args[1].name === 'ObjectExpression') config = configOf(def, args[1]);
      else err('The settings of an event are written as an object: { range: 6 }', args[1]);
    } else if (args.length > 3 || args.length < 2) {
      err(`on() takes the event, optional settings, and a function`, call);
    }
    const params = kids(kids(fnNode)[0]).filter((c) => c.name === 'VariableDefinition').map(src);
    const block = kids(fnNode).find((c) => c.name === 'Block');
    if (!block) {
      err('The handler needs a block body: () => { ... }', fnNode);
      return;
    }
    handlers.push({ id: mk(call), event: def.name, config, params, body: body(block), ...(comment ? { note: comment } : {}) });
  };

  for (const n of kids(tree.topNode)) {
    if (n.name === 'LineComment') {
      note.push(src(n).replace(/^\/\/ ?/, ''));
      continue;
    }
    const comment = takeNote();
    if (n.name === 'VariableDeclaration') {
      const [kw, name, , value] = kids(n);
      if (src(kw) !== 'let') {
        err('Declare program variables with let', kw);
        continue;
      }
      const v = value ? constEval(value) : 0;
      if (v === undefined) err('A variable can only start as a number or a named constant', value ?? n);
      vars.push({ name: src(name), init: v ?? 0, ...(comment ? { note: comment } : {}) });
      ranges.set(`var:${src(name)}`, firstLine(n));
    } else if (n.name === 'ExpressionStatement' && n.firstChild?.name === 'CallExpression' && src(kids(n.firstChild)[0]) === 'on') {
      handler(n.firstChild, comment);
    } else if (n.name !== ';') {
      err('At the top level only let declarations and on(...) blocks are allowed', n);
    }
  }

  const syntaxErrors = errors.length;
  let doc: FlowDoc = { ...emptyDoc(), vars, handlers };
  // Check the program too, and turn each problem into a range in the text.
  const analysis = checkDoc(doc, host, host.reservedKeys);
  for (const e of analysis.errors) {
    const r = e.node ? ranges.get(e.node) : undefined;
    errors.push(r ? new FlowError(e.message, r.from, r.to, e.node) : e);
  }
  if (prev) doc = alignIds(prev, doc);
  return { doc, errors, syntaxErrors, memory: analysis.memory };
}

// ============================================================================================
// Keeping ids stable across a text edit
// ============================================================================================

/**
 * Gives statements of `doc` the ids of the statement in the same place of `prev` (same
 * handler, same position, same kind and function), so editing text does not forget where
 * the graph view had put things. Anything new keeps its fresh id.
 */
export function alignIds(prev: FlowDoc, doc: FlowDoc): FlowDoc {
  const used = new Set<string>();
  const claim = (id: string | undefined, fallback: string): string => {
    if (id && !used.has(id)) {
      used.add(id);
      return id;
    }
    return fallback;
  };
  const same = (a: Stmt, b: Stmt) => a.k === b.k && (a.k !== 'call' || a.fn === (b as typeof a).fn);
  const walk = (old: readonly Stmt[] | undefined, list: readonly Stmt[]): Stmt[] =>
    list.map((s, i) => {
      const o = old?.[i] && same(old[i], s) ? old[i] : undefined;
      const id = claim(o?.id, s.id);
      if (s.k === 'call' && s.outcomes) {
        const oldOutcomes = o?.k === 'call' ? o.outcomes : undefined;
        return { ...s, id, outcomes: Object.fromEntries(Object.entries(s.outcomes).map(([name, chain]) => [name, walk(oldOutcomes?.[name], chain)])) };
      }
      if (s.k === 'if') return { ...s, id, then: walk(o?.k === 'if' ? o.then : undefined, s.then), else: walk(o?.k === 'if' ? o.else : undefined, s.else) };
      if (s.k === 'while') return { ...s, id, body: walk(o?.k === 'while' ? o.body : undefined, s.body) };
      return { ...s, id };
    });
  const seen = new Map<string, number>();
  const handlers = doc.handlers.map((h) => {
    const n = seen.get(h.event) ?? 0;
    seen.set(h.event, n + 1);
    const old = prev.handlers.filter((p) => p.event === h.event)[n];
    return { ...h, id: claim(old?.id, h.id), body: walk(old?.body, h.body) };
  });
  return { ...doc, handlers };
}

// ============================================================================================
// Printing
// ============================================================================================

export function printText(doc: FlowDoc, host: FlowHost): string {
  const apiByName = new Map(host.api.map((b) => [b.name, b]));
  const lines: string[] = [];
  const comment = (note: string | undefined, indent: string) => {
    if (note !== undefined) for (const l of note.split('\n')) lines.push(`${indent}//${l ? ' ' + l : ''}`);
  };

  const prec = (e: Expr): number => {
    switch (e.k) {
      case 'bin': return PREC[e.op];
      case 'un': return PREC_UNARY;
      case 'cond': return PREC_COND;
      case 'num': return e.v < 0 ? PREC_UNARY : PREC_ATOM;
      default: return PREC_ATOM;
    }
  };
  const wrap = (e: Expr, min: number): string => (prec(e) < min ? `(${expr(e)})` : expr(e));
  const expr = (e: Expr): string => {
    switch (e.k) {
      case 'num': return String(e.v);
      case 'str': return `'${e.v.replace(/(['\\])/g, '\\$1')}'`;
      case 'ref': return e.name;
      case 'un': return `${e.op}${wrap(e.a, PREC_UNARY)}`;
      case 'bin': {
        const p = PREC[e.op];
        const logic = e.op === '&&' || e.op === '||';
        // Mixed && / || are always parenthesised, and so is any binary operand of equal precedence on the right.
        const left = e.a.k === 'bin' && logic && (e.a.op === '&&' || e.a.op === '||') && e.a.op !== e.op ? `(${expr(e.a)})` : wrap(e.a, p);
        const right = e.b.k === 'bin' && logic && (e.b.op === '&&' || e.b.op === '||') && e.b.op !== e.op ? `(${expr(e.b)})` : wrap(e.b, p + 1);
        const op = e.op === '==' ? '===' : e.op === '!=' ? '!==' : e.op;
        return `${left} ${op} ${right}`;
      }
      case 'cond': return `${wrap(e.c, 1)} ? ${wrap(e.a, 1)} : ${wrap(e.b, 1)}`;
      case 'call': return `${e.fn}(${e.args.map(expr).join(', ')})`;
    }
  };

  const block = (list: readonly Stmt[], indent: string): void => {
    for (const s of list) {
      switch (s.k) {
        case 'comment':
          comment(s.text, indent);
          break;
        case 'call': {
          const b = apiByName.get(s.fn);
          const callee = `${b?.kind === 'config' ? 'config.' : ''}${s.fn}`;
          const lead = `${indent}${s.result !== undefined ? `const ${s.result} = ` : ''}${callee}(${s.args.map(expr).join(', ')}`;
          const present = s.outcomes ? [...(b?.outcomes ?? []).filter((n) => s.outcomes![n]), ...Object.keys(s.outcomes).filter((n) => !(b?.outcomes ?? []).includes(n))] : [];
          if (!s.outcomes) {
            lines.push(`${lead});`);
            break;
          }
          lines.push(`${lead}${s.args.length ? ', ' : ''}{`);
          for (const name of present) {
            lines.push(`${indent}  ${name}: () => {`);
            block(s.outcomes[name], indent + '    ');
            lines.push(`${indent}  },`);
          }
          lines.push(`${indent}});`);
          break;
        }
        case 'set':
          lines.push(`${indent}${s.name} = ${expr(s.value)};`);
          break;
        case 'if': {
          lines.push(`${indent}if (${expr(s.cond)}) {`);
          block(s.then, indent + '  ');
          let tail = s.else;
          // An else holding exactly one if is written as an else-if chain.
          while (tail.length === 1 && tail[0].k === 'if') {
            const inner = tail[0];
            lines.push(`${indent}} else if (${expr(inner.cond)}) {`);
            block(inner.then, indent + '  ');
            tail = inner.else;
          }
          if (tail.length) {
            lines.push(`${indent}} else {`);
            block(tail, indent + '  ');
          }
          lines.push(`${indent}}`);
          break;
        }
        case 'while':
          lines.push(`${indent}while (${expr(s.cond)}) {`);
          block(s.body, indent + '  ');
          lines.push(`${indent}}`);
          break;
      }
    }
  };

  const configText = (h: Handler): string => {
    const def = EVENT_BY_NAME.get(h.event);
    const keys = def ? def.config.map((f) => f.name).filter((k) => k in h.config) : Object.keys(h.config);
    for (const k of Object.keys(h.config)) if (!keys.includes(k)) keys.push(k);
    if (!keys.length) return '';
    const parts = keys.map((k) => {
      const v = h.config[k];
      const named = (n: number): string => configNumberText(h.event, k, n, host);
      if (typeof v === 'string') return `${k}: '${v.replace(/(['\\])/g, '\\$1')}'`;
      if (typeof v === 'number') return `${k}: ${named(v)}`;
      return `${k}: [${v.map(named).join(', ')}]`;
    });
    return ` { ${parts.join(', ')} },`;
  };

  for (const v of doc.vars) {
    comment(v.note, '');
    lines.push(`let ${v.name} = ${v.init};`);
  }
  for (const h of doc.handlers) {
    if (lines.length) lines.push('');
    comment(h.note, '');
    const cfg = configText(h);
    lines.push(`on(${h.event},${cfg || ''} (${h.params.join(', ')}) => {`.replace(',  (', ', ('));
    block(h.body, '  ');
    lines.push('});');
  }
  return lines.join('\n') + (lines.length ? '\n' : '');
}
