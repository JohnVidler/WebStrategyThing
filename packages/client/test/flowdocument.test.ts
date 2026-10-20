import { describe, expect, it } from 'vitest';
import { FLOW_HOST, parseDoc, serialize } from '@wst/engine';
import { FlowDocument, sourceToText } from '../src/flow/FlowDocument';

const PROGRAM = 'let n = 0;\n\non(Idle, () => {\n  n = n + 1;\n  fire(0);\n});\n';

const make = (text = PROGRAM) => {
  const d = new FlowDocument(FLOW_HOST);
  d.loadText(text);
  return d;
};

describe('FlowDocument: one program behind the graph and the text', () => {
  it('follows valid text edits into the IR, and keeps the last good IR while the text is broken', () => {
    const d = make();
    expect(d.valid).toBe(true);
    const good = serialize(d.doc);
    d.setText('let n = 0;\non(Idle, () => {\n  n = n + 1;\n  fire(0\n});\n');
    expect(d.valid).toBe(false);
    expect(serialize(d.doc)).toBe(good); // the graph keeps showing the last good program
    expect(d.errors[0].message).toBe('Syntax error');
    expect(() => d.source()).toThrow();
    d.setText('let n = 0;\non(Idle, () => {\n  n = n + 2;\n});\n');
    expect(d.valid).toBe(true);
    expect(serialize(d.doc)).not.toBe(good);
  });

  it('reprints the text after a graph edit and tells subscribers who made each change', () => {
    const d = make();
    const seen: { origin: unknown; docChanged: boolean }[] = [];
    d.subscribe((c) => seen.push(c));
    const next = { ...d.doc, handlers: d.doc.handlers.map((h) => ({ ...h, body: h.body.slice(0, 1) })) };
    d.apply(next, d.views, 'graph');
    expect(d.text).toBe('let n = 0;\n\non(Idle, () => {\n  n = n + 1;\n});\n');
    expect(seen.at(-1)).toEqual({ origin: 'graph', docChanged: true });
    d.setText(d.text + '\n// trailing comment is a formatting change only\n', 'text');
    expect(seen.at(-1)?.origin).toBe('text');
  });

  it('undoes and redoes graph edits (a quick follow-up edit joins the same step), but not text typing or layout', () => {
    const d = make();
    const original = d.text;
    const cut = (n: number) => ({ ...d.doc, handlers: d.doc.handlers.map((h) => ({ ...h, body: h.body.slice(0, n) })) });
    d.apply(cut(1), d.views, 'graph');
    d.apply(cut(0), d.views, 'graph', true); // folded into the previous step
    expect(d.canUndo).toBe(true);
    d.setViews({ graph: { pos: { n2: [1, 2] } } });
    expect(d.undo()).toBe(true);
    expect(d.text).toBe(original);
    expect(d.canUndo).toBe(false);
    expect(d.canRedo).toBe(true);
    expect(d.redo()).toBe(true);
    expect(d.doc.handlers[0].body).toHaveLength(0);
    expect(d.undo()).toBe(true);
    d.apply(cut(1), d.views, 'graph');
    expect(d.canRedo).toBe(false); // a new edit ends the redo branch
  });

  it('never gives a statement parsed from text an id the editor already uses for a loose piece', () => {
    const d = make();
    const loose = { graph: { scratch: { chains: [[{ id: 'n7', k: 'call', fn: 'stop', args: [] }]], exprs: [] } } };
    d.setViews(loose as never);
    d.setText(d.text + '\non(Every, { ticks: 9 }, () => {\n  stop();\n});\n');
    const taken = new Set(['n7']);
    const all: string[] = [];
    for (const h of d.doc.handlers) (all.push(h.id), h.body.forEach((s) => all.push(s.id)));
    expect(all.some((id) => taken.has(id))).toBe(false);
    expect(new Set(all).size).toBe(all.length);
  });

  it('keeps statement ids (and so graph layout) when text edits leave statements in place', () => {
    const d = make();
    const before = d.doc.handlers[0].body.map((s) => s.id);
    d.setText('let n = 0;\non(Idle, () => {\n  n = n + 5;\n  fire(1);\n  fire(2);\n});\n');
    const after = d.doc.handlers[0].body.map((s) => s.id);
    expect(after.slice(0, 2)).toEqual(before);
    expect(after[2]).not.toBe(after[1]);
  });

  it('stores the program as JSON, with editor-only views when there are any, and reads it back', () => {
    const d = make();
    expect(parseDoc(d.source()).views).toBeUndefined();
    const id = d.doc.handlers[0].body[0].id;
    d.setViews({ graph: { pos: { [id]: [10, 20] } } });
    const stored = d.source();
    expect(parseDoc(stored).views?.graph?.pos?.[id]).toEqual([10, 20]);
    expect(d.logic()).not.toContain('"views"');
    const again = new FlowDocument(FLOW_HOST);
    again.loadSource(stored);
    expect(again.text).toBe(d.text);
    expect(again.views.graph?.pos?.[id]).toEqual([10, 20]);
    expect(sourceToText(stored, FLOW_HOST)).toBe(d.text);
  });

  it('treats an empty source as an empty program and a foreign one as unreadable', () => {
    const d = new FlowDocument(FLOW_HOST);
    d.loadSource('');
    expect(d.isEmpty).toBe(true);
    expect(d.valid).toBe(true);
    d.loadSource('var n = 0\nn = 1');
    expect(d.valid).toBe(false);
    expect(d.errors[0].message).toMatch(/not in the event-block format/);
  });

  it('counts the memory of the text it holds, even while the text is invalid', () => {
    const d = make('let a = 0;\nlet b = 0;\non(Idle, () => {\n  fire(7);\n});\n');
    expect(d.memory).toEqual({ vars: 2, literals: 1, locals: 0, total: 3 });
  });
});
