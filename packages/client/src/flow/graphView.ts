import { LitPlugin, Presets as LitPresets, type LitArea2D } from '@retejs/lit-plugin';
import {
  configFromText,
  EVENT_BY_NAME,
  EVENTS,
  type BinOp,
  type FlowHost,
  type FlowViews,
} from '@wst/engine';
import { html } from 'lit';
import { ClassicPreset, NodeEditor, type GetSchemes } from 'rete';
import { AreaExtensions, AreaPlugin } from 'rete-area-plugin';
import { ConnectionPlugin, Presets as ConnectionPresets } from 'rete-connection-plugin';
import './components';
import type { NodeCallbacks, PaletteItem, VariableRow, WstFlowPalette, WstFlowVariables } from './components';
import type { FlowDocument } from './FlowDocument';
import { buildGraph, OP_TITLE, slotForInput, type GNode, type GraphModel } from './graphModel';
import {
  addExpression,
  addHandler,
  addStatement,
  addVariable,
  connectData,
  connectExec,
  deleteNode,
  deleteVariable,
  disconnectData,
  disconnectExec,
  isExprNodeId,
  OpError,
  scratchOf,
  setAssignTarget,
  setComment,
  setConfig,
  setLiteral,
  setOperator,
  setResultName,
  setVariableInit,
  setVariableRef,
  suggestResultName,
  variableUsed,
  withScratch,
  type DataSource,
  type ExecRef,
  type Program,
} from './graphOps';
import { layout, NODE_WIDTH } from './layout';

/*
 * The Graph view: Rete.js draws the program as blocks and wires, our Lit components draw each
 * piece, and every edit is an operation on the program (graphOps) applied through the shared
 * FlowDocument. Rete never owns the program: whatever it does is cancelled and the graph is
 * rebuilt from the program that comes back, so the graph and the text cannot drift apart.
 */

class FlowSocket extends ClassicPreset.Socket {
  constructor(readonly kind: 'exec' | 'data') {
    super(kind);
  }
}
const EXEC = new FlowSocket('exec');
const DATA = new FlowSocket('data');

class FlowNode extends ClassicPreset.Node {
  width = NODE_WIDTH;
  height = 0;
  constructor(public model: GNode) {
    super(model.title);
    // Rete's ids are ours, so a connection's ends and a selection name the same nodes as the program does.
    this.id = model.id;
  }
}

class FlowConnection extends ClassicPreset.Connection<FlowNode, FlowNode> {
  constructor(
    source: FlowNode,
    sourceOutput: string,
    target: FlowNode,
    targetInput: string,
    readonly type: 'exec' | 'data',
  ) {
    super(source, sourceOutput, target, targetInput);
  }
}

type Schemes = GetSchemes<FlowNode, FlowConnection>;
type AreaExtra = LitArea2D<Schemes>;

const structureOf = (m: GNode) => JSON.stringify([m.kind, m.title, m.inputs, m.outputs]);
const edgeKey = (e: { from: { node: string; key: string }; to: { node: string; key: string } }) => `${e.from.node}.${e.from.key}>${e.to.node}.${e.to.key}`;

export interface GraphHost {
  doc: FlowDocument;
  host: FlowHost;
  /** A short message for the player (the Code tab's status line, plus a toast over the graph). */
  notify(message: string, ok: boolean): void;
}

/** What the palette offers: everything a program can contain. */
export function paletteItems(host: FlowHost, vars: readonly string[], existing: ReadonlySet<string>): PaletteItem[] {
  const items: PaletteItem[] = [];
  for (const e of EVENTS) {
    items.push({
      id: `ev:${e.name}`, label: e.name, group: 'Events', kind: 'event', doc: e.doc,
      disabled: !e.multi && existing.has(e.name) ? `A class can only have one ${e.name} block` : undefined,
    });
  }
  items.push(
    { id: 'st:if', label: 'Branch (if)', group: 'Flow', kind: 'flow', doc: 'Runs one of two chains, then continues' },
    { id: 'st:while', label: 'While loop', group: 'Flow', kind: 'flow', doc: 'Repeats a chain while a condition holds' },
    { id: 'st:set', label: 'Set variable', group: 'Flow', kind: 'flow', doc: 'Assigns a variable', disabled: vars.length ? undefined : 'Add a variable first' },
    { id: 'st:note', label: 'Note', group: 'Flow', kind: 'note', doc: 'A comment' },
  );
  const callGroups: Record<string, string> = { action: 'Actions', config: 'Runtime settings', query: 'Queries' };
  for (const b of host.api) {
    if (b.kind === 'query') {
      items.push({ id: `ex:call:${b.name}`, label: `${b.name}(${(b.args ?? []).join(', ')})`, group: callGroups.query, kind: 'query', doc: b.doc ?? '' });
    } else {
      items.push({ id: `st:call:${b.name}`, label: `${b.kind === 'config' ? 'config.' : ''}${b.name}(${(b.args ?? []).join(', ')})`, group: callGroups[b.kind], kind: b.kind, doc: b.doc ?? '' });
    }
  }
  const math: [string, readonly BinOp[]][] = [
    ['Maths', ['+', '-', '*', '/', '%']],
    ['Compare', ['==', '!=', '<', '<=', '>', '>=']],
    ['Logic', ['&&', '||', '&', '|']],
  ];
  for (const [group, ops] of math) for (const op of ops) items.push({ id: `ex:bin:${op}`, label: OP_TITLE[op] ?? op, group, kind: 'logic', doc: `Operator ${op}` });
  items.push(
    { id: 'ex:un:!', label: 'NOT', group: 'Logic', kind: 'logic', doc: 'Logical not' },
    { id: 'ex:un:-', label: 'Negate', group: 'Maths', kind: 'logic', doc: 'Negative of a number' },
    { id: 'ex:cond', label: 'Select', group: 'Logic', kind: 'logic', doc: 'Picks one of two values' },
  );
  for (const v of vars) items.push({ id: `ex:var:${v}`, label: `Get ${v}`, group: 'Variables', kind: 'variable', doc: `Reads the variable ${v}` });
  return items;
}

export class GraphView {
  readonly element: HTMLDivElement;
  private readonly canvas: HTMLDivElement;
  private readonly palette: WstFlowPalette;
  private readonly variables: WstFlowVariables;
  private readonly banner: HTMLDivElement;
  private readonly toast: HTMLDivElement;
  private readonly undoBtn: HTMLButtonElement;
  private readonly redoBtn: HTMLButtonElement;

  private editor!: NodeEditor<Schemes>;
  private area!: AreaPlugin<Schemes, AreaExtra>;
  private selector = AreaExtensions.selector();
  private ready = false;
  private visible = false;

  private readonly nodes = new Map<string, FlowNode>();
  private readonly conns = new Map<string, FlowConnection>();
  private pos: Record<string, readonly [number, number]> = {};
  private model: GraphModel = { nodes: [], edges: [] };
  private syncing = false;
  /** Wires this class is removing itself, so the removal is not mistaken for the player cutting them. */
  private readonly ownRemovals = new Set<string>();
  private again = false;
  /** A wire is being dragged: the graph is rebuilt when it is dropped. */
  private dragging = false;
  /** Nodes that changed id while a wire was picked up, so the drag can carry on from the new id. */
  private readonly moved = new Map<string, string>();
  private saveTimer = 0;
  private lastCommit = 0;
  /** Zoom to fit once the next rebuild has finished (after a program is loaded). */
  private wantFit = false;
  private toastTimer = 0;
  private readonly callbacks: NodeCallbacks = { control: (id, key, value) => this.control(id, key, value) };

  constructor(private readonly g: GraphHost) {
    this.element = document.createElement('div');
    this.element.className = 'graph-pane';
    this.element.innerHTML = `
      <aside class="graph-side"></aside>
      <div class="graph-main">
        <div class="graph-toolbar">
          <button data-act="undo" title="Undo (Ctrl+Z)">↶ Undo</button>
          <button data-act="redo" title="Redo (Ctrl+Y)">↷ Redo</button>
          <button data-act="tidy" title="Lay the whole program out again">Tidy</button>
          <button data-act="fit" title="Zoom to fit everything">Fit</button>
          <button data-act="delete" title="Delete the selected nodes (Delete)">Delete</button>
          <span class="muted graph-hint">Drag from a pin to wire · double-click a wire to cut it · Delete removes the selection</span>
        </div>
        <div class="graph-canvas" tabindex="0"></div>
        <div class="graph-banner" hidden></div>
        <div class="graph-toast" hidden></div>
      </div>`;
    this.canvas = this.element.querySelector('.graph-canvas')!;
    this.banner = this.element.querySelector('.graph-banner')!;
    this.toast = this.element.querySelector('.graph-toast')!;
    const side = this.element.querySelector('.graph-side')!;
    this.palette = document.createElement('wst-flow-palette') as WstFlowPalette;
    this.variables = document.createElement('wst-flow-variables') as WstFlowVariables;
    side.append(this.palette, this.variables);
    this.palette.addEventListener('add', (ev) => this.addNode((ev as CustomEvent<string>).detail));
    this.variables.addEventListener('var-add', (ev) => this.edit(() => addVariable(this.program(), (ev as CustomEvent<string>).detail, 0, g.host)));
    this.variables.addEventListener('var-init', (ev) => {
      const { name, value } = (ev as CustomEvent<{ name: string; value: string }>).detail;
      if (!/^-?\d+$/.test(value.trim())) return this.fail(new OpError('A variable starts as a whole number'));
      this.edit(() => setVariableInit(this.program(), name, Number(value)));
    });
    this.variables.addEventListener('var-delete', (ev) => this.edit(() => deleteVariable(this.program(), (ev as CustomEvent<string>).detail)));
    const click = (act: string) => this.element.querySelector<HTMLButtonElement>(`[data-act="${act}"]`)!;
    this.undoBtn = click('undo');
    this.redoBtn = click('redo');
    click('undo').onclick = () => this.undo();
    click('redo').onclick = () => this.redo();
    click('tidy').onclick = () => void this.tidy();
    click('fit').onclick = () => this.fit();
    click('delete').onclick = () => this.deleteSelected();
    this.canvas.addEventListener('keydown', (e) => this.key(e));
    this.canvas.addEventListener('wire-cut', (e) => this.cutWire((e as CustomEvent<string>).detail));
    // Handy in the browser console while developing.
    if (import.meta.env.DEV) (window as unknown as { __wstGraph?: GraphView }).__wstGraph = this;
    g.doc.subscribe((change) => {
      if (change.origin === this) return;
      if (change.origin === 'load') {
        this.syncPositionsFromDoc();
        this.wantFit = true;
      }
      this.refreshChrome();
      if (change.docChanged || change.origin === 'load') void this.sync();
    });
  }

  // --- life cycle ---------------------------------------------------------------------------------

  /** The pane became visible: build the editor on first use, then show the program. */
  async show(): Promise<void> {
    this.visible = true;
    if (!this.ready) await this.init();
    this.wantFit = true;
    await this.sync();
  }

  hide(): void {
    this.visible = false;
  }

  private async init(): Promise<void> {
    this.ready = true;
    const editor = new NodeEditor<Schemes>();
    const area = new AreaPlugin<Schemes, AreaExtra>(this.canvas);
    const connection = new ConnectionPlugin<Schemes, AreaExtra>();
    const render = new LitPlugin<Schemes, AreaExtra>();
    AreaExtensions.selectableNodes(area, this.selector, { accumulating: AreaExtensions.accumulateOnCtrl() });
    render.addPreset(
      LitPresets.classic.setup({
        customize: {
          node: (data) => ({ emit }) => html`<wst-flow-node .data=${data.payload} .model=${(data.payload as FlowNode).model} .callbacks=${this.callbacks} .emit=${emit}></wst-flow-node>`,
          socket: (data) => () => html`<wst-flow-socket kind=${(data.payload as FlowSocket).kind}></wst-flow-socket>`,
          connection: (data) => ({ path }) => html`<wst-flow-wire .path=${path} .type=${(data.payload as FlowConnection).type} .wire=${data.payload.id}></wst-flow-wire>`,
        },
      }),
    );
    connection.addPreset(ConnectionPresets.classic.setup());
    editor.use(area);
    area.use(connection);
    area.use(render);
    this.editor = editor;
    this.area = area;

    // The program owns every wire: the user's connect and disconnect are turned into edits and
    // cancelled, and the graph is rebuilt from the result.
    editor.addPipe((ctx) => {
      // The wires we add are FlowConnection objects; the ones the player drags out are plain data.
      if (ctx.type === 'connectioncreate') {
        if (ctx.data instanceof FlowConnection) return ctx;
        this.userConnect(ctx.data);
        return undefined;
      }
      if (ctx.type === 'connectionremove') {
        if (this.ownRemovals.has(ctx.data.id)) return ctx;
        this.userDisconnect(ctx.data.id);
        return undefined;
      }
      return ctx;
    });
    connection.addPipe((ctx) => {
      if (ctx.type === 'connectionpick') this.dragging = true;
      if (ctx.type === 'connectiondrop') {
        this.dragging = false;
        window.setTimeout(() => void this.sync(), 0);
      }
      return ctx;
    });
    area.addPipe((ctx) => {
      if (ctx.type === 'nodetranslated' && !this.syncing) {
        const { id, position } = ctx.data;
        this.pos[id] = [Math.round(position.x), Math.round(position.y)];
        this.scheduleSave();
      }
      return ctx;
    });
  }

  // --- program access ------------------------------------------------------------------------------

  private program(): Program {
    return { doc: this.g.doc.doc, scratch: scratchOf(this.g.doc.views) };
  }

  /** Applies an edit; a refusal is shown to the player and changes nothing. */
  private edit(make: () => Program): void {
    try {
      this.commit(make());
    } catch (err) {
      this.fail(err);
    }
  }

  private commit(next: Program): void {
    // Edits that follow one another within a moment are one gesture (a wire dropped on a taken pin is a cut and a connect).
    const now = performance.now();
    const merge = now - this.lastCommit < 120;
    this.lastCommit = now;
    this.g.doc.apply(next.doc, withScratch(this.withPositions(this.g.doc.views), next.scratch), this, merge);
    this.refreshChrome();
    void this.sync();
  }

  private fail(err: unknown): void {
    if (!(err instanceof Error)) throw err;
    this.say(err.message, false);
    void this.sync();
  }

  private say(message: string, ok: boolean): void {
    this.g.notify(message, ok);
    this.toast.textContent = message;
    this.toast.className = `graph-toast ${ok ? 'ok' : 'bad'}`;
    this.toast.hidden = false;
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (this.toast.hidden = true), 4500);
  }

  private withPositions(views: FlowViews): FlowViews {
    return { ...views, graph: { ...(views.graph ?? {}), pos: { ...this.pos } } } as FlowViews;
  }

  private scheduleSave(): void {
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.g.doc.setViews(this.withPositions(this.g.doc.views), this), 300);
  }

  // --- user edits ----------------------------------------------------------------------------------------

  private nodeOf(id: string): GNode | undefined {
    return this.nodes.get(id)?.model ?? this.model.nodes.find((n) => n.id === id);
  }

  private execRef(nodeId: string, key: string): ExecRef | undefined {
    const n = this.nodeOf(nodeId);
    if (!n) return undefined;
    if (n.kind === 'event') return key === 'start' ? { k: 'start', handler: nodeId } : undefined;
    if (key === 'next' || key === 'then' || key === 'else' || key === 'body') return { k: key, stmt: nodeId };
    if (key.startsWith('out:')) return { k: 'outcome', stmt: nodeId, name: key.slice(4) };
    return undefined;
  }

  private userConnect(c: { source: string; sourceOutput: string; target: string; targetInput: string }): void {
    const sourceId = this.moved.get(c.source) ?? c.source;
    const from = this.nodeOf(c.source) ?? this.nodeOf(sourceId);
    const to = this.nodeOf(c.target);
    const out = from?.outputs.find((p) => p.key === c.sourceOutput);
    const into = to?.inputs.find((p) => p.key === c.targetInput);
    if (!from || !to || !out || !into) return this.fail(new OpError('That connection is not possible'));
    if (out.type !== into.type) return this.fail(new OpError(out.type === 'exec' ? 'Execution wires only go to execution pins' : 'Value wires only go to value pins'));
    this.edit(() => {
      let p = this.program();
      if (out.type === 'exec') {
        const ref = this.execRef(c.source, c.sourceOutput);
        if (!ref) throw new OpError('That connection is not possible');
        return connectExec(p, ref, c.target);
      }
      let source: DataSource;
      if (from.kind === 'event') source = { k: 'local', name: c.sourceOutput.replace(/^p:/, '') };
      else if (!isExprNodeId(sourceId)) {
        // A call's result: it needs a name to be wired onward.
        const stmt = findCall(p, sourceId);
        let name = stmt?.result;
        if (!name) {
          name = suggestResultName(p, sourceId);
          p = setResultName(p, sourceId, name);
        }
        source = { k: 'local', name };
      } else source = { k: 'node', id: sourceId };
      return connectData(p, source, slotForInput(c.target, c.targetInput));
    });
    this.moved.clear();
  }

  private userDisconnect(connectionId: string): void {
    const conn = [...this.conns.values()].find((c) => c.id === connectionId);
    if (!conn) return;
    const type = conn.type;
    this.edit(() => {
      const p = this.program();
      if (type === 'exec') {
        const ref = this.execRef(conn.source, conn.sourceOutput);
        if (!ref) throw new OpError('That wire cannot be cut');
        return disconnectExec(p, ref);
      }
      const cut = disconnectData(p, slotForInput(conn.target, conn.targetInput));
      if (cut.detached && isExprNodeId(conn.source)) {
        // A drag that picked this wire up carries on from the node's new id.
        this.moved.set(conn.source, cut.detached);
        window.setTimeout(() => this.moved.delete(conn.source), 5000);
      }
      return cut.program;
    });
  }

  private cutWire(id: string): void {
    this.userDisconnect(id);
  }

  private control(nodeId: string, key: string, value: string): void {
    const node = this.nodeOf(nodeId);
    if (!node) return;
    this.edit(() => {
      const p = this.program();
      if (key.startsWith('cfg:')) {
        const def = EVENT_BY_NAME.get(node.title);
        const field = def?.config.find((f) => f.name === key.slice(4));
        if (!def || !field) throw new OpError('Unknown setting');
        try {
          return setConfig(p, nodeId, field.name, configFromText(def.name, field, value, this.g.host));
        } catch (err) {
          throw new OpError(err instanceof Error ? err.message : String(err));
        }
      }
      if (key === 'var') return node.kind === 'variable' ? setVariableRef(p, nodeId, value) : setAssignTarget(p, nodeId, value);
      if (key === 'op') return setOperator(p, nodeId, value as BinOp);
      if (key === 'text') return setComment(p, nodeId, value);
      return setLiteral(p, slotForInput(nodeId, key), value, this.g.host);
    });
  }

  private addNode(id: string): void {
    const [kind, ...rest] = id.split(':');
    this.edit(() => {
      const p = this.program();
      let added: { program: Program; id: string };
      if (kind === 'ev') added = addHandler(p, rest[0]);
      else if (kind === 'st') {
        const what = rest[0];
        if (what === 'call') {
          const b = this.g.host.api.find((x) => x.name === rest[1]);
          added = addStatement(p, { k: 'call', fn: rest[1], argc: b?.argc ?? 0 });
        } else if (what === 'set') added = addStatement(p, { k: 'set', name: p.doc.vars[0]?.name ?? '' });
        else if (what === 'if') added = addStatement(p, { k: 'if' });
        else if (what === 'while') added = addStatement(p, { k: 'while' });
        else added = addStatement(p, { k: 'comment', text: 'note' });
      } else {
        const what = rest[0];
        if (what === 'call') {
          const b = this.g.host.api.find((x) => x.name === rest[1]);
          added = addExpression(p, { k: 'call', fn: rest[1], argc: b?.argc ?? 0 });
        } else if (what === 'bin') added = addExpression(p, { k: 'bin', op: rest[1] as BinOp });
        else if (what === 'un') added = addExpression(p, { k: 'un', op: rest[1] as '-' | '!' });
        else if (what === 'cond') added = addExpression(p, { k: 'cond' });
        else added = addExpression(p, { k: 'var', name: rest[1] });
      }
      this.placeAtCentre(added.id);
      return added.program;
    });
  }

  /** New nodes appear in the middle of what the player is looking at. */
  private placeAtCentre(id: string): void {
    const rect = this.canvas.getBoundingClientRect();
    const t = this.area?.area.transform ?? { x: 0, y: 0, k: 1 };
    const n = Object.keys(this.pos).length;
    const x = (rect.width / 2 - t.x) / t.k - NODE_WIDTH / 2 + (n % 5) * 14;
    const y = (rect.height / 2 - t.y) / t.k - 40 + (n % 5) * 14;
    this.pos[id] = [Math.round(x), Math.round(y)];
  }

  private deleteSelected(): void {
    const ids = [...this.selector.entities.values()].filter((e) => e.label === 'node').map((e) => e.id);
    if (!ids.length) return this.say('Select a node first (click it; Ctrl-click adds more)', false);
    this.edit(() => {
      let p = this.program();
      for (const id of ids) {
        p = deleteNode(p, id);
        delete this.pos[id];
      }
      return p;
    });
  }

  private undo(): void {
    if (this.g.doc.undo(this)) {
      this.syncPositionsFromDoc();
      this.refreshChrome();
      void this.sync();
    }
  }

  private redo(): void {
    if (this.g.doc.redo(this)) {
      this.syncPositionsFromDoc();
      this.refreshChrome();
      void this.sync();
    }
  }

  private syncPositionsFromDoc(): void {
    this.pos = { ...((this.g.doc.views.graph?.pos as Record<string, readonly [number, number]> | undefined) ?? {}) };
  }

  private key(e: KeyboardEvent): void {
    const typing = (e.target as HTMLElement | null)?.closest('input, textarea, select');
    if (typing) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      this.deleteSelected();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) this.redo();
      else this.undo();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      this.redo();
    }
  }

  // --- drawing -----------------------------------------------------------------------------------------------

  private refreshChrome(): void {
    const doc = this.g.doc;
    this.undoBtn.disabled = !doc.canUndo;
    this.redoBtn.disabled = !doc.canRedo;
    this.banner.hidden = doc.syntaxOk;
    this.canvas.classList.toggle('frozen', !doc.syntaxOk);
    if (!doc.syntaxOk) this.banner.textContent = `The text has a syntax error, so the graph is showing the last valid program and is read-only until the text is fixed: ${doc.errors[0]?.message ?? ''}`;
    const p = this.program();
    this.palette.items = paletteItems(this.g.host, p.doc.vars.map((v) => v.name), new Set(p.doc.handlers.map((h) => h.event)));
    this.variables.vars = p.doc.vars.map((v): VariableRow => ({ name: v.name, init: v.init, used: variableUsed(p, v.name) }));
  }

  /** Rebuilds the drawing from the program: adds, updates and removes nodes and wires so only what changed moves. */
  async sync(): Promise<void> {
    if (!this.ready || !this.visible) return;
    if (this.syncing || this.dragging) {
      this.again = true;
      return;
    }
    this.syncing = true;
    try {
      do {
        this.again = false;
        await this.reconcile();
      } while (this.again && !this.dragging);
      if (this.wantFit) {
        this.wantFit = false;
        this.fit();
      }
    } finally {
      this.syncing = false;
    }
    this.refreshChrome();
  }

  private async reconcile(): Promise<void> {
    const model = buildGraph(this.program(), this.g.host, this.g.doc.problems);
    this.model = model;
    // Nodes without a saved position get a tidy one, and it is remembered so later edits don't shuffle them.
    const auto = layout(model);
    let added = false;
    for (const n of model.nodes) {
      if (!this.pos[n.id]) {
        this.pos[n.id] = auto[n.id] ?? [40, 40];
        added = true;
      }
    }
    const wanted = new Map(model.nodes.map((n) => [n.id, n]));
    const wantedEdges = new Map(model.edges.map((e) => [edgeKey(e), e]));

    // Wires that are gone (or whose ends are about to be rebuilt).
    const rebuild = new Set<string>();
    for (const [id, n] of this.nodes) {
      const m = wanted.get(id);
      if (m && structureOf(m) !== structureOf(n.model)) rebuild.add(id);
    }
    for (const [key, c] of [...this.conns]) {
      if (!wantedEdges.has(key) || rebuild.has(c.source) || rebuild.has(c.target)) {
        this.ownRemovals.add(c.id);
        await this.editor.removeConnection(c.id);
        this.ownRemovals.delete(c.id);
        this.conns.delete(key);
      }
    }
    for (const id of [...this.nodes.keys()]) {
      if (!wanted.has(id) || rebuild.has(id)) {
        await this.editor.removeNode(id);
        this.nodes.delete(id);
      }
    }
    for (const m of model.nodes) {
      const have = this.nodes.get(m.id);
      if (have) {
        have.model = m;
        await this.area.update('node', m.id);
        const at = this.pos[m.id];
        const view = this.area.nodeViews.get(m.id);
        if (view && at && (view.position.x !== at[0] || view.position.y !== at[1])) await this.area.translate(m.id, { x: at[0], y: at[1] });
        continue;
      }
      const node = makeNode(m);
      this.nodes.set(m.id, node);
      await this.editor.addNode(node);
      const at = this.pos[m.id] ?? [40, 40];
      await this.area.translate(m.id, { x: at[0], y: at[1] });
    }
    for (const e of model.edges) {
      const key = edgeKey(e);
      if (this.conns.has(key)) continue;
      const from = this.nodes.get(e.from.node);
      const to = this.nodes.get(e.to.node);
      if (!from || !to) continue;
      if (!(e.from.key in from.outputs) || !(e.to.key in to.inputs)) {
        console.error('graph: stale node', e.from.node, e.from.key, Object.keys(from.outputs), '->', e.to.node, e.to.key, Object.keys(to.inputs), structureOf(from.model));
        continue;
      }
      const c = new FlowConnection(from, e.from.key, to, e.to.key, e.type);
      this.conns.set(key, c);
      await this.editor.addConnection(c);
    }
    if (added) this.g.doc.setViews(this.withPositions(this.g.doc.views), this);
  }

  /** Lays every node out again. */
  async tidy(): Promise<void> {
    if (!this.ready) return;
    this.pos = { ...layout(this.model) };
    this.g.doc.setViews(this.withPositions(this.g.doc.views), this);
    this.syncing = true;
    try {
      for (const [id, at] of Object.entries(this.pos)) if (this.nodes.has(id)) await this.area.translate(id, { x: at[0], y: at[1] });
    } finally {
      this.syncing = false;
    }
    this.fit();
  }

  fit(): void {
    if (!this.ready || this.nodes.size === 0) return;
    void AreaExtensions.zoomAt(this.area, this.editor.getNodes()).then(async () => {
      // A big program fits only when it is too small to read: show it at a readable size from the top left instead.
      const MIN_ZOOM = 0.6;
      if (this.area.area.transform.k >= MIN_ZOOM) return;
      const xs = Object.values(this.pos).map((p) => p[0]);
      const ys = Object.values(this.pos).map((p) => p[1]);
      await this.area.area.zoom(MIN_ZOOM, 0, 0);
      await this.area.area.translate(24 - Math.min(...xs) * MIN_ZOOM, 24 - Math.min(...ys) * MIN_ZOOM);
    });
  }
}

function makeNode(m: GNode): FlowNode {
  const node = new FlowNode(m);
  for (const p of m.inputs) node.addInput(p.key, new ClassicPreset.Input(p.type === 'exec' ? EXEC : DATA, p.label, false));
  for (const p of m.outputs) {
    // Event parameters and call results can feed many inputs; every other output feeds exactly one.
    const many = p.type === 'data' && (m.kind === 'event' || p.key === 'result');
    node.addOutput(p.key, new ClassicPreset.Output(p.type === 'exec' ? EXEC : DATA, p.label, many));
  }
  return node;
}

function findCall(p: Program, id: string): { result?: string } | undefined {
  const walk = (list: readonly import('@wst/engine').Stmt[]): { result?: string } | undefined => {
    for (const s of list) {
      if (s.id === id && s.k === 'call') return s;
      const inner = s.k === 'if' ? (walk(s.then) ?? walk(s.else)) : s.k === 'while' ? walk(s.body) : undefined;
      if (inner) return inner;
    }
    return undefined;
  };
  for (const h of p.doc.handlers) {
    const hit = walk(h.body);
    if (hit) return hit;
  }
  for (const c of p.scratch.chains) {
    const hit = walk(c);
    if (hit) return hit;
  }
  return undefined;
}

