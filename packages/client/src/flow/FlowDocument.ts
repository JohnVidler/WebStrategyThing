import {
  checkBlocks,
  checkDoc,
  expandBlocks,
  emptyDoc,
  FlowError,
  isFlowSource,
  parseDoc,
  parseText,
  printText,
  serialize,
  type FlowDoc,
  type FlowHost,
  type FlowViews,
  type MemoryUse,
} from '@wst/engine';

/**
 * The program being edited: one model behind the Graph view and the Text view.
 *
 * The IR (`doc`) is the truth; the text is its printed form. A graph edit replaces the IR and
 * the text follows (`apply`). A text edit is parsed: if it parses, the IR follows it, with ids
 * kept where statements stay in place so the graph keeps its layout; if it does not parse, the
 * IR stays at the last good state, the text stays as typed, and `errors` says what is wrong
 * (`setText`). Both views subscribe, and each change says who made it so a view can skip its own.
 */

export interface Draft {
  readonly text: string;
  readonly views?: FlowViews;
}

export interface FlowChange {
  /** What produced the change; a view ignores changes it made itself. */
  readonly origin: unknown;
  /** The program (IR) changed, as opposed to only the text being edited into an unparsable state or the layout moving. */
  readonly docChanged: boolean;
}

interface Snapshot {
  readonly doc: FlowDoc;
  readonly views: FlowViews;
}

const HISTORY_LIMIT = 100;

export class FlowDocument {
  doc: FlowDoc = emptyDoc();
  text = '';
  /** Everything wrong with the text: syntax problems and program problems, each with its place. */
  errors: readonly FlowError[] = [];
  /** True while the text parses into a program (the IR then matches it, though it may still have program problems). */
  syntaxOk = true;
  /** Program problems by node id (unknown names, wrong kinds of call, ...), found on the IR itself. */
  problems: ReadonlyMap<string, string> = new Map();
  memory: MemoryUse = { vars: 0, literals: 0, locals: 0, total: 0 };
  views: FlowViews = {};
  /** The last test run's hit counts by node id (the graph's heat map), until the program changes. */
  heat: ReadonlyMap<string, number> | null = null;
  private readonly listeners = new Set<(change: FlowChange) => void>();
  private past: Snapshot[] = [];
  private future: Snapshot[] = [];

  constructor(private readonly host: FlowHost) {}

  /** True when the text is a valid program: it parses and passes every check. */
  get valid(): boolean {
    return this.errors.length === 0;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  subscribe(fn: (change: FlowChange) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(origin: unknown, docChanged: boolean): void {
    // Counts from a test run describe the program that ran: once it changes they would point at the wrong nodes.
    if (docChanged && origin !== 'heat') this.heat = null;
    for (const fn of [...this.listeners]) fn({ origin, docChanged });
  }

  /** Shows (or, with null, clears) a test run's hit counts on the graph. Not a program change and not undoable. */
  setHeat(heat: ReadonlyMap<string, number> | null): void {
    this.heat = heat;
    this.emit('heat', false);
  }

  /** Loads a stored program (JSON), or an empty program for ''. Anything unreadable loads as unusable text with an error. */
  loadSource(source: string, origin: unknown = 'load'): void {
    this.past = [];
    this.future = [];
    if (!source.trim()) {
      this.replace(emptyDoc(), {}, origin);
      return;
    }
    if (!isFlowSource(source)) return this.unreadable(source, 'This program is not in the event-block format and cannot be shown', origin);
    try {
      const doc = parseDoc(source);
      this.replace(doc, doc.views ?? {}, origin);
    } catch (err) {
      this.unreadable(source, err instanceof FlowError ? err.message : String(err), origin);
    }
  }

  private unreadable(source: string, message: string, origin: unknown): void {
    this.text = source;
    this.doc = emptyDoc();
    this.views = {};
    this.errors = [new FlowError(message)];
    this.syntaxOk = false;
    this.problems = new Map();
    this.emit(origin, true);
  }

  /** Loads program text (starter content, a history version). */
  loadText(text: string, views: FlowViews = {}, origin: unknown = 'load'): void {
    this.past = [];
    this.future = [];
    this.views = views;
    this.setText(text, origin, true);
  }

  loadDraft(draft: Draft, origin: unknown = 'load'): void {
    this.loadText(draft.text, draft.views ?? {}, origin);
  }

  draft(): Draft {
    return { text: this.text, views: this.views };
  }

  /** Adopts `doc` as the program: reprints the text and re-runs the checks. */
  private replace(doc: FlowDoc, views: FlowViews, origin: unknown): void {
    this.doc = { ...doc, views: undefined } as FlowDoc;
    this.views = views;
    this.text = printText(doc, this.host);
    const result = parseText(this.text, this.host);
    this.errors = result.errors;
    this.syntaxOk = result.syntaxErrors === 0;
    this.memory = result.memory;
    this.problems = this.findProblems();
    this.emit(origin, true);
  }

  /** Ids the editor's loose pieces already use, so statements parsed from text never share one. */
  private reservedIds(): string[] {
    const scratch = (this.views.graph as { scratch?: unknown } | undefined)?.scratch;
    return scratch ? [...JSON.stringify(scratch).matchAll(/"id":"(n\d+)"/g)].map((m) => m[1]) : [];
  }

  private findProblems(): ReadonlyMap<string, string> {
    const out = new Map<string, string>();
    // Problems inside a block's expansion are shown on the block (their ids are `<block id>~<id>`).
    for (const e of [...checkBlocks(this.doc), ...checkDoc(expandBlocks(this.doc, this.host), this.host, this.host.reservedKeys).errors]) {
      const node = e.node?.split('~')[0];
      if (node && !out.has(node)) out.set(node, e.message);
    }
    return out;
  }

  /** The user edited the text. */
  setText(text: string, origin: unknown = 'text', force = false): void {
    if (!force && text === this.text && this.errors.length === 0) return;
    const result = parseText(text, this.host, this.doc, this.reservedIds());
    this.text = text;
    this.errors = result.errors;
    this.syntaxOk = result.syntaxErrors === 0;
    this.memory = result.memory;
    const before = serialize(this.doc);
    if (this.syntaxOk) this.doc = result.doc;
    this.problems = this.syntaxOk ? this.findProblems() : this.problems;
    this.emit(origin, serialize(this.doc) !== before);
  }

  /** A graph edit: the new IR (with the views it came with) becomes the program, and the text is reprinted. Undoable. */
  apply(doc: FlowDoc, views: FlowViews, origin: unknown, merge = false): void {
    // `merge` folds this edit into the previous undo step (a wire replaced by another is two edits but one step).
    if (!merge || this.past.length === 0) {
      this.past.push({ doc: this.doc, views: this.views });
      if (this.past.length > HISTORY_LIMIT) this.past.shift();
    }
    this.future = [];
    this.replace(doc, views, origin);
  }

  undo(origin: unknown = 'undo'): boolean {
    const back = this.past.pop();
    if (!back) return false;
    this.future.push({ doc: this.doc, views: this.views });
    this.replace(back.doc, back.views, origin);
    return true;
  }

  redo(origin: unknown = 'redo'): boolean {
    const next = this.future.pop();
    if (!next) return false;
    this.past.push({ doc: this.doc, views: this.views });
    this.replace(next.doc, next.views, origin);
    return true;
  }

  /** Records where graph nodes sit (editor-only; never changes the program and is not undoable). */
  setViews(views: FlowViews, origin: unknown = 'layout'): void {
    this.views = views;
    this.emit(origin, false);
  }

  /** The stored form (JSON, including the editor-only views). Throws if the text is not a valid program. */
  source(): string {
    if (!this.valid) throw this.errors[0];
    const hasViews = Object.keys(this.views.graph ?? {}).length > 0;
    return serialize(hasViews ? { ...this.doc, views: this.views } : this.doc);
  }

  /** The stored form without the views: what the game runs, and what two programs are compared by. */
  logic(): string {
    return serialize({ ...this.doc, views: undefined } as FlowDoc);
  }

  /** True if there is any program at all (blocks or variables). */
  get isEmpty(): boolean {
    return this.doc.handlers.length === 0 && this.doc.vars.length === 0;
  }
}

/** Text of a stored program as the Text view prints it ('' if it cannot be read). */
export function sourceToText(source: string, host: FlowHost): string {
  if (!isFlowSource(source)) return '';
  try {
    return printText(parseDoc(source), host);
  } catch {
    return '';
  }
}
