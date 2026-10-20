import { css, html, LitElement, nothing, type TemplateResult } from 'lit';
import type { Control, GNode, NodeKind, Port } from './graphModel';

/*
 * The visual parts of the graph editor, as custom elements so they can be reused and restyled
 * without touching the editor: <wst-flow-node>, <wst-flow-socket>, <wst-flow-wire> and
 * <wst-flow-palette>. Colours are CSS custom properties; every kind of node has its own header
 * colour and icon so "do something now", "read something", "change how a module behaves" and
 * "an event arrives" are never mistaken for each other.
 */

/** What a node's controls call back into (the graph view wires this up). */
export interface NodeCallbacks {
  /** A control was committed (typed value or chosen option). */
  control(nodeId: string, key: string, value: string): void;
  /** A button on a card was pressed (a block's Expand). */
  action(nodeId: string, key: string): void;
}

type Emit = (props: unknown) => void;

const KIND_ICON: Record<NodeKind, string> = {
  event: '◆',
  action: '⚡',
  query: '?',
  config: '⚙',
  logic: 'ƒ',
  variable: '𝑥',
  flow: '⑂',
  note: '✎',
  block: '▣',
};

export const KIND_NAME: Record<NodeKind, string> = {
  event: 'Event',
  action: 'Action',
  query: 'Query',
  config: 'Runtime setting',
  logic: 'Logic',
  variable: 'Variable',
  flow: 'Flow',
  note: 'Note',
  block: 'Block',
};

/** A pin: a triangle for execution, a circle for data. */
export class WstFlowSocket extends LitElement {
  static properties = { kind: { type: String, reflect: true } };
  declare kind: 'exec' | 'data';
  static styles = css`
    :host { display: inline-block; padding: 6px; cursor: crosshair; }
    .pin { width: 14px; height: 14px; box-sizing: border-box; background: var(--wst-data, #6aa7ff); border: 2px solid var(--wst-pin-edge, #0c0e12); border-radius: 50%; }
    :host([kind='exec']) .pin { background: var(--wst-exec, #f2f2f2); clip-path: polygon(0 0, 100% 50%, 0 100%); border: 0; border-radius: 0; }
    :host(:hover) .pin { filter: brightness(1.4); transform: scale(1.15); }
  `;
  render() {
    return html`<div class="pin"></div>`;
  }
}

/** A wire: execution wires are white and thick, data wires blue. Double-click cuts it. */
export class WstFlowWire extends LitElement {
  static properties = { path: { attribute: false }, type: { type: String, reflect: true }, wire: { attribute: false } };
  declare path: string;
  declare type: 'exec' | 'data';
  /** Id of the connection, reported when the wire is cut. */
  declare wire: string;
  static styles = css`
    svg { overflow: visible !important; position: absolute; pointer-events: none; width: 9999px; height: 9999px; }
    path { fill: none; stroke: var(--wst-data, #4f87c7); stroke-width: 3px; pointer-events: auto; cursor: pointer; }
    :host([type='exec']) path { stroke: var(--wst-exec, #f2f2f2); stroke-width: 4px; }
    path:hover { stroke-width: 6px; filter: brightness(1.3); }
  `;
  render() {
    return html`<svg><path d=${this.path} @dblclick=${() => this.dispatchEvent(new CustomEvent('wire-cut', { detail: this.wire, bubbles: true, composed: true }))}><title>Double-click to cut this wire</title></path></svg>`;
  }
}

/** A node: header by kind, then settings, then one row per pin. */
export class WstFlowNode extends LitElement {
  static properties = {
    data: { attribute: false },
    emit: { attribute: false },
    model: { attribute: false },
    callbacks: { attribute: false },
    kind: { type: String, reflect: true },
  };
  declare data: { id: string; selected?: boolean; inputs: Record<string, unknown>; outputs: Record<string, unknown> };
  declare emit: Emit;
  declare model: GNode;
  declare callbacks: NodeCallbacks;
  declare kind: NodeKind;

  static styles = css`
    :host {
      display: block; width: 230px; background: var(--wst-node, #1d222c); border: 2px solid var(--wst-node-edge, #343c4b); border-radius: 8px;
      color: var(--wst-text, #dde3ee); font: 12px/1.35 system-ui, sans-serif; user-select: none; box-shadow: 0 4px 14px #0008;
    }
    :host([selected]) { border-color: var(--wst-selected, #ffd92c); }
    :host([loose]) { border-style: dashed; opacity: 0.92; }
    :host([problem]) { border-color: var(--wst-bad, #ff6b5e); }
    header { display: flex; align-items: center; gap: 6px; padding: 5px 9px; border-radius: 5px 5px 0 0; font-weight: 600; background: var(--head, #555); }
    :host([kind='event']) header { --head: var(--wst-event, #8c2f39); }
    :host([kind='action']) header { --head: var(--wst-action, #a65a1e); }
    :host([kind='query']) header { --head: var(--wst-query, #2c5d92); }
    :host([kind='config']) header { --head: var(--wst-config, #1f6f6b); }
    :host([kind='logic']) header { --head: var(--wst-logic, #3a4150); }
    :host([kind='variable']) header { --head: var(--wst-variable, #3b6a3a); }
    :host([kind='flow']) header { --head: var(--wst-flow, #4f3d7a); }
    :host([kind='note']) header { --head: var(--wst-note, #6a5d2a); }
    :host([kind='block']) { width: 250px; border-color: var(--wst-block-edge, #5b6fb0); }
    :host([kind='block']) header { --head: var(--wst-block, #34499a); font-size: 13px; padding: 7px 9px; }
    .emits { padding: 2px 9px 4px; color: var(--wst-muted, #8f9bb0); font-size: 11px; }
    .emits b { color: var(--wst-text, #dde3ee); font-weight: 600; }
    .actions { padding: 4px 9px 8px; display: flex; gap: 6px; }
    .actions button { font: inherit; color: inherit; background: var(--wst-field, #12161d); border: 1px solid var(--wst-node-edge, #343c4b); border-radius: 4px; padding: 2px 8px; cursor: pointer; }
    .actions button:hover { border-color: var(--wst-selected, #ffd92c); }
    .icon { opacity: 0.85; width: 14px; text-align: center; }
    .title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sub { font-weight: 400; opacity: 0.7; font-size: 10px; }
    .cost { font-weight: 400; font-size: 10px; padding: 0 5px; border-radius: 8px; background: #0006; }
    .settings { padding: 4px 9px 2px; display: grid; grid-template-columns: auto 1fr; gap: 3px 8px; align-items: center; }
    .settings label { color: var(--wst-muted, #8f9bb0); }
    .row { display: flex; align-items: center; justify-content: space-between; min-height: 26px; }
    .in, .out { display: flex; align-items: center; gap: 4px; min-width: 0; }
    .in { margin-left: -9px; } .out { margin-right: -9px; }
    .pin-label { color: var(--wst-muted, #aab4c6); }
    .pin-label.out-label { text-align: right; }
    input, select, textarea {
      font: inherit; color: inherit; background: var(--wst-field, #12161d); border: 1px solid var(--wst-node-edge, #343c4b); border-radius: 4px;
      padding: 1px 5px; min-width: 0; width: 100%; box-sizing: border-box; user-select: text;
    }
    .in input { width: 84px; }
    input:focus, select:focus, textarea:focus { outline: 1px solid var(--wst-selected, #ffd92c); }
    textarea { height: 46px; resize: vertical; }
    .problem { padding: 3px 9px 6px; color: var(--wst-bad, #ff8a7a); font-size: 11px; white-space: normal; }
    .loose-tag { font-weight: 400; font-size: 9px; opacity: 0.75; }
  `;

  render() {
    const m = this.model;
    if (!m) return nothing;
    this.kind = m.kind;
    this.toggleAttribute('selected', !!this.data?.selected);
    this.toggleAttribute('loose', m.loose);
    this.toggleAttribute('problem', !!m.problem);
    this.title = m.doc ?? '';
    const pinControls = new Set(m.inputs.map((i) => i.key));
    const settings = m.controls.filter((c) => !pinControls.has(c.key));
    const rows = Math.max(m.inputs.length, m.outputs.length);
    const rowsHtml: TemplateResult[] = [];
    for (let i = 0; i < rows; i++) rowsHtml.push(this.row(m.inputs[i], m.outputs[i]));
    return html`
      <header>
        <span class="icon" title=${KIND_NAME[m.kind]}>${KIND_ICON[m.kind]}</span>
        <span class="title">${m.title}${m.subtitle ? html` <span class="sub">${m.subtitle}</span>` : nothing}</span>
        ${m.loose ? html`<span class="loose-tag" title="Not connected to any event block">loose</span>` : nothing}
        ${m.cost > 0 ? html`<span class="cost" title="Cycles this node costs each time it runs">${m.cost}c</span>` : nothing}
      </header>
      ${settings.length ? html`<div class="settings">${settings.map((c) => this.setting(c))}</div>` : nothing}
      ${rowsHtml}
      ${m.emits?.length ? html`<div class="emits" title="Events this block raises: add an event block with the same name to react to them">raises ${m.emits.map((e, i) => html`${i ? ', ' : ''}<b>${e}</b>`)}</div>` : nothing}
      ${m.actions?.length ? html`<div class="actions">${m.actions.map((a) => html`<button title=${a.title} @pointerdown=${stop} @dblclick=${stop} @click=${() => this.callbacks?.action(this.data.id, a.key)}>${a.label}</button>`)}</div>` : nothing}
      ${m.problem ? html`<div class="problem">${m.problem}</div>` : nothing}`;
  }

  private row(input: Port | undefined, output: Port | undefined): TemplateResult {
    const control = input ? this.model.controls.find((c) => c.key === input.key) : undefined;
    return html`<div class="row">
      <div class="in">${input
        ? html`<rete-ref .data=${{ type: 'socket', side: 'input', key: input.key, nodeId: this.data.id, payload: this.data.inputs[input.key] && (this.data.inputs[input.key] as { socket: unknown }).socket }} .emit=${this.emit}></rete-ref>
            ${input.label ? html`<span class="pin-label">${input.label}</span>` : nothing}${control ? this.field(control) : nothing}`
        : nothing}</div>
      <div class="out">${output
        ? html`${output.label ? html`<span class="pin-label out-label">${output.label}</span>` : nothing}
            <rete-ref .data=${{ type: 'socket', side: 'output', key: output.key, nodeId: this.data.id, payload: this.data.outputs[output.key] && (this.data.outputs[output.key] as { socket: unknown }).socket }} .emit=${this.emit}></rete-ref>`
        : nothing}</div>
    </div>`;
  }

  /** A typed-in default sitting beside an input pin. */
  private field(c: Control): TemplateResult {
    return html`<input .value=${c.value} title=${c.hint ?? 'A whole number, or a constant such as MOVE'} spellcheck="false"
      @pointerdown=${stop} @dblclick=${stop} @keydown=${this.keys} @change=${(e: Event) => this.commit(c.key, (e.target as HTMLInputElement).value)}>`;
  }

  private setting(c: Control): TemplateResult {
    let input: TemplateResult;
    if (c.type === 'select') {
      input = html`<select @pointerdown=${stop} @dblclick=${stop} @change=${(e: Event) => this.commit(c.key, (e.target as HTMLSelectElement).value)}>
        ${(c.options ?? []).map((o) => html`<option value=${o} ?selected=${o === c.value}>${o}</option>`)}</select>`;
    } else if (c.type === 'multiline') {
      input = html`<textarea .value=${c.value} @pointerdown=${stop} @dblclick=${stop} @keydown=${this.keys} @change=${(e: Event) => this.commit(c.key, (e.target as HTMLTextAreaElement).value)}></textarea>`;
    } else {
      input = html`<input .value=${c.value} title=${c.hint ?? ''} spellcheck="false" @pointerdown=${stop} @dblclick=${stop} @keydown=${this.keys}
        @change=${(e: Event) => this.commit(c.key, (e.target as HTMLInputElement).value)}>`;
    }
    return c.label ? html`<label title=${c.hint ?? ''}>${c.label}</label>${input}` : html`<div style="grid-column: 1 / -1">${input}</div>`;
  }

  /** Typing in a field must not delete or move the node. */
  private keys = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'TEXTAREA') (e.target as HTMLElement).blur();
  };

  private commit(key: string, value: string): void {
    this.callbacks?.control(this.data.id, key, value);
  }
}

const stop = (e: Event) => e.stopPropagation();

// --- palette -------------------------------------------------------------------------------------------

export interface PaletteItem {
  readonly id: string;
  readonly label: string;
  readonly group: string;
  readonly kind: NodeKind;
  readonly doc: string;
  readonly disabled?: string;
}

/** The "add a node" list, grouped and searchable. Fires `add` with the item's id. */
export class WstFlowPalette extends LitElement {
  static properties = { items: { attribute: false }, filter: { state: true } };
  declare items: readonly PaletteItem[];
  declare filter: string;

  constructor() {
    super();
    this.items = [];
    this.filter = '';
  }

  static styles = css`
    :host { display: flex; flex-direction: column; min-height: 0; font: 12px system-ui, sans-serif; color: var(--wst-text, #dde3ee); }
    input { margin: 6px; padding: 4px 6px; font: inherit; color: inherit; background: var(--wst-field, #12161d); border: 1px solid var(--wst-node-edge, #343c4b); border-radius: 4px; }
    .list { overflow-y: auto; padding: 0 6px 6px; flex: 1; min-height: 0; }
    details { margin-bottom: 4px; }
    summary { cursor: pointer; color: var(--wst-muted, #8f9bb0); font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; padding: 3px 0; }
    button { display: flex; align-items: center; gap: 6px; width: 100%; text-align: left; margin: 1px 0; padding: 3px 6px; font: inherit; color: inherit; cursor: pointer;
      background: var(--wst-node, #1d222c); border: 1px solid var(--wst-node-edge, #343c4b); border-left: 4px solid var(--c, #555); border-radius: 4px; }
    button:hover:not(:disabled) { border-color: var(--wst-selected, #ffd92c); border-left-color: var(--c, #555); }
    button:disabled { opacity: 0.45; cursor: not-allowed; }
    button[data-kind='event'] { --c: var(--wst-event, #8c2f39); }
    button[data-kind='action'] { --c: var(--wst-action, #a65a1e); }
    button[data-kind='query'] { --c: var(--wst-query, #2c5d92); }
    button[data-kind='config'] { --c: var(--wst-config, #1f6f6b); }
    button[data-kind='logic'] { --c: var(--wst-logic, #566078); }
    button[data-kind='variable'] { --c: var(--wst-variable, #3b6a3a); }
    button[data-kind='flow'] { --c: var(--wst-flow, #4f3d7a); }
    button[data-kind='note'] { --c: var(--wst-note, #6a5d2a); }
    button[data-kind='block'] { --c: var(--wst-block, #34499a); }
  `;

  render() {
    const filter = this.filter.trim().toLowerCase();
    const shown = this.items.filter((i) => !filter || i.label.toLowerCase().includes(filter) || i.doc.toLowerCase().includes(filter));
    const groups = [...new Set(shown.map((i) => i.group))];
    return html`
      <input type="search" placeholder="Search nodes…" .value=${this.filter} @input=${(e: Event) => (this.filter = (e.target as HTMLInputElement).value)}>
      <div class="list">${groups.map(
        (g) => html`<details ?open=${!!filter || g === 'Blocks' || g === 'Events' || g === 'Flow'}><summary>${g}</summary>${shown
          .filter((i) => i.group === g)
          .map(
            (i) => html`<button data-kind=${i.kind} ?disabled=${!!i.disabled} title=${i.disabled ?? i.doc}
              @click=${() => this.dispatchEvent(new CustomEvent('add', { detail: i.id, bubbles: true, composed: true }))}>${KIND_ICON[i.kind]} ${i.label}</button>`,
          )}</details>`,
      )}</div>`;
  }
}

for (const [name, ctor] of [
  ['wst-flow-socket', WstFlowSocket],
  ['wst-flow-wire', WstFlowWire],
  ['wst-flow-node', WstFlowNode],
  ['wst-flow-palette', WstFlowPalette],
] as const) {
  if (!customElements.get(name)) customElements.define(name, ctor);
}

// --- variables -----------------------------------------------------------------------------------------

export interface VariableRow {
  readonly name: string;
  readonly init: number;
  readonly used: boolean;
}

/** The program's variables: add, set the starting value, delete (while nothing uses them). Fires var-add, var-init, var-delete. */
export class WstFlowVariables extends LitElement {
  static properties = { vars: { attribute: false } };
  declare vars: readonly VariableRow[];

  constructor() {
    super();
    this.vars = [];
  }

  static styles = css`
    :host { display: block; padding: 6px; border-top: 1px solid var(--wst-node-edge, #343c4b); font: 12px system-ui, sans-serif; color: var(--wst-text, #dde3ee); }
    h4 { margin: 0 0 4px; font-size: 11px; font-weight: 400; text-transform: uppercase; letter-spacing: 0.04em; color: var(--wst-muted, #8f9bb0); }
    .row { display: flex; align-items: center; gap: 4px; margin: 2px 0; }
    .row span { flex: 1; overflow: hidden; text-overflow: ellipsis; }
    input { font: inherit; color: inherit; background: var(--wst-field, #12161d); border: 1px solid var(--wst-node-edge, #343c4b); border-radius: 4px; padding: 1px 4px; min-width: 0; }
    input.num { width: 52px; } input.name { flex: 1; }
    button { font: inherit; color: inherit; background: var(--wst-node, #1d222c); border: 1px solid var(--wst-node-edge, #343c4b); border-radius: 4px; cursor: pointer; padding: 0 6px; }
    button:disabled { opacity: 0.4; cursor: not-allowed; }
    .hint { color: var(--wst-muted, #8f9bb0); font-size: 11px; margin: 2px 0 0; }
  `;

  render() {
    const fire = (type: string, detail: unknown) => this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
    return html`<h4>Variables <span class="hint">(one memory slot each)</span></h4>
      ${this.vars.map(
        (v) => html`<div class="row"><span title=${v.name}>${v.name}</span>
          <input class="num" .value=${String(v.init)} title="Starting value" @change=${(e: Event) => fire('var-init', { name: v.name, value: (e.target as HTMLInputElement).value })}>
          <button ?disabled=${v.used} title=${v.used ? 'Still used by a node' : 'Delete variable'} @click=${() => fire('var-delete', v.name)}>✕</button></div>`,
      )}
      <div class="row"><input class="name" placeholder="new variable" spellcheck="false" @keydown=${(e: KeyboardEvent) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          const el = e.target as HTMLInputElement;
          fire('var-add', el.value.trim());
          el.value = '';
        }
      }}></div>`;
  }
}

if (!customElements.get('wst-flow-variables')) customElements.define('wst-flow-variables', WstFlowVariables);
