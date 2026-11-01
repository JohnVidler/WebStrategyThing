/*
 * Dev Options: a floating button on the right of the map that opens a panel of playtest shortcuts (fog of war,
 * spawning and removing things on any team, the weather, ending the match in every way), grouped under vertical tabs
 * down the left of the panel (one per class of tool; see `tabs()`). Only in a client built with WST_DEV_TOOLS=1:
 * main.ts imports this behind `__WST_DEV_TOOLS__`, so any other build neither contains nor loads it. The server
 * obeys it only when started with WST_DEV_TOOLS=1 (npm run dev does that); otherwise it answers that the tools are off.
 */
import { DEV_TEMPLATES, NEUTRAL, Sky, type ClientMessage, type DevCommand, type DevOutcome, type ScoreEntry } from '@wst/engine';
import { barrage, EFFECT_GROUPS, spawnAll, type EffectOptions, type EffectSinks } from './devEffects';
import { ownerColour } from './renderer';
import { showToast, type ToastKind } from './toast';
import type { ClientState } from './state';

export interface DevToolsActions {
  send(msg: ClientMessage): void;
  /** The middle of the map view, in tiles. */
  view(): { x: number; y: number; radius: number };
  /** Cut the connection so the client's reconnect logic runs. */
  drop(): void;
  /** The map canvas, where a target is picked. */
  canvas(): HTMLCanvasElement;
  /** Canvas CSS pixels to tiles, and back. */
  screenToTile(sx: number, sy: number): { x: number; y: number };
  tileToScreen(x: number, y: number): { x: number; y: number };
  /** The renderer's live effect lists (fetch again for each use). */
  effects(): EffectSinks;
  /** Ids of the selected units and buildings. */
  selection(): number[];
}

const OUTCOMES: readonly { outcome: DevOutcome; label: string; title: string }[] = [
  { outcome: 'win', label: 'Victory', title: 'All opposing forces destroyed' },
  { outcome: 'win-last-player', label: 'Victory: others left', title: 'Every other player has left' },
  { outcome: 'win-no-power', label: 'Victory: no power', title: 'Only you still have powered units' },
  { outcome: 'loss', label: 'Defeat', title: 'You lose; the others win' },
  { outcome: 'loss-no-power', label: 'Defeat: no power', title: 'You lose because you have no powered units' },
  { outcome: 'draw', label: 'Draw', title: 'Match over with no winner' },
];

export function make<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const element = Object.assign(document.createElement(tag), props);
  element.append(...children);
  return element;
}

export class DevTools {
  private readonly panel: HTMLDivElement;
  private readonly noteLine: HTMLDivElement;
  private readonly fogBox: HTMLInputElement;
  private readonly ownerSelects: { select: HTMLSelectElement; any: string | undefined }[] = [];
  private players: readonly ScoreEntry[] = [];
  /** The tab showing (kept while the panel is closed). */
  private tab = 'world';
  /** Where spawns, fields and removals happen, picked on the map; null = the middle of the view. */
  private target: { x: number; y: number } | null = null;
  private readonly targetOut: HTMLSpanElement;
  private readonly marker: HTMLDivElement;
  private markerFrame = 0;
  /** Set while waiting for a click on the map; undoes the pick mode. */
  private stopPicking: (() => void) | null = null;
  /** Timer of the Effects tab's repeat option, while it runs. */
  private repeatTimer = 0;
  private repeatBox: HTMLInputElement | null = null;
  /** Weather sliders with a marker for what the world is doing now (see `scale`); moved each frame while the panel is open. */
  private readonly scales: { marker: HTMLElement; read: () => number; shown: number }[] = [];
  private scaleFrame = 0;

  constructor(
    host: HTMLElement,
    private readonly state: ClientState,
    private readonly actions: DevToolsActions,
  ) {
    const toggle = make('button', { id: 'dev-button', type: 'button', textContent: 'Dev Options', title: 'Developer tools (development builds only)' });
    toggle.dataset.sound = 'menu.click';
    this.noteLine = make('div', { className: 'dev-note muted', textContent: 'Dev tools need the server started with WST_DEV_TOOLS=1.' });
    this.fogBox = make('input', { type: 'checkbox' });
    this.fogBox.onchange = () => this.run({ kind: 'fog', on: this.fogBox.checked });

    const close = make('button', { type: 'button', textContent: '✕', title: 'Close (Esc)' });
    close.onclick = () => this.show(false);
    this.panel = make('div', { id: 'dev-panel', hidden: true });
    this.panel.setAttribute('role', 'dialog');
    this.panel.setAttribute('aria-label', 'Dev Options');
    this.panel.classList.add('dev-tabbed');
    this.targetOut = make('span', { className: 'dev-target-out' });
    this.marker = make('div', { className: 'dev-target', hidden: true });
    const pick = this.button('Pick on map', () => this.pick(), 'Click the map to choose where things spawn or are removed (Esc cancels)');
    const centre = this.button('Use view centre', () => this.setTarget(null), 'Go back to the middle of the view');
    this.panel.append(
      make('div', { className: 'dev-head' }, make('h2', { textContent: 'Dev Options' }), close),
      this.noteLine,
      make('div', { className: 'dev-row dev-targetbar' }, make('span', { textContent: 'Target:' }), this.targetOut, pick, centre),
      this.tabs([
        { id: 'world', label: 'World', title: 'Fog, pausing and the connection', sections: [this.worldSection()] },
        { id: 'weather', label: 'Weather', title: 'Sunlight, wind, rain and storms', sections: [this.weatherSection()] },
        { id: 'spawn', label: 'Spawn', title: 'Units, buildings, matter and fire', sections: [this.spawnSection(), this.matterSection(), this.fireSection()] },
        { id: 'terrain', label: 'Terrain', title: 'Paint water, lava, voids, rock and dry ground', sections: [this.terrainSection()] },
        { id: 'combat', label: 'Combat', title: 'Hurt or destroy the selected units and buildings', sections: [this.damageSection(), this.weaponsSection()] },
        { id: 'fix', label: 'Clean-up', title: 'Remove things, heal, finish construction', sections: [this.removeSection(), this.repairSection()] },
        { id: 'effects', label: 'Effects', title: 'Blasts, sparks, fragments and lights, for looking at', sections: this.effectsSections() },
        { id: 'ui', label: 'Interface', title: 'Previews of interface pieces', sections: [this.alertsSection()] },
        { id: 'match', label: 'Match', title: 'End the match', sections: [this.endSection()] },
      ]),
    );
    toggle.onclick = () => this.show(this.panel.hidden === true);
    window.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Escape' || this.panel.hidden) return;
      if (this.stopPicking) this.stopPicking();
      else this.show(false);
    });
    host.append(toggle, this.panel, this.marker);
    this.setTarget(null);
    this.refreshOwners();
  }

  /** The players of the match (from the scoreboard), for the owner pickers. */
  setPlayers(players: readonly ScoreEntry[]): void {
    this.players = players;
    this.refreshOwners();
  }

  /** The server's answer to the last command. */
  note(text: string, ok: boolean): void {
    this.noteLine.textContent = text;
    this.noteLine.className = `dev-note ${ok ? 'ok' : 'bad'}`;
    this.fogBox.checked = this.state.fog;
  }

  private show(open: boolean): void {
    if (!open) {
      this.stopPicking?.();
      this.stopRepeat();
    }
    this.panel.hidden = !open;
    this.fogBox.checked = this.state.fog;
    this.trackMarker();
    this.trackScales();
  }

  /** A slider with a marker on its scale showing the value the game world has now (which slides toward the slider, or wanders on its own when the setting is natural). */
  private scale(range: HTMLInputElement, read: () => number, title: string): HTMLElement {
    const marker = make('span', { className: 'dev-now', title });
    this.scales.push({ marker, read, shown: NaN });
    return make('span', { className: 'dev-scale' }, range, marker);
  }

  /** Moves the markers while the panel is open (a rAF loop that stops when it closes; a style write only when a value changes). */
  private trackScales(): void {
    if (this.panel.hidden || this.scaleFrame) return;
    const step = () => {
      this.scaleFrame = 0;
      if (this.panel.hidden) return;
      for (const s of this.scales) {
        const v = Math.max(0, Math.min(100, Math.round(s.read())));
        if (v === s.shown) continue;
        s.shown = v;
        s.marker.style.setProperty('--p', String(v / 100));
        s.marker.dataset.value = String(v);
      }
      this.scaleFrame = requestAnimationFrame(step);
    };
    this.scaleFrame = requestAnimationFrame(step);
  }

  private setTarget(target: { x: number; y: number } | null): void {
    this.target = target;
    this.targetOut.textContent = target ? `${target.x}, ${target.y}` : 'middle of the view';
    this.trackMarker();
  }

  /** Wait for one click on the map and make it the target. The panel steps aside meanwhile so the whole map can be clicked. */
  private pick(): void {
    this.stopPicking?.();
    const canvas = this.actions.canvas();
    const onDown = (ev: PointerEvent) => {
      ev.stopImmediatePropagation();
      ev.preventDefault();
      if (ev.button !== 0) return;
      const tile = this.actions.screenToTile(ev.offsetX, ev.offsetY);
      this.setTarget({ x: Math.max(0, Math.floor(tile.x)), y: Math.max(0, Math.floor(tile.y)) });
      done();
    };
    // Swallow the rest of the click so the game does not select or order anything with it.
    const swallow = (ev: Event) => ev.stopImmediatePropagation();
    const done = () => {
      canvas.removeEventListener('pointerdown', onDown, true);
      canvas.removeEventListener('pointerup', swallow, true);
      canvas.style.cursor = '';
      this.panel.classList.remove('dev-picking');
      this.stopPicking = null;
    };
    canvas.addEventListener('pointerdown', onDown, true);
    canvas.addEventListener('pointerup', swallow, true);
    canvas.style.cursor = 'crosshair';
    this.panel.classList.add('dev-picking');
    this.stopPicking = done;
    showToast('Click the map to choose the target (Esc cancels)', 'info');
  }

  /** Keeps the target marker on its tile while the panel is open; the loop runs only then. */
  private trackMarker(): void {
    const live = this.target !== null && !this.panel.hidden;
    this.marker.hidden = !live;
    if (!live || this.markerFrame) return;
    const step = () => {
      this.markerFrame = 0;
      const target = this.target;
      if (!target || this.panel.hidden) return;
      const canvas = this.actions.canvas();
      const at = this.actions.tileToScreen(target.x + 0.5, target.y + 0.5);
      const c = canvas.getBoundingClientRect();
      const h = this.marker.offsetParent?.getBoundingClientRect();
      this.marker.style.transform = `translate(${c.left - (h?.left ?? 0) + at.x}px, ${c.top - (h?.top ?? 0) + at.y}px)`;
      this.markerFrame = requestAnimationFrame(step);
    };
    this.markerFrame = requestAnimationFrame(step);
  }

  private run(cmd: DevCommand): void {
    this.actions.send({ t: 'dev', cmd });
  }

  private button(label: string, onClick: () => void, title = '', className = ''): HTMLButtonElement {
    const b = make('button', { type: 'button', textContent: label, title, className });
    b.onclick = onClick;
    return b;
  }

  /** Vertical tabs down the left, one page of sections per tab (add a tab for a new class of tool, not a section at the bottom). */
  private tabs(defs: readonly { id: string; label: string; title: string; sections: HTMLElement[] }[]): HTMLElement {
    const list = make('div', { className: 'dev-tabs' });
    list.setAttribute('role', 'tablist');
    list.setAttribute('aria-orientation', 'vertical');
    const pages = make('div', { className: 'dev-pages' });
    const buttons: HTMLButtonElement[] = [];
    const views: HTMLElement[] = [];
    const select = (i: number, focus = false) => {
      buttons.forEach((b, j) => {
        b.setAttribute('aria-selected', String(i === j));
        b.tabIndex = i === j ? 0 : -1;
        views[j].hidden = i !== j;
      });
      this.tab = defs[i].id;
      if (focus) buttons[i].focus();
    };
    defs.forEach((d, i) => {
      const b = make('button', { type: 'button', textContent: d.label, title: d.title, className: 'dev-tab' });
      b.setAttribute('role', 'tab');
      b.onclick = () => select(i);
      b.onkeydown = (ev) => {
        const step = ev.key === 'ArrowDown' ? 1 : ev.key === 'ArrowUp' ? -1 : 0;
        if (step === 0) return;
        ev.preventDefault();
        select((i + step + defs.length) % defs.length, true);
      };
      const view = make('div', { className: 'dev-page' }, ...d.sections);
      view.setAttribute('role', 'tabpanel');
      buttons.push(b);
      views.push(view);
      list.append(b);
      pages.append(view);
    });
    select(Math.max(0, defs.findIndex((d) => d.id === this.tab)));
    return make('div', { className: 'dev-body' }, list, pages);
  }

  private section(title: string, ...content: (Node | string)[]): HTMLElement {
    return make('fieldset', { className: 'dev-section' }, make('legend', { textContent: title }), ...content);
  }

  private row(...content: (Node | string)[]): HTMLDivElement {
    return make('div', { className: 'dev-row' }, ...content);
  }

  private labelled(text: string, control: HTMLElement): HTMLLabelElement {
    return make('label', {}, text, control);
  }

  private number(value: number, min: number, max: number, step = 1): HTMLInputElement {
    return make('input', { type: 'number', value: String(value), min: String(min), max: String(max), step: String(step) });
  }

  /** An owner picker; `anyLabel` adds an extra first choice with value -1 ("Anyone", "Everyone"). */
  private ownerSelect(anyLabel?: string): HTMLSelectElement {
    const select = make('select');
    this.ownerSelects.push({ select, any: anyLabel });
    return select;
  }

  private refreshOwners(): void {
    for (const { select, any } of this.ownerSelects) {
      const keep = select.value;
      select.replaceChildren();
      if (any) select.append(make('option', { value: '-1', textContent: any }));
      select.append(make('option', { value: String(NEUTRAL), textContent: 'Neutral' }));
      const mine = this.players.find((p) => p.id === this.state.myId);
      select.append(make('option', { value: String(this.state.myId), textContent: `You${mine ? ` (${mine.name})` : ''}` }));
      for (const p of this.players) if (p.id !== this.state.myId) select.append(make('option', { value: String(p.id), textContent: p.name }));
      if ([...select.options].some((o) => o.value === keep)) select.value = keep;
    }
  }

  private owner(select: HTMLSelectElement): number {
    return Number(select.value);
  }

  private tile(): { x: number; y: number } {
    if (this.target) return { x: this.target.x, y: this.target.y };
    const { x, y } = this.actions.view();
    return { x: Math.max(0, Math.floor(x)), y: Math.max(0, Math.floor(y)) };
  }

  private worldSection(): HTMLElement {
    const pauseButton = (label: string, mode: 'off' | 'dev' | 'disconnect', title: string) => this.button(label, () => this.run({ kind: 'pause', mode }), title);
    return this.section(
      'World',
      this.row(make('label', { className: 'dev-check' }, this.fogBox, 'Fog of war')),
      this.row(
        pauseButton('Pause', 'dev', 'Stop the simulation (the pause notice shows)'),
        pauseButton('Resume', 'off', 'Run the simulation again'),
        pauseButton('Fake disconnect', 'disconnect', 'Show the “waiting for a player” pause, as when someone drops'),
      ),
      this.row(this.button('Drop my connection', () => this.actions.drop(), 'Close the socket so the client reconnects with its token')),
    );
  }

  private spawnSection(): HTMLElement {
    const owner = this.ownerSelect();
    const template = make('select');
    const group = (label: string, structure: boolean) =>
      make('optgroup', { label }, ...DEV_TEMPLATES.filter((t) => t.structure === structure).map((t) => make('option', { value: t.name, textContent: t.name })));
    template.append(group('Units', false), group('Buildings', true));
    const count = this.number(1, 1, 50);
    return this.section(
      'Spawn at the target',
      this.row(this.labelled('Team', owner), this.labelled('Class', template), this.labelled('Count', count)),
      this.row(
        this.button('Spawn', () => this.run({ kind: 'spawn', owner: this.owner(owner), template: template.value, ...this.tile(), count: Math.max(1, Math.min(50, Number(count.value) || 1)) }), 'Instant, fully built and charged; the neutral team’s units attack everyone'),
      ),
    );
  }

  private matterSection(): HTMLElement {
    const owner = this.ownerSelect();
    const amount = this.number(5000, 1, 1_000_000, 500);
    const field = this.number(5000, 1, 65535, 500);
    return this.section(
      'Matter',
      this.row(this.labelled('Silos of', owner), this.labelled('Amount', amount), this.button('Give', () => this.run({ kind: 'give', owner: this.owner(owner), amount: Math.max(1, Number(amount.value) || 1) }), 'Into their silos, as far as there is room')),
      this.row(this.labelled('Field size', field), this.button('Add matter field here', () => this.run({ kind: 'field', ...this.tile(), amount: Math.max(1, Math.min(65535, Number(field.value) || 1)) }), 'A neutral matter field at the target')),
    );
  }

  private terrainSection(): HTMLElement {
    const radius = this.number(3, 0, 20);
    const paint = (elevation: number) => this.run({ kind: 'terrain', ...this.tile(), r: Math.max(0, Math.min(20, Math.floor(Number(radius.value) || 0))), elevation });
    const brush = (label: string, elevation: number, title: string) => this.button(label, () => paint(elevation), title);
    return this.section(
      'Paint terrain',
      this.row(this.labelled('Radius', radius)),
      this.row(
        brush('Dry ground', 0, 'Open ground (cells under a building are left alone)'),
        brush('Rock', 3, 'Rock three high: walls and cliffs'),
        brush('Shallow water', -1, 'Shallow water: ground units wade it, slowly'),
        brush('Deep water', -4, 'Deep water: only amphibious and hover drives cross it'),
      ),
      this.row(
        brush('Lava', -7, 'Lava: only hover drives cross it, and they are scorched; a ground unit caught in it burns up'),
        brush('Void', -9, 'A drop with no floor: only fliers cross it, and a ground unit over it is lost'),
      ),
    );
  }

  private fireSection(): HTMLElement {
    const count = this.number(8, 1, 40);
    return this.section(
      'Fire',
      this.row(
        this.labelled('Count', count),
        this.button('Start fires', () => this.run({ kind: 'fire', ...this.tile(), mode: 'ground', count: Math.max(1, Math.min(40, Number(count.value) || 1)) }), 'Fires on the ground round the target: they burn everything, friend or foe'),
        this.button('Flame burst', () => this.run({ kind: 'fire', ...this.tile(), mode: 'burst', count: Math.max(1, Math.min(40, Number(count.value) || 1)) }), 'Fireballs thrown every way from the target, as a flamethrower unit does when destroyed'),
      ),
    );
  }

  private removeSection(): HTMLElement {
    const owner = this.ownerSelect('Anyone');
    const radius = this.number(6, 1, 200);
    const check = (label: string, on: boolean) => make('input', { type: 'checkbox', checked: on, title: label });
    const units = check('Units', true);
    const buildings = check('Buildings', true);
    const resources = check('Matter fields', false);
    const clearOwner = this.ownerSelect();
    return this.section(
      'Remove',
      this.row(this.labelled('Owner', owner), this.labelled('Radius (tiles)', radius)),
      this.row(make('label', { className: 'dev-check' }, units, 'Units'), make('label', { className: 'dev-check' }, buildings, 'Buildings'), make('label', { className: 'dev-check' }, resources, 'Matter fields')),
      this.row(this.button('Remove around the target', () => this.run({ kind: 'remove', ...this.tile(), r: Math.max(1, Math.min(200, Number(radius.value) || 1)), owner: this.owner(owner), scope: { units: units.checked, buildings: buildings.checked, resources: resources.checked } }))),
      this.row(this.labelled('Everything of', clearOwner), this.button('Destroy all', () => this.run({ kind: 'clear', owner: this.owner(clearOwner) }), 'Every unit and building of that team, anywhere', 'danger')),
    );
  }

  private damageSection(): HTMLElement {
    const amount = this.number(50, 1, 1_000_000, 10);
    const crashBox = make('input', { type: 'checkbox', title: 'Every shot-down flier tumbles on and crashes, instead of about 3 in 10' });
    crashBox.onchange = () => this.actions.effects().alwaysCrash(crashBox.checked);
    const hurt = (hp: number): void => {
      const ids = this.actions.selection();
      if (ids.length === 0) this.note('Nothing is selected.', false);
      else this.run({ kind: 'damage', ids: ids.slice(0, 500), amount: hp });
    };
    return this.section(
      'Selected units and buildings',
      this.row(this.labelled('Damage', amount), this.button('Damage selected', () => hurt(Math.max(1, Math.min(1_000_000, Number(amount.value) || 1))), 'Takes this many hit points off each selected unit or building')),
      this.row(
        this.button('Destroy selected', () => hurt(1_000_000), 'Enough damage to kill whatever is selected', 'danger'),
        this.button('Crash selected fliers', () => {
          // Force the crash for the moment it takes the hit to land and the death to arrive, then go back to the usual odds.
          const effects = this.actions.effects();
          const before = crashBox.checked;
          effects.alwaysCrash(true);
          hurt(1_000_000);
          setTimeout(() => this.actions.effects().alwaysCrash(before), 1500);
        }, 'Destroy the selected units; any that fly are certain to tumble and crash'),
      ),
      this.row(make('label', { className: 'dev-check' }, crashBox, 'Shot-down fliers always crash')),
    );
  }

  /** The railgun, ion gun, smoke and drone bay, on demand (DevCommand 'weapons'). */
  private weaponsSection(): HTMLElement {
    const onSelected = (action: 'ion' | 'rail' | 'fill' | 'launch' | 'recall'): void => {
      const ids = this.actions.selection();
      if (ids.length === 0) this.note('Nothing is selected.', false);
      else this.run({ kind: 'weapons', action, ids: ids.slice(0, 500), ...this.tile() });
    };
    return this.section(
      'Weapons and modules',
      this.row(
        this.button('Smoke at the target', () => this.run({ kind: 'weapons', action: 'smoke', ids: [], ...this.tile() }), 'Drops three smoke clouds round the marked tile (or the middle of the view)'),
        this.button('Ion selected', () => onSelected('ion'), 'Holds a random working module of each selected unit or building down for a few seconds'),
      ),
      this.row(this.button('Fire selected railguns', () => onSelected('rail'), 'A selected railgun that has a target skips the charge and fires at once')),
      this.row(
        this.button('Fill drone bays', () => onSelected('fill'), 'Fills the bays of the selected carriers with Wasps, free'),
        this.button('Launch drones', () => onSelected('launch'), 'Sends every docked drone of the selected carriers out'),
        this.button('Recall drones', () => onSelected('recall'), 'Calls the launched drones back to their carriers'),
      ),
    );
  }

  private repairSection(): HTMLElement {
    const owner = this.ownerSelect('Everyone');
    return this.section(
      'Repair and build',
      this.row(this.labelled('Team', owner)),
      this.row(
        this.button('Heal and recharge', () => this.run({ kind: 'heal', owner: this.owner(owner) }), 'Full health, mended modules, full energy'),
        this.button('Finish construction sites', () => this.run({ kind: 'finish', owner: this.owner(owner) }), 'Complete every site for free'),
      ),
    );
  }

  private weatherSection(): HTMLElement {
    const level = (value: number) => make('input', { type: 'range', min: '0', max: '100', step: '1', value: String(value) });
    const sun = level(100);
    const wind = level(50);
    const sunOut = make('output', { textContent: '100' });
    const windOut = make('output', { textContent: '50' });
    const sunFixed = make('input', { type: 'checkbox' });
    const windFixed = make('input', { type: 'checkbox' });
    // Natural weather, or any forced kind (the engine's Sky); the intensity scales how strong all weather is, and changes slide in.
    const sky = make('select');
    const kinds: [number, string][] = [[-1, 'Natural'], [Sky.Dry, 'Dry'], [Sky.Rain, 'Rain'], [Sky.Storm, 'Storm'], [Sky.Heat, 'Heatwave'], [Sky.Dust, 'Dust storm'], [Sky.Mist, 'Mist']];
    sky.append(...kinds.map(([value, textContent]) => make('option', { value: String(value), textContent })));
    const intensity = level(100);
    const intensityOut = make('output', { textContent: '100' });
    // How long a change of weather takes: natural (15 to 45 s a spell), or a fixed number of seconds (0 is instant).
    const change = make('input', { type: 'number', value: '-1', min: '-1', max: '120', step: '1', title: 'Seconds a change of weather takes; -1 is the natural 15 to 45 s, 0 is instant' });
    const apply = () => {
      sunOut.textContent = sun.value;
      windOut.textContent = wind.value;
      intensityOut.textContent = intensity.value;
      this.run({ kind: 'weather', sun: sunFixed.checked ? Number(sun.value) : -1, wind: windFixed.checked ? Number(wind.value) : -1, sky: Number(sky.value), intensity: Number(intensity.value), change: Math.max(-1, Math.min(120, Math.round(Number(change.value)))) });
    };
    for (const control of [sun, wind, sunFixed, windFixed, sky, intensity, change]) control.onchange = apply;
    for (const [range, out] of [[sun, sunOut], [wind, windOut], [intensity, intensityOut]] as const) range.oninput = () => (out.textContent = range.value);
    const preset = (label: string, s: number, w: number) =>
      this.button(label, () => {
        sunFixed.checked = windFixed.checked = true;
        sun.value = String(s);
        wind.value = String(w);
        apply();
      });
    return this.section(
      'Sunlight, wind and sky',
      this.row(make('label', { className: 'dev-check' }, sunFixed, 'Fix sunlight'), this.scale(sun, () => this.state.daylight, 'Marker: the light level in the game now'), sunOut),
      this.row(make('label', { className: 'dev-check' }, windFixed, 'Fix wind'), this.scale(wind, () => this.state.wind, 'Marker: the wind in the game now'), windOut),
      this.row(this.labelled('Sky', sky)),
      this.row(make('label', { className: 'dev-check' }, 'Intensity', this.scale(intensity, () => this.state.weather.strength, 'Marker: how strongly the weather is felt now (0 while the sky is dry)'), intensityOut)),
      this.row(this.labelled('Change time (s, -1 natural)', change)),
      this.row(
        preset('Noon, gale', 100, 100),
        preset('Night, calm', 0, 0),
        this.button('Thunderstorm', () => {
          sky.value = String(Sky.Storm);
          apply();
        }, 'Force a storm: heavy rain, lightning, less sun and more wind'),
        this.button('Natural cycle', () => {
          sunFixed.checked = windFixed.checked = false;
          sky.value = '-1';
          intensity.value = '100';
          change.value = '-1';
          apply();
        }, 'Let daylight, wind and the weather follow their normal course again'),
      ),
    );
  }

  /** Previews of the pop-in alerts, one per kind (nothing is sent to the server). */
  private alertsSection(): HTMLElement {
    const sample: Record<ToastKind, string> = {
      ok: 'Restored your saved designs (1 added)',
      info: 'Reinforcements are on the way.',
      warn: 'Your power network is running low.',
      error: 'Program rejected — see the designer.',
    };
    const alert = (kind: ToastKind) => this.button(kind === 'ok' ? 'OK' : kind[0].toUpperCase() + kind.slice(1), () => showToast(sample[kind], kind), `Show a ${kind} alert at the top right`, `dev-alert-${kind}`);
    return this.section('Alerts', this.row(...(['ok', 'info', 'warn', 'error'] as const).map(alert)));
  }

  private stopRepeat(): void {
    if (this.repeatTimer) clearInterval(this.repeatTimer);
    this.repeatTimer = 0;
    if (this.repeatBox) this.repeatBox.checked = false;
  }

  /** Spawn the renderer's visual effects at the target (nothing goes to the server). Lights show best at night: use the Weather tab. */
  private effectsSections(): HTMLElement[] {
    const charge = make('input', { type: 'range', min: '0', max: '100', step: '1', value: '100' });
    const chargeOut = make('output', { textContent: '100%' });
    charge.oninput = () => (chargeOut.textContent = `${charge.value}%`);
    const radius = this.number(1.5, 0.3, 6, 0.1);
    const colour = make('select');
    ['Grey', 'Blue', 'Red', 'Green', 'Yellow', 'Purple', 'Teal', 'Orange'].forEach((name, i) => colour.append(make('option', { value: String(ownerColour(i)), textContent: name })));
    colour.value = String(ownerColour(1));
    this.repeatBox = make('input', { type: 'checkbox' });
    const options = (): EffectOptions => ({ power: Number(charge.value) / 100, colour: Number(colour.value), radius: Math.max(0.3, Math.min(6, Number(radius.value) || 1.5)) });
    const at = () => {
      const t = this.tile();
      return { x: t.x + 0.5, y: t.y + 0.5 };
    };
    // The last thing spawned, so Repeat can run it again every 1.2 s while the panel is open.
    let last: () => void = () => undefined;
    const fire = (fn: () => void) => () => {
      last = fn;
      fn();
    };
    this.repeatBox.onchange = () => {
      if (this.repeatTimer) clearInterval(this.repeatTimer);
      this.repeatTimer = this.repeatBox?.checked ? window.setInterval(() => (this.panel.hidden ? this.stopRepeat() : last()), 1200) : 0;
    };
    const groups = EFFECT_GROUPS.map((g) =>
      this.section(
        g.title,
        make('div', { className: 'dev-grid' }, ...g.effects.map((e) => this.button(e.label, fire(() => e.spawn(this.actions.effects(), at().x, at().y, performance.now(), options())), e.title))),
      ),
    );
    return [
      this.section(
        'Settings',
        this.row(this.labelled('Radius (tiles)', radius), this.labelled('Shield colour', colour)),
        this.row(make('label', { className: 'dev-check' }, 'Battery charge'), charge, chargeOut),
        this.row(make('label', { className: 'dev-check' }, this.repeatBox, 'Repeat the last one every 1.2 s')),
        this.row(
          this.button('Spawn everything', fire(() => spawnAll(this.actions.effects(), at().x, at().y, performance.now(), options())), 'The whole catalogue in a grid around the target'),
          this.button('Barrage', fire(() => barrage(this.actions.effects(), at().x, at().y, performance.now(), 40, 8, options())), '40 random blasts over 8 tiles, for judging a big fight'),
          this.button('Clear effects', () => this.actions.effects().clear(), 'Remove every blast, spark and light now'),
        ),
      ),
      ...groups,
    ];
  }

  private endSection(): HTMLElement {
    const buttons = OUTCOMES.map(({ outcome, label, title }) => this.button(label, () => this.run({ kind: 'end', outcome }), title));
    return this.section(
      'End the match',
      make('div', { className: 'dev-grid' }, ...buttons),
      this.row(
        this.button('Knocked out (spectate prompt)', () => this.run({ kind: 'defeat' }), 'Show the defeat choice without ending the match'),
        this.button('Allow normal ending again', () => this.run({ kind: 'reopen' }), 'After a dev ending, let the real victory check end the match'),
      ),
    );
  }
}
