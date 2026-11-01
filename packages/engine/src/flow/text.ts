import { parser } from '@lezer/javascript';
import type { SyntaxNode } from '@lezer/common';
import { BLOCK_BY_NAME, blockContext, checkBlocks } from './blocks';
import { checkDoc, type MemoryUse } from './check';
import { configNumberText } from './config';
import { CONTROL_SETTINGS, controlFrom } from './controls';
import { customEventDef, EVENT_BY_NAME, isCustomEventName, type EventDef } from './events';
import { callSyntax, type BuiltinSig, type FlowHost } from './host';
import { LIST_OP_BY_NAME } from './lists';
import {
  emptyDoc,
  FlowError,
  idGenerator,
  type BinOp,
  type BlockUse,
  type ChainStep,
  type ConfigValue,
  type ControlDecl,
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
// The object tree: self, self.modules[...]
// ============================================================================================

/** Builtins by their place in the object tree (`self.hp`, `self.modules.weapon.fire`). */
function memberIndex(host: FlowHost): Map<string, BuiltinSig> {
  const out = new Map<string, BuiltinSig>();
  for (const b of host.api) if (b.member) out.set(b.member, b);
  return out;
}

/** The message for a `self...` path that names nothing, listing what would have been valid at the point it went wrong. */
function unknownMember(path: readonly string[], members: ReadonlyMap<string, BuiltinSig>): string {
  const names = (prefix: string): string[] => {
    const seen = new Set<string>();
    for (const key of members.keys()) {
      const m = key.replace('[]', '');
      if (m.startsWith(prefix)) seen.add(m.slice(prefix.length).split('.')[0]);
    }
    return [...seen];
  };
  const text = path.join('.');
  if (path[1] === 'modules') {
    if (path.length === 2) return "self.modules holds the unit's modules: write self.modules['weapon'].fire(h)";
    if (path.length === 3 || !names('self.modules.').includes(path[2])) {
      return `This unit has no module called '${path[2]}' (modules: ${names('self.modules.').join(', ')})`;
    }
    return `${text} does not exist (${path[2]} has: ${names(`self.modules.${path[2]}.`).join(', ')})`;
  }
  if (path.length === 1) return "self is the unit running the program: write self.hp, self.moveTo(x, y) or self.modules['weapon'].fire(h)";
  return `self has no '${path[1]}' (it has: ${names('self.').filter((n) => n !== 'modules').join(', ')}, modules)`;
}

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
  const members = memberIndex(host);
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

  /**
   * `self.modules['weapon'][i].fire` as the path ['self', 'modules', 'weapon', '[]', 'fire'] and the node of the index;
   * undefined unless it is a plain chain of names with at most one index.
   */
  const memberInfo = (n: SyntaxNode): { path: string[]; index?: SyntaxNode } | undefined => {
    if (n.name === 'VariableName') return { path: [src(n)] };
    if (n.name !== 'MemberExpression') return undefined;
    const parts = kids(n);
    const head = memberInfo(parts[0]);
    if (!head) return undefined;
    const name = parts.find((p) => p.name === 'PropertyName');
    if (name) return { path: [...head.path, src(name)], index: head.index };
    const open = parts.findIndex((p) => p.name === '[');
    const key = open >= 0 ? parts[open + 1] : undefined;
    if (!key) return undefined;
    if (key.name === 'String') return { path: [...head.path, src(key).slice(1, -1)], index: head.index };
    return head.index ? undefined : { path: [...head.path, '[]'], index: key };
  };
  const isSelf = (n: SyntaxNode): boolean => memberInfo(n)?.path[0] === 'self';

  /** The builtin a `self...` path names (module aliases resolved), or undefined. */
  const findMember = (path: readonly string[]): BuiltinSig | undefined => {
    const key = (p: readonly string[]) => p.join('.').replace(/\.\[\]/g, '[]');
    return members.get(key(path)) ?? members.get(key(path.map((p, i) => (i === 2 && path[1] === 'modules' ? (host.moduleAliases?.get(p) ?? p) : p))));
  };
  /** `self.modules.weapon.filter` and the like: a step of a chain that starts at a module list. */
  const isListChain = (n: SyntaxNode): boolean => {
    const path = memberInfo(n)?.path;
    return !!path && path.length > 2 && LIST_OP_BY_NAME.has(path[path.length - 1]) && !!findMember(path.slice(0, -1))?.list;
  };
  /** A `self...` name that is a property, method or module call (not the start of a list chain). */
  const isSelfCall = (n: SyntaxNode): boolean => isSelf(n) && !isListChain(n);

  /** The builtin a `self...` path names, with a problem reported at `n` if it names none or is used the wrong way. */
  const selfCall = (n: SyntaxNode, called: boolean): { b: BuiltinSig; lead: Expr[] } | undefined => {
    const { path, index } = memberInfo(n)!;
    const text = path.join('.').replace(/\.\[\]/g, '[i]');
    const b = findMember(path);
    if (!b) {
      err(unknownMember(path, members), n);
      return undefined;
    }
    if (called && b.prop) err(`${text} is a property: write it without brackets`, n);
    else if (!called && !b.prop) err(`${text} is a function: write ${text}(${(b.args ?? []).slice(index ? 1 : 0).join(', ')})`, n);
    return { b, lead: index ? [expr(index)] : [] };
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
      case 'MemberExpression': {
        if (!isSelf(n)) {
          err('Only self.something can be read like this', n);
          return { k: 'num', v: 0 };
        }
        const r = selfCall(n, false);
        return { k: 'call', fn: r?.b.name ?? 'x', args: r?.lead ?? [] };
      }
      case 'CallExpression': {
        const [callee, args] = kids(n);
        if (callee.name === 'MemberExpression' && isSelfCall(callee)) {
          const r = selfCall(callee, true);
          return { k: 'call', fn: r?.b.name ?? 'x', args: [...(r?.lead ?? []), ...argList(args)] };
        }
        if (callee.name === 'MemberExpression') return chainExpr(n);
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

  /** `findResources(10).filter(r => resource(r) > 50).first()`: a list source, then steps (see lists.ts). */
  const chainExpr = (n: SyntaxNode): Expr => {
    const steps: ChainStep[] = [];
    let cur = n;
    while (cur.name === 'CallExpression') {
      const [callee, args] = kids(cur);
      if (callee.name === 'MemberExpression') {
        const parts = kids(callee);
        steps.unshift(chainStep(src(parts[parts.length - 1]), args));
        cur = parts[0];
      } else if (callee.name === 'VariableName') {
        return { k: 'chain', fn: src(callee), args: argList(args), steps };
      } else {
        break;
      }
    }
    if (cur.name === 'MemberExpression' && isSelf(cur)) {
      const b = findMember(memberInfo(cur)!.path);
      if (b?.list) return { k: 'chain', fn: b.name, args: [], steps };
    }
    err('A list chain starts with a find function, such as findResources(10).filter(r => resource(r) > 50).first()', n);
    return { k: 'num', v: 0 };
  };

  const chainStep = (op: string, args: SyntaxNode): ChainStep => {
    const argNodes = kids(args).filter((c) => !['(', ')', ','].includes(c.name));
    const fnNode = argNodes.at(-1)?.name === 'ArrowFunction' ? argNodes.pop()! : undefined;
    const stray = argNodes.find((a) => a.name === 'ArrowFunction');
    if (stray) err(`The function must come last: .${op}(..., r => ...)`, stray);
    const plain = argNodes.filter((a) => a !== stray).map(expr);
    if (!fnNode) return { op, params: [], args: plain };
    const parts = kids(fnNode);
    const head = parts[0];
    const params = head.name === 'ParamList' ? kids(head).filter((c) => c.name === 'VariableDefinition').map(src) : head.name === 'VariableDefinition' ? [src(head)] : [];
    const bodyNode = parts[parts.length - 1];
    if (bodyNode.name === 'Block' || bodyNode.name === '=>') {
      err(`Write the function as a single expression, such as ${params[0] ?? 'r'} => dist(${params[0] ?? 'r'}) < 5`, fnNode);
      return { op, params, args: [...plain, { k: 'num', v: 0 }] };
    }
    return { op, params, args: [...plain, expr(bodyNode)] };
  };

  const argList = (args: SyntaxNode): Expr[] => kids(args).filter((c) => !['(', ')', ','].includes(c.name)).map(expr);

  // --- statements ---
  const callStmt = (n: SyntaxNode, result?: string): Stmt | undefined => {
    const [callee, args] = kids(n);
    let fn: string;
    let lead: Expr[] = [];
    if (callee.name === 'MemberExpression' && isSelfCall(callee)) {
      const r = selfCall(callee, true);
      if (!r) return undefined;
      fn = r.b.name;
      lead = r.lead;
    } else if (callee.name === 'VariableName') {
      fn = src(callee);
      const b = apiByName.get(fn);
      if (b?.kind === 'config') err(`${fn}() is a runtime setting: write ${b.member ?? `config.${fn}`}(...)`, callee);
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
    return { id, k: 'call', fn, args: [...lead, ...argNodes.map(expr)], ...(result !== undefined ? { result } : {}), ...(outcomes ? { outcomes } : {}) };
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
        if (e.name === 'CallExpression' && src(kids(e)[0]) === 'emit') {
          const argNodes = kids(kids(e)[1]).filter((c) => !['(', ')', ','].includes(c.name));
          if (!argNodes[0] || argNodes[0].name !== 'VariableName') {
            err('emit() needs an event name first, such as emit(Delivered, amount)', e);
            return [];
          }
          return [{ id: mk(n), k: 'emit', event: src(argNodes[0]), args: argNodes.slice(1).map(expr) }];
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
        if (!value) {
          err('A const needs a value, such as: const foe = scan();', n);
          return [];
        }
        if (value.name === 'MemberExpression' && isSelfCall(value)) {
          // const load = self.cargo; is the property read, kept as a call with a result (the graph shows it as one).
          const r = selfCall(value, false);
          return [{ id: mk(n), k: 'call', fn: r?.b.name ?? 'x', args: r?.lead ?? [], result: src(name) }];
        }
        if (value.name !== 'CallExpression' || (kids(value)[0].name === 'MemberExpression' && !isSelfCall(kids(value)[0]))) {
          // Any other expression (a list chain, a sum, a condition) is bound through calc(), which returns what it is given.
          return [{ id: mk(n), k: 'call', fn: 'calc', args: [expr(value)], result: src(name) }];
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
  const blocks: BlockUse[] = [];
  const controls: ControlDecl[] = [];
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
    const def = EVENT_BY_NAME.get(src(evNode)) ?? (isCustomEventName(src(evNode)) ? customEventDef(src(evNode)) : undefined);
    if (!def) {
      err(`Unknown event '${src(evNode)}' (events: ${[...EVENT_BY_NAME.keys()].join(', ')}; or one of your own, starting with a capital letter)`, evNode);
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

  const use = (call: SyntaxNode, comment: string | undefined): void => {
    const args = kids(kids(call)[1]).filter((c) => !['(', ')', ','].includes(c.name));
    const nameNode = args[0];
    if (!nameNode || nameNode.name !== 'VariableName') {
      err('use() needs a block name first, such as use(HarvestLoop, { minMatter: 10 })', call);
      return;
    }
    const def = BLOCK_BY_NAME.get(src(nameNode));
    if (!def) {
      err(`Unknown block '${src(nameNode)}' (blocks: ${[...BLOCK_BY_NAME.keys()].join(', ')})`, nameNode);
      return;
    }
    let settings: Record<string, ConfigValue> = {};
    if (args.length === 2 && args[1].name === 'ObjectExpression') settings = configOf({ name: def.name, config: def.settings } as unknown as EventDef, args[1]);
    else if (args.length > 1) err('The settings of a block are written as one object: { minMatter: 10 }', args[1]);
    blocks.push({ id: mk(call), block: def.name, settings, ...(comment ? { note: comment } : {}) });
  };

  const control = (kind: ControlDecl['kind'], call: SyntaxNode, comment: string | undefined): void => {
    const args = kids(kids(call)[1]).filter((c) => !['(', ')', ','].includes(c.name));
    const nameNode = args[0];
    if (!nameNode || nameNode.name !== 'VariableName') {
      err(`${kind}() needs a variable first, such as ${kind}(power, { label: 'Power' })`, call);
      return;
    }
    let settings: Record<string, ConfigValue> = {};
    if (args.length === 2 && args[1].name === 'ObjectExpression') settings = configOf({ name: kind, config: CONTROL_SETTINGS[kind] } as unknown as EventDef, args[1]);
    else if (args.length > 1) err('The settings of a control are written as one object: { label: "Power", min: 0, max: 10 }', args[1]);
    controls.push(controlFrom(kind, src(nameNode), settings, comment));
    ranges.set(`ctl:${src(nameNode)}`, firstLine(call));
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
    } else if (n.name === 'ExpressionStatement' && n.firstChild?.name === 'CallExpression' && src(kids(n.firstChild)[0]) === 'use') {
      use(n.firstChild, comment);
    } else if (n.name === 'ExpressionStatement' && n.firstChild?.name === 'CallExpression' && ['slider', 'toggle'].includes(src(kids(n.firstChild)[0]))) {
      control(src(kids(n.firstChild)[0]) as ControlDecl['kind'], n.firstChild, comment);
    } else if (n.name !== ';') {
      err('At the top level only let declarations, slider(...), toggle(...), use(...) and on(...) blocks are allowed', n);
    }
  }

  const syntaxErrors = errors.length;
  let doc: FlowDoc = { ...emptyDoc(), vars, handlers, ...(blocks.length ? { blocks } : {}), ...(controls.length ? { controls } : {}) };
  // Check the program too (with its blocks expanded), and turn each problem into a range in the text.
  const analysis = checkDoc(expandBlocks(doc, host), host, host.reservedKeys);
  for (const e of [...checkBlocks(doc), ...analysis.errors]) {
    const r = e.node ? ranges.get(e.node.split('~')[0]) : undefined;
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
  const blocks = doc.blocks?.map((b, i) => {
    const old = prev.blocks?.[i];
    return { ...b, id: claim(old && old.block === b.block ? old.id : undefined, b.id) };
  });
  return { ...doc, handlers, ...(blocks ? { blocks } : {}) };
}

// ============================================================================================
// Blocks
// ============================================================================================

const prefixed = (list: readonly Stmt[], prefix: string): Stmt[] =>
  list.map((s): Stmt => {
    const id = `${prefix}~${s.id}`;
    if (s.k === 'if') return { ...s, id, then: prefixed(s.then, prefix), else: prefixed(s.else, prefix) };
    if (s.k === 'while') return { ...s, id, body: prefixed(s.body, prefix) };
    if (s.k === 'call' && s.outcomes) return { ...s, id, outcomes: Object.fromEntries(Object.entries(s.outcomes).map(([k, chain]) => [k, prefixed(chain, prefix)])) };
    return { ...s, id };
  });

/** The program text a block writes for its settings (what `Expand` turns it into). */
export function blockText(use: BlockUse, host: FlowHost): string {
  const def = BLOCK_BY_NAME.get(use.block);
  return def ? def.text(blockContext(def, use.settings, host.constants)) : '';
}

/**
 * The plain program a document with blocks stands for: every `use` replaced by the variables and event
 * blocks its template writes. Their ids are `<use id>~<their id>` so a problem in one can be shown on the block.
 */
export function expandBlocks(doc: FlowDoc, host: FlowHost): FlowDoc {
  if (!doc.blocks?.length) return doc;
  const vars = [...doc.vars];
  const handlers = [...doc.handlers];
  const controls = [...(doc.controls ?? [])];
  for (const u of doc.blocks) {
    if (!BLOCK_BY_NAME.has(u.block)) continue;
    const part = parseText(blockText(u, host), host);
    if (part.syntaxErrors) throw new Error(`Block ${u.block} wrote a program with errors: ${part.errors.map((e) => e.message).join('; ')}`);
    vars.push(...part.doc.vars);
    controls.push(...(part.doc.controls ?? []));
    for (const h of part.doc.handlers) handlers.push({ ...h, id: `${u.id}~${h.id}`, body: prefixed(h.body, u.id) });
  }
  const { blocks: _blocks, ...rest } = doc;
  return { ...rest, vars, handlers, ...(controls.length ? { controls } : {}) };
}

/** One block turned into its plain variables and event blocks, in the program. */
export function expandOne(doc: FlowDoc, id: string, host: FlowHost): FlowDoc {
  const use = doc.blocks?.find((b) => b.id === id);
  if (!use) throw new FlowError('That block no longer exists');
  const expanded = expandBlocks({ ...doc, vars: [], handlers: [], blocks: [use] }, host);
  const rest = (doc.blocks ?? []).filter((b) => b.id !== id);
  const gen = idGenerator(doc);
  const fresh = (list: readonly Stmt[]): Stmt[] =>
    list.map((s): Stmt => {
      const sid = gen();
      if (s.k === 'if') return { ...s, id: sid, then: fresh(s.then), else: fresh(s.else) };
      if (s.k === 'while') return { ...s, id: sid, body: fresh(s.body) };
      if (s.k === 'call' && s.outcomes) return { ...s, id: sid, outcomes: Object.fromEntries(Object.entries(s.outcomes).map(([k, chain]) => [k, fresh(chain)])) };
      return { ...s, id: sid };
    });
  const handlers = expanded.handlers.map((h) => ({ ...h, id: gen(), body: fresh(h.body), ...(use.note ? {} : {}) }));
  const { blocks: _b, ...base } = doc;
  return { ...base, vars: [...doc.vars, ...expanded.vars], handlers: [...doc.handlers, ...handlers], ...(expanded.controls?.length ? { controls: expanded.controls } : {}), ...(rest.length ? { blocks: rest } : {}) };
}

// ============================================================================================
// Printing
// ============================================================================================

/** An expression as program text, with the fewest parentheses that keep its meaning. */
/** A call as text: its place in the object tree if it has one (an `[]` there takes the first argument as the index). */
function callText(b: BuiltinSig | undefined, fn: string, args: readonly Expr[], expr: (e: Expr) => string): string {
  if (!b?.member) return `${fn}(${args.map(expr).join(', ')})`;
  const indexed = b.member.includes('[]');
  const path = indexed ? b.member.replace('[]', `[${expr(args[0])}]`) : b.member;
  return b.prop ? path : `${path}(${args.slice(indexed ? 1 : 0).map(expr).join(', ')})`;
}

export function exprText(e: Expr, lookup?: (fn: string) => BuiltinSig | undefined): string {
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
      case 'call': return callText(lookup?.(e.fn), e.fn, e.args, expr);
      case 'chain': {
        const steps = e.steps.map((st) => {
          const plain = st.params.length ? st.args.slice(0, -1) : st.args;
          const parts = plain.map(expr);
          if (st.params.length) parts.push(`${st.params.length === 1 ? st.params[0] : `(${st.params.join(', ')})`} => ${expr(st.args[st.args.length - 1])}`);
          return `.${st.op}(${parts.join(', ')})`;
        });
        const head = lookup?.(e.fn);
        return `${head?.list && head.member ? head.member : `${e.fn}(${e.args.map(expr).join(', ')})`}${steps.join('')}`;
      }
    }
  };
  return expr(e);
}

export function printText(doc: FlowDoc, host: FlowHost): string {
  const apiByName = new Map(host.api.map((b) => [b.name, b]));
  const lines: string[] = [];
  const comment = (note: string | undefined, indent: string) => {
    if (note !== undefined) for (const l of note.split('\n')) lines.push(`${indent}//${l ? ' ' + l : ''}`);
  };

  const expr = (e: Expr): string => exprText(e, (fn) => apiByName.get(fn));

  const block = (list: readonly Stmt[], indent: string): void => {
    for (const s of list) {
      switch (s.k) {
        case 'comment':
          comment(s.text, indent);
          break;
        case 'call': {
          const b = apiByName.get(s.fn);
          if (s.fn === 'calc' && s.result !== undefined && s.args.length === 1 && !s.outcomes) {
            lines.push(`${indent}const ${s.result} = ${expr(s.args[0])};`);
            break;
          }
          const callee = b ? callSyntax(b) : s.fn;
          if (b?.member && !s.outcomes) {
            lines.push(`${indent}${s.result !== undefined ? `const ${s.result} = ` : ''}${callText(b, s.fn, s.args, expr)};`);
            break;
          }
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
        case 'emit':
          lines.push(`${indent}emit(${[s.event, ...s.args.map(expr)].join(', ')});`);
          break;
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
  for (const c of doc.controls ?? []) {
    comment(c.note, '');
    const label = `label: '${c.label.replace(/(['\\])/g, '\\$1')}'`;
    lines.push(c.kind === 'toggle' ? `toggle(${c.name}, { ${label} });` : `slider(${c.name}, { ${label}, min: ${c.min}, max: ${c.max}${c.step === 1 ? '' : `, step: ${c.step}`} });`);
  }
  for (const b of doc.blocks ?? []) {
    if (lines.length && !lines[lines.length - 1].startsWith('use(')) lines.push('');
    comment(b.note, '');
    const keys = Object.keys(b.settings);
    const parts = keys.map((k) => {
      const v = b.settings[k];
      const named = (n: number): string => configNumberText(b.block, k, n, host);
      if (typeof v === 'string') return `${k}: '${v.replace(/(['\\])/g, '\\$1')}'`;
      if (typeof v === 'number') return `${k}: ${named(v)}`;
      return `${k}: [${v.map(named).join(', ')}]`;
    });
    lines.push(parts.length ? `use(${b.block}, { ${parts.join(', ')} });` : `use(${b.block});`);
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
