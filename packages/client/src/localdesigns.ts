import {
  BlueprintError,
  classifyDesigns,
  CompileError,
  compileUnitProgram,
  defaultDesigns,
  parseDesignFile,
  resolveDesigns,
  type DesignEntry,
} from '@wst/engine';
import { Application } from 'pixi.js';
import { renderClassImage } from './artstudio';
import type { Designer } from './designer';
import { readStorage, snapshotDesigns, writeStorage } from './designs';
import { ownerColour } from './renderer';
import { ClientState } from './state';

/** The player's id in the offline designer; a rival's colour is the next one along. */
const ME = 1;

/**
 * The class designer without a match: the player's saved designs (the same ones
 * a match restores when they join) are loaded into a local class registry, and
 * every change is checked here and saved straight back. Used from the main menu.
 */
export class LocalDesigns {
  readonly state = new ClientState();
  private designer: Designer | undefined;

  constructor() {
    this.state.myId = ME;
    this.apply(this.saved() ?? defaultDesigns());
  }

  /** The designs saved in this browser; classes whose defaults changed since keep the player's version. */
  private saved(): DesignEntry[] | undefined {
    const text = readStorage();
    if (!text) return undefined;
    try {
      return resolveDesigns(classifyDesigns(parseDesignFile(JSON.parse(text))), () => true);
    } catch {
      return undefined;
    }
  }

  private apply(entries: readonly DesignEntry[]): void {
    for (const e of entries) {
      try {
        const bp = this.state.blueprints.define(ME, e.name, e.parts);
        bp.retired = e.retired === true;
        if (e.program) {
          this.state.blueprints.setProgram(bp.id, compileUnitProgram(e.program));
          this.state.programs.set(bp.id, e.program);
        }
      } catch (err) {
        if (!(err instanceof BlueprintError || err instanceof CompileError)) throw err;
      }
    }
  }

  private save(): void {
    writeStorage(JSON.stringify(snapshotDesigns(this.state)));
  }

  /** Called when the designer is closed, whether by its own controls or by `close()`. */
  onClose?: () => void;

  close(): void {
    this.designer?.toggle(false);
  }

  /** Opens the designer over the whole page; closing it just hides it again. */
  async open(): Promise<void> {
    if (!this.designer) {
      const [{ Designer }, studio] = await Promise.all([import('./designer'), this.studio()]);
      const host = document.createElement('div');
      host.id = 'lobby-designer';
      document.body.appendChild(host);
      this.designer = new Designer(host, this.state, {
        defineClass: (name, parts) => {
          try {
            this.state.blueprints.define(ME, name, parts);
          } catch (err) {
            if (!(err instanceof BlueprintError)) throw err;
            this.designer?.showResult(err.message, false);
            return;
          }
          this.designer?.updateClasses();
          this.save();
        },
        uploadProgram: (blueprint, source) => {
          try {
            this.state.blueprints.setProgram(blueprint, compileUnitProgram(source));
          } catch (err) {
            if (!(err instanceof CompileError || err instanceof BlueprintError)) throw err;
            this.designer?.showResult(err.message, false);
            return;
          }
          this.state.programs.set(blueprint, source);
          this.designer?.setSource(blueprint, source);
          this.designer?.showResult('Program saved.', true);
          this.save();
        },
        retireClass: (blueprint, retired) => {
          const bp = this.state.blueprints.get(blueprint);
          if (!bp) return;
          bp.retired = retired;
          this.designer?.updateClasses();
          this.save();
        },
        preview: (parts, pxPerTile, rival) => renderClassImage(studio.renderer, parts, ownerColour(rival ? ME + 1 : ME), () => pxPerTile / 32),
        iconFor: (blueprint) => {
          const bp = this.state.blueprints.get(blueprint)!;
          return renderClassImage(studio.renderer, bp.parts, ownerColour(ME), (w, h) => 36 / Math.max(w, h));
        },
      });
    }
    this.designer.onClose = () => this.onClose?.();
    this.designer.toggle(true);
  }

  private studioApp: Application | undefined;

  /** An off-screen Pixi renderer, only used to draw class art for previews and icons. */
  private async studio(): Promise<Application> {
    if (!this.studioApp) {
      const app = new Application();
      await app.init({ width: 8, height: 8, background: '#0e1116', antialias: true });
      this.studioApp = app;
    }
    return this.studioApp;
  }
}
