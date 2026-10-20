import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  snippetCompletion,
  type Completion,
  type CompletionContext,
} from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { bracketMatching, HighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language';
import { forceLinting, linter, lintGutter, type Diagnostic } from '@codemirror/lint';
import { Annotation, EditorState } from '@codemirror/state';
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  hoverTooltip,
  keymap,
  lineNumbers,
} from '@codemirror/view';
import {
  compileDoc,
  BLOCKS,
  EVENT_BY_NAME,
  EVENTS,
  FLOW_HOST,
  resolveSweep,
  SCRIPT_CONSTANT_DOCS,
  UNIT_API,
  type BlueprintStats,
  type EventDef,
} from '@wst/engine';
import { tags as t } from '@lezer/highlight';
import type { FlowDocument } from './flow/FlowDocument';

const BUILTINS = new Map(UNIT_API.map((b) => [b.name, b]));
const CONSTANT_DOCS = new Map(SCRIPT_CONSTANT_DOCS.map(([name, value, doc]) => [name, { value, doc }]));

const highlight = HighlightStyle.define([
  { tag: t.keyword, color: '#c792ea' },
  { tag: t.controlKeyword, color: '#c792ea' },
  { tag: t.definitionKeyword, color: '#c792ea' },
  { tag: t.bool, color: '#f78c6c' },
  { tag: t.number, color: '#f78c6c' },
  { tag: t.string, color: '#c3e88d' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: '#6a7686', fontStyle: 'italic' },
  { tag: t.function(t.variableName), color: '#82aaff' },
  { tag: t.function(t.propertyName), color: '#82aaff' },
  { tag: t.definition(t.variableName), color: '#c3e88d' },
  { tag: t.propertyName, color: '#ffcb6b' },
  { tag: t.variableName, color: '#d6dde6' },
  { tag: [t.operator, t.compareOperator, t.logicOperator, t.arithmeticOperator], color: '#89ddff' },
  { tag: [t.bracket, t.paren, t.brace, t.squareBracket, t.punctuation], color: '#8b95a3' },
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
    '.cm-doc': { padding: '6px 8px', maxWidth: '380px', fontFamily: 'system-ui, sans-serif', fontSize: '12px' },
    '.cm-doc code': { color: '#82aaff' },
  },
  { dark: true },
);

const escapeHtml = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

function docNode(html: string): HTMLElement {
  const div = document.createElement('div');
  div.className = 'cm-doc';
  div.innerHTML = html;
  return div;
}

const KIND_LABEL = { query: 'query', action: 'action', config: 'runtime setting' } as const;

/** Written form of a call: runtime settings live in the `config` namespace. */
const callName = (b: { name: string; kind: string }) => (b.kind === 'config' ? `config.${b.name}` : b.name);

function builtinDoc(name: string): string {
  const b = BUILTINS.get(name)!;
  const sig = `${callName(b)}(${(b.args ?? []).join(', ')})`;
  return `<code>${sig}</code> · ${KIND_LABEL[b.kind]}${b.cost ? ` · +${b.cost} cycles` : ''}<br>${escapeHtml(b.doc ?? '')}`;
}

function eventDoc(def: EventDef): string {
  const params = def.params.length ? `(${def.params.join(', ')})` : '';
  const config = def.config.map((f) => `<li><code>${f.name}</code>: ${escapeHtml(f.doc)}</li>`).join('');
  return `<code>on(${def.name}${params})</code> · event${def.multi ? ' · several blocks allowed' : ''}<br>${escapeHtml(def.doc)}${config ? `<ul>${config}</ul>` : ''}`;
}

// --- completion --------------------------------------------------------------------------

/** What the cursor is in, found from the text before it. Exported for tests. */
export type Place =
  | { kind: 'config'; event: EventDef }
  | { kind: 'event' }
  | { kind: 'code' };

export function placeAt(before: string): Place {
  // Inside the settings object of an on(Event, { ... block.
  const cfg = /\bon\(\s*([A-Za-z]+)\s*,\s*\{[^{}()]*$/.exec(before);
  if (cfg) {
    const event = EVENT_BY_NAME.get(cfg[1]);
    if (event) return { kind: 'config', event };
  }
  if (/\bon\(\s*[A-Za-z]*$/.test(before)) return { kind: 'event' };
  return { kind: 'code' };
}

const KEYWORD_SNIPPETS: Completion[] = [
  snippetCompletion('if (${cond}) {\n  ${}\n}', { label: 'if', type: 'keyword', detail: 'if (…) { }' }),
  snippetCompletion('if (${cond}) {\n  ${}\n} else {\n  ${}\n}', { label: 'ifelse', type: 'keyword', detail: 'if … else' }),
  snippetCompletion('while (${cond}) {\n  ${}\n}', { label: 'while', type: 'keyword', detail: 'while (…) { }' }),
  snippetCompletion('const ${name} = ${call}();', { label: 'const', type: 'keyword', detail: 'bind a call result' }),
  snippetCompletion('let ${name} = ${0};', { label: 'let', type: 'keyword', detail: 'program variable' }),
];

function blockSnippet(def: EventDef): Completion {
  const params = def.params.join(', ');
  return snippetCompletion(`on(${def.name}, (${params}) => {\n  \${}\n});`, {
    label: `on(${def.name}`,
    type: 'keyword',
    detail: def.params.length ? `(${params})` : 'event block',
    info: () => docNode(eventDoc(def)),
  });
}

/** Builtins, constants, events, snippets and the program's own variables. */
function completions(context: CompletionContext) {
  const word = context.matchBefore(/[A-Za-z_][A-Za-z0-9_.]*/);
  if (!word || (word.from === word.to && !context.explicit)) return null;
  const place = placeAt(context.state.sliceDoc(0, context.pos));

  if (place.kind === 'config') {
    const options: Completion[] = [
      ...place.event.config.map((f) => ({
        label: f.name,
        type: 'property',
        detail: f.type === 'ints' ? 'list' : f.type,
        info: f.doc,
        apply: `${f.name}: `,
      })),
      ...SCRIPT_CONSTANT_DOCS.map(([name, value, doc]) => ({ label: name, type: 'constant', detail: String(value), info: doc })),
    ];
    return { from: word.from, options, validFor: /^[A-Za-z0-9_]*$/ };
  }
  if (place.kind === 'event') {
    return {
      from: word.from,
      options: EVENTS.map((e) => ({ label: e.name, type: 'keyword', detail: e.params.length ? `(${e.params.join(', ')})` : '', info: () => docNode(eventDoc(e)) })),
      validFor: /^[A-Za-z0-9_]*$/,
    };
  }

  const text = context.state.doc.toString();
  const vars = new Set<string>();
  for (const m of text.matchAll(/\blet\s+([A-Za-z_][A-Za-z0-9_]*)/g)) vars.add(m[1]);
  const locals = new Set<string>();
  for (const m of text.matchAll(/\bconst\s+([A-Za-z_][A-Za-z0-9_]*)/g)) locals.add(m[1]);
  for (const m of text.matchAll(/=>|\(([^()]*)\)\s*=>/g)) for (const p of (m[1] ?? '').split(',')) if (p.trim()) locals.add(p.trim());

  const onConfig = word.text.startsWith('config.');
  const options: Completion[] = [
    ...UNIT_API.filter((b) => (onConfig ? b.kind === 'config' : true)).map((b) => ({
      label: callName(b),
      type: b.kind === 'query' ? 'function' : b.kind === 'action' ? 'method' : 'property',
      detail: `(${(b.args ?? []).join(', ')}) ${KIND_LABEL[b.kind]}`,
      info: () => docNode(builtinDoc(b.name)),
      apply: `${callName(b)}(`,
      boost: b.kind === 'config' ? -1 : 0,
    })),
    ...SCRIPT_CONSTANT_DOCS.map(([name, value, doc]) => ({ label: name, type: 'constant', detail: String(value), info: doc })),
    ...EVENTS.map(blockSnippet),
    ...BLOCKS.map((b) => snippetCompletion(`use(${b.name}${b.settings.length ? ', { ${} }' : ''});`, { label: `use ${b.name}`, type: 'class', detail: `block · ${b.group}`, info: b.doc })),
    ...KEYWORD_SNIPPETS,
    ...[...vars].map((v) => ({ label: v, type: 'variable', detail: 'variable' })),
    ...[...locals].map((v) => ({ label: v, type: 'variable', detail: 'event parameter or result' })),
  ];
  return { from: word.from, options, validFor: /^[A-Za-z0-9_.]*$/ };
}

/** Docs on hover for built-in calls, constants and event names. */
const hoverDocs = hoverTooltip((view, pos) => {
  const line = view.state.doc.lineAt(pos);
  const text = line.text;
  let start = pos - line.from;
  let end = start;
  while (start > 0 && /\w/.test(text[start - 1])) start--;
  while (end < text.length && /\w/.test(text[end])) end++;
  const word = text.slice(start, end);
  let html: string | undefined;
  const event = EVENT_BY_NAME.get(word);
  if (event && /\bon\(\s*$/.test(text.slice(0, start))) html = eventDoc(event);
  else if (BUILTINS.has(word)) html = builtinDoc(word);
  else if (CONSTANT_DOCS.has(word)) html = `<code>${word} = ${CONSTANT_DOCS.get(word)!.value}</code><br>${escapeHtml(CONSTANT_DOCS.get(word)!.doc)}`;
  if (!html) return null;
  const content = html;
  return { pos: line.from + start, end: line.from + end, above: true, create: () => ({ dom: docNode(content) }) };
});

// --- diagnostics -------------------------------------------------------------------------

export interface EditorContext {
  /** Stats of the class being edited (undefined: invalid design). */
  stats(): BlueprintStats | undefined;
}

export interface Problem {
  readonly from: number;
  readonly to: number;
  readonly severity: 'error' | 'warning';
  readonly message: string;
}

/**
 * Everything wrong with the program in `doc`: parse and check errors (with their places), then,
 * for a valid program, what the class's hardware cannot hold or do. Exported for tests.
 */
export function problemsOf(doc: FlowDocument, stats: BlueprintStats | undefined): Problem[] {
  const text = doc.text;
  const out: Problem[] = [];
  const firstLineEnd = text.indexOf('\n') >= 0 ? text.indexOf('\n') : text.length;
  for (const e of doc.errors) {
    const from = Math.min(text.length, e.from ?? 0);
    out.push({ from, to: Math.min(text.length, e.to ?? (e.from === undefined ? firstLineEnd : from)), severity: 'error', message: e.message });
  }
  if (!doc.valid || doc.isEmpty || !stats) return out;
  if (stats.cyclesPerTick === 0) {
    out.push({ from: 0, to: 0, severity: 'warning', message: 'This class has no CPU: the program will never run.' });
  }
  if (doc.memory.total > stats.memorySlots) {
    out.push({
      from: 0,
      to: firstLineEnd,
      severity: 'error',
      message: `Needs ${doc.memory.total} memory slots (${doc.memory.vars} variables, ${doc.memory.literals} numbers, ${doc.memory.locals} locals) but this class only has ${stats.memorySlots}: add memory or a bigger CPU.`,
    });
  }
  // What the installed sensor cannot do is clamped when the program runs; say so where it is written.
  try {
    const program = compileDoc(doc.doc, FLOW_HOST, '');
    const at = [...text.matchAll(/\bon\(\s*Detected\b/g)].map((m) => m.index ?? 0);
    program.byEvent[EVENT_BY_NAME.get('Detected')!.id]?.forEach((h, i) => {
      for (const note of resolveSweep(program.handlers[h], stats).notes) {
        const from = at[i] ?? 0;
        out.push({ from, to: text.indexOf('\n', from) >= 0 ? text.indexOf('\n', from) : text.length, severity: 'warning', message: note });
      }
    });
  } catch {
    // too long or otherwise not compilable: the errors above say why
  }
  return out;
}

function programLinter(doc: FlowDocument, ctx: EditorContext) {
  return linter(
    (view): Diagnostic[] => {
      const length = view.state.doc.length;
      return problemsOf(doc, ctx.stats()).map((p) => ({ from: Math.min(p.from, length), to: Math.min(Math.max(p.to, p.from), length), severity: p.severity, message: p.message }));
    },
    { delay: 250 },
  );
}

// --- the editor --------------------------------------------------------------------------

export interface TextView {
  readonly view: EditorView;
  /** Re-run diagnostics (e.g. after the class's memory changed). */
  relint(): void;
}

/** Marks changes the view made to itself while following the document, so they are not echoed back. */
const FROM_DOCUMENT = Annotation.define<boolean>();

/** The Text view: a TypeScript-flavoured editor over the shared program model. */
export function createTextView(parent: HTMLElement, doc: FlowDocument, ctx: EditorContext): TextView {
  const view: EditorView = new EditorView({
    parent,
    state: EditorState.create({
      doc: doc.text,
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
        javascript({ typescript: true }),
        syntaxHighlighting(highlight),
        programLinter(doc, ctx),
        lintGutter(),
        hoverDocs,
        EditorState.tabSize.of(2),
        keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...completionKeymap, indentWithTab]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged && !u.transactions.some((tr) => tr.annotation(FROM_DOCUMENT))) doc.setText(u.state.doc.toString(), view);
        }),
        theme,
      ],
    }),
  });
  // Follow edits made elsewhere (the graph, a class switch, a loaded version).
  doc.subscribe((change) => {
    if (change.origin === view) {
      forceLinting(view);
      return;
    }
    if (doc.text !== view.state.doc.toString()) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: doc.text }, annotations: FROM_DOCUMENT.of(true) });
    }
    forceLinting(view);
  });
  return {
    view,
    relint() {
      forceLinting(view);
    },
  };
}
