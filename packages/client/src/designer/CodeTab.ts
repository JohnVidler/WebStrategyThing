import { FlowError, FLOW_HOST, testRun, type TestRunOptions } from '@wst/engine';
import { diffLines, withContext } from '../diff';
import { createTextView, type TextView } from '../editor';
import { FlowDocument, sourceToText, type Draft } from '../flow/FlowDocument';
import type { GraphView } from '../flow/graphView';
import { esc, type DesignerModel } from './shared';

type Mode = 'graph' | 'text' | 'split';
const MODE_KEY = 'wst-code-mode';

function loadMode(): Mode {
  try {
    const v = sessionStorage.getItem(MODE_KEY);
    return v === 'graph' || v === 'text' || v === 'split' ? v : 'split';
  } catch {
    return 'split';
  }
}

/**
 * The Code tab: a full-panel program editor with the class picker above it, version history,
 * the upload diff and the sandbox test run. The program is a `FlowDocument`; this tab shows it
 * as text today and will show it as a graph next to (or instead of) the text.
 */
export class CodeTab {
  readonly panel: HTMLDivElement;
  /** The program on show, shared by every view of it. */
  readonly doc = new FlowDocument(FLOW_HOST);
  private readonly classSelect: HTMLSelectElement;
  private readonly historySelect: HTMLSelectElement;
  private readonly memoryMeter: HTMLSpanElement;
  private readonly diffPanel: HTMLDivElement;
  private readonly testOut: HTMLDivElement;
  private readonly text: TextView;
  private readonly modeButtons: HTMLButtonElement[];
  private readonly graphSlot: HTMLDivElement;
  private readonly textSlot: HTMLDivElement;
  private mode: Mode = loadMode();
  private graph: GraphView | undefined;
  private graphLoading: Promise<GraphView> | undefined;

  constructor(private readonly m: DesignerModel) {
    this.panel = document.createElement('div');
    this.panel.className = 'designer-panel designer-tab-code';
    this.panel.dataset.tab = 'code';
    this.panel.hidden = true;
    this.panel.innerHTML = `
      <div class="code-head">
        <label>Class <select data-role="class-select" title="The class whose program you are editing"></select></label>
        <span class="mode-switch" role="group" aria-label="How to show the program">
          <button data-mode="graph" title="Blocks and wires">Graph</button>
          <button data-mode="split" title="Graph and text side by side">Split</button>
          <button data-mode="text" title="TypeScript-style text">Text</button>
        </span>
        <span data-role="memory" class="memory-meter" title="Memory the program occupies: variables, distinct numbers (other than -1, 0 and 1) and locals. Memory modules add more."></span>
        <span class="muted">Ctrl+Space completes; hover a call or event for its docs</span>
        <span class="code-spacer"></span>
        <select data-role="history" title="Uploaded versions of this program (kept in this browser): pick one to load it into the editor"></select>
      </div>
      <div class="code-views">
        <div data-role="graph" class="graph-slot"></div>
        <div data-role="editor" class="editor-host"></div>
      </div>
      <details class="test-run">
        <summary>Test run <span class="muted">— try this design and program in a private sandbox</span></summary>
        <div class="test-controls">
          <label>Length <select data-role="test-ticks"><option value="100">10 s</option><option value="300" selected>30 s</option><option value="600">60 s</option></select></label>
          <label>Order <select data-role="test-order"><option value="none">none</option><option value="move">move across the map</option><option value="attack">attack an enemy scout</option></select></label>
          <label><input type="checkbox" data-role="test-enemy"> enemy scout nearby</label>
          <button data-role="test-run" class="primary" data-sound="ui.designer_run">Run</button>
        </div>
        <div data-role="test-out" class="test-out muted">Runs the unsaved design and program next to a copy of your starting base. Nothing in the real match changes.</div>
      </details>
      <div data-role="diff" class="diff-panel" hidden>
        <h2>Upload these changes?</h2>
        <div data-role="diff-body" class="diff-body"></div>
        <div class="diff-actions">
          <button data-role="diff-cancel" data-sound="ui.cancel">Keep editing</button>
          <button data-role="diff-confirm" class="primary" data-sound="ui.confirm">Upload</button>
        </div>
      </div>`;

    const q = <T extends HTMLElement>(role: string) => this.panel.querySelector<T>(`[data-role="${role}"]`)!;
    this.classSelect = q('class-select');
    this.historySelect = q('history');
    this.memoryMeter = q('memory');
    this.diffPanel = q('diff');
    this.testOut = q('test-out');

    this.graphSlot = q('graph');
    this.textSlot = q('editor');
    this.modeButtons = [...this.panel.querySelectorAll<HTMLButtonElement>('.mode-switch button')];
    for (const b of this.modeButtons) b.onclick = () => this.setMode(b.dataset.mode as Mode);
    this.text = createTextView(q('editor'), this.doc, { stats: () => m.stats });
    this.applyMode();
    // Whatever changes the program (typing, loading) is the draft for the class on show, as before.
    this.doc.subscribe(() => {
      const draft = this.doc.draft();
      if (m.selected < 0) m.draftProgram = draft;
      else m.edits.set(m.selected, draft);
      this.renderMemory();
    });

    this.classSelect.onchange = () => {
      const id = Number(this.classSelect.value);
      if (id < 0) m.newDesign();
      else m.select(id);
    };
    q<HTMLButtonElement>('diff-cancel').onclick = () => (this.diffPanel.hidden = true);
    q<HTMLButtonElement>('diff-confirm').onclick = () => {
      this.diffPanel.hidden = true;
      if (m.selected < 0) return;
      try {
        m.actions.uploadProgram(m.selected, this.doc.source());
      } catch (err) {
        m.showResult((err as Error).message, false);
      }
    };
    this.historySelect.onchange = () => {
      const v = m.history.versionsOf(m.selected)[Number(this.historySelect.value)];
      if (v) {
        this.doc.loadSource(v.source);
        m.showResult(`Loaded the version from ${v.at.toLocaleTimeString()} — upload it to make it live.`, true);
      }
    };
    q<HTMLButtonElement>('test-run').onclick = () =>
      this.runTest({
        ticks: Number(q<HTMLSelectElement>('test-ticks').value),
        order: q<HTMLSelectElement>('test-order').value as TestRunOptions['order'],
        enemy: q<HTMLInputElement>('test-enemy').checked,
      });
  }

  /** The program as stored (JSON). Throws FlowError while the text is not a valid program. */
  programSource(): string {
    return this.doc.source();
  }

  /** The program on show as an editable draft (text and layout). */
  draft(): Draft {
    return this.doc.draft();
  }

  /** Re-checks the program against the design on show (the diagnostics depend on its CPU, memory and sensor). */
  refresh(): void {
    this.text.relint();
    this.renderMemory();
  }

  /** The tab became visible: a CodeMirror view hidden at creation needs measuring, and the graph needs drawing. */
  shown(): void {
    this.text.view.requestMeasure();
    if (this.mode !== 'text') void this.ensureGraph().then((g) => g.show());
  }

  /** The tab was hidden. */
  hidden(): void {
    this.graph?.hide();
  }

  private setMode(mode: Mode): void {
    this.mode = mode;
    try {
      sessionStorage.setItem(MODE_KEY, mode);
    } catch {
      // not remembered
    }
    this.applyMode();
    if (mode !== 'graph') this.text.view.requestMeasure();
    if (mode === 'text') this.graph?.hide();
    else void this.ensureGraph().then((g) => g.show());
  }

  private applyMode(): void {
    this.graphSlot.hidden = this.mode === 'text';
    this.textSlot.hidden = this.mode === 'graph';
    this.panel.dataset.mode = this.mode;
    for (const b of this.modeButtons) b.classList.toggle('active', b.dataset.mode === this.mode);
  }

  /** The graph editor (Rete and the node components) loads the first time it is wanted. */
  private ensureGraph(): Promise<GraphView> {
    this.graphLoading ??= import('../flow/graphView').then(({ GraphView }) => {
      const view = new GraphView({ doc: this.doc, host: FLOW_HOST, notify: (message, ok) => this.m.showResult(message, ok) });
      this.graphSlot.appendChild(view.element);
      this.graph = view;
      return view;
    });
    return this.graphLoading;
  }

  /** Loads the selected class's (or the draft's) program. */
  loadSelected(): void {
    const { m } = this;
    const id = m.selected;
    if (id < 0) {
      this.doc.loadDraft(m.draftProgram);
    } else {
      const draft = m.edits.get(id);
      if (draft) this.doc.loadDraft(draft);
      else this.doc.loadSource(m.state.programs.get(id) ?? m.state.blueprints.get(id)?.program?.source ?? '');
      const live = m.state.programs.get(id);
      if (live !== undefined) m.history.remember(id, live);
    }
    this.diffPanel.hidden = true;
    this.renderHistory();
  }

  /** The server confirmed a program (ClientState.programs already holds it). */
  confirmed(blueprint: number, source: string): void {
    this.m.edits.delete(blueprint);
    this.m.history.remember(blueprint, source);
    if (blueprint === this.m.selected) {
      this.doc.loadSource(source);
      this.renderHistory();
    }
  }

  /** Class picker: the draft, then every class of the player's. */
  renderClassSelect(): void {
    const { m } = this;
    const mine = m.state.blueprints.ownedBy(m.state.myId);
    const group = (label: string, list: typeof mine) =>
      list.length ? `<optgroup label="${label}">${list.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join('')}</optgroup>` : '';
    this.classSelect.innerHTML =
      `<option value="-1">${esc(m.draftName || 'New design')} (new design)</option>` +
      group('Units', mine.filter((b) => !b.stats.structure && !b.retired)) +
      group('Buildings', mine.filter((b) => b.stats.structure && !b.retired)) +
      group('Retired', mine.filter((b) => b.retired));
    this.classSelect.value = String(m.selected);
  }

  renderHistory(): void {
    const list = this.m.selected >= 0 ? this.m.history.versionsOf(this.m.selected) : [];
    this.historySelect.hidden = list.length === 0;
    this.historySelect.innerHTML =
      '<option value="" disabled selected>History…</option>' +
      list
        .map((v, i) => `<option value="${i}">${i === list.length - 1 ? 'Live' : `v${i + 1}`} · ${v.at.toLocaleTimeString()}</option>`)
        .reverse()
        .join('');
  }

  /** "Memory 7/16", red when the program does not fit. */
  private renderMemory(): void {
    const have = this.m.stats?.memorySlots;
    const used = this.doc.memory.total;
    this.memoryMeter.textContent = have === undefined ? `Memory ${used}` : `Memory ${used}/${have}`;
    this.memoryMeter.classList.toggle('bad', have !== undefined && used > have);
  }

  /** Shows what an upload would change, before sending it. */
  reviewUpload(): void {
    const { m } = this;
    if (m.selected < 0) return;
    if (!this.doc.valid) {
      m.showResult(`Fix the program first: ${this.doc.errors[0].message}`, false);
      return;
    }
    const live = sourceToText(m.state.programs.get(m.selected) ?? '', FLOW_HOST);
    const lines = withContext(diffLines(live, this.doc.text));
    const body = this.diffPanel.querySelector<HTMLDivElement>('[data-role="diff-body"]')!;
    if (!lines.length) {
      m.showResult('No changes to upload.', true);
      return;
    }
    const added = lines.filter((l) => l?.op === '+').length;
    const removed = lines.filter((l) => l?.op === '-').length;
    body.innerHTML =
      `<p class="muted">${added} line(s) added, ${removed} removed. Every unit of this class reboots into the new program.</p><pre>` +
      lines
        .map((l) => (l ? `<span class="d${l.op === '+' ? 'add' : l.op === '-' ? 'del' : 'ctx'}">${l.op} ${esc(l.text)}</span>` : '<span class="dgap">⋯</span>'))
        .join('\n') +
      '</pre>';
    this.diffPanel.hidden = false;
  }

  /** Runs the current design and program in a throwaway local simulation. */
  private runTest(options: TestRunOptions): void {
    let source: string;
    try {
      source = this.doc.source();
    } catch (err) {
      this.testOut.innerHTML = `<div class="bad">Could not run: ${esc(err instanceof FlowError ? err.message : String(err))}</div>`;
      return;
    }
    const started = performance.now();
    const result = testRun(this.m.currentParts(), source, options);
    const ms = Math.round(performance.now() - started);
    if (result.error) {
      this.testOut.innerHTML = `<div class="bad">Could not run: ${esc(result.error)}</div>`;
      return;
    }
    const rows = result.samples
      .map(
        (s) =>
          `<tr><td>${(s.tick / 10).toFixed(0)}s</td><td>${s.x}, ${s.y}</td><td>${s.hp}</td><td>${s.energy}%</td><td>${s.cpu}</td><td>${s.cycles}</td><td>${s.tasks}</td><td>${s.cargo}</td></tr>`,
      )
      .join('');
    const buttons = result.buttons.length ? `<p>Buttons: ${result.buttons.map((b) => `<b>${esc(b.label)}</b>${b.key ? ` (${b.key})` : ''}`).join(', ')}</p>` : '';
    this.testOut.innerHTML = `
      <ul>${result.notes.map((n) => `<li${n.startsWith('⚠') ? ' class="bad"' : ''}>${esc(n)}</li>`).join('')}</ul>
      ${buttons}
      <table><tr><th>Time</th><th>Tile</th><th>HP</th><th>Energy</th><th>CPU</th><th>Cycles</th><th>Tasks</th><th>Cargo</th></tr>${rows}</table>
      <p class="muted">Sandbox computed in ${ms} ms.</p>`;
  }
}
