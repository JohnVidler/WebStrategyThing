import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  type Completion,
  type CompletionContext,
} from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import {
  bracketMatching,
  HighlightStyle,
  indentOnInput,
  StreamLanguage,
  syntaxHighlighting,
  type StreamParser,
} from '@codemirror/language';
import { forceLinting, linter, lintGutter, type Diagnostic } from '@codemirror/lint';
import { EditorState } from '@codemirror/state';
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  hoverTooltip,
  keymap,
  lineNumbers,
} from '@codemirror/view';
import { CompileError, compileUnitProgram, SCRIPT_CONSTANT_DOCS, SCRIPT_CONSTANTS, UNIT_API } from '@wst/engine';
import { tags as t } from '@lezer/highlight';

const KEYWORDS = new Set(['var', 'if', 'else', 'while', 'yield', 'true', 'false', 'button']);
/** Only keywords inside a button declaration. */
const BUTTON_WORDS = new Set(['key', 'aim']);
const BUILTINS = new Map(UNIT_API.map((b) => [b.name, b]));
const CONSTANT_DOCS = new Map(SCRIPT_CONSTANT_DOCS.map(([name, value, doc]) => [name, { value, doc }]));

/** Tokeniser for the unit script language (mirrors the compiler's lexer). */
export const unitScript: StreamParser<{ afterVar: boolean; inButton: boolean }> = {
  name: 'unitscript',
  startState: () => ({ afterVar: false, inButton: false }),
  token(stream, state) {
    if (stream.sol()) state.inButton = false;
    if (stream.eatSpace()) return null;
    if (stream.match('#') || stream.match('//')) {
      stream.skipToEnd();
      return 'comment';
    }
    if (stream.match(/^\d+/)) return 'number';
    if (stream.match(/^"[^"]*"?/)) return 'string';
    const word = stream.match(/^[A-Za-z_][A-Za-z0-9_]*/) as RegExpMatchArray | null;
    if (word) {
      const w = word[0];
      const declaring = state.afterVar;
      state.afterVar = w === 'var' || w === 'button';
      if (w === 'button') state.inButton = true;
      if (state.inButton && BUTTON_WORDS.has(w)) return 'keyword';
      if (KEYWORDS.has(w)) return w === 'true' || w === 'false' ? 'bool' : 'keyword';
      if (declaring) return 'definition';
      if (BUILTINS.has(w)) return 'builtin';
      if (SCRIPT_CONSTANTS.has(w)) return 'constant';
      return 'variableName';
    }
    state.afterVar = false;
    if (stream.match(/^(&&|\|\||==|!=|<=|>=|[-+*/%<>!=&|])/)) return 'operator';
    if (stream.match(/^[{}()]/)) return 'bracket';
    stream.next();
    return null;
  },
  languageData: { commentTokens: { line: '#' }, indentOnInput: /^\s*\}$/ },
  tokenTable: {
    builtin: t.function(t.variableName),
    constant: t.constant(t.variableName),
    definition: t.definition(t.variableName),
  },
};

const highlight = HighlightStyle.define([
  { tag: t.keyword, color: '#c792ea' },
  { tag: t.bool, color: '#f78c6c' },
  { tag: t.number, color: '#f78c6c' },
  { tag: t.string, color: '#c3e88d' },
  { tag: t.comment, color: '#6a7686', fontStyle: 'italic' },
  { tag: t.function(t.variableName), color: '#82aaff' },
  { tag: t.constant(t.variableName), color: '#ffcb6b' },
  { tag: t.definition(t.variableName), color: '#c3e88d' },
  { tag: t.variableName, color: '#d6dde6' },
  { tag: t.operator, color: '#89ddff' },
  { tag: t.bracket, color: '#8b95a3' },
]);

const theme = EditorView.theme(
  {
    '&': { height: '100%', backgroundColor: '#0e1116', color: '#d6dde6', fontSize: '13px' },
    '.cm-scroller': { fontFamily: 'ui-monospace, Consolas, monospace', lineHeight: '1.5' },
    '.cm-content': { caretColor: '#4ea1ff' },
    '.cm-gutters': { backgroundColor: '#11161d', color: '#4b5563', border: 'none' },
    '.cm-activeLine': { backgroundColor: '#161c25' },
    '.cm-activeLineGutter': { backgroundColor: '#161c25', color: '#8b95a3' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: '#23324a !important' },
    '.cm-tooltip': { backgroundColor: '#161b22', border: '1px solid #2a313c', color: '#d6dde6' },
    '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: '#23324a', color: '#fff' },
    '.cm-completionDetail': { color: '#8b95a3', marginLeft: '8px' },
    '.cm-doc': { padding: '6px 8px', maxWidth: '360px', fontFamily: 'system-ui, sans-serif', fontSize: '12px' },
    '.cm-doc code': { color: '#82aaff' },
  },
  { dark: true },
);

const signature = (name: string) => {
  const b = BUILTINS.get(name)!;
  return `${b.name}(${(b.args ?? []).join(', ')})`;
};

function docNode(html: string): HTMLElement {
  const div = document.createElement('div');
  div.className = 'cm-doc';
  div.innerHTML = html;
  return div;
}

const escapeHtml = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

function builtinDoc(name: string): string {
  const b = BUILTINS.get(name)!;
  return `<code>${signature(name)}</code> · ${1 + b.cost} cycle${b.cost ? 's' : ''}<br>${escapeHtml(b.doc ?? '')}`;
}

/** Builtins, constants, keywords and the script's own variables. */
function completions(context: CompletionContext) {
  const word = context.matchBefore(/[A-Za-z_][A-Za-z0-9_]*/);
  if (!word || (word.from === word.to && !context.explicit)) return null;
  const vars = new Set<string>();
  const buttons = new Set<string>();
  const doc = context.state.doc.toString();
  for (const m of doc.matchAll(/\bvar\s+([A-Za-z_][A-Za-z0-9_]*)/g)) vars.add(m[1]);
  for (const m of doc.matchAll(/\bbutton\s+([A-Za-z_][A-Za-z0-9_]*)/g)) buttons.add(m[1]);
  const options: Completion[] = [
    ...UNIT_API.map((b) => ({
      label: b.name,
      type: 'function',
      detail: `(${(b.args ?? []).join(', ')}) ${1 + b.cost}c`,
      info: () => docNode(builtinDoc(b.name)),
      apply: `${b.name}(`,
    })),
    ...SCRIPT_CONSTANT_DOCS.map(([name, value, doc]) => ({
      label: name,
      type: 'constant',
      detail: String(value),
      info: doc,
    })),
    ...[...KEYWORDS].map((k) => ({ label: k, type: 'keyword' })),
    ...[...vars].map((v) => ({ label: v, type: 'variable' })),
    ...[...buttons].map((b) => ({ label: b, type: 'constant', detail: 'button task' })),
  ];
  return { from: word.from, options, validFor: /^[A-Za-z0-9_]*$/ };
}

/** Docs on hover for builtins and constants. */
const hoverDocs = hoverTooltip((view, pos) => {
  const line = view.state.doc.lineAt(pos);
  const text = line.text;
  let start = pos - line.from;
  let end = start;
  while (start > 0 && /\w/.test(text[start - 1])) start--;
  while (end < text.length && /\w/.test(text[end])) end++;
  const word = text.slice(start, end);
  let html: string | undefined;
  if (BUILTINS.has(word)) html = builtinDoc(word);
  else if (CONSTANT_DOCS.has(word)) html = `<code>${word} = ${CONSTANT_DOCS.get(word)!.value}</code><br>${escapeHtml(CONSTANT_DOCS.get(word)!.doc)}`;
  if (!html) return null;
  const content = html;
  return { pos: line.from + start, end: line.from + end, above: true, create: () => ({ dom: docNode(content) }) };
});

export interface EditorContext {
  /** Memory slots of the class being edited (undefined: unknown/invalid design). */
  memorySlots(): number | undefined;
  /** Whether the class has a CPU at all. */
  hasCpu(): boolean;
}

/** Runs the real compiler on every edit and turns its errors into diagnostics. */
function scriptLinter(ctx: EditorContext) {
  return linter(
    (view) => {
      const source = view.state.doc.toString();
      const out: Diagnostic[] = [];
      if (!source.trim()) return out;
      try {
        const program = compileUnitProgram(source);
        const slots = ctx.memorySlots();
        if (slots !== undefined && program.slots > slots) {
          out.push({
            from: 0,
            to: Math.min(source.length, view.state.doc.line(1).to),
            severity: 'error',
            message: `Uses ${program.slots} variables but this class only has ${slots} memory slots (add memory or CPU modules).`,
          });
        }
        if (!ctx.hasCpu()) {
          out.push({ from: 0, to: 0, severity: 'warning', message: 'This class has no CPU: the program will never run.' });
        }
      } catch (err) {
        if (!(err instanceof CompileError)) throw err;
        // Underline the word the compiler stopped at.
        const line = view.state.doc.line(Math.min(err.line, view.state.doc.lines));
        const from = Math.min(line.to, line.from + err.col - 1);
        const word = /^\w+/.exec(line.text.slice(from - line.from))?.[0].length ?? 1;
        out.push({ from, to: Math.min(line.to, from + word), severity: 'error', message: err.reason });
      }
      return out;
    },
    { delay: 250 },
  );
}

export interface ScriptEditor {
  readonly view: EditorView;
  value: string;
  /** Re-run diagnostics (e.g. after the class's memory changed). */
  relint(): void;
}

export function createScriptEditor(parent: HTMLElement, ctx: EditorContext, onChange: () => void): ScriptEditor {
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: '',
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        history(),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        autocompletion({ override: [completions] }),
        highlightActiveLine(),
        StreamLanguage.define(unitScript),
        syntaxHighlighting(highlight),
        scriptLinter(ctx),
        lintGutter(),
        hoverDocs,
        EditorState.tabSize.of(2),
        keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...completionKeymap, indentWithTab]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChange();
        }),
        theme,
      ],
    }),
  });
  return {
    view,
    get value() {
      return view.state.doc.toString();
    },
    set value(text: string) {
      if (text === view.state.doc.toString()) return;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
    },
    relint() {
      forceLinting(view);
    },
  };
}
