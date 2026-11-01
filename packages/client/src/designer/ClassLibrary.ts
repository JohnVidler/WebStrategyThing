import { TIER_NAMES } from '@wst/engine';
import { esc, type DesignerModel } from './shared';

type Kind = 'units' | 'buildings';
const KIND_KEY = 'wst-designer-library';

/**
 * The full-screen grid of the player's classes that the designer opens on: one tab for units, one
 * for buildings, each split by body size (units) or footprint (buildings). Picking a card (or
 * "New design") hands over to the Design and Code tabs; the top bar's class chip comes back here.
 */
export class ClassLibrary {
  readonly element: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private readonly search: HTMLInputElement;
  private readonly retired: HTMLInputElement;
  private readonly tabs: Record<Kind, HTMLButtonElement>;
  private readonly back: HTMLButtonElement;
  private readonly icons = new Map<number, string>();
  private kind: Kind = loadKind();

  constructor(
    private readonly m: DesignerModel,
    /** Called after a class (or "New design") was picked. */
    private readonly onPick: () => void,
    /** Called by the Back button. */
    private readonly onBack: () => void,
  ) {
    this.element = document.createElement('div');
    this.element.className = 'designer-library';
    this.element.hidden = true;
    this.element.innerHTML = `
      <div class="library-head">
        <button data-role="back" class="library-back" hidden></button>
        <nav class="library-tabs" role="tablist">
          <button role="tab" data-kind="units" data-sound="menu.click"></button>
          <button role="tab" data-kind="buildings" data-sound="menu.click"></button>
        </nav>
        <input data-role="search" type="search" placeholder="Search classes…  ( / )" aria-label="Search your classes">
        <label class="fits-only"><input type="checkbox" data-role="retired"> Show retired</label>
      </div>
      <div data-role="body" class="library-body"></div>`;
    const q = <T extends HTMLElement>(role: string) => this.element.querySelector<T>(`[data-role="${role}"]`)!;
    this.body = q('body');
    this.search = q('search');
    this.retired = q('retired');
    this.back = q('back');
    this.tabs = {
      units: this.element.querySelector('[data-kind="units"]')!,
      buildings: this.element.querySelector('[data-kind="buildings"]')!,
    };
    for (const kind of ['units', 'buildings'] as Kind[]) this.tabs[kind].onclick = () => this.setKind(kind);
    this.search.oninput = () => this.render();
    this.retired.onchange = () => this.render();
    this.back.onclick = () => onBack();
    this.search.onkeydown = (ev) => {
      if (ev.key === 'Escape' && this.search.value) {
        ev.stopPropagation();
        this.search.value = '';
        this.render();
      }
    };
  }

  focusSearch(): void {
    this.search.focus();
    this.search.select();
  }

  /** Opens on the tab holding the class being worked on, if any. */
  showKindOf(id: number): void {
    const bp = this.m.state.blueprints.get(id);
    if (bp) this.setKind(bp.stats.structure ? 'buildings' : 'units');
  }

  /** `backTo` names the class the Back button returns to; undefined hides the button. */
  render(backTo?: string | null): void {
    const { m } = this;
    if (backTo !== undefined) {
      this.back.hidden = backTo === null;
      this.back.textContent = `← Back to ${backTo ?? ''}`;
    }
    const needle = this.search.value.trim().toLowerCase();
    const all = m.state.blueprints.ownedBy(m.state.myId).filter((b) => this.retired.checked || !b.retired);
    const units = all.filter((b) => !b.stats.structure);
    const buildings = all.filter((b) => b.stats.structure);
    this.tabs.units.innerHTML = `Units <small>${units.length}</small>`;
    this.tabs.buildings.innerHTML = `Buildings <small>${buildings.length}</small>`;
    for (const kind of ['units', 'buildings'] as Kind[]) {
      this.tabs[kind].classList.toggle('active', kind === this.kind);
      this.tabs[kind].setAttribute('aria-selected', String(kind === this.kind));
    }

    const list = (this.kind === 'units' ? units : buildings).filter((b) => !needle || b.name.toLowerCase().includes(needle));
    // Sections by body size (units) or footprint (buildings), smallest first.
    const sectionOf = (b: (typeof list)[number]) => (this.kind === 'units' ? b.stats.size : b.stats.footprint);
    const titleOf = (key: number) => (this.kind === 'units' ? `${TIER_NAMES[key] ?? `Size ${key}`} bodies` : `${key}×${key} tiles`);
    const keys = [...new Set(list.map(sectionOf))].sort((a, b) => a - b);

    this.body.innerHTML = '';
    const fresh = document.createElement('button');
    fresh.className = 'library-card library-new primary';
    fresh.innerHTML = `<span class="library-plus" aria-hidden="true">＋</span><b>New design</b><small>Start a new ${this.kind === 'units' ? 'unit' : 'building'} from scratch</small>`;
    fresh.onclick = () => {
      m.newDesign();
      this.onPick();
    };
    const top = document.createElement('div');
    top.className = 'library-grid';
    top.appendChild(fresh);
    this.body.appendChild(top);

    for (const key of keys) {
      const group = list.filter((b) => sectionOf(b) === key);
      const section = document.createElement('section');
      section.className = 'library-section';
      section.innerHTML = `<h3>${esc(titleOf(key))} · ${group.length}</h3>`;
      const grid = document.createElement('div');
      grid.className = 'library-grid';
      for (const bp of group) {
        const card = document.createElement('button');
        card.className = `library-card${bp.id === m.selected ? ' active' : ''}${bp.retired ? ' retired' : ''}`;
        card.title = bp.name;
        const img = document.createElement('img');
        img.alt = '';
        const cached = this.icons.get(bp.id);
        if (cached) img.src = cached;
        else
          m.actions
            .iconFor(bp.id)
            .then((src) => {
              this.icons.set(bp.id, src);
              img.src = src;
            })
            .catch(() => img.remove());
        const info = document.createElement('span');
        info.innerHTML = `<b>${esc(bp.name)}</b><small>${bp.stats.cyclesPerTick ? `${bp.stats.cyclesPerTick} c/t` : 'no CPU'} · ◆${bp.stats.cost}${bp.retired ? ' · retired' : ''}</small>`;
        card.append(img, info);
        card.onclick = () => {
          m.select(bp.id);
          this.onPick();
        };
        grid.appendChild(card);
      }
      section.appendChild(grid);
      this.body.appendChild(section);
    }
    if (!keys.length) {
      const note = document.createElement('div');
      note.className = 'palette-note';
      note.textContent = needle ? 'No class matches.' : `You have no ${this.kind} yet.`;
      this.body.appendChild(note);
    }
  }

  private setKind(kind: Kind): void {
    this.kind = kind;
    try {
      sessionStorage.setItem(KIND_KEY, kind);
    } catch {
      // not remembered
    }
    this.render();
  }
}

function loadKind(): Kind {
  try {
    return sessionStorage.getItem(KIND_KEY) === 'buildings' ? 'buildings' : 'units';
  } catch {
    return 'units';
  }
}
