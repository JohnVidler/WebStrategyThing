import { Op } from './opcodes';
import { MAX_ARGS, type BuiltinSig, type Program, type ProgramButton } from './types';

/*
 * Unit script language — deliberately tiny. 32-bit integers only.
 *
 *   var target = -1          // memory slot; initial value applied once at boot
 *   target = scan()
 *   if target >= 0 && fire(target) == 0 {
 *     moveTo(posx(target), posy(target))
 *   } else if moving() == 0 {
 *     move(rand(5) - 2, rand(5) - 2)
 *   }
 *   while cond { ... }
 *   yield                    // end this tick's execution here
 *
 * All variables live in the unit's memory and persist between ticks.
 * Reaching the end of the program ends the tick and restarts from the top next tick.
 * Operators, loosest first: ||  &&  == !=  < <= > >=  |  &  + -  * / %  unary - !
 *   (&& and || short-circuit; | and & are bitwise and bind tighter than comparisons, as in Python)
 * Host constants (e.g. MOVE, URGENT) are compile-time names supplied by the game.
 * Comments: // or #
 *
 *   button boost "Boost" key "B"   // top level only, before first use
 *   button mine "Lay mine" aim     // the player picks a point/unit after pressing it
 *
 * declares a player UI button. `boost` becomes a constant: the task type pushed
 * onto the unit's queue when the player presses the button.
 */

export const MAX_PROGRAM_OPS = 2048;
export const MAX_BUTTONS = 12;
export const MAX_BUTTON_LABEL = 20;

export interface CompileOptions {
  /** Task type of the first declared button; later ones follow on. Default 100. */
  readonly buttonBase?: number;
  /** Hotkeys buttons may not use, with what they are reserved for. */
  readonly reservedKeys?: ReadonlyMap<string, string>;
}

export class CompileError extends Error {
  constructor(
    readonly reason: string,
    readonly line: number,
    readonly col: number,
  ) {
    super(`line ${line}, col ${col}: ${reason}`);
    this.name = 'CompileError';
  }
}

interface Tok {
  k: 'num' | 'id' | 'op' | 'str' | 'eof';
  v: string;
  n: number;
  line: number;
  col: number;
}

const KEYWORDS = new Set(['var', 'if', 'else', 'while', 'yield', 'true', 'false', 'button']);
const OPS = ['&&', '||', '&', '|', '==', '!=', '<=', '>=', '+', '-', '*', '/', '%', '<', '>', '!', '=', '(', ')', '{', '}', ',', ';'];

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  let line = 1;
  let col = 1;
  const adv = (n: number) => {
    for (let k = 0; k < n; k++, i++) {
      if (src[i] === '\n') { line++; col = 1; } else col++;
    }
  };
  const isDigit = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9';
  const isIdStart = (c: string | undefined) => c !== undefined && /[A-Za-z_]/.test(c);
  const isIdPart = (c: string | undefined) => c !== undefined && /[A-Za-z0-9_]/.test(c);

  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') { adv(1); continue; }
    if (c === '#' || (c === '/' && src[i + 1] === '/')) {
      while (i < src.length && src[i] !== '\n') adv(1);
      continue;
    }
    const tl = line;
    const tc = col;
    if (isDigit(c)) {
      let j = i;
      while (isDigit(src[j])) j++;
      const text = src.slice(i, j);
      const n = Number(text);
      if (n > 0x7fffffff) throw new CompileError(`Number ${text} is too large`, tl, tc);
      out.push({ k: 'num', v: text, n, line: tl, col: tc });
      adv(j - i);
      continue;
    }
    if (isIdStart(c)) {
      let j = i;
      while (isIdPart(src[j])) j++;
      out.push({ k: 'id', v: src.slice(i, j), n: 0, line: tl, col: tc });
      adv(j - i);
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== '"' && src[j] !== '\n') j++;
      if (src[j] !== '"') throw new CompileError('Unterminated string', tl, tc);
      out.push({ k: 'str', v: src.slice(i + 1, j), n: 0, line: tl, col: tc });
      adv(j + 1 - i);
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw new CompileError(`Unexpected character '${c}'`, tl, tc);
    out.push({ k: 'op', v: op, n: 0, line: tl, col: tc });
    adv(op.length);
  }
  out.push({ k: 'eof', v: 'end of program', n: 0, line, col });
  return out;
}

const EQUALITY = new Map<string, number>([['==', Op.Eq], ['!=', Op.Ne]]);
const COMPARISON = new Map<string, number>([['<', Op.Lt], ['<=', Op.Le], ['>', Op.Gt], ['>=', Op.Ge]]);
const BIT_OR = new Map<string, number>([['|', Op.BitOr]]);
const BIT_AND = new Map<string, number>([['&', Op.BitAnd]]);
const ADDITIVE = new Map<string, number>([['+', Op.Add], ['-', Op.Sub]]);
const MULTIPLICATIVE = new Map<string, number>([['*', Op.Mul], ['/', Op.Div], ['%', Op.Mod]]);

export function compile(
  source: string,
  api: readonly BuiltinSig[],
  constants: ReadonlyMap<string, number> = new Map(),
  options: CompileOptions = {},
): Program {
  return new Compiler(tokenize(source), api, constants, source, options).program();
}

class Compiler {
  private pos = 0;
  private readonly code: number[] = [];
  private readonly slots = new Map<string, number>();
  private readonly init: number[] = [];
  private readonly builtins = new Map<string, number>();
  private readonly buttons: ProgramButton[] = [];
  private depth = 0;

  constructor(
    private readonly toks: Tok[],
    private readonly api: readonly BuiltinSig[],
    private readonly constants: ReadonlyMap<string, number>,
    private readonly source: string,
    private readonly options: CompileOptions,
  ) {
    api.forEach((b, id) => {
      if (b.argc > MAX_ARGS) throw new Error(`Builtin '${b.name}' takes more than ${MAX_ARGS} args`);
      this.builtins.set(b.name, id);
    });
  }

  program(): Program {
    while (this.peek().k !== 'eof') this.statement();
    this.emit(Op.Halt);
    return {
      code: Int32Array.from(this.code),
      slots: this.init.length,
      init: Int32Array.from(this.init),
      names: [...this.slots.keys()],
      source: this.source,
      buttons: this.buttons,
    };
  }

  // --- token helpers -------------------------------------------------------

  private peek(o = 0): Tok {
    return this.toks[Math.min(this.pos + o, this.toks.length - 1)];
  }

  private next(): Tok {
    const t = this.peek();
    if (t.k !== 'eof') this.pos++;
    return t;
  }

  private isOp(v: string, o = 0): boolean {
    const t = this.peek(o);
    return t.k === 'op' && t.v === v;
  }

  private isKw(v: string): boolean {
    const t = this.peek();
    return t.k === 'id' && t.v === v;
  }

  private expectOp(v: string): Tok {
    if (!this.isOp(v)) this.error(`Expected '${v}' but found '${this.peek().v}'`);
    return this.next();
  }

  private error(msg: string, t: Tok = this.peek()): never {
    throw new CompileError(msg, t.line, t.col);
  }

  // --- emit helpers --------------------------------------------------------

  private emit(op: number, arg = 0): number {
    if (this.code.length / 2 >= MAX_PROGRAM_OPS) this.error(`Program exceeds ${MAX_PROGRAM_OPS} instructions`);
    this.code.push(op, arg);
    return this.code.length - 2;
  }

  private patch(at: number, target: number): void {
    this.code[at + 1] = target;
  }

  private get here(): number {
    return this.code.length;
  }

  // --- statements ----------------------------------------------------------

  private statement(): void {
    if (this.isOp(';')) { this.next(); return; }
    if (this.isKw('var')) return this.varDecl();
    if (this.isKw('button')) return this.buttonDecl();
    if (this.isKw('if')) return this.ifStmt();
    if (this.isKw('while')) return this.whileStmt();
    if (this.isKw('yield')) { this.next(); this.emit(Op.Yield); return; }

    const t = this.peek();
    if (t.k === 'id' && !KEYWORDS.has(t.v) && this.isOp('=', 1)) {
      this.next();
      this.next();
      this.expr();
      this.emit(Op.Store, this.slotOf(t));
      return;
    }
    this.expr();
    this.emit(Op.Pop);
  }

  private varDecl(): void {
    this.next();
    const name = this.next();
    if (name.k !== 'id' || KEYWORDS.has(name.v)) this.error('Expected a variable name', name);
    this.checkFreeName(name);
    let value = 0;
    if (this.isOp('=')) {
      this.next();
      const neg = this.isOp('-');
      if (neg) this.next();
      const n = this.next();
      if (n.k !== 'num') this.error('Initial values must be integer literals (they are applied once at boot)', n);
      value = neg ? -n.n : n.n;
    }
    this.slots.set(name.v, this.init.length);
    this.init.push(value);
  }

  private checkFreeName(name: Tok): void {
    if (this.builtins.has(name.v)) this.error(`'${name.v}' is a builtin function`, name);
    if (this.constants.has(name.v)) this.error(`'${name.v}' is a built-in constant`, name);
    if (this.slots.has(name.v)) this.error(`Variable '${name.v}' is already declared`, name);
    if (this.buttons.some((b) => b.name === name.v)) this.error(`'${name.v}' is already a button`, name);
  }

  /** button name "Label" [key "K"] [aim] — UI metadata only, emits no code. */
  private buttonDecl(): void {
    const kw = this.next();
    if (this.depth > 0) this.error('Buttons must be declared at the top level, outside any block', kw);
    if (this.buttons.length >= MAX_BUTTONS) this.error(`At most ${MAX_BUTTONS} buttons per class`, kw);
    const name = this.next();
    if (name.k !== 'id' || KEYWORDS.has(name.v)) this.error('Expected a button name', name);
    this.checkFreeName(name);
    const label = this.next();
    if (label.k !== 'str') this.error('Expected the button label in quotes, e.g. "Boost"', label);
    if (!label.v.trim() || label.v.length > MAX_BUTTON_LABEL) {
      this.error(`Button labels must be 1-${MAX_BUTTON_LABEL} characters`, label);
    }
    let key = '';
    let aim = false;
    for (;;) {
      if (this.isKw('aim') && !this.isOp('=', 1)) {
        this.next();
        aim = true;
      } else if (this.isKw('key') && this.peek(1).k === 'str') {
        this.next();
        const k = this.next();
        key = k.v.toUpperCase();
        if (!/^[A-Z]$/.test(key)) this.error('Button keys must be a single letter', k);
        const reserved = this.options.reservedKeys?.get(key);
        if (reserved) this.error(`Key ${key} is reserved for ${reserved}`, k);
        if (this.buttons.some((b) => b.key === key)) this.error(`Key ${key} is already used by another button`, k);
      } else break;
    }
    const task = (this.options.buttonBase ?? 100) + this.buttons.length;
    this.buttons.push({ name: name.v, label: label.v.trim(), key, aim, task });
  }

  private ifStmt(): void {
    this.next();
    this.expr();
    const jz = this.emit(Op.Jz);
    this.block();
    if (this.isKw('else')) {
      this.next();
      const jmp = this.emit(Op.Jmp);
      this.patch(jz, this.here);
      if (this.isKw('if')) this.ifStmt();
      else this.block();
      this.patch(jmp, this.here);
    } else {
      this.patch(jz, this.here);
    }
  }

  private whileStmt(): void {
    this.next();
    const top = this.here;
    this.expr();
    const jz = this.emit(Op.Jz);
    this.block();
    this.emit(Op.Jmp, top);
    this.patch(jz, this.here);
  }

  private block(): void {
    this.expectOp('{');
    this.depth++;
    while (!this.isOp('}')) {
      if (this.peek().k === 'eof') this.error("Missing '}'");
      this.statement();
    }
    this.depth--;
    this.next();
  }

  private slotOf(t: Tok): number {
    const slot = this.slots.get(t.v);
    if (slot === undefined) this.error(`Unknown variable '${t.v}' (declare it with 'var')`, t);
    return slot;
  }

  // --- expressions ---------------------------------------------------------

  private expr(): void {
    this.or();
  }

  private or(): void {
    this.and();
    while (this.isOp('||')) {
      this.next();
      const j1 = this.emit(Op.Jnz);
      this.and();
      const j2 = this.emit(Op.Jnz);
      this.emit(Op.Push, 0);
      const end = this.emit(Op.Jmp);
      this.patch(j1, this.here);
      this.patch(j2, this.here);
      this.emit(Op.Push, 1);
      this.patch(end, this.here);
    }
  }

  private and(): void {
    this.equality();
    while (this.isOp('&&')) {
      this.next();
      const j1 = this.emit(Op.Jz);
      this.equality();
      const j2 = this.emit(Op.Jz);
      this.emit(Op.Push, 1);
      const end = this.emit(Op.Jmp);
      this.patch(j1, this.here);
      this.patch(j2, this.here);
      this.emit(Op.Push, 0);
      this.patch(end, this.here);
    }
  }

  private equality(): void {
    this.binary(() => this.comparison(), EQUALITY);
  }

  private comparison(): void {
    this.binary(() => this.bitOr(), COMPARISON);
  }

  private bitOr(): void {
    this.binary(() => this.bitAnd(), BIT_OR);
  }

  private bitAnd(): void {
    this.binary(() => this.additive(), BIT_AND);
  }

  private additive(): void {
    this.binary(() => this.multiplicative(), ADDITIVE);
  }

  private multiplicative(): void {
    this.binary(() => this.unary(), MULTIPLICATIVE);
  }

  private binary(operand: () => void, ops: Map<string, number>): void {
    operand();
    for (;;) {
      const t = this.peek();
      const op = t.k === 'op' ? ops.get(t.v) : undefined;
      if (op === undefined) return;
      this.next();
      operand();
      this.emit(op);
    }
  }

  private unary(): void {
    if (this.isOp('-')) {
      this.next();
      if (this.peek().k === 'num') { this.emit(Op.Push, -this.next().n); return; }
      this.unary();
      this.emit(Op.Neg);
      return;
    }
    if (this.isOp('!')) {
      this.next();
      this.unary();
      this.emit(Op.Not);
      return;
    }
    this.primary();
  }

  private primary(): void {
    const t = this.next();
    if (t.k === 'num') { this.emit(Op.Push, t.n); return; }
    if (t.k === 'op' && t.v === '(') {
      this.expr();
      this.expectOp(')');
      return;
    }
    if (t.k === 'id') {
      if (t.v === 'true') { this.emit(Op.Push, 1); return; }
      if (t.v === 'false') { this.emit(Op.Push, 0); return; }
      if (KEYWORDS.has(t.v)) this.error(`Unexpected keyword '${t.v}'`, t);
      if (this.isOp('(')) return this.call(t);
      const k = this.constants.get(t.v) ?? this.buttons.find((b) => b.name === t.v)?.task;
      if (k !== undefined) { this.emit(Op.Push, k); return; }
      this.emit(Op.Load, this.slotOf(t));
      return;
    }
    if (t.k === 'str') this.error('Text in quotes is only allowed in button declarations', t);
    this.error(`Unexpected '${t.v}'`, t);
  }

  private call(name: Tok): void {
    const id = this.builtins.get(name.v);
    if (id === undefined) this.error(`Unknown function '${name.v}'`, name);
    this.expectOp('(');
    let argc = 0;
    if (!this.isOp(')')) {
      do {
        this.expr();
        argc++;
      } while (this.isOp(',') && this.next());
    }
    this.expectOp(')');
    const sig = this.api[id];
    if (argc !== sig.argc) this.error(`'${sig.name}' takes ${sig.argc} argument(s), got ${argc}`, name);
    this.emit(Op.Call, id);
  }
}
