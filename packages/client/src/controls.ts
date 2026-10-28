import { COMMON_ACTIONS, DEMOLISH_KEY } from '@wst/engine';

/**
 * Player-configurable controls: which keys, mouse buttons, wheel and trackpad gestures (plus
 * Ctrl / Shift / Alt / Meta) do what in the match. Pure data and matching, no DOM, so it can be
 * tested; `controlsMenu.ts` is the editor and `input.ts` the consumer.
 *
 * A binding is written `[mods+]input`, for example `ctrl+key:KeyA`, `shift+mouse:2`, `pinch`.
 * Every action has two slots. Settings are kept in local storage (like the unit designs) and
 * read defensively: anything that is not a valid binding for its action is ignored.
 */

export type Mod = 'ctrl' | 'shift' | 'alt' | 'meta';
export const MODS: readonly Mod[] = ['ctrl', 'shift', 'alt', 'meta'];
export const MOD_LABEL: Record<Mod, string> = { ctrl: 'Ctrl', shift: 'Shift', alt: 'Alt', meta: 'Meta' };

export interface Binding {
  /** `key:<KeyboardEvent.code>`, `mouse:0|1|2`, `wheel`, `scroll`, `pinch` or `mod:<Mod>`. */
  readonly input: string;
  readonly mods: readonly Mod[];
}

export const SLOTS = 2;

export type ActionId =
  | 'panLeft' | 'panRight' | 'panUp' | 'panDown' | 'zoomIn' | 'zoomOut' | 'resetView' | 'cancel'
  | 'select' | 'groupAssign' | 'groupAdd' | 'groupSelect' | 'order' | 'panDrag' | 'zoom' | 'panScroll' | 'addSelect' | 'queue' | 'fillQueue'
  | 'orderMove' | 'orderAttack' | 'orderStop' | 'orderHarvest' | 'orderDock' | 'orderRepair' | 'orderCharge' | 'orderDemolish'
  | 'buildMenu' | 'buildCategoryPrev' | 'buildCategoryNext' | 'buildItemPrev' | 'buildItemNext' | 'buildConfirm';

type InputKind = 'key' | 'mouse' | 'wheel' | 'scroll' | 'pinch' | 'mod';

export interface ActionDef {
  readonly id: ActionId;
  readonly label: string;
  readonly hint: string;
  readonly section: 'camera' | 'selection' | 'orders' | 'building';
  /** `selection`: only active when the current selection can use it (an order it can take, a builder). Such keys give way to nothing else, and camera keys give way to them. */
  readonly context?: 'selection';
  /** What kinds of input may be assigned. */
  readonly inputs: readonly InputKind[];
  readonly defaults: readonly string[];
}

/** The id of the control for a common order (`move` -> `orderMove`); Demolish is `orderDemolish`. */
export const orderControl = (engineId: string): ActionId => `order${engineId[0].toUpperCase()}${engineId.slice(1)}` as ActionId;

const ORDER_DEFS: ActionDef[] = [
  ...COMMON_ACTIONS.map((a): ActionDef => ({
    id: orderControl(a.id),
    label: a.label,
    hint: a.aim ? 'Then left-click a target' : 'Acts at once',
    section: 'orders',
    context: 'selection',
    inputs: ['key'],
    // Attack and Stop sit on Ctrl + letter and Unload on Shift + D, which leaves A, S and D free for the camera.
    defaults: [`${a.id === 'attack' || a.id === 'stop' ? 'ctrl+' : a.id === 'dock' ? 'shift+' : ''}key:Key${a.key}`],
  })),
  { id: 'orderDemolish', label: 'Demolish', hint: 'Press twice to confirm', section: 'orders', context: 'selection', inputs: ['key'], defaults: [`key:Key${DEMOLISH_KEY}`] },
];

const BUILD_DEFS: ActionDef[] = [
  { id: 'buildMenu', label: 'Open build menu', hint: 'With a builder selected; again to close', section: 'building', context: 'selection', inputs: ['key'], defaults: ['key:KeyB'] },
  { id: 'buildCategoryPrev', label: 'Previous category', hint: 'Opens the menu if it is closed', section: 'building', context: 'selection', inputs: ['key'], defaults: ['key:KeyQ'] },
  { id: 'buildCategoryNext', label: 'Next category', hint: '', section: 'building', context: 'selection', inputs: ['key'], defaults: ['key:KeyE'] },
  { id: 'buildItemPrev', label: 'Previous building', hint: 'Moves the highlight in the open menu', section: 'building', context: 'selection', inputs: ['key'], defaults: ['key:Comma'] },
  { id: 'buildItemNext', label: 'Next building', hint: '', section: 'building', context: 'selection', inputs: ['key'], defaults: ['key:Period'] },
  { id: 'buildConfirm', label: 'Place highlighted building', hint: 'Starts placing it', section: 'building', context: 'selection', inputs: ['key'], defaults: ['key:Enter', 'key:NumpadEnter'] },
];

/** Listed by tab of Options > Controls (`section`); within a tab, in this order (the editor adds Keys / Mouse and trackpad headings where the kind of input changes). */
export const ACTIONS: readonly ActionDef[] = [
  { id: 'panLeft', label: 'Pan left', hint: 'Hold to glide the view', section: 'camera', inputs: ['key'], defaults: ['key:ArrowLeft', 'key:KeyA'] },
  { id: 'panRight', label: 'Pan right', hint: '', section: 'camera', inputs: ['key'], defaults: ['key:ArrowRight', 'key:KeyD'] },
  { id: 'panUp', label: 'Pan up', hint: '', section: 'camera', inputs: ['key'], defaults: ['key:ArrowUp', 'key:KeyW'] },
  { id: 'panDown', label: 'Pan down', hint: '', section: 'camera', inputs: ['key'], defaults: ['key:ArrowDown', 'key:KeyS'] },
  { id: 'zoomIn', label: 'Zoom in', hint: 'Towards the middle of the view', section: 'camera', inputs: ['key'], defaults: ['key:Equal', 'key:NumpadAdd'] },
  { id: 'zoomOut', label: 'Zoom out', hint: '', section: 'camera', inputs: ['key'], defaults: ['key:Minus', 'key:NumpadSubtract'] },
  { id: 'resetView', label: 'Reset view', hint: 'Fit the whole map', section: 'camera', inputs: ['key'], defaults: ['key:Home'] },
  { id: 'panDrag', label: 'Pan by dragging', hint: 'Drag the map', section: 'camera', inputs: ['mouse'], defaults: ['mouse:1'] },
  { id: 'zoom', label: 'Zoom', hint: 'At the pointer', section: 'camera', inputs: ['wheel', 'scroll', 'pinch'], defaults: ['wheel', 'pinch'] },
  { id: 'panScroll', label: 'Pan by scrolling', hint: 'Moves the view with the scroll', section: 'camera', inputs: ['scroll', 'wheel'], defaults: ['scroll'] },
  { id: 'select', label: 'Select', hint: 'Click a unit or drag a box', section: 'selection', inputs: ['mouse'], defaults: ['mouse:0'] },
  { id: 'addSelect', label: 'Add to selection', hint: 'Hold while selecting', section: 'selection', inputs: ['mod'], defaults: ['mod:shift'] },
  { id: 'groupAssign', label: 'Save control group', hint: 'Hold with a number key 1-9: the selection becomes that group', section: 'selection', inputs: ['mod'], defaults: ['mod:ctrl', 'mod:meta'] },
  { id: 'groupAdd', label: 'Add to control group', hint: 'Hold with a number key 1-9: adds the selection to that group', section: 'selection', inputs: ['mod'], defaults: ['mod:shift'] },
  { id: 'groupSelect', label: 'Select control group', hint: 'Hold with a number key 1-9 to select that group; with nothing set, the bare number key does it', section: 'selection', inputs: ['mod'], defaults: [] },
  { id: 'cancel', label: 'Cancel / deselect', hint: 'Leaves aiming or placing, then clears the selection', section: 'selection', inputs: ['key'], defaults: ['key:Escape'] },
  { id: 'order', label: 'Give order', hint: 'Move, attack, harvest, build; drag to spread units along a path', section: 'orders', inputs: ['mouse'], defaults: ['mouse:2'] },
  { id: 'queue', label: 'Queue orders', hint: 'Hold while ordering or placing: add to the queue instead of replacing it', section: 'orders', inputs: ['mod'], defaults: ['mod:ctrl', 'mod:shift'] },
  ...ORDER_DEFS,
  ...BUILD_DEFS,
  { id: 'fillQueue', label: 'Fill production queue', hint: 'Hold while clicking a unit in the Build units panel: fills the rest of the queue with it', section: 'building', inputs: ['mod'], defaults: ['mod:ctrl'] },
];

const DEFS = new Map<ActionId, ActionDef>(ACTIONS.map((a) => [a.id, a]));
export const actionDef = (id: ActionId): ActionDef => DEFS.get(id)!;

const INPUT_RE = /^(key:[A-Za-z0-9]{1,24}|mouse:[012]|wheel|scroll|pinch|mod:(ctrl|shift|alt|meta))$/;

export function kindOf(input: string): InputKind {
  const i = input.indexOf(':');
  return (i < 0 ? input : input.slice(0, i)) as InputKind;
}

/** Canonical text form: mods in a fixed order, then the input. */
export function bindingToString(b: Binding): string {
  return [...MODS.filter((m) => b.mods.includes(m)), b.input].join('+');
}

export function parseBinding(text: unknown): Binding | null {
  if (typeof text !== 'string' || text.length > 80) return null;
  const parts = text.split('+');
  const input = parts.pop()!;
  if (!INPUT_RE.test(input)) return null;
  const mods: Mod[] = [];
  for (const p of parts) {
    if (!MODS.includes(p as Mod) || mods.includes(p as Mod)) return null;
    mods.push(p as Mod);
  }
  if (input.startsWith('mod:') && mods.length) return null;
  return { input, mods: MODS.filter((m) => mods.includes(m)) };
}

const KEY_NAMES: Record<string, string> = {
  ArrowLeft: 'Left arrow', ArrowRight: 'Right arrow', ArrowUp: 'Up arrow', ArrowDown: 'Down arrow',
  Equal: '= (plus)', Minus: '- (minus)', NumpadAdd: 'Numpad +', NumpadSubtract: 'Numpad -', Backquote: '`',
  BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\',
};
const INPUT_NAMES: Record<string, string> = {
  'mouse:0': 'Left button',
  'mouse:1': 'Middle button',
  'mouse:2': 'Right button',
  wheel: 'Mouse wheel',
  scroll: 'Two-finger scroll',
  pinch: 'Pinch',
};

export function keyName(code: string): string {
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  return code.replace(/([a-z])([A-Z0-9])/g, '$1 $2');
}

export function inputName(input: string): string {
  if (input.startsWith('key:')) return keyName(input.slice(4));
  if (input.startsWith('mod:')) return MOD_LABEL[input.slice(4) as Mod];
  return INPUT_NAMES[input] ?? input;
}

export function formatBinding(b: Binding): string {
  return [...b.mods.map((m) => MOD_LABEL[m]), inputName(b.input)].join(' + ');
}

export interface ModState {
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
}

const modHeld = (m: Mod, ev: ModState): boolean => (m === 'ctrl' ? ev.ctrlKey : m === 'shift' ? ev.shiftKey : m === 'alt' ? ev.altKey : ev.metaKey);

/** The mods held in an event, as a canonical list. */
export const modsOf = (ev: ModState): Mod[] => MODS.filter((m) => modHeld(m, ev));

const defaultSlots = (def: ActionDef): (Binding | null)[] => Array.from({ length: SLOTS }, (_, i) => parseBinding(def.defaults[i]));

const STORAGE_KEY = 'wst-controls';

const keyText = (slots: readonly (Binding | null)[]): string => {
  const b = slots.find((x) => x?.input.startsWith('key:'));
  if (!b) return '';
  const m = /^Key([A-Z])$/.exec(b.input.slice(4));
  return m && !b.mods.length ? m[1] : formatBinding(b);
};

/** The shipped key text for an action ("Shift + M"), for the manual. */
export const defaultKeyLabel = (id: ActionId): string => keyText(defaultSlots(actionDef(id)));

export class Controls {
  private slots = new Map<ActionId, (Binding | null)[]>();

  constructor() {
    this.reload();
  }

  /** Reads the saved settings (or the defaults). Safe on corrupt or hostile storage. */
  reload(): void {
    this.slots = new Map(ACTIONS.map((a) => [a.id, defaultSlots(a)]));
    let saved: unknown;
    try {
      saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    } catch {
      return;
    }
    const table = (saved as { bindings?: unknown } | null)?.bindings;
    if (!table || typeof table !== 'object') return;
    for (const def of ACTIONS) {
      const row = (table as Record<string, unknown>)[def.id];
      if (!Array.isArray(row)) continue;
      this.slots.set(
        def.id,
        Array.from({ length: SLOTS }, (_, i) => {
          const b = parseBinding(row[i]);
          return b && def.inputs.includes(kindOf(b.input)) ? b : null;
        }),
      );
    }
  }

  private save(): void {
    // Only what differs from the defaults is kept, so a later change of default reaches players who never touched that control.
    const bindings: Record<string, string[]> = {};
    for (const [id, row] of this.slots) if (!this.isDefault(id)) bindings[id] = row.map((b) => (b ? bindingToString(b) : ''));
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, bindings }));
    } catch {
      // Not persisted; the settings still apply until the page closes.
    }
  }

  slotsOf(id: ActionId): readonly (Binding | null)[] {
    return this.slots.get(id)!;
  }

  set(id: ActionId, slot: number, b: Binding | null): void {
    const row = this.slots.get(id);
    if (!row || slot < 0 || slot >= SLOTS) return;
    row[slot] = b;
    this.save();
  }

  resetAll(): void {
    this.slots = new Map(ACTIONS.map((a) => [a.id, defaultSlots(a)]));
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Nothing saved to remove.
    }
  }

  /**
   * The action among `candidates` that `input` (e.g. `mouse:0`, `key:KeyW`) with the held mods
   * triggers. Keys need exactly the bound mods; mouse and wheel inputs need at least the bound
   * mods, and the binding with the most mods wins, so Shift + wheel can differ from the wheel.
   */
  find(input: string, ev: ModState, candidates: readonly ActionId[]): ActionId | null {
    const held = modsOf(ev);
    const exact = input.startsWith('key:');
    let best: ActionId | null = null;
    let bestMods = -1;
    for (const id of candidates) {
      for (const b of this.slots.get(id)!) {
        if (!b || b.input !== input) continue;
        const ok = exact ? b.mods.length === held.length && b.mods.every((m) => held.includes(m)) : b.mods.every((m) => held.includes(m));
        if (ok && b.mods.length > bestMods) {
          best = id;
          bestMods = b.mods.length;
        }
      }
    }
    return best;
  }

  /** Short text for the first key bound to `id` ("M", "Shift + M"), or '' if none; shown on buttons. */
  keyLabel(id: ActionId): string {
    return keyText(this.slots.get(id)!);
  }

  /** Whether both slots of `id` are as shipped. */
  isDefault(id: ActionId): boolean {
    const same = (a: Binding | null, b: Binding | null) => (a ? !!b && bindingToString(a) === bindingToString(b) : !b);
    const def = defaultSlots(actionDef(id));
    return this.slots.get(id)!.every((b, i) => same(b, def[i]));
  }

  /** Puts `id` back to its default bindings. */
  resetAction(id: ActionId): void {
    this.slots.set(id, defaultSlots(actionDef(id)));
    this.save();
  }

  /** Whether `id` has any modifier bound at all. */
  hasModifier(id: ActionId): boolean {
    return this.slots.get(id)!.some((b) => b !== null);
  }

  /** Whether a modifier action (`addSelect`, `queue`, `groupAssign`...) has a held modifier in `ev`. */
  modifierHeld(id: ActionId, ev: ModState): boolean {
    return this.slots.get(id)!.some((b) => b && modHeld(b.input.slice(4) as Mod, ev));
  }
}

export const controls = new Controls();

// --- trackpad or wheel? ---------------------------------------------------------------

/** A wheel event with whole pixels, on one axis, at least this big, is a mouse notch rather than a trackpad scroll. */
const NOTCH_MIN = 50;
/** Events this soon after a trackpad one are treated as trackpad too, so a fast flick is not read as notches. */
const TRACKPAD_STICKY_MS = 200;

export type WheelKind = 'wheel' | 'scroll' | 'pinch';

/**
 * Browsers give no direct way to tell a mouse wheel from a trackpad. A pinch arrives as a wheel
 * event with Ctrl held and small deltas; a mouse notch is line-based or a whole 100-ish pixels on
 * one axis; anything else is a two-finger scroll.
 */
export class WheelClassifier {
  private lastTrackpad = -Infinity;

  classify(ev: { deltaX: number; deltaY: number; deltaMode: number; ctrlKey: boolean }, now: number): WheelKind {
    const whole = Number.isInteger(ev.deltaX) && Number.isInteger(ev.deltaY);
    const oneAxis = ev.deltaX === 0 || ev.deltaY === 0;
    const notch = ev.deltaMode !== 0 || (whole && oneAxis && Math.max(Math.abs(ev.deltaX), Math.abs(ev.deltaY)) >= NOTCH_MIN);
    const settled = now - this.lastTrackpad > TRACKPAD_STICKY_MS;
    if (notch && settled) return 'wheel';
    this.lastTrackpad = now;
    return ev.ctrlKey ? 'pinch' : 'scroll';
  }
}

// --- warnings -------------------------------------------------------------------------

export interface Env {
  readonly firefox: boolean;
  readonly mac: boolean;
  readonly linux: boolean;
}

export function detectEnv(): Env {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  const platform = typeof navigator === 'undefined' ? '' : navigator.platform ?? '';
  return { firefox: /firefox/i.test(ua), mac: /mac/i.test(platform) && !/iphone|ipad/i.test(ua), linux: /linux|x11/i.test(platform) || /linux/i.test(ua) };
}

export interface Issue {
  /** `blocked`: cannot be assigned. `conflict`: already used by `other` (assignable by replacing it). `warn`: assignable, but may not work everywhere. */
  readonly level: 'blocked' | 'conflict' | 'warn';
  readonly text: string;
  readonly other?: ActionId;
}

/** Combinations the browser or system takes before the page sees them. */
const RESERVED_KEYS = new Set([
  'ctrl+key:KeyW', 'ctrl+key:KeyT', 'ctrl+key:KeyN', 'ctrl+shift+key:KeyN', 'ctrl+shift+key:KeyT', 'ctrl+shift+key:KeyW',
  'ctrl+key:Tab', 'ctrl+shift+key:Tab', 'ctrl+key:PageUp', 'ctrl+key:PageDown', 'alt+key:F4', 'alt+key:Tab',
  'key:F11', 'key:F12', 'ctrl+shift+key:KeyI', 'ctrl+shift+key:KeyJ',
]);

const labelOf = (id: ActionId) => actionDef(id).label;

const modName = (mods: readonly Mod[]) => mods.map((m) => MOD_LABEL[m]).join(' + ');

/**
 * Everything worth telling the player about `b` in `slot` of `id`: unusable combinations,
 * clashes with other controls, and combinations that only work in some browsers or systems.
 */
export function checkBinding(c: Controls, id: ActionId, slot: number, b: Binding, env: Env): Issue[] {
  const issues: Issue[] = [];
  const text = bindingToString(b);
  const has = (m: Mod) => b.mods.includes(m);
  const kind = kindOf(b.input);

  if (kind === 'key') {
    if (RESERVED_KEYS.has(text)) {
      issues.push({ level: 'blocked', text: `${formatBinding(b)} is taken by your browser or system, so the game never sees it.` });
    } else if (has('meta')) {
      issues.push({ level: 'warn', text: `Combinations with ${MOD_LABEL.meta} (Windows or Command) are often taken by the system and may not reach the game.` });
    }
    const code = b.input.slice(4);
    if (/^(Digit|Numpad)[1-9]$/.test(code) && !has('alt') && !has('meta')) {
      issues.push({ level: 'blocked', text: 'The number keys pick the control group; change what Ctrl, Shift and the like do with them under Selection instead.' });
    }
    if (code === 'F1' || code === 'F2') issues.push({ level: 'blocked', text: 'F1 opens the Manual and F2 the Designer.' });
  } else if (kind === 'mouse') {
    if (b.input === 'mouse:2' && has('shift')) {
      issues.push(
        env.firefox
          ? { level: 'blocked', text: 'Firefox always opens its own menu on Shift + right click and the game cannot stop it.' }
          : { level: 'warn', text: 'Shift + right click does not work in Firefox, which always opens its own menu. It works in other browsers.' },
      );
    }
    if (b.input === 'mouse:0' && has('ctrl') && env.mac) issues.push({ level: 'warn', text: 'On a Mac, Ctrl + click is treated as a right click.' });
    if (has('alt') && env.linux) issues.push({ level: 'warn', text: 'Many Linux desktops use Alt + drag to move windows, which can swallow this.' });
  } else if (kind === 'scroll' && has('ctrl')) {
    issues.push({ level: 'blocked', text: 'A two-finger scroll with Ctrl held looks like a pinch to the browser, so the two cannot be told apart.' });
  } else if (kind === 'pinch' && has('ctrl')) {
    issues.push({ level: 'blocked', text: 'Browsers report a pinch as Ctrl + wheel, so a pinch cannot be combined with Ctrl.' });
  } else if (kind === 'mod' && b.input === 'mod:shift' && id === 'queue') {
    const second = c.slotsOf('queue').some((o, i) => i !== slot && o && o.input !== 'mod:shift');
    if (!second) issues.push({ level: 'warn', text: 'Shift + right click does not work in Firefox. Keep another key (such as Ctrl) as well for Firefox players.' });
  }

  if (kind !== 'mod') {
    for (const other of ACTIONS) {
      const row = c.slotsOf(other.id);
      for (let i = 0; i < row.length; i++) {
        const o = row[i];
        if (!o || (other.id === id && i === slot) || o.input !== b.input) continue;
        const same = o.mods.length === b.mods.length && o.mods.every((m) => b.mods.includes(m));
        if (same) {
          const mine = actionDef(id).context;
          if (mine === other.context) issues.push({ level: 'conflict', other: other.id, text: `Already used for "${labelOf(other.id)}".` });
          else if (!mine) issues.push({ level: 'warn', text: `Shared with "${labelOf(other.id)}", which takes priority whenever your selection can use it.` });
        } else if (kind !== 'key') {
          // The more specific binding wins; tell the player when that takes a modifier from select or order.
          const extra = b.mods.filter((m) => !o.mods.includes(m));
          const subset = o.mods.every((m) => b.mods.includes(m));
          const mod = other.id === 'select' ? 'addSelect' : other.id === 'order' ? 'queue' : null;
          if (subset && mod && extra.some((m) => c.slotsOf(mod).some((s) => s?.input === `mod:${m}`))) {
            issues.push({ level: 'warn', text: `While you hold ${modName(extra)}, this takes over from "${labelOf(other.id)}", so ${modName(extra)} no longer ${mod === 'queue' ? 'queues orders' : 'adds to the selection'}.` });
          }
        }
      }
    }
  }
  return issues;
}
