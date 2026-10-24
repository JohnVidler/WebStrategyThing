/*
 * Dev Options: a floating button on the right of the map that opens a panel of playtest shortcuts (fog of war,
 * spawning and removing things on any team, ending the match in every way). Only in a client built with WST_DEV_TOOLS=1:
 * main.ts imports this behind `__WST_DEV_TOOLS__`, so any other build neither contains nor loads it. The server
 * obeys it only when started with WST_DEV_TOOLS=1 (npm run dev does that); otherwise it answers that the tools are off.
 */
import { DEV_TEMPLATES, NEUTRAL, type ClientMessage, type DevCommand, type DevOutcome, type ScoreEntry } from '@wst/engine';
import type { ClientState } from './state';

export interface DevToolsActions {
  send(msg: ClientMessage): void;
  /** The middle of the map view, in tiles. */
  view(): { x: number; y: number; radius: number };
  /** Cut the connection so the client's reconnect logic runs. */
  drop(): void;
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
    this.panel.append(
      make('div', { className: 'dev-head' }, make('h2', { textContent: 'Dev Options' }), close),
      this.noteLine,
      this.worldSection(),
      this.spawnSection(),
      this.matterSection(),
      this.removeSection(),
      this.repairSection(),
      this.endSection(),
    );
    toggle.onclick = () => this.show(this.panel.hidden === true);
    window.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && !this.panel.hidden) this.show(false);
    });
    host.append(toggle, this.panel);
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
    this.panel.hidden = !open;
    this.fogBox.checked = this.state.fog;
  }

  private run(cmd: DevCommand): void {
    this.actions.send({ t: 'dev', cmd });
  }

  private button(label: string, onClick: () => void, title = '', className = ''): HTMLButtonElement {
    const b = make('button', { type: 'button', textContent: label, title, className });
    b.onclick = onClick;
    return b;
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
      'Spawn at the middle of the view',
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
      this.row(this.labelled('Field size', field), this.button('Add matter field here', () => this.run({ kind: 'field', ...this.tile(), amount: Math.max(1, Math.min(65535, Number(field.value) || 1)) }), 'A neutral matter field at the middle of the view')),
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
      this.row(this.button('Remove around the middle of the view', () => this.run({ kind: 'remove', ...this.tile(), r: Math.max(1, Math.min(200, Number(radius.value) || 1)), owner: this.owner(owner), scope: { units: units.checked, buildings: buildings.checked, resources: resources.checked } }))),
      this.row(this.labelled('Everything of', clearOwner), this.button('Destroy all', () => this.run({ kind: 'clear', owner: this.owner(clearOwner) }), 'Every unit and building of that team, anywhere', 'danger')),
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
