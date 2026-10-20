import { FLOW_HOST, parseText, type FlowDoc } from '@wst/engine';
import { buildGraph, type GNode, type NodeKind, type Port } from './flow/graphModel';
import { emptyScratch } from './flow/graphOps';
import { estimateHeight, layout, NODE_WIDTH } from './flow/layout';

/*
 * Draws a program the way the graph editor shows it, as static HTML for the manual. It uses the
 * editor's own graph model and layout (so what the manual shows is what the editor builds from
 * the same text) and a fixed row height so the wires meet the pins.
 */

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const ICON: Record<NodeKind, string> = { event: '◆', action: '⚡', query: '?', config: '⚙', logic: 'ƒ', variable: '𝑥', flow: '⑂', note: '✎', block: '▣' };

/** Vertical layout inside a node, in px; the same numbers `estimateHeight` assumes. */
const HEADER = 38;
const SETTING = 28;
const ROW = 26;
const BLOCK_W = 250;
const MARGIN = 14;

const widthOf = (n: GNode) => (n.kind === 'block' ? BLOCK_W : NODE_WIDTH);

export interface GraphRender {
  readonly html: string;
  /** Problems in the text (empty when it parses and checks); the manual's test asserts this is empty. */
  readonly errors: readonly string[];
}

/** The graph of a program given as text, as HTML. */
export function graphOf(text: string, caption?: string): GraphRender {
  const parsed = parseText(text, FLOW_HOST);
  const errors = parsed.errors.map((e) => e.message);
  return { html: renderDoc(parsed.doc, caption), errors };
}

export function renderDoc(doc: FlowDoc, caption?: string): string {
  const model = buildGraph({ doc, scratch: emptyScratch }, FLOW_HOST);
  const pos = layout(model);
  const at = new Map<string, { x: number; y: number; n: GNode; w: number; h: number }>();
  let minX = 0;
  let minY = 0;
  for (const n of model.nodes) {
    const p = pos[n.id] ?? [0, 0];
    minX = Math.min(minX, p[0]);
    minY = Math.min(minY, p[1]);
  }
  let maxX = 0;
  let maxY = 0;
  for (const n of model.nodes) {
    const p = pos[n.id] ?? [0, 0];
    const w = widthOf(n);
    const h = estimateHeight(n);
    const x = p[0] - minX + MARGIN;
    const y = p[1] - minY + MARGIN;
    at.set(n.id, { x, y, n, w, h });
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  }

  const pinY = (n: GNode, side: 'in' | 'out', key: string, y: number): number => {
    const controlsAbove = n.controls.filter((c) => !n.inputs.some((i) => i.key === c.key)).length;
    const list: readonly Port[] = side === 'in' ? n.inputs : n.outputs;
    const i = Math.max(0, list.findIndex((p) => p.key === key));
    return y + HEADER + controlsAbove * SETTING + (n.controls.some((c) => c.type === 'multiline') ? 42 : 0) + i * ROW + ROW / 2;
  };

  const wires = model.edges
    .map((e) => {
      const a = at.get(e.from.node);
      const b = at.get(e.to.node);
      if (!a || !b) return '';
      const x1 = a.x + a.w;
      const y1 = pinY(a.n, 'out', e.from.key, a.y);
      const x2 = b.x;
      const y2 = pinY(b.n, 'in', e.to.key, b.y);
      const dx = Math.max(40, Math.abs(x2 - x1) / 2);
      return `<path class="${e.type}" d="M${x1} ${y1} C${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}"/>`;
    })
    .join('');

  const nodes = [...at.values()].map(({ x, y, n, w, h }) => nodeHtml(n, x, y, w, h)).join('');
  return `<figure class="graph"><div class="graph-scroll"><div class="graph-canvas" style="width:${Math.ceil(maxX + MARGIN)}px;height:${Math.ceil(maxY + MARGIN)}px">
    <svg width="${Math.ceil(maxX + MARGIN)}" height="${Math.ceil(maxY + MARGIN)}">${wires}</svg>${nodes}</div></div>${caption ? `<figcaption>${caption}</figcaption>` : ''}</figure>`;
}

function pin(p: Port): string {
  return `<span class="pin ${p.type}"></span>`;
}

function nodeHtml(n: GNode, x: number, y: number, w: number, h: number): string {
  const pinned = new Set(n.inputs.map((i) => i.key));
  const settings = n.controls.filter((c) => !pinned.has(c.key));
  const head = `<header style="height:${HEADER}px"><span class="icon">${ICON[n.kind]}</span><span class="title">${esc(n.title)}${n.subtitle ? ` <span class="sub">${esc(n.subtitle)}</span>` : ''}</span>${n.cost > 0 ? `<span class="cost">${n.cost}c</span>` : ''}</header>`;
  const sets = settings
    .map((c) => {
      const value = c.type === 'multiline' ? `<span class="field note-text">${esc(c.value)}</span>` : `<span class="field">${esc(c.value) || '&nbsp;'}</span>`;
      return `<div class="setting" style="height:${c.type === 'multiline' ? 70 : SETTING}px">${c.label ? `<label>${esc(c.label)}</label>` : ''}${value}</div>`;
    })
    .join('');
  const rows = Math.max(n.inputs.length, n.outputs.length);
  let body = '';
  for (let i = 0; i < rows; i++) {
    const inp = n.inputs[i];
    const out = n.outputs[i];
    const control = inp ? n.controls.find((c) => c.key === inp.key) : undefined;
    body += `<div class="row" style="height:${ROW}px"><span class="in">${inp ? `${pin(inp)}${inp.label ? `<span class="lab">${esc(inp.label)}</span>` : ''}${control ? `<span class="field small">${esc(control.value)}</span>` : ''}` : ''}</span><span class="out">${out ? `${out.label ? `<span class="lab">${esc(out.label)}</span>` : ''}${pin(out)}` : ''}</span></div>`;
  }
  const emits = n.emits?.length ? `<div class="emits">raises ${n.emits.map((e) => `<b>${esc(e)}</b>`).join(', ')}</div>` : '';
  const actions = n.actions?.length ? `<div class="actions">${n.actions.map((a) => `<span class="button">${esc(a.label)}</span>`).join('')}</div>` : '';
  return `<div class="gnode ${n.kind}" style="left:${x}px;top:${y}px;width:${w}px;min-height:${h}px">${head}${sets}${body}${emits}${actions}</div>`;
}
