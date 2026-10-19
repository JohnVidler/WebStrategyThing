import {
  deriveStats,
  GENERATION_SCALE,
  NEW_CLASS_PROGRAM,
  PART_LIST,
  PARTS,
  testRun,
  TILE,
  type BlueprintStats,
  type TestRunOptions,
  type PartDef,
  type PartSlot,
} from '@wst/engine';
import { diffLines, withContext } from './diff';
import { createScriptEditor, type ScriptEditor } from './editor';
import { placeMusic } from './music';
import { isShown, setShown } from './transition';
import type { ClientState } from './state';

export interface DesignerActions {
  defineClass(name: string, parts: string[]): void;
  uploadProgram(blueprint: number, source: string): void;
  retireClass(blueprint: number, retired: boolean): void;
  /** Image of a (possibly unsaved) design, drawn with the game's sprite art. */
  /** Image of a (possibly unsaved) design at `pxPerTile` pixels per map tile, in the player's colours or a rival's. */
  preview(parts: readonly string[], pxPerTile: number, rival?: boolean): Promise<string>;
  iconFor(blueprint: number): Promise<string>;
}

/** Module palette groups, in display order. Chassis are split into unit bodies and building frames. */
const CATEGORIES: { title: string; match: (p: PartDef) => boolean }[] = [
  { title: 'Unit bodies', match: (p) => p.slot === 'chassis' && !p.structure },
  { title: 'Building frames', match: (p) => p.slot === 'chassis' && p.structure === true },
  { title: 'Compute', match: (p) => p.slot === 'cpu' || p.slot === 'memory' },
  { title: 'Movement', match: (p) => p.slot === 'motor' },
  { title: 'Sensors & weapons', match: (p) => (['sensor', 'radar', 'weapon', 'armor'] as PartSlot[]).includes(p.slot) },
  { title: 'Industry', match: (p) => (['cargo', 'builder', 'repair', 'factory', 'depot'] as PartSlot[]).includes(p.slot) },
  { title: 'Power', match: (p) => (['battery', 'charger', 'generator', 'antenna'] as PartSlot[]).includes(p.slot) },
];

/** Uploaded versions kept per class; saved in the browser so they survive reloads. */
const HISTORY_LIMIT = 12;
const HISTORY_KEY = 'wst-program-history';

/** Saved history, keyed by class name and parts (blueprint ids change between sessions). */
function loadStoredHistory(): Record<string, { source: string; at: string }[]> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '{}');
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, { source: string; at: string }[]>) : {};
  } catch {
    return {};
  }
}

interface Version {
  readonly source: string;
  readonly at: Date;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/**
 * Full-screen design workspace over the running game: class list, design
 * (preview, stats, modules by category) and the program editor. Designing and
 * coding happen here; the side panel is left for playing.
 */
export class Designer {
  private readonly root: HTMLDivElement;
  private readonly classList: HTMLDivElement;
  private readonly nameInput: HTMLInputElement;
  private readonly preview: HTMLImageElement;
  private readonly previewOwn: HTMLImageElement;
  private readonly previewRival: HTMLImageElement;
  private readonly previewNote: HTMLDivElement;
  private readonly statsView: HTMLDivElement;
  private readonly partsView: HTMLOListElement;
  private readonly palette: HTMLDivElement;
  private readonly status: HTMLDivElement;
  private readonly createBtn: HTMLButtonElement;
  private readonly uploadBtn: HTMLButtonElement;
  private readonly copyBtn: HTMLButtonElement;
  private readonly retireBtn: HTMLButtonElement;
  private readonly historySelect: HTMLSelectElement;
  private readonly diffPanel: HTMLDivElement;
  private readonly testOut: HTMLDivElement;
  private readonly editor: ScriptEditor;
  /** Uploaded versions per class, oldest first. */
  private readonly versions = new Map<number, Version[]>();
  private readonly stored = loadStoredHistory();
  /** Index of the module being dragged in the installed list. */
  private dragging = -1;

  /** Existing class being viewed, or -1 for the new design draft. */
  private selected = -1;
  private draft: string[] = ['chassis.light', 'cpu.basic', 'motor.small', 'battery.cell'];
  private draftName = 'New class';
  private draftSource = NEW_CLASS_PROGRAM;
  /** A design sent to the server; its program is uploaded once the class arrives. */
  private awaiting: { name: string; source: string } | null = null;
  private previewToken = 0;
  /** Unsaved edits per class; server-confirmed sources live in ClientState.programs. */
  private readonly edits = new Map<number, string>();
  private stats: BlueprintStats | undefined;

  constructor(
    host: HTMLElement,
    private readonly state: ClientState,
    private readonly actions: DesignerActions,
  ) {
    this.root = document.createElement('div');
    this.root.id = 'designer-overlay';
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="designer-bar">
        <strong>Class designer</strong>
        <span class="muted">Design units and buildings, and write their programs. The game keeps running underneath.</span>
        <span class="designer-music"></span>
        <button data-role="close" data-sound="ui.panel_close" title="Close (Esc / F2)">✕</button>
      </div>
      <div class="designer-body">
        <section class="designer-classes">
          <h2>Your classes</h2>
          <button data-role="new" class="primary">+ New design</button>
          <div data-role="classes" class="class-list"></div>
        </section>
        <section class="designer-design">
          <div class="design-head">
            <div class="preview">
              <div class="preview-stage"><img data-role="preview" alt=""></div>
              <div class="preview-small"><img data-role="preview-own" alt="" title="In-game size, your colours"><img data-role="preview-rival" alt="" title="In-game size, a rival's colours"></div>
              <div data-role="preview-note" class="muted"></div>
            </div>
            <div class="design-meta">
              <input data-role="name" maxlength="24" placeholder="Class name">
              <div data-role="stats" class="stats-grid"></div>
            </div>
          </div>
          <h2>Installed modules <span data-role="slots" class="muted"></span></h2>
          <ol data-role="parts" class="installed" start="0"></ol>
          <h2>Module catalogue</h2>
          <div data-role="palette" class="palette"></div>
        </section>
        <section class="designer-code">
          <div class="code-head">
            <h2>Program <span class="muted">— Ctrl+Space completes; hover a function for its docs</span></h2>
            <select data-role="history" title="Uploaded versions of this program (kept in this browser): pick one to load it into the editor"></select>
          </div>
          <div data-role="editor" class="editor-host"></div>
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
        </section>
        <div data-role="diff" class="diff-panel" hidden>
          <h2>Upload these changes?</h2>
          <div data-role="diff-body" class="diff-body"></div>
          <div class="diff-actions">
            <button data-role="diff-cancel" data-sound="ui.cancel">Keep editing</button>
            <button data-role="diff-confirm" class="primary" data-sound="ui.confirm">Upload</button>
          </div>
        </div>
      </div>
      <div class="designer-footer">
        <div data-role="status" class="status"></div>
        <button data-role="retire" title="Retired classes can't be produced or placed; units already built carry on">Retire class</button>
        <button data-role="copy">Copy as new design</button>
        <button data-role="upload" class="primary" data-sound="ui.confirm">Upload program</button>
        <button data-role="create" class="primary" data-sound="ui.confirm">Create class</button>
      </div>`;
    host.appendChild(this.root);

    const q = <T extends HTMLElement>(role: string) => this.root.querySelector<T>(`[data-role="${role}"]`)!;
    this.classList = q('classes');
    this.nameInput = q('name');
    this.preview = q('preview');
    this.previewOwn = q('preview-own');
    this.previewRival = q('preview-rival');
    this.previewNote = q('preview-note');
    this.statsView = q('stats');
    this.partsView = q('parts');
    this.palette = q('palette');
    this.status = q('status');
    this.createBtn = q('create');
    this.uploadBtn = q('upload');
    this.copyBtn = q('copy');
    this.retireBtn = q('retire');
    this.historySelect = q('history');
    this.diffPanel = q('diff');
    this.testOut = q('test-out');

    this.editor = createScriptEditor(
      q('editor'),
      {
        memorySlots: () => this.stats?.memorySlots,
        hasCpu: () => (this.stats ? this.stats.cyclesPerTick > 0 : true),
      },
      () => {
        if (this.selected < 0) this.draftSource = this.editor.value;
        else this.edits.set(this.selected, this.editor.value);
      },
    );

    q<HTMLButtonElement>('close').onclick = () => this.toggle(false);
    q<HTMLButtonElement>('new').onclick = () => this.newDesign();
    this.nameInput.oninput = () => {
      if (this.selected < 0) this.draftName = this.nameInput.value;
    };
    this.createBtn.onclick = () => this.create();
    this.uploadBtn.onclick = () => this.reviewUpload();
    q<HTMLButtonElement>('diff-cancel').onclick = () => (this.diffPanel.hidden = true);
    q<HTMLButtonElement>('diff-confirm').onclick = () => {
      this.diffPanel.hidden = true;
      if (this.selected >= 0) this.actions.uploadProgram(this.selected, this.editor.value);
    };
    this.retireBtn.onclick = () => {
      const bp = this.state.blueprints.get(this.selected);
      if (bp) this.actions.retireClass(bp.id, !bp.retired);
    };
    this.historySelect.onchange = () => {
      const v = this.versionsOf(this.selected)[Number(this.historySelect.value)];
      if (v) {
        this.editor.value = v.source;
        this.showResult(`Loaded the version from ${v.at.toLocaleTimeString()} — upload it to make it live.`, true);
      }
    };
    q<HTMLButtonElement>('test-run').onclick = () =>
      this.runTest({
        ticks: Number(q<HTMLSelectElement>('test-ticks').value),
        order: q<HTMLSelectElement>('test-order').value as TestRunOptions['order'],
        enemy: q<HTMLInputElement>('test-enemy').checked,
      });
    this.copyBtn.onclick = () => {
      const bp = this.state.blueprints.get(this.selected);
      if (!bp) return;
      this.newDesign([...bp.parts], `${bp.name} copy`.slice(0, 24), this.editor.value);
    };
    window.addEventListener('keydown', (ev) => {
      if (ev.key === 'F2') {
        ev.preventDefault();
        this.toggle(!this.isOpen);
      } else if (ev.key === 'Escape' && this.isOpen && !(ev.target as HTMLElement | null)?.closest('.cm-editor')) {
        this.toggle(false);
      }
    });
    this.renderDesign();
  }

  get isOpen(): boolean {
    return isShown(this.root);
  }

  /** Called when the overlay goes from open to closed, by whatever means. */
  onClose?: () => void;

  toggle(open: boolean): void {
    const wasOpen = this.isOpen;
    setShown(this.root, open);
    // The music widget lives in the top bar while the designer covers the page.
    placeMusic(open ? this.root.querySelector<HTMLElement>('.designer-music') : null);
    if (wasOpen && !open) this.onClose?.();
    if (open) {
      this.renderClassList();
      this.renderDesign();
      this.editor.view.requestMeasure();
    }
  }

  /** Called when class info arrives from the server. */
  updateClasses(): void {
    const mine = this.state.blueprints.ownedBy(this.state.myId);
    if (this.awaiting) {
      const made = mine.filter((b) => b.name === this.awaiting!.name).at(-1);
      if (made && !this.state.programs.has(made.id) && !this.edits.has(made.id)) {
        const { source } = this.awaiting;
        this.awaiting = null;
        this.edits.set(made.id, source);
        if (source.trim() && made.stats.cyclesPerTick > 0) this.actions.uploadProgram(made.id, source);
        this.select(made.id);
        this.showResult(`Created ${made.name}.`, true);
      }
    }
    if (this.isOpen) {
      this.renderClassList();
      this.renderDesign();
    }
  }

  /** A program was confirmed by the server (ClientState.programs already holds it). */
  setSource(blueprint: number, source: string): void {
    this.edits.delete(blueprint);
    this.remember(blueprint, source);
    if (blueprint === this.selected && this.editor.value !== source) this.editor.value = source;
    if (blueprint === this.selected) this.renderHistory();
  }

  private remember(blueprint: number, source: string): void {
    const list = this.versionsOf(blueprint);
    if (list.at(-1)?.source === source) return;
    list.push({ source, at: new Date() });
    if (list.length > HISTORY_LIMIT) list.shift();
    const key = this.historyKey(blueprint);
    if (!key) return;
    this.stored[key] = list.map((v) => ({ source: v.source, at: v.at.toISOString() }));
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(this.stored));
    } catch {
      // storage full or unavailable: history just lasts for this session
    }
  }

  private historyKey(blueprint: number): string | undefined {
    const bp = this.state.blueprints.get(blueprint);
    return bp ? `${bp.name}|${bp.parts.join(',')}` : undefined;
  }

  /** A class's versions, oldest first, seeded from the browser's saved history the first time it is needed. */
  private versionsOf(blueprint: number): Version[] {
    let list = this.versions.get(blueprint);
    if (!list) {
      const key = this.historyKey(blueprint);
      list = (key ? (this.stored[key] ?? []) : [])
        .filter((v) => typeof v.source === 'string')
        .map((v) => ({ source: v.source, at: new Date(v.at) }));
      this.versions.set(blueprint, list);
    }
    return list;
  }

  private renderHistory(): void {
    const list = this.selected >= 0 ? this.versionsOf(this.selected) : [];
    this.historySelect.hidden = list.length === 0;
    this.historySelect.innerHTML =
      '<option value="" disabled selected>History…</option>' +
      list
        .map((v, i) => `<option value="${i}">${i === list.length - 1 ? 'Live' : `v${i + 1}`} · ${v.at.toLocaleTimeString()}</option>`)
        .reverse()
        .join('');
  }

  /** Shows what an upload would change, before sending it. */
  private reviewUpload(): void {
    if (this.selected < 0) return;
    const live = this.state.programs.get(this.selected) ?? '';
    const lines = withContext(diffLines(live, this.editor.value));
    const body = this.diffPanel.querySelector<HTMLDivElement>('[data-role="diff-body"]')!;
    if (!lines.length) {
      this.showResult('No changes to upload.', true);
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
    const started = performance.now();
    const result = testRun(this.currentParts(), this.editor.value, options);
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

  showResult(text: string, ok: boolean): void {
    this.status.textContent = text;
    this.status.className = `status ${ok ? 'ok' : 'bad'}`;
  }

  // --- class list ------------------------------------------------------------------

  private renderClassList(): void {
    const mine = this.state.blueprints.ownedBy(this.state.myId);
    this.classList.innerHTML = '';
    const groups: [string, typeof mine][] = [
      ['Units', mine.filter((b) => !b.stats.structure && !b.retired)],
      ['Buildings', mine.filter((b) => b.stats.structure && !b.retired)],
      ['Retired', mine.filter((b) => b.retired)],
    ];
    for (const [title, list] of groups) {
      if (!list.length) continue;
      const h = document.createElement('h3');
      h.textContent = title;
      this.classList.appendChild(h);
      for (const bp of list) {
        const btn = document.createElement('button');
        btn.className = `class-item${bp.id === this.selected ? ' active' : ''}${bp.retired ? ' retired' : ''}`;
        const img = document.createElement('img');
        img.alt = '';
        this.actions.iconFor(bp.id).then((src) => (img.src = src)).catch(() => img.remove());
        const label = document.createElement('span');
        label.innerHTML = `${esc(bp.name)}<small>${bp.stats.cyclesPerTick ? `${bp.stats.cyclesPerTick} c/t` : 'no CPU'} · ◆${bp.stats.cost}</small>`;
        btn.append(img, label);
        btn.onclick = () => this.select(bp.id);
        this.classList.appendChild(btn);
      }
    }
  }

  private select(id: number): void {
    this.selected = id;
    const bp = this.state.blueprints.get(id);
    this.editor.value = this.edits.get(id) ?? this.state.programs.get(id) ?? bp?.program?.source ?? '';
    const live = this.state.programs.get(id);
    if (live !== undefined) this.remember(id, live);
    this.diffPanel.hidden = true;
    this.renderHistory();
    this.renderClassList();
    this.renderDesign();
  }

  private newDesign(parts?: string[], name?: string, source?: string): void {
    this.selected = -1;
    if (parts) this.draft = parts;
    if (name) this.draftName = name;
    if (source !== undefined) this.draftSource = source;
    this.editor.value = this.draftSource;
    this.diffPanel.hidden = true;
    this.renderHistory();
    this.renderClassList();
    this.renderDesign();
  }

  private create(): void {
    if (!this.stats) {
      this.showResult('Fix the design first (see the stats panel).', false);
      return;
    }
    const name = this.draftName.trim() || 'Unnamed';
    this.awaiting = { name, source: this.editor.value };
    this.actions.defineClass(name, [...this.draft]);
    this.showResult(`Creating ${name}…`, true);
  }

  // --- design panel --------------------------------------------------------------------

  private get editable(): boolean {
    return this.selected < 0;
  }

  private currentParts(): readonly string[] {
    return this.editable ? this.draft : (this.state.blueprints.get(this.selected)?.parts ?? []);
  }

  private renderDesign(): void {
    const parts = this.currentParts();
    const editable = this.editable;
    const bp = this.state.blueprints.get(this.selected);
    this.nameInput.value = editable ? this.draftName : (bp?.name ?? '');
    this.nameInput.readOnly = !editable;
    this.createBtn.hidden = !editable;
    this.uploadBtn.hidden = editable;
    this.copyBtn.hidden = editable;
    this.retireBtn.hidden = editable;
    this.retireBtn.textContent = bp?.retired ? 'Restore class' : 'Retire class';

    let error = '';
    try {
      this.stats = deriveStats(parts);
    } catch (err) {
      this.stats = undefined;
      error = (err as Error).message;
    }
    this.renderStats(error);
    this.renderParts(parts, editable);
    this.renderPalette(parts, editable);
    this.renderPreview();
    this.editor.relint();
  }

  private renderStats(error: string): void {
    const s = this.stats;
    if (!s) {
      this.statsView.innerHTML = `<div class="bad">${esc(error)}</div>`;
      return;
    }
    const rows: [string, string][] = [
      ['Cost', `◆${s.cost} · ϟ${s.buildEnergy} · ${(s.buildTime / 10).toFixed(1)}s`],
      ['Hit points', String(s.hp)],
      ['Energy', `${s.energyCapacity}`],
      ['CPU', s.cyclesPerTick ? `${s.cyclesPerTick} cycles/tick · ${s.cpuUse} per 100 cycles` : 'none'],
      ['Memory', `${s.memorySlots} vars · stack ${s.stackDepth}`],
    ];
    if (s.structure) {
      rows.push(['Footprint', `${s.footprint}×${s.footprint} tiles`], ['Link reach', `${s.linkRange} tiles`]);
      if (s.solar || s.wind) rows.push(['Generation', `☀ ${s.solar / GENERATION_SCALE}/t  ≋ ${s.wind / GENERATION_SCALE}/t (peak)`]);
      if (s.chargeRate) rows.push(['Charging', `${s.chargeRate}/t per unit`]);
      if (s.resourceCapacity) rows.push(['Silos', String(s.resourceCapacity)]);
      if (s.factory) rows.push(['Factory', `${s.factoryUse} energy/t while producing`]);
    } else {
      rows.push(['Speed', s.speed ? `${((s.speed / TILE) * 10).toFixed(1)} tiles/s${s.flying ? ' (flying)' : ''} · ${s.motorUse}/t` : 'immobile']);
      if (s.sensorRange) rows.push(['Sensor', `${s.sensorRange / TILE} tiles · ${s.sensorUse}/scan`]);
      if (s.weapon) rows.push(['Weapon', `${s.weapon.damage} dmg · range ${s.weapon.range / TILE} · ${s.weapon.use}/shot`]);
      if (s.cargo) rows.push(['Cargo', `${s.cargo} · ${s.harvestRate}/t harvesting`]);
      if (s.buildRate) rows.push(['Build arm', `${s.buildRate}/t · ${s.builderUse} energy/t`]);
      if (s.repairRate) rows.push(['Repair', `${s.repairRate} hp/t · ${s.repairUse} energy/t · ◆${s.repairMatterPerHp.toFixed(2)}/hp to mend this class`]);
    }
    this.statsView.innerHTML = rows.map(([k, v]) => `<span>${k}</span><span>${esc(v)}</span>`).join('');
  }

  private renderParts(parts: readonly string[], editable: boolean): void {
    const frame = PARTS[parts[0]];
    const used = parts.length - 1;
    this.root.querySelector('[data-role="slots"]')!.textContent = frame?.slots ? `${used}/${frame.slots} slots` : '';
    this.partsView.innerHTML = '';
    parts.forEach((id, i) => {
      const def = PARTS[id];
      const li = document.createElement('li');
      li.innerHTML = `<span>${esc(def?.name ?? id)}</span><span class="muted">${esc(def?.description ?? '')}</span>`;
      if (editable && i > 0) {
        // Drag to reorder: the order sets each module's index (setModule, the module switches).
        li.draggable = true;
        li.title = 'Drag to reorder';
        li.classList.add('draggable');
        li.ondragstart = (ev) => {
          this.dragging = i;
          ev.dataTransfer?.setData('text/plain', String(i));
          li.classList.add('dragging');
        };
        li.ondragend = () => li.classList.remove('dragging');
        li.ondragover = (ev) => {
          if (this.dragging > 0) ev.preventDefault();
        };
        li.ondrop = (ev) => {
          ev.preventDefault();
          const from = this.dragging;
          this.dragging = -1;
          if (from <= 0 || from === i) return;
          const [moved] = this.draft.splice(from, 1);
          this.draft.splice(i, 0, moved);
          this.renderDesign();
        };
        const rm = document.createElement('button');
        rm.textContent = '✕';
        rm.title = 'Remove';
        rm.onclick = () => {
          this.draft.splice(i, 1);
          this.renderDesign();
        };
        li.appendChild(rm);
      }
      this.partsView.appendChild(li);
    });
  }

  private renderPalette(parts: readonly string[], editable: boolean): void {
    const frame = PARTS[parts[0]];
    const structure = frame?.structure === true;
    const full = frame?.slots !== undefined && parts.length - 1 >= frame.slots;
    this.palette.innerHTML = '';
    for (const cat of CATEGORIES) {
      const details = document.createElement('details');
      details.open = true;
      details.innerHTML = `<summary>${cat.title}</summary>`;
      for (const p of PART_LIST.filter(cat.match)) {
        const isFrame = p.slot === 'chassis';
        const fits = isFrame || (structure ? !p.mobileOnly : !p.structureOnly);
        const row = document.createElement('button');
        row.className = 'part-row';
        row.disabled = !editable || !fits || (!isFrame && full);
        row.title = !fits ? `Only fits ${p.structureOnly ? 'buildings' : 'units'}` : p.description;
        const detail = [
          `mass ${p.mass}`,
          p.use ? `uses ${p.use}` : '',
          p.slots ? `${p.slots} slots` : '',
          p.energy ? `+${p.energy} energy` : '',
        ].filter(Boolean).join(' · ');
        row.innerHTML = `<span>${isFrame ? '⇄ ' : '+ '}${esc(p.name)}</span><small>${esc(detail)}</small>`;
        row.onclick = () => (isFrame ? this.setFrame(p) : this.addPart(p));
        details.appendChild(row);
      }
      this.palette.appendChild(details);
    }
  }

  private addPart(p: PartDef): void {
    this.draft.push(p.id);
    this.renderDesign();
  }

  /** Swaps the chassis/frame; modules that no longer fit are dropped. */
  private setFrame(p: PartDef): void {
    const structure = p.structure === true;
    const kept = this.draft.slice(1).filter((id) => (structure ? !PARTS[id].mobileOnly : !PARTS[id].structureOnly));
    const dropped = this.draft.length - 1 - kept.length;
    this.draft = [p.id, ...kept.slice(0, p.slots ?? kept.length)];
    if (dropped) this.showResult(`Removed ${dropped} module(s) that don't fit a ${structure ? 'building' : 'unit'}.`, false);
    this.renderDesign();
  }

  /** Large view, plus true-size thumbnails in own and rival colours to judge how it reads on the map. */
  private renderPreview(): void {
    const token = ++this.previewToken;
    const s = this.stats;
    if (!s) {
      for (const img of [this.preview, this.previewOwn, this.previewRival]) img.removeAttribute('src');
      this.previewNote.textContent = 'Invalid design';
      return;
    }
    this.previewNote.textContent = s.structure ? `${s.footprint}×${s.footprint} building` : s.flying ? 'flying unit' : 'ground unit';
    const parts = this.currentParts();
    // The same scale for every design, so body sizes compare directly.
    const views: [HTMLImageElement, number, boolean][] = [[this.preview, 64, false], [this.previewOwn, 32, false], [this.previewRival, 32, true]];
    for (const [img, pxPerTile, rival] of views) {
      this.actions
        .preview(parts, pxPerTile, rival)
        .then((src) => {
          if (token !== this.previewToken) return;
          // Rendered at 2× for sharpness: show it at logical size.
          img.onload = () => (img.style.width = `${img.naturalWidth / 2}px`);
          img.src = src;
        })
        .catch(() => {});
    }
  }
}
