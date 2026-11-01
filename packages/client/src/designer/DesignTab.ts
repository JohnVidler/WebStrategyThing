import { GENERATION_SCALE, LIGHT_TILES_PER_ENERGY, STEAM_GENERATION_MULTIPLIER, PART_LIST, PARTS, TIER_NAMES, TILE, type PartDef, type PartSlot } from '@wst/engine';
import { partIcon } from './partIcons';
import { esc, type DesignerModel } from './shared';


/** Module palette groups, in display order. Chassis are split into unit bodies and building frames. */
const CATEGORIES: { title: string; match: (p: PartDef) => boolean }[] = [
  { title: 'Unit bodies', match: (p) => p.slot === 'chassis' && !p.structure },
  { title: 'Building frames', match: (p) => p.slot === 'chassis' && p.structure === true },
  { title: 'Compute', match: (p) => p.slot === 'cpu' || p.slot === 'memory' },
  { title: 'Movement', match: (p) => p.slot === 'motor' },
  { title: 'Weapons & armour', match: (p) => p.slot === 'weapon' || p.slot === 'armor' || p.slot === 'shield' || p.slot === 'smoke' || p.slot === 'defence' },
  { title: 'Sensors, radar & lights', match: (p) => p.slot === 'sensor' || p.slot === 'radar' || p.slot === 'light' },
  { title: 'Radio & laser links', match: (p) => p.slot === 'comms' },
  { title: 'Industry', match: (p) => (['cargo', 'builder', 'repair', 'factory', 'depot', 'hangar'] as PartSlot[]).includes(p.slot) },
  { title: 'Power', match: (p) => (['battery', 'charger', 'generator', 'antenna'] as PartSlot[]).includes(p.slot) },
];

/**
 * The Design tab: class list, preview and stats, installed modules (drag to reorder),
 * and the module catalogue. It edits the shell's draft and asks the shell to refresh.
 */
export class DesignTab {
  readonly panel: HTMLDivElement;
  private readonly search: HTMLInputElement;
  private readonly fitsOnly: HTMLInputElement;
  private readonly chips: HTMLDivElement;
  private readonly tiles: HTMLDivElement;
  /** Category chip on show: an index into CATEGORIES, or -1 for all of them. */
  private category = -1;
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
      <section class="designer-design">
        <div class="design-head">
          <div class="preview">
            <div class="preview-stage">
              <img data-role="preview" alt="">
              <div data-role="preview-note" class="preview-note muted"></div>
              <div class="preview-small"><img data-role="preview-own" alt="" title="In-game size, your colours"><img data-role="preview-rival" alt="" title="In-game size, a rival's colours"></div>
            </div>
          </div>
          <div class="design-meta">
            <input data-role="name" maxlength="24" placeholder="Class name" aria-label="Class name">
            <div data-role="tiles" class="stat-tiles"></div>
          </div>
        </div>
        <details class="all-stats"><summary>All stats</summary><div data-role="stats" class="stats-grid"></div></details>
        <h2>Installed modules <span data-role="slots" class="slot-count"></span></h2>
        <ol data-role="parts" class="installed" start="0"></ol>
      </section>
      <section class="designer-catalogue">
        <div class="catalogue-bar">
          <input data-role="search" type="search" placeholder="Search modules…  ( / )" aria-label="Search modules">
          <label class="fits-only" title="Hide modules this chassis can't carry"><input type="checkbox" data-role="fits" checked> Only what fits</label>
          <div data-role="chips" class="chips" role="group" aria-label="Module category"></div>
        </div>
        <div data-role="palette" class="palette"></div>
      </section>`;

    const q = <T extends HTMLElement>(role: string) => this.panel.querySelector<T>(`[data-role="${role}"]`)!;
    this.search = q('search');
    this.fitsOnly = q('fits');
    this.chips = q('chips');
    this.tiles = q('tiles');
    this.nameInput = q('name');
    this.preview = q('preview');
    this.previewOwn = q('preview-own');
    this.previewRival = q('preview-rival');
    this.previewNote = q('preview-note');
    this.statsView = q('stats');
    this.partsView = q('parts');
    this.slotsView = q('slots');
    this.palette = q('palette');

    this.search.oninput = () => this.renderPalette(this.m.currentParts(), this.m.editable);
    this.fitsOnly.onchange = () => this.renderPalette(this.m.currentParts(), this.m.editable);
    this.search.onkeydown = (ev) => {
      if (ev.key === 'Escape' && this.search.value) {
        ev.stopPropagation();
        this.search.value = '';
        this.renderPalette(this.m.currentParts(), this.m.editable);
      }
    };
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

  /** The module search box, for the `/` shortcut. */
  focusSearch(): void {
    this.search.focus();
    this.search.select();
  }

  private renderStats(): void {
    const s = this.m.stats;
    if (!s) {
      this.statsView.innerHTML = `<div class="bad">${esc(this.m.statsError)}</div>`;
      this.tiles.innerHTML = `<div class="bad stat-error">${esc(this.m.statsError)}</div>`;
      return;
    }
    const tile = (label: string, value: string, hint = '') => `<div class="stat-tile" title="${esc(hint)}"><b>${esc(value)}</b><small>${label}</small></div>`;
    const memory = this.m.programMemory();
    this.tiles.innerHTML =
      tile('cost', `◆${s.cost}`, `Build time ${(s.buildTime / 10).toFixed(1)}s · ϟ${s.buildEnergy} energy`) +
      tile('hit points', String(s.hp)) +
      (s.structure
        ? tile('footprint', `${s.footprint}×${s.footprint}`, `Link reach ${s.linkRange} tiles`)
        : tile('speed', s.speed ? `${((s.speed / TILE) * 10).toFixed(1)}` : '–', s.speed ? 'tiles per second' : 'immobile')) +
      tile('CPU c/t', s.cyclesPerTick ? String(s.cyclesPerTick) : 'none', 'Cycles per tick') +
      tile('memory', `${memory}/${s.memorySlots}`, 'Program memory in use') +
      tile('energy', String(s.energyCapacity));
    const rows: [string, string][] = [
      ['Cost', `◆${s.cost} · ϟ${s.buildEnergy} · ${(s.buildTime / 10).toFixed(1)}s`],
      ['Hit points', String(s.hp)],
      ['Energy', `${s.energyCapacity}`],
      ['CPU', s.cyclesPerTick ? `${s.cyclesPerTick} cycles/tick · ${s.cpuUse} per 100 cycles` : 'none'],
      ['Memory', `program ${this.m.programMemory()}/${s.memorySlots} slots · queue ${s.stackDepth}`],
    ];
    if (s.shield) {
      const deg = (r: number) => Math.round((r * 180) / Math.PI);
      rows.push(['Shield', `${deg(s.shield.arc)}° arc (up to ${deg(s.shield.maxArc)}°) · ${s.shield.range / TILE} tiles out (up to ${s.shield.maxRange / TILE}) · ${s.shield.use} energy/t`]);
    }
    if (s.light) rows.push(['Spotlight', `${s.light.power * LIGHT_TILES_PER_ENERGY} tiles at ${s.light.power} energy/t (up to ${s.light.maxPower * LIGHT_TILES_PER_ENERGY} tiles at ${s.light.maxPower})`]);
    if (s.structure) {
      rows.push(['Footprint', s.shape ? `${s.area} tiles in a ${s.footprint}×${s.footprint} box` : `${s.footprint}×${s.footprint} tiles`], ['Link reach', `${s.linkRange} tiles`]);
      if (s.solar || s.wind) rows.push(['Generation', `☀ ${s.solar / GENERATION_SCALE}/t  ≋ ${s.wind / GENERATION_SCALE}/t (peak)`]);
      if (s.steam) rows.push(['Steam', `♨ ${(s.steam * STEAM_GENERATION_MULTIPLIER) / GENERATION_SCALE}/t on a vent (${s.steamTurbines} turbine${s.steamTurbines === 1 ? '' : 's'}, one vent each)`]);
      if (s.chargeRate) rows.push(['Charging', `${s.chargeRate}/t per unit`]);
      if (s.resourceCapacity) rows.push(['Silos', String(s.resourceCapacity)]);
      if (s.factory) rows.push(['Factory', `${s.factoryUse} energy/t while producing`]);
    } else {
      rows.push(['Speed', s.speed ? `${((s.speed / TILE) * 10).toFixed(1)} tiles/s${s.flying ? ' (flying)' : ''} · ${s.motorUse}/t` : 'immobile']);
      rows.push(['Size', `${TIER_NAMES[s.size]}${s.clearance ? ` · needs a ${2 * s.clearance + 1}-tile-wide way` : ''}`]);
      if (s.legs) rows.push(['Legs', s.climb >= 9 ? 'stride over any rock (half speed on rock)' : `climb ${s.climb} level${s.climb === 1 ? '' : 's'} into rock (half speed on rock)`]);
      if (s.speed && !s.flying) {
        const liquid = s.hover ? 'skims over water and lava (lava scorches it)' : s.wade >= 5 ? 'wades shallow and deep water (slowly)' : s.wade > 0 ? 'wades shallow water (slowly)' : '';
        if (liquid) rows.push(['Liquids', liquid]);
      }
      if (s.sensorRange) rows.push(['Sensor', `${s.sensorRange / TILE} tiles · ${s.sensorUse}/scan`]);
      s.weapons.forEach((w, i) => {
        if (w) rows.push([s.weapons.length > 1 ? `Weapon ${i + 1}` : 'Weapon', `${w.damage} dmg · range ${w.range / TILE} · ${w.use}/shot`]);
      });
      if (s.cargo) rows.push(['Cargo', `${s.cargo} · ${s.harvestRate}/t harvesting`]);
      if (s.buildRate) rows.push(['Build arm', `${s.buildRate}/t · ${s.builderUse} energy/t`]);
      if (s.repairRate) rows.push(['Repair', `${s.repairRate} hp/t · ${s.repairUse} energy/t · ◆${s.repairMatterPerHp.toFixed(2)}/hp to mend this class`]);
    }
    this.statsView.innerHTML = rows.map(([k, v]) => `<span>${k}</span><span>${esc(v)}</span>`).join('');
  }

  private renderParts(parts: readonly string[], editable: boolean): void {
    const frame = PARTS[parts[0]];
    const used = parts.length - 1;
    const slots = frame?.slots;
    this.slotsView.innerHTML = slots
      ? `${used}/${slots}<span class="slot-meter" aria-hidden="true"><i style="width:${Math.min(100, (100 * used) / slots)}%"></i></span>`
      : '';
    this.slotsView.classList.toggle('full', slots !== undefined && used >= slots);
    this.partsView.innerHTML = '';
    parts.forEach((id, i) => {
      const def = PARTS[id];
      const li = document.createElement('li');
      li.classList.toggle('frame', i === 0);
      li.innerHTML = `<span class="idx">${i === 0 ? '▣' : i}</span>${partIcon(def)}<span class="nm">${esc(def?.name ?? id)}</span><span class="muted desc">${esc(def?.description ?? '')}</span>`;
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
        rm.title = `Remove ${def?.name ?? id}`;
        rm.setAttribute('aria-label', rm.title);
        rm.onclick = () => {
          this.m.draft.splice(i, 1);
          this.m.refresh();
        };
        li.appendChild(rm);
      }
      this.partsView.appendChild(li);
    });
    if (parts.length === 1 && editable) {
      const empty = document.createElement('li');
      empty.className = 'installed-empty muted';
      empty.textContent = 'No modules yet. Pick some from the catalogue on the right.';
      this.partsView.appendChild(empty);
    }
  }

  private renderPalette(parts: readonly string[], editable: boolean): void {
    const frame = PARTS[parts[0]];
    const structure = frame?.structure === true;
    const full = frame?.slots !== undefined && parts.length - 1 >= frame.slots;
    const query = this.search.value.trim().toLowerCase();
    const onlyFits = this.fitsOnly.checked && editable;
    const tooSmallFor = (p: PartDef) => p.slot !== 'chassis' && !structure && (p.minSize ?? 0) > (frame?.size ?? 0);
    const fitsOf = (p: PartDef) => p.slot === 'chassis' || ((structure ? !p.mobileOnly : !p.structureOnly) && !tooSmallFor(p));
    const listOf = (cat: (typeof CATEGORIES)[number]) =>
      PART_LIST.filter(
        (p) => cat.match(p) && (!onlyFits || fitsOf(p)) && (!query || [p.name, p.description, p.slot, cat.title].some((t) => t?.toLowerCase().includes(query))),
      );

    // Category chips with how many modules each would show.
    const counts = CATEGORIES.map((cat) => listOf(cat).length);
    this.chips.innerHTML = '';
    const chip = (label: string, index: number, count: number) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `chip${index === this.category ? ' active' : ''}`;
      b.innerHTML = `${esc(label)} <small>${count}</small>`;
      b.disabled = count === 0 && index !== this.category;
      b.onclick = () => {
        this.category = index;
        this.renderPalette(this.m.currentParts(), this.m.editable);
      };
      this.chips.appendChild(b);
    };
    chip('All', -1, counts.reduce((a, b) => a + b, 0));
    CATEGORIES.forEach((cat, i) => chip(cat.title, i, counts[i]));

    this.palette.innerHTML = '';
    const note = (html: string) => {
      const n = document.createElement('div');
      n.className = 'palette-note';
      n.innerHTML = html;
      this.palette.appendChild(n);
    };
    if (!editable) note('This class is built and can’t be edited. Use <b>Copy as new design</b> below to make a changed version.');
    else if (full) note('All slots are used. Remove a module to add another, or swap the chassis.');
    let shown = 0;
    CATEGORIES.forEach((cat, ci) => {
      if (this.category >= 0 && ci !== this.category) return;
      // Unit bodies run from the smallest tier to the biggest.
      const list = listOf(cat).sort((a, b) => (a.slot === 'chassis' && b.slot === 'chassis' && !a.structure ? (a.size ?? 0) - (b.size ?? 0) : 0));
      if (!list.length) return;
      const group = document.createElement('section');
      group.className = 'part-group';
      group.innerHTML = `<h3>${esc(cat.title)}</h3>`;
      const grid = document.createElement('div');
      grid.className = 'part-grid';
      group.appendChild(grid);
      for (const p of list) {
        shown++;
        const isFrame = p.slot === 'chassis';
        const fits = fitsOf(p);
        const row = document.createElement('button');
        row.className = 'part-row';
        row.disabled = !editable || !fits || (!isFrame && full);
        const why = tooSmallFor(p) ? `Needs a ${TIER_NAMES[p.minSize!]} chassis or bigger` : `Only fits ${p.structureOnly ? 'buildings' : 'units'}`;
        row.title = !fits ? why : p.description;
        const detail = [
          isFrame && !p.structure ? TIER_NAMES[p.size ?? 0] : '',
          `mass ${p.mass}`,
          p.climb ? `climbs ${p.climb >= 9 ? 'anything' : p.climb}` : '',
          p.hover ? 'hovers over water and lava' : p.wade ? 'wades deep water' : '',
          p.minSize && !isFrame ? `${TIER_NAMES[p.minSize]}+` : '',
          p.use ? `uses ${p.use}` : '',
          p.slots ? `${p.slots} slots` : '',
          p.energy ? `+${p.energy} energy` : '',
        ].filter(Boolean).join(' · ');
        // Why the button is disabled, shown on the tile itself.
        const reason = !editable ? '' : !fits ? why : !isFrame && full ? 'No free slots' : '';
        row.innerHTML = `${partIcon(p)}<span class="part-text"><b>${esc(p.name)}</b><small class="desc">${esc(p.description)}</small><small>${esc(detail)}</small>${reason ? `<small class="why-disabled">${esc(reason)}</small>` : ''}</span>`;
        row.onclick = () => (isFrame ? this.setFrame(p) : this.addPart(p));
        grid.appendChild(row);
      }
      this.palette.appendChild(group);
    });
    if (!shown) note(query ? `No module matches “${esc(this.search.value.trim())}”.` : 'Nothing in this category fits this chassis.');
  }

  private addPart(p: PartDef): void {
    this.m.draft.push(p.id);
    this.m.refresh();
  }

  /** Swaps the chassis/frame; modules that no longer fit are dropped. */
  private setFrame(p: PartDef): void {
    const structure = p.structure === true;
    const kept = this.m.draft.slice(1).filter((id) => (structure ? !PARTS[id].mobileOnly : !PARTS[id].structureOnly && (PARTS[id].minSize ?? 0) <= (p.size ?? 0)));
    const dropped = this.m.draft.length - 1 - kept.length;
    this.m.draft = [p.id, ...kept.slice(0, p.slots ?? kept.length)];
    if (dropped) this.m.showResult(`Removed ${dropped} module(s) that don't fit a ${structure ? 'building' : `${TIER_NAMES[p.size ?? 0]} unit`}.`, false);
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
    this.previewNote.textContent = s.structure ? (s.shape ? `${s.area}-tile building (${s.footprint}×${s.footprint} box)` : `${s.footprint}×${s.footprint} building`) : s.flying ? 'flying unit' : s.long ? 'long ground unit' : 'ground unit';
    const parts = this.m.currentParts();
    // The same scale for every design, so body sizes compare directly.
    // The big view is scaled to fill the stage whatever the design's size; the thumbnails keep true in-game size.
    const views: [HTMLImageElement, number, boolean, number?][] = [[this.preview, 0, false, 560], [this.previewOwn, 32, false], [this.previewRival, 32, true]];
    for (const [img, pxPerTile, rival, fit] of views) {
      this.m.actions
        .preview(parts, pxPerTile, rival, fit)
        .then((src) => {
          if (token !== this.previewToken) return;
          // Rendered at 2× for sharpness: show it at logical size.
          if (!fit) img.onload = () => (img.style.width = `${img.naturalWidth / 2}px`);
          img.src = src;
        })
        .catch(() => {});
    }
  }
}
