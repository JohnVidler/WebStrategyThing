/*
 * Dev Rooms: a sidebar on the Multiplayer screen to create and remove example rooms in the room list, for testing the
 * list and its animations. The rooms exist only in this page (the server never hears of them) and their Join buttons
 * are disabled. Only in a client built with WST_DEV_TOOLS=1: lobby.ts imports this behind `__WST_DEV_TOOLS__`.
 */
import { GAME_MODES, MAPS, type GameMode } from '@wst/engine';
import { make } from './devTools';
import type { RoomInfo } from './lobby';

const PLAYER_NAMES = ['Ada', 'Bo', 'Cy', 'Dee'];
const ROOM_WORDS = ['ember', 'harbor', 'granite', 'willow', 'comet', 'fjord', 'saffron', 'lantern'];
const MODES: readonly GameMode[] = GAME_MODES.filter((m) => m.id === 'versus' || m.id === 'coop').map((m) => m.id);
const STATES = ['lobby', 'running', 'paused', 'finished'] as const;
type RoomState = (typeof STATES)[number];
const CHURN_MS = 2000;

/** Kept outside the panel, so leaving the Multiplayer screen and coming back keeps the rooms. */
const examples: RoomInfo[] = [];
let counter = 0;

const pick = <T>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)];
const randomName = (): string => `example-${pick(ROOM_WORDS)}-${++counter}`;

function example(name: string, mode: GameMode, mapId: string, players: number, state: RoomState): RoomInfo {
  const map = MAPS.find((m) => m.id === mapId) ?? MAPS[0];
  const capacity = mode === 'coop' ? 2 : 4;
  const count = Math.max(1, Math.min(capacity, players));
  const lobby = state === 'lobby';
  return {
    name,
    mapId: map.id,
    mapName: map.name,
    mode,
    width: map.width,
    height: map.height,
    players: count,
    capacity,
    over: state === 'finished',
    elapsed: lobby ? 0 : 60 + Math.floor(Math.random() * 3000),
    paused: state === 'paused',
    lobby,
    scores: PLAYER_NAMES.slice(0, count).map((n) => ({
      name: n,
      score: lobby ? 0 : Math.floor(Math.random() * 2000),
      connected: true,
      eliminated: state === 'finished' && Math.random() < 0.5,
    })),
    example: true,
  };
}

const randomRoom = (): RoomInfo => example(randomName(), pick(MODES), pick(MAPS).id, 1 + Math.floor(Math.random() * 4), pick(STATES));

/** The example rooms, to be listed beside the real ones. */
export const exampleRooms = (): RoomInfo[] => [...examples];

export class LobbyDevTools {
  private readonly toggle: HTMLButtonElement;
  private readonly panel: HTMLDivElement;
  private readonly list: HTMLDivElement;
  private timer: number | undefined;
  private readonly onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape' && !this.panel.hidden) this.show(false);
  };

  constructor(private readonly onChange: () => void) {
    this.toggle = make('button', { id: 'dev-button', className: 'dev-lobby', type: 'button', textContent: 'Dev Rooms', title: 'Example rooms for the room list (development builds only)' });
    this.toggle.dataset.sound = 'menu.click';
    this.toggle.onclick = () => this.show(this.panel.hidden === true);
    this.list = make('div', { className: 'dev-room-list' });
    const close = make('button', { type: 'button', textContent: '✕', title: 'Close (Esc)' });
    close.onclick = () => this.show(false);
    this.panel = make('div', { id: 'dev-panel', className: 'dev-lobby', hidden: true });
    this.panel.setAttribute('role', 'dialog');
    this.panel.setAttribute('aria-label', 'Dev Rooms');
    this.panel.append(
      make('div', { className: 'dev-head' }, make('h2', { textContent: 'Dev Rooms' }), close),
      make('div', { className: 'dev-note muted', textContent: 'Example rooms exist only in this page: they cannot be joined.' }),
      this.addSection(),
      this.manageSection(),
      this.section('Example rooms', this.list),
    );
    document.body.append(this.toggle, this.panel);
    window.addEventListener('keydown', this.onKey);
    this.renderList();
  }

  /** Removes the sidebar and stops any churn; the example rooms themselves are kept. */
  dispose(): void {
    window.clearInterval(this.timer);
    window.removeEventListener('keydown', this.onKey);
    this.toggle.remove();
    this.panel.remove();
  }

  private show(open: boolean): void {
    this.panel.hidden = !open;
  }

  private section(title: string, ...content: (Node | string)[]): HTMLElement {
    return make('fieldset', { className: 'dev-section' }, make('legend', { textContent: title }), ...content);
  }

  private button(label: string, onClick: () => void, title = '', className = ''): HTMLButtonElement {
    const b = make('button', { type: 'button', textContent: label, title, className });
    b.onclick = onClick;
    return b;
  }

  private changed(): void {
    this.renderList();
    this.onChange();
  }

  private addSection(): HTMLElement {
    const name = make('input', { type: 'text', maxLength: 24, placeholder: 'random' });
    const mode = make('select', {}, ...MODES.map((id) => make('option', { value: id, textContent: GAME_MODES.find((m) => m.id === id)?.name ?? id })));
    const map = make('select', {}, ...MAPS.map((m) => make('option', { value: m.id, textContent: m.name })));
    const players = make('input', { type: 'number', value: '2', min: '1', max: '4' });
    const state = make('select', {}, ...STATES.map((s) => make('option', { value: s, textContent: s })));
    const labelled = (text: string, control: HTMLElement) => make('label', {}, text, control);
    return this.section(
      'Add a room',
      make('div', { className: 'dev-row' }, labelled('Name', name), labelled('Type', mode), labelled('Map', map)),
      make('div', { className: 'dev-row' }, labelled('Players', players), labelled('State', state)),
      make('div', { className: 'dev-row' },
        this.button('Add', () => {
          const wanted = name.value.trim();
          const taken = examples.some((r) => r.name === wanted);
          examples.push(example(wanted && !taken ? wanted : randomName(), mode.value as GameMode, map.value, Number(players.value) || 1, state.value as RoomState));
          this.changed();
        }),
        this.button('Add a random room', () => {
          examples.push(randomRoom());
          this.changed();
        }),
      ),
    );
  }

  private manageSection(): HTMLElement {
    const churn = make('input', { type: 'checkbox' });
    churn.onchange = () => {
      window.clearInterval(this.timer);
      this.timer = churn.checked ? window.setInterval(() => this.churnOnce(), CHURN_MS) : undefined;
    };
    return this.section(
      'Change the list',
      make('div', { className: 'dev-row' },
        this.button('Remove a random room', () => {
          if (examples.length) examples.splice(Math.floor(Math.random() * examples.length), 1);
          this.changed();
        }),
        this.button('Change a room', () => {
          if (!examples.length) return;
          const i = Math.floor(Math.random() * examples.length);
          const r = examples[i];
          examples[i] = example(r.name, r.mode, r.mapId, 1 + Math.floor(Math.random() * 4), pick(STATES));
          this.changed();
        }, 'New players and state for one room, to see a row update in place'),
        this.button('Remove all', () => {
          examples.length = 0;
          this.changed();
        }, '', 'danger'),
      ),
      make('div', { className: 'dev-row' }, make('label', { className: 'dev-check' }, churn, `Churn: add or remove a room every ${CHURN_MS / 1000} s`)),
    );
  }

  private churnOnce(): void {
    if (examples.length < 3 || (examples.length < 8 && Math.random() < 0.5)) examples.push(randomRoom());
    else examples.splice(Math.floor(Math.random() * examples.length), 1);
    this.changed();
  }

  private renderList(): void {
    if (!examples.length) {
      this.list.replaceChildren(make('span', { className: 'muted', textContent: 'None yet.' }));
      return;
    }
    this.list.replaceChildren(
      ...examples.map((r) => {
        const remove = this.button('✕', () => {
          const i = examples.findIndex((e) => e.name === r.name);
          if (i >= 0) examples.splice(i, 1);
          this.changed();
        }, 'Remove this room');
        return make('div', { className: 'dev-room-item' }, make('span', { textContent: `${r.name} · ${r.players}/${r.capacity}` }), remove);
      }),
    );
  }
}
