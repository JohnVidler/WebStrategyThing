import { isFlowSource } from '../flow/ir';
import { compileUnitProgram } from './actions';
import { deriveStats } from './blueprint';
import { NEW_CLASS_PROGRAM, STARTER_CLASSES, type ClassTemplate } from './content';

/*
 * Design files: a player's classes (parts + program) as plain JSON, used to keep
 * designs in the browser between sessions and to download/upload them.
 *
 *   {
 *     "format": "wst-designs", "version": 1,
 *     "build": "<fingerprint of the default classes this was saved against>",
 *     "savedAt": "2026-10-13T20:00:00.000Z",
 *     "classes": [
 *       { "name": "Scout", "parts": ["chassis.light", ...], "program": "...",
 *         "retired": false, "base": "<hash of the default 'Scout' when saved>" }
 *     ]
 *   }
 *
 * `base` lets a later build tell "the player changed this default" apart from
 * "the default itself changed upstream since this was saved".
 */

export const DESIGN_FORMAT = 'wst-designs';
export const DESIGN_VERSION = 2;
export const MAX_DESIGNS = 80;

export interface DesignEntry {
  readonly name: string;
  readonly parts: readonly string[];
  readonly program: string;
  readonly retired?: boolean;
  /** For classes named like a default: hash of that default when the file was saved. */
  readonly base?: string | null;
}

export interface DesignFile {
  readonly format: typeof DESIGN_FORMAT;
  readonly version: number;
  readonly build: string;
  readonly savedAt: string;
  /** Git hash of the game build the player last accepted these designs under ('' if unknown). */
  readonly game: string;
  readonly classes: readonly DesignEntry[];
  /** Classes whose old-language program (a version 1 file) was replaced by a default or the new-class starter. */
  readonly migrated?: readonly string[];
}

export class DesignFileError extends Error {}

/** FNV-1a over a string, as 8 hex digits. */
function fnv(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Identity of a design's content (parts and program; the name and retired flag don't count). */
export function designHash(parts: readonly string[], program: string): string {
  return fnv(JSON.stringify([parts, program.replace(/\r\n/g, '\n').trimEnd()]));
}

export const DEFAULT_DESIGNS: ReadonlyMap<string, ClassTemplate> = new Map(STARTER_CLASSES.map((c) => [c.name, c]));

/** Hash of the current default with this name, or undefined if it isn't a default class. */
export function defaultHash(name: string): string | undefined {
  const c = DEFAULT_DESIGNS.get(name);
  return c ? designHash(c.parts, c.program) : undefined;
}

/** Fingerprint of the whole default set: changes whenever any default design changes. */
export const DESIGNS_BUILD = fnv(STARTER_CLASSES.map((c) => `${c.name}:${designHash(c.parts, c.program)}`).join('|'));

export function makeDesignFile(classes: readonly Omit<DesignEntry, 'base'>[], game = ''): DesignFile {
  return {
    format: DESIGN_FORMAT,
    version: DESIGN_VERSION,
    build: DESIGNS_BUILD,
    savedAt: new Date().toISOString(),
    game,
    classes: classes.map((c) => ({
      name: c.name,
      parts: [...c.parts],
      program: c.program,
      retired: c.retired === true,
      base: defaultHash(c.name) ?? null,
    })),
  };
}

/** The current defaults as design entries (what "reset to defaults" restores). */
export function defaultDesigns(): DesignEntry[] {
  return STARTER_CLASSES.map((c) => ({ name: c.name, parts: [...c.parts], program: c.program, retired: false }));
}

/** Validates the shape of a design file (from storage or an upload). Throws DesignFileError. */
export function parseDesignFile(raw: unknown): DesignFile {
  const f = raw as Partial<DesignFile> | null;
  if (typeof f !== 'object' || f === null || f.format !== DESIGN_FORMAT) throw new DesignFileError('Not a WebStrategyThing design file');
  if (typeof f.version !== 'number' || f.version > DESIGN_VERSION) throw new DesignFileError(`Unsupported design file version ${String(f.version)}`);
  if (!Array.isArray(f.classes) || f.classes.length > MAX_DESIGNS) throw new DesignFileError(`A design file holds 0-${MAX_DESIGNS} classes`);
  const migrated: string[] = [];
  const classes = f.classes.map((c: Partial<DesignEntry>, i: number) => {
    if (typeof c?.name !== 'string' || !c.name.trim() || c.name.length > 24) throw new DesignFileError(`Class ${i + 1}: bad name`);
    if (!Array.isArray(c.parts) || !c.parts.every((p) => typeof p === 'string')) throw new DesignFileError(`${c.name}: bad parts list`);
    if (c.program !== undefined && typeof c.program !== 'string') throw new DesignFileError(`${c.name}: program must be text`);
    let program = c.program ?? '';
    if (f.version! < 2 && program.trim() && !isFlowSource(program)) {
      // A program in the old text language (files from before flowcode): replace it with the
      // default of that name, or the new-class starter. The old text is not kept in the entry.
      migrated.push(c.name.trim());
      program = DEFAULT_DESIGNS.get(c.name.trim())?.program ?? NEW_CLASS_PROGRAM;
    }
    return {
      name: c.name.trim(),
      parts: [...c.parts],
      program,
      retired: c.retired === true,
      base: typeof c.base === 'string' ? c.base : null,
    };
  });
  return {
    format: DESIGN_FORMAT,
    version: DESIGN_VERSION,
    build: typeof f.build === 'string' ? f.build : '',
    savedAt: typeof f.savedAt === 'string' ? f.savedAt : '',
    game: typeof f.game === 'string' ? f.game : '',
    classes,
    ...(migrated.length ? { migrated } : {}),
  };
}

/**
 * How a saved design relates to this build:
 *  - default: identical to the current default of that name
 *  - modified: the player's edit of the current default (keep it)
 *  - custom: the player's own class (no default of that name)
 *  - outdated: an unmodified copy of an older default (take the new default)
 *  - conflict: the player changed a default that has since changed upstream (ask)
 *  - invalid: doesn't build or compile here (parts removed, API changed, ...)
 */
export type DesignStatus = 'default' | 'modified' | 'custom' | 'outdated' | 'conflict' | 'invalid';

export interface ClassifiedDesign {
  readonly entry: DesignEntry;
  readonly status: DesignStatus;
  /** Why it is invalid. */
  readonly problem?: string;
  /** The current default with the same name, if any. */
  readonly fallback?: DesignEntry;
}

export function classifyDesigns(file: DesignFile): ClassifiedDesign[] {
  return file.classes.map((entry) => {
    const template = DEFAULT_DESIGNS.get(entry.name);
    const fallback = template
      ? { name: template.name, parts: [...template.parts], program: template.program, retired: entry.retired }
      : undefined;
    try {
      const stats = deriveStats(entry.parts);
      if (entry.program.trim() && stats.cyclesPerTick > 0) {
        const p = compileUnitProgram(entry.program);
        if (p.slots > stats.memorySlots) throw new Error(`program needs ${p.slots} variables, the class has ${stats.memorySlots}`);
      }
    } catch (err) {
      return { entry, status: 'invalid', problem: (err as Error).message, fallback };
    }
    if (!template) return { entry, status: 'custom' };
    const hash = designHash(entry.parts, entry.program);
    const current = designHash(template.parts, template.program);
    if (hash === current) return { entry, status: 'default', fallback };
    // No base recorded (hand-written file): judge by the file's build.
    const base = entry.base ?? (file.build === DESIGNS_BUILD ? current : null);
    if (base === current) return { entry, status: 'modified', fallback };
    if (base !== null && hash === base) return { entry, status: 'outdated', fallback };
    return { entry, status: 'conflict', fallback };
  });
}

/**
 * The entries to load: conflicts use the player's choice (`keepMine` by class
 * name), outdated defaults take the new default, invalid classes fall back to
 * the default of the same name or are left out.
 */
export function resolveDesigns(classified: readonly ClassifiedDesign[], keepMine: (name: string) => boolean): DesignEntry[] {
  const out: DesignEntry[] = [];
  for (const c of classified) {
    if (c.status === 'outdated' || c.status === 'invalid') {
      if (c.fallback) out.push(c.fallback);
    } else if (c.status === 'conflict') {
      out.push(keepMine(c.entry.name) ? c.entry : c.fallback!);
    } else {
      out.push(c.entry);
    }
  }
  return out;
}
