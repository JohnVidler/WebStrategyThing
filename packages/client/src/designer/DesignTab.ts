import { GENERATION_SCALE, PART_LIST, PARTS, TILE, type PartDef, type PartSlot } from '@wst/engine';
import { esc, type DesignerModel } from './shared';

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

/**
 * The Design tab: class list, preview and stats, installed modules (drag to reorder),
 * and the module catalogue. It edits the shell's draft and asks the shell to refresh.
 */
export class DesignTab {
  readonly panel: HTMLDivElement;
  private readonly classList: HTMLDivElement;
  private readonly nameInput: HTMLInputElement;
  private readonly preview: HTMLImageElement;
  private readonly previewOwn: HTMLImageElement;
  private readonly previewRival: HTMLImageElement;
  private readonly previewNote: HTMLDivElement;
  private readonly statsView: HTMLDivElement;
  private readonly partsView: HTMLOListElement;
  private readonly slotsView: HTMLSpanElement;
  private readonly palette: HTMLDivElement;
  private previewToken = 0;
  /** Index of the module being dragged in the installed list. */
  private dragging = -1;

  constructor(private readonly m: DesignerModel) {
    this.panel = document.createElement('div');
    this.panel.className = 'designer-panel designer-tab-design';
    this.panel.dataset.tab = 'design';
    this.panel.innerHTML = `
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
      </section>
      <section class="designer-catalogue">
        <h2>Module catalogue</h2>
        <div data-role="palette" class="palette"></div>
      </section>`;

    const q = <T extends HTMLElement>(role: string) => this.panel.querySelector<T>(`[data-role="${role}"]`)!;
    this.classList = q('classes');
    this.nameInput = q('name');
    this.preview = q('preview');
    this.previewOwn = q('preview-own');
    this.previewRival = q('preview-rival');
    this.previewNote = q('preview-note');
    this.statsView = q('stats');
    this.partsView = q('parts');
    this.slotsView = q('slots');
    this.palette = q('palette');

    q<HTMLButtonElement>('new').onclick = () => m.newDesign();
    this.nameInput.oninput = () => {
      if (m.selected < 0) m.draftName = this.nameInput.value;
    };
  }

  /** Redraws everything that depends on the design on show. */
  render(): void {
    const { m } = this;
    const parts = m.currentParts();
    const editable = m.editable;
    const bp = m.state.blueprints.get(m.selected);
    this.nameInput.value = editable ? m.draftName : (bp?.name ?? '');
    this.nameInput.readOnly = !editable;
    this.renderStats();
    this.renderParts(parts, editable);
    this.renderPalette(parts, editable);
    this.renderPreview();
  }

  renderClassList(): void {
    const { m } = this;
    const mine = m.state.blueprints.ownedBy(m.state.myId);
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
        btn.className = `class-item${bp.id === m.selected ? ' active' : ''}${bp.retired ? ' retired' : ''}`;
        const img = document.createElement('img');
        img.alt = '';
        m.actions.iconFor(bp.id).then((src) => (img.src = src)).catch(() => img.remove());
        const label = document.createElement('span');
        label.innerHTML = `${esc(bp.name)}<small>${bp.stats.cyclesPerTick ? `${bp.stats.cyclesPerTick} c/t` : 'no CPU'} · ◆${bp.stats.cost}</small>`;
        btn.append(img, label);
        btn.onclick = () => m.select(bp.id);
        this.classList.appendChild(btn);
      }
    }
  }

  private renderStats(): void {
    const s = this.m.stats;
    if (!s) {
      this.statsView.innerHTML = `<div class="bad">${esc(this.m.statsError)}</div>`;
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
    this.slotsView.textContent = frame?.slots ? `${used}/${frame.slots} slots` : '';
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
          const [moved] = this.m.draft.splice(from, 1);
          this.m.draft.splice(i, 0, moved);
          this.m.refresh();
        };
        const rm = document.createElement('button');
        rm.textContent = '✕';
        rm.title = 'Remove';
        rm.onclick = () => {
          this.m.draft.splice(i, 1);
          this.m.refresh();
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
    this.m.draft.push(p.id);
    this.m.refresh();
  }

  /** Swaps the chassis/frame; modules that no longer fit are dropped. */
  private setFrame(p: PartDef): void {
    const structure = p.structure === true;
    const kept = this.m.draft.slice(1).filter((id) => (structure ? !PARTS[id].mobileOnly : !PARTS[id].structureOnly));
    const dropped = this.m.draft.length - 1 - kept.length;
    this.m.draft = [p.id, ...kept.slice(0, p.slots ?? kept.length)];
    if (dropped) this.m.showResult(`Removed ${dropped} module(s) that don't fit a ${structure ? 'building' : 'unit'}.`, false);
    this.m.refresh();
  }

  /** Large view, plus true-size thumbnails in own and rival colours to judge how it reads on the map. */
  private renderPreview(): void {
    const token = ++this.previewToken;
    const s = this.m.stats;
    if (!s) {
      for (const img of [this.preview, this.previewOwn, this.previewRival]) img.removeAttribute('src');
      this.previewNote.textContent = 'Invalid design';
      return;
    }
    this.previewNote.textContent = s.structure ? `${s.footprint}×${s.footprint} building` : s.flying ? 'flying unit' : 'ground unit';
    const parts = this.m.currentParts();
    // The same scale for every design, so body sizes compare directly.
    const views: [HTMLImageElement, number, boolean][] = [[this.preview, 64, false], [this.previewOwn, 32, false], [this.previewRival, 32, true]];
    for (const [img, pxPerTile, rival] of views) {
      this.m.actions
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
