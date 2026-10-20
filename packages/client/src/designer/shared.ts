import type { BlueprintStats } from '@wst/engine';
import { isFlowSource } from '@wst/engine';
import type { Draft } from '../flow/FlowDocument';
import type { ClientState } from '../state';

export interface DesignerActions {
  defineClass(name: string, parts: string[]): void;
  uploadProgram(blueprint: number, source: string): void;
  retireClass(blueprint: number, retired: boolean): void;
  /** Image of a (possibly unsaved) design at `pxPerTile` pixels per map tile, in the player's colours or a rival's. */
  preview(parts: readonly string[], pxPerTile: number, rival?: boolean): Promise<string>;
  iconFor(blueprint: number): Promise<string>;
  /** When given, the designer shows buttons to download, upload and reset the saved set of classes (the offline designer; in a match they live on the menu). */
  designFiles?: { download(): void; upload(file: File): void; reset(): void };
}

export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Uploaded versions kept per class; saved in the browser so they survive reloads. */
const HISTORY_LIMIT = 12;
/** Versions saved with the old text language are not shown; this key starts a fresh history. */
const HISTORY_KEY = 'wst-program-history-2';

export interface Version {
  readonly source: string;
  readonly at: Date;
}

/** Saved history, keyed by class name and parts (blueprint ids change between sessions). */
function loadStoredHistory(): Record<string, { source: string; at: string }[]> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '{}');
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, { source: string; at: string }[]>) : {};
  } catch {
    return {};
  }
}

/** Uploaded program versions per class, oldest first, persisted in the browser. */
export class ProgramHistory {
  private readonly versions = new Map<number, Version[]>();
  private readonly stored = loadStoredHistory();

  constructor(private readonly state: ClientState) {}

  remember(blueprint: number, source: string): void {
    const list = this.versionsOf(blueprint);
    if (list.at(-1)?.source === source) return;
    list.push({ source, at: new Date() });
    if (list.length > HISTORY_LIMIT) list.shift();
    const key = this.keyOf(blueprint);
    if (!key) return;
    this.stored[key] = list.map((v) => ({ source: v.source, at: v.at.toISOString() }));
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(this.stored));
    } catch {
      // storage full or unavailable: history just lasts for this session
    }
  }

  /** A class's versions, oldest first, seeded from the browser's saved history the first time it is needed. */
  versionsOf(blueprint: number): Version[] {
    let list = this.versions.get(blueprint);
    if (!list) {
      const key = this.keyOf(blueprint);
      list = (key ? (this.stored[key] ?? []) : [])
        .filter((v) => typeof v.source === 'string' && isFlowSource(v.source))
        .map((v) => ({ source: v.source, at: new Date(v.at) }));
      this.versions.set(blueprint, list);
    }
    return list;
  }

  private keyOf(blueprint: number): string | undefined {
    const bp = this.state.blueprints.get(blueprint);
    return bp ? `${bp.name}|${bp.parts.join(',')}` : undefined;
  }
}

/**
 * What the Design and Code tabs share. The designer shell owns it; the tabs read and edit it
 * through this interface and ask the shell to `refresh()` after a change.
 */
export interface DesignerModel {
  readonly state: ClientState;
  readonly actions: DesignerActions;
  readonly history: ProgramHistory;
  /** Existing class being viewed, or -1 for the new design draft. */
  selected: number;
  /** Modules of the unsaved draft (index 0 is the chassis). */
  draft: string[];
  draftName: string;
  /** Program of the unsaved draft. */
  draftProgram: Draft;
  /** Unsaved edits per class (the program text and its graph layout); server-confirmed sources live in ClientState.programs. */
  readonly edits: Map<number, Draft>;
  /** Derived stats of the design on show, or undefined if it is invalid (see `statsError`). */
  readonly stats: BlueprintStats | undefined;
  readonly statsError: string;
  /** True while the design on show is the editable draft rather than an existing class. */
  readonly editable: boolean;
  /** Modules of the design on show. */
  currentParts(): readonly string[];
  showResult(text: string, ok: boolean): void;
  /** Re-derives stats and redraws every tab. */
  refresh(): void;
  /** Shows an existing class (or the draft with -1). */
  select(id: number): void;
  newDesign(parts?: string[], name?: string, program?: Draft): void;
}
