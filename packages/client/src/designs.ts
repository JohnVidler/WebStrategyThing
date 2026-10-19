import {
  classifyDesigns,
  defaultDesigns,
  DEFAULT_DESIGNS,
  designHash,
  DesignFileError,
  makeDesignFile,
  parseDesignFile,
  resolveDesigns,
  type ClassifiedDesign,
  type ClientMessage,
  type DesignEntry,
  type DesignFile,
  type ServerMessage,
} from '@wst/engine';
import type { ClientState } from './state';

/*
 * Keeps the player's classes (parts + programs) in the browser between sessions,
 * and lets them be downloaded, uploaded or reset to the defaults. The server
 * applies a whole set at once ('loadDesigns'); this module decides what to send
 * and asks the player first where it matters.
 */

const STORAGE_KEY = 'wst-designs';
const SAVE_DELAY_MS = 800;
const RESTORE_DELAY_MS = 300;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function readStorage(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function writeStorage(text: string): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, text);
    return true;
  } catch {
    return false;
  }
}

interface DialogAction {
  readonly label: string;
  readonly value: string;
  readonly kind?: 'primary' | 'danger';
}

/** A modal dialog; resolves with the chosen action and the dialog's form state. */
function dialog(title: string, body: string, actions: readonly DialogAction[]): Promise<{ value: string; form: HTMLElement }> {
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <h2>${esc(title)}</h2><div class="modal-body">${body}</div><div class="modal-actions"></div></div>`;
    const bar = back.querySelector<HTMLDivElement>('.modal-actions')!;
    const close = (value: string) => {
      back.remove();
      window.removeEventListener('keydown', onKey, true);
      resolve({ value, form: back });
    };
    const onKey = (ev: KeyboardEvent) => {
      ev.stopPropagation(); // keep game hotkeys out while the dialog is up
      if (ev.key === 'Escape') close('cancel');
    };
    for (const a of actions) {
      const b = document.createElement('button');
      b.textContent = a.label;
      if (a.kind) b.className = a.kind;
      b.onclick = () => close(a.value);
      bar.appendChild(b);
    }
    window.addEventListener('keydown', onKey, true);
    document.body.appendChild(back);
    bar.querySelector<HTMLButtonElement>('.primary, .danger')?.focus();
  });
}

const STATUS_TEXT: Record<string, string> = {
  conflict: 'You changed this default, and the default itself has changed since.',
  invalid: "Doesn't work in this version",
};

/** Rows asking "mine or default?" for conflicting/broken classes. */
function choiceTable(items: readonly ClassifiedDesign[]): string {
  if (!items.length) return '';
  const rows = items
    .map((c, i) => {
      const why = c.status === 'invalid' ? `${STATUS_TEXT.invalid}: ${esc(c.problem ?? '')}` : STATUS_TEXT.conflict;
      const choices =
        c.status === 'conflict'
          ? `<label><input type="radio" name="c${i}" value="mine" checked> keep mine</label>
             <label><input type="radio" name="c${i}" value="default"> use the new default</label>`
          : c.fallback
            ? '<span class="muted">the current default will be used</span>'
            : '<span class="muted">will be left out</span>';
      return `<tr data-name="${esc(c.entry.name)}" data-index="${i}"><td><b>${esc(c.entry.name)}</b><br><small class="muted">${why}</small></td><td class="choices">${choices}</td></tr>`;
    })
    .join('');
  return `<table class="design-choices">${rows}</table>`;
}

function chosenMine(form: HTMLElement, items: readonly ClassifiedDesign[]): Set<string> {
  const mine = new Set<string>();
  items.forEach((c, i) => {
    if (c.status !== 'conflict') return;
    const picked = form.querySelector<HTMLInputElement>(`input[name="c${i}"]:checked`)?.value ?? 'mine';
    if (picked === 'mine') mine.add(c.entry.name);
  });
  return mine;
}

/** The player's current classes as a design file (superseded copies left out). */
export function snapshotDesigns(state: ClientState): DesignFile {
  const mine = state.blueprints.ownedBy(state.myId);
  const activeNames = new Set(mine.filter((b) => !b.retired).map((b) => b.name));
  return makeDesignFile(
    mine
      // A retired class whose name lives on in an active class was replaced (new parts): drop it.
      .filter((b) => !(b.retired && activeNames.has(b.name)))
      .map((b) => ({ name: b.name, parts: b.parts, program: state.programs.get(b.id) ?? '', retired: b.retired })),
  );
}

export interface DesignHost {
  send(msg: ClientMessage): void;
  notify(text: string, ok: boolean): void;
}

export class DesignStore {
  /** Autosaving starts once the saved session has been restored (or there was none). */
  private ready = false;
  private restoreChecked = false;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private storageWorks = true;

  constructor(
    private readonly state: ClientState,
    private readonly host: DesignHost,
  ) {}

  /** The player's current classes as a design file (superseded copies left out). */
  snapshot(): DesignFile {
    return snapshotDesigns(this.state);
  }

  /** Call whenever class info or programs arrive. */
  onClassesChanged(): void {
    if (!this.restoreChecked && this.state.blueprints.ownedBy(this.state.myId).length > 0) {
      this.restoreChecked = true;
      // The classes' programs follow in separate messages: let them land first.
      setTimeout(() => void this.restoreSession(), RESTORE_DELAY_MS);
      return;
    }
    if (this.ready) this.scheduleSave();
  }

  onLoaded(msg: Extract<ServerMessage, { t: 'designsLoaded' }>): void {
    const what = { session: 'Restored your saved designs', upload: 'Uploaded designs applied', reset: 'Designs reset to the defaults' }[msg.reason];
    const counts = [
      msg.defined && `${msg.defined} added`,
      msg.updated && `${msg.updated} program(s) updated`,
      msg.retired && `${msg.retired} retired`,
    ].filter(Boolean);
    const errors = msg.errors.length ? ` — ${msg.errors.length} problem(s): ${msg.errors.join('; ')}` : '';
    this.host.notify(`${what}${counts.length ? ` (${counts.join(', ')})` : ''}${errors}`, msg.errors.length === 0);
    this.ready = true;
    this.scheduleSave();
  }

  download(): void {
    const text = JSON.stringify(this.snapshot(), null, 2);
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `wst-designs-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async upload(file: File): Promise<void> {
    let parsed: DesignFile;
    try {
      parsed = parseDesignFile(JSON.parse(await file.text()));
    } catch (err) {
      const why = err instanceof DesignFileError ? err.message : 'not valid JSON';
      await dialog('Can’t read that file', `<p>${esc(file.name)}: ${esc(why)}.</p>`, [{ label: 'OK', value: 'ok', kind: 'primary' }]);
      return;
    }
    const classified = classifyDesigns(parsed);
    const needChoice = classified.filter((c) => c.status === 'conflict' || c.status === 'invalid');
    const preview = this.plan(resolveDesigns(classified, () => true));
    const saved = parsed.savedAt ? ` (saved ${new Date(parsed.savedAt).toLocaleString()})` : '';
    const { value, form } = await dialog(
      'Upload designs?',
      `<p>Replace your current designs and scripts with the ${parsed.classes.length} class(es) in <b>${esc(file.name)}</b>${saved}. <b>Merge into mine</b> adds or updates only those classes and leaves your other classes alone.</p>
       ${preview}
       ${needChoice.length ? `<p>Some classes in the file need a decision:</p>${choiceTable(needChoice)}` : ''}
       <p class="muted">Units already built keep running; every unit of an updated class reboots into its new program.</p>`,
      [
        { label: 'Cancel', value: 'cancel' },
        { label: 'Merge into mine', value: 'merge' },
        { label: 'Upload and apply', value: 'apply', kind: 'primary' },
      ],
    );
    if (value !== 'apply' && value !== 'merge') return;
    const mine = chosenMine(form, needChoice);
    this.load(resolveDesigns(classified, (name) => mine.has(name)), 'upload', value === 'merge');
  }

  async reset(): Promise<void> {
    const preview = this.plan(defaultDesigns());
    const { value } = await dialog(
      'Reset designs to the defaults?',
      `<p>Every default class goes back to the version that comes with this build, and your own classes are retired
       (download your designs first if you want to keep a copy).</p>${preview}
       <p class="muted">Units already built keep running; every unit of a reset class reboots into the default program.</p>`,
      [
        { label: 'Cancel', value: 'cancel' },
        { label: 'Reset to defaults', value: 'reset', kind: 'danger' },
      ],
    );
    if (value === 'reset') this.load(defaultDesigns(), 'reset');
  }

  /** Brings back the designs saved in this browser, asking about anything that diverged from this build. */
  private async restoreSession(): Promise<void> {
    const text = readStorage();
    if (!text) {
      this.ready = true;
      this.scheduleSave();
      return;
    }
    let saved: DesignFile;
    try {
      saved = parseDesignFile(JSON.parse(text));
    } catch {
      this.host.notify('Your saved designs could not be read; starting from the defaults.', false);
      this.ready = true;
      return; // keep the unreadable copy until the next change overwrites it
    }
    // An earlier save made before the programs had arrived left default classes with empty
    // programs, which would switch every unit of the class off: use the default instead.
    saved = {
      ...saved,
      classes: saved.classes.map((c) => {
        const template = DEFAULT_DESIGNS.get(c.name);
        return template && !c.program.trim() && template.program.trim() ? { ...c, program: template.program } : c;
      }),
    };
    const classified = classifyDesigns(saved);
    const needChoice = classified.filter((c) => c.status === 'conflict' || c.status === 'invalid');
    let mine = new Set<string>(needChoice.map((c) => c.entry.name));
    if (needChoice.length) {
      const { value, form } = await dialog(
        'Your saved designs differ from this version',
        `<p>Some of the designs saved in this browser were made for a different version of the game. Choose which to keep:</p>
         ${choiceTable(needChoice)}`,
        [
          { label: 'Use all new defaults', value: 'defaults' },
          { label: 'Keep all mine', value: 'mine' },
          { label: 'Apply my choices', value: 'apply', kind: 'primary' },
        ],
      );
      if (value === 'defaults') mine = new Set();
      else if (value === 'apply') mine = chosenMine(form, needChoice);
    }
    const entries = resolveDesigns(classified, (name) => mine.has(name));
    if (this.plan(entries, true) === '') {
      // Nothing differs from what the server just gave us.
      this.ready = true;
      this.scheduleSave();
      return;
    }
    this.load(entries, 'session');
  }

  private load(classes: DesignEntry[], reason: 'session' | 'upload' | 'reset', merge = false): void {
    this.ready = false; // don't save a half-applied set
    this.host.send({ t: 'loadDesigns', classes, reason, merge });
  }

  /**
   * A short summary of what loading `entries` would change, compared with the
   * player's current classes (mirrors Simulation.loadDesigns). Empty if nothing.
   */
  private plan(entries: readonly DesignEntry[], quiet = false): string {
    const current = this.state.blueprints.ownedBy(this.state.myId).filter((b) => !b.retired);
    const byName = new Map(current.map((b) => [b.name, b]));
    const updated: string[] = [];
    const added: string[] = [];
    const retiredNow: string[] = [];
    const restored: string[] = [];
    const named = new Set(entries.map((e) => e.name));
    for (const e of entries) {
      const bp = byName.get(e.name);
      if (e.retired) {
        if (bp) retiredNow.push(e.name);
        continue;
      }
      if (!bp) {
        const old = this.state.blueprints.ownedBy(this.state.myId).find((b) => b.name === e.name);
        (old ? restored : added).push(e.name);
      } else if (designHash(bp.parts, this.state.programs.get(bp.id) ?? '') !== designHash(e.parts, e.program)) {
        updated.push(e.name);
      }
    }
    for (const b of current) if (!named.has(b.name) && !DEFAULT_DESIGNS.has(b.name)) retiredNow.push(b.name);
    const line = (label: string, names: string[]) =>
      names.length ? `<li>${label} (${names.length}): ${names.map(esc).join(', ')}</li>` : '';
    const items = [
      line('Changed', updated),
      line('Added', added),
      line('Brought back', restored),
      line('Retired', retiredNow),
    ].join('');
    if (!items) return quiet ? '' : '<p class="muted">Nothing would change: your current designs already match.</p>';
    return `<ul class="design-plan">${items}</ul>`;
  }

  /**
   * False while class programs are missing altogether (a fresh welcome clears them and the
   * server resends them after the class list): saving then would store empty programs.
   */
  private programsLoaded(): boolean {
    const mine = this.state.blueprints.ownedBy(this.state.myId);
    return this.state.programs.size > 0 || !mine.some((b) => b.stats.cyclesPerTick > 0 && !b.retired);
  }

  private scheduleSave(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      if (!this.ready || this.state.spectating || !this.programsLoaded()) return;
      if (!writeStorage(JSON.stringify(this.snapshot())) && this.storageWorks) {
        this.storageWorks = false;
        this.host.notify('This browser won’t store your designs; use Download designs to keep a copy.', false);
      }
    }, SAVE_DELAY_MS);
  }
}
