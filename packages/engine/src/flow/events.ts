/**
 * Event sources: the only entry points of a program. Each event has a fixed id (append
 * only), parameters that become data outputs of its block, and a configuration schema:
 * the settings of whatever raises it (sensor sweep, filters, timers, button label).
 * Configuration is constants only and costs nothing to run; hardware limits clamp it.
 */

export type ConfigType = 'int' | 'ints' | 'string';

export interface ConfigField {
  readonly name: string;
  readonly type: ConfigType;
  /** Default for `int` / `string`; for `ints` the default list. */
  readonly default: number | string | readonly number[];
  readonly min?: number;
  readonly max?: number;
  readonly doc: string;
}

export interface EventDef {
  readonly id: number;
  readonly name: string;
  readonly params: readonly string[];
  readonly config: readonly ConfigField[];
  /** A class may have several blocks of this event, each with its own configuration. */
  readonly multi: boolean;
  readonly doc: string;
}

/** Sensor kinds a `Detected` block can watch, in constants form. */
export const DetectKind = { Enemy: 1, Resource: 2, DamagedAlly: 3, Missile: 4 } as const;
/** Order policy constants. */
export const OrderPolicy = { Queue: 0, Replace: 1 } as const;
export const DetectSort = { Nearest: 0, Weakest: 1, Strongest: 2, MostDamaged: 3 } as const;

/** Constants usable in programs, besides the game's own (MOVE, ENEMY, ...). */
export const FLOW_CONSTANT_DOCS: readonly (readonly [string, number, string])[] = [
  ['QUEUE', OrderPolicy.Queue, 'Order policy: urgent orders wait their turn'],
  ['REPLACE', OrderPolicy.Replace, 'Order policy: an urgent order replaces the plan'],
  ['ENEMY', DetectKind.Enemy, 'Detected kind: an enemy unit or building'],
  ['RESOURCE', DetectKind.Resource, 'Detected kind: a resource field with matter left'],
  ['DAMAGED_ALLY', DetectKind.DamagedAlly, 'Detected kind: an own unit or building missing hit points'],
  ['MISSILE', DetectKind.Missile, 'Detected kind: an enemy missile in flight (ENEMY reports them too, among everything else)'],
  ['NEAREST', DetectSort.Nearest, 'Detected sort: closest first'],
  ['WEAKEST', DetectSort.Weakest, 'Detected sort: fewest hit points first (better sensors)'],
  ['STRONGEST', DetectSort.Strongest, 'Detected sort: most hit points first (better sensors)'],
  ['MOST_DAMAGED', DetectSort.MostDamaged, 'Detected sort: lowest health percentage first (better sensors)'],
];

const int = (name: string, def: number, min: number, max: number, doc: string): ConfigField => ({ name, type: 'int', default: def, min, max, doc });
const ints = (name: string, def: readonly number[], doc: string): ConfigField => ({ name, type: 'ints', default: def, doc });

export const EVENTS: readonly EventDef[] = [
  {
    id: 1, name: 'Spawned', params: ['reason'], config: [], multi: false,
    doc: 'The unit was just built (reason 0) or rebooted after a crash or a new program (reason 1).',
  },
  {
    id: 2, name: 'Idle', params: [], multi: false,
    config: [int('interval', 1, 1, 600, 'Fire at most every this many ticks')],
    doc: 'The CPU was evaluated and nothing else is queued or running. Never fires while there is other work, and a class without an Idle block never pays for idling. `rest(n)` pauses it.',
  },
  {
    id: 3, name: 'Every', params: [], multi: true,
    config: [int('ticks', 10, 1, 6000, 'Period in ticks')],
    doc: 'A repeating timer.',
  },
  {
    id: 4, name: 'Timer', params: ['id'], multi: true,
    config: [ints('ids', [], 'Only these timer ids (empty: any)')],
    doc: 'A one-shot timer set by `after(ticks, id)` went off.',
  },
  {
    id: 5, name: 'Order', params: ['type', 'tx', 'ty', 'target'], multi: true,
    config: [
      ints('types', [], 'Only these task types, such as MOVE (empty: any)'),
      int('from', 0, 0, 3, 'Only orders from FROM_PLAYER (1), FROM_BUILDING (2) or both (3); 0 = anyone'),
      int('urgent', 0, 0, 1, 'QUEUE (0): urgent orders wait their turn like any other. REPLACE (1): an urgent order drops every older order and cancels the current activity first'),
    ],
    doc: 'An order reached the front of the unit\'s order list: the player or a building gave it while the unit was free, an urgent order replaced the plan, or nextOrder() moved on to it.',
  },
  { id: 6, name: 'Arrived', params: [], config: [], multi: false, doc: 'Travel finished (or ended near the goal).' },
  {
    id: 7, name: 'Damaged', params: ['amount', 'attacker'], multi: false,
    config: [int('minAmount', 0, 0, 100000, 'Ignore hits smaller than this')],
    doc: 'The unit took damage. `attacker` is the owner id of the weapon that hit.',
  },
  {
    id: 8, name: 'Detected', params: ['kind', 'handle'], multi: true,
    config: [
      ints('watch', [DetectKind.Enemy], 'Kinds to look for, in priority order (better sensors allow more)'),
      int('range', 255, 1, 255, 'Sweep radius in tiles (capped by the sensor)'),
      int('interval', 5, 1, 600, 'Ticks between sweeps (at least the sensor minimum)'),
      int('sort', DetectSort.Nearest, 0, 3, 'Which candidate is reported first (better sensors allow more modes)'),
      int('limit', 1, 1, 8, 'Most reports per sweep (better sensors allow more)'),
    ],
    doc: 'The sensor swept and found something. Raised once per report, in priority order, only when something is found; each sweep costs the sensor its energy.',
  },
  {
    id: 9, name: 'Visitor', params: ['reason', 'visitor'], multi: true,
    config: [ints('reasons', [], 'Only these reasons, PRODUCED or DOCKED (empty: any)')],
    doc: 'Building: a unit was just produced here or docked here. While the handler runs, order() and the visitor queries apply to that unit.',
  },
  {
    id: 10, name: 'Button', params: ['tx', 'ty', 'target'], multi: true,
    config: [
      { name: 'label', type: 'string', default: 'Button', doc: 'Text on the button' },
      { name: 'key', type: 'string', default: '', doc: 'Hotkey: one upper-case letter' },
      int('aim', 0, 0, 1, '1: the player picks a point or unit on the map after pressing it'),
      { name: 'name', type: 'string', default: '', doc: 'Identifier (defaults to the label)' },
    ],
    doc: 'The player pressed this button. Aimed buttons carry the picked tile and target handle (-1 if none); others the unit\'s own tile.',
  },
  {
    id: 11, name: 'EnergyLow', params: [], multi: false,
    config: [int('below', 25, 1, 99, 'Percent')],
    doc: 'Stored energy fell below the threshold.',
  },
  {
    id: 13, name: 'Free', params: [], multi: false,
    config: [int('repeat', 0, 0, 6000, 'Ask again every this many ticks while the unit stays free (0: only once)')],
    doc: 'The unit has nothing left to do: a job ended with no chain attached, or there is no next order, or it was just built. Raised once when that happens, and again every `repeat` ticks while the unit stays free, so a free unit can look for work without polling.',
  },
  {
    id: 12, name: 'EnergyFull', params: [], multi: false,
    config: [int('above', 95, 2, 100, 'Percent')],
    doc: 'Stored energy rose above the threshold.',
  },
];

export const EVENT_BY_NAME: ReadonlyMap<string, EventDef> = new Map(EVENTS.map((e) => [e.name, e]));
export const EVENT_BY_ID: ReadonlyMap<number, EventDef> = new Map(EVENTS.map((e) => [e.id, e]));
export const EventId = Object.fromEntries(EVENTS.map((e) => [e.name, e.id])) as Record<
  'Spawned' | 'Idle' | 'Every' | 'Timer' | 'Order' | 'Arrived' | 'Damaged' | 'Detected' | 'Visitor' | 'Button' | 'EnergyLow' | 'EnergyFull' | 'Free',
  number
>;
