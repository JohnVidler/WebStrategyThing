import { deriveStats, NEW_CLASS_TEXT, type BlueprintStats } from '@wst/engine';
import type { Draft } from '../flow/FlowDocument';
import { placeMusic } from '../music';
import type { ClientState } from '../state';
import { isShown, setShown } from '../transition';
import { CodeTab } from './CodeTab';
import { DesignTab } from './DesignTab';
import { ProgramHistory, type DesignerActions, type DesignerModel } from './shared';

type TabName = 'design' | 'code';
const TAB_KEY = 'wst-designer-tab';

function loadTab(): TabName {
  try {
    return sessionStorage.getItem(TAB_KEY) === 'code' ? 'code' : 'design';
  } catch {
    return 'design';
  }
}

/**
 * Full-screen design workspace over the running game. A shell with two tabs:
 * **Design** (class list, preview, stats, modules) and **Code** (the full-panel program
 * editor). The shell owns what they share (the selected class, the draft, unsaved
 * edits) and the footer actions; the game keeps running underneath.
 */
export class Designer implements DesignerModel {
  private readonly root: HTMLDivElement;
  private readonly status: HTMLDivElement;
  private readonly createBtn: HTMLButtonElement;
  private readonly uploadBtn: HTMLButtonElement;
  private readonly copyBtn: HTMLButtonElement;
  private readonly retireBtn: HTMLButtonElement;
  private readonly tabButtons: HTMLButtonElement[];
  private readonly designTab: DesignTab;
  private readonly codeTab: CodeTab;
  private tab: TabName = loadTab();
  /** A design sent to the server; its program is uploaded once the class arrives. */
  private awaiting: { name: string; source: string; draft: Draft } | null = null;

  // --- DesignerModel: the state the tabs share ---
  readonly history: ProgramHistory;
  selected = -1;
  draft: string[] = ['chassis.light', 'cpu.basic', 'motor.small', 'battery.cell'];
  draftName = 'New class';
  draftProgram: Draft = { text: NEW_CLASS_TEXT };
  readonly edits = new Map<number, Draft>();
  stats: BlueprintStats | undefined;
  statsError = '';

  programMemory(): number {
    return this.codeTab.doc.memory.total;
  }

  constructor(
    host: HTMLElement,
    readonly state: ClientState,
    readonly actions: DesignerActions,
  ) {
    this.history = new ProgramHistory(state);
    this.designTab = new DesignTab(this);
    this.codeTab = new CodeTab(this);

    this.root = document.createElement('div');
    this.root.id = 'designer-overlay';
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="designer-bar">
        <strong>Class designer</strong>
        <nav class="designer-tabs" role="tablist">
          <button role="tab" data-tab="design" data-sound="menu.click">Design</button>
          <button role="tab" data-tab="code" data-sound="menu.click">Code</button>
        </nav>
        <span class="muted">The game keeps running underneath.</span>
        <span class="designer-music"></span>
        <span class="designer-files" data-role="files" hidden>
          <button data-role="download" data-sound="ui.design_download" title="Save your unit and building designs and their scripts as a JSON file">⬇ Download designs</button>
          <button data-role="upload-designs" title="Load designs from a JSON file (asks first)">⬆ Upload designs</button>
          <button data-role="reset-designs" title="Put every default class back and retire your own (asks first)">Reset to defaults…</button>
          <input data-role="designs-file" type="file" accept=".json,application/json" hidden>
        </span>
        <button data-role="close" data-sound="ui.panel_close" title="Close (Esc / F2)">✕</button>
      </div>
      <div class="designer-body"></div>
      <div class="designer-footer">
        <div data-role="status" class="status"></div>
        <button data-role="retire" title="Retired classes can't be produced or placed; units already built carry on">Retire class</button>
        <button data-role="copy">Copy as new design</button>
        <button data-role="upload" class="primary" data-sound="ui.confirm">Upload program</button>
        <button data-role="create" class="primary" data-sound="ui.confirm">Create class</button>
      </div>`;
    this.root.querySelector('.designer-body')!.append(this.designTab.panel, this.codeTab.panel);
    host.appendChild(this.root);

    const q = <T extends HTMLElement>(role: string) => this.root.querySelector<T>(`[data-role="${role}"]`)!;
    this.status = q('status');
    this.createBtn = q('create');
    this.uploadBtn = q('upload');
    this.copyBtn = q('copy');
    this.retireBtn = q('retire');
    this.tabButtons = [...this.root.querySelectorAll<HTMLButtonElement>('.designer-tabs button')];

    for (const btn of this.tabButtons) btn.onclick = () => this.setTab(btn.dataset.tab as TabName);
    q<HTMLButtonElement>('close').onclick = () => this.toggle(false);
    const files = actions.designFiles;
    if (files) {
      q('files').hidden = false;
      const input = q<HTMLInputElement>('designs-file');
      q<HTMLButtonElement>('download').onclick = () => files.download();
      q<HTMLButtonElement>('upload-designs').onclick = () => input.click();
      q<HTMLButtonElement>('reset-designs').onclick = () => files.reset();
      input.onchange = () => {
        const file = input.files?.[0];
        input.value = '';
        if (file) files.upload(file);
      };
    }
    this.createBtn.onclick = () => this.create();
    // The diff is part of the Code tab, so uploading from the Design tab switches there first.
    this.uploadBtn.onclick = () => {
      this.setTab('code');
      this.codeTab.reviewUpload();
    };
    this.retireBtn.onclick = () => {
      const bp = this.state.blueprints.get(this.selected);
      if (bp) this.actions.retireClass(bp.id, !bp.retired);
    };
    this.copyBtn.onclick = () => {
      const bp = this.state.blueprints.get(this.selected);
      if (!bp) return;
      this.newDesign([...bp.parts], `${bp.name} copy`.slice(0, 24), this.codeTab.draft());
    };
    window.addEventListener('keydown', (ev) => {
      if (ev.key === 'F2') {
        ev.preventDefault();
        this.toggle(!this.isOpen);
      } else if (ev.key === 'Escape' && this.isOpen && !(ev.target as HTMLElement | null)?.closest('.cm-editor')) {
        this.toggle(false);
      }
    });
    this.applyTab();
    this.refresh();
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
    if (wasOpen && !open) {
      this.codeTab.hidden();
      this.onClose?.();
    }
    if (open) {
      this.designTab.renderClassList();
      this.refresh();
      this.codeTab.shown();
    }
  }

  // --- tabs ----------------------------------------------------------------------------

  private setTab(tab: TabName): void {
    if (tab === this.tab) return;
    this.tab = tab;
    try {
      sessionStorage.setItem(TAB_KEY, tab);
    } catch {
      // not remembered: the designer just opens on Design next time
    }
    this.applyTab();
    if (tab === 'code') {
      this.codeTab.renderClassSelect();
      this.codeTab.shown();
    }
  }

  private applyTab(): void {
    this.designTab.panel.hidden = this.tab !== 'design';
    this.codeTab.panel.hidden = this.tab !== 'code';
    if (this.tab !== 'code') this.codeTab.hidden();
    for (const btn of this.tabButtons) {
      const active = btn.dataset.tab === this.tab;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', String(active));
    }
  }

  // --- server events ---------------------------------------------------------------------

  /** Called when class info arrives from the server. */
  updateClasses(): void {
    const mine = this.state.blueprints.ownedBy(this.state.myId);
    if (this.awaiting) {
      const made = mine.filter((b) => b.name === this.awaiting!.name).at(-1);
      if (made && !this.state.programs.has(made.id) && !this.edits.has(made.id)) {
        const { source, draft } = this.awaiting;
        this.awaiting = null;
        this.edits.set(made.id, draft);
        if (source.trim() && made.stats.cyclesPerTick > 0) this.actions.uploadProgram(made.id, source);
        this.select(made.id);
        this.showResult(`Created ${made.name}.`, true);
      }
    }
    if (this.isOpen) {
      this.designTab.renderClassList();
      this.refresh();
    }
  }

  /** A program was confirmed by the server (ClientState.programs already holds it). */
  setSource(blueprint: number, source: string): void {
    this.codeTab.confirmed(blueprint, source);
  }

  /** The whole set of classes changed under the designer (an upload or a reset): drop unsaved edits and reload the selection. */
  reloadAll(): void {
    this.edits.clear();
    if (!this.state.blueprints.get(this.selected)) this.selected = -1;
    this.codeTab.loadSelected();
    this.designTab.renderClassList();
    this.refresh();
  }

  showResult(text: string, ok: boolean): void {
    this.status.textContent = text;
    this.status.className = `status ${ok ? 'ok' : 'bad'}`;
  }

  // --- DesignerModel ------------------------------------------------------------------

  get editable(): boolean {
    return this.selected < 0;
  }

  currentParts(): readonly string[] {
    return this.editable ? this.draft : (this.state.blueprints.get(this.selected)?.parts ?? []);
  }

  /** Re-derives stats and redraws the tabs and the footer. */
  refresh(): void {
    const parts = this.currentParts();
    this.statsError = '';
    try {
      this.stats = deriveStats(parts);
    } catch (err) {
      this.stats = undefined;
      this.statsError = (err as Error).message;
    }
    const editable = this.editable;
    const bp = this.state.blueprints.get(this.selected);
    this.createBtn.hidden = !editable;
    this.uploadBtn.hidden = editable;
    this.copyBtn.hidden = editable;
    this.retireBtn.hidden = editable;
    this.retireBtn.textContent = bp?.retired ? 'Restore class' : 'Retire class';
    this.designTab.render();
    this.codeTab.renderClassSelect();
    this.codeTab.refresh();
  }

  select(id: number): void {
    this.selected = id;
    this.codeTab.loadSelected();
    this.designTab.renderClassList();
    this.refresh();
  }

  newDesign(parts?: string[], name?: string, program?: Draft): void {
    this.selected = -1;
    if (parts) this.draft = parts;
    if (name) this.draftName = name;
    if (program !== undefined) this.draftProgram = program;
    this.codeTab.loadSelected();
    this.designTab.renderClassList();
    this.refresh();
  }

  private create(): void {
    if (!this.stats) {
      this.showResult('Fix the design first (see the stats panel).', false);
      return;
    }
    let source: string;
    try {
      source = this.codeTab.programSource();
    } catch (err) {
      this.showResult(`Fix the program first: ${(err as Error).message}`, false);
      return;
    }
    const name = this.draftName.trim() || 'Unnamed';
    this.awaiting = { name, source, draft: this.codeTab.draft() };
    this.actions.defineClass(name, [...this.draft]);
    this.showResult(`Creating ${name}…`, true);
  }
}
