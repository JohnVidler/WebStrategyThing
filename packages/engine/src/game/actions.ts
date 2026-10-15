import { compile } from '../vm/compiler';
import type { Program } from '../vm/types';
import { SCRIPT_CONSTANTS, UNIT_API } from './api';
import { Caps, type BlueprintStats } from './blueprint';
import { TaskType } from './tasks';

/**
 * Player action buttons. Two kinds share the sidebar grid:
 *  - common actions (below) are always shown, and enabled when at least one
 *    selected unit has the modules to carry them out;
 *  - custom buttons are declared by class scripts (`button name "Label"`) and
 *    shown while a unit of that class is selected. Pressing one pushes the
 *    button's task type onto every selected unit whose class declares it.
 * Either way the result is just a task: the unit's script decides what happens.
 */

/** Task type of a class's first declared button; later buttons follow on. */
export const CUSTOM_TASK_BASE = 100;

export interface CommonAction {
  readonly id: string;
  readonly label: string;
  /** Hotkey (upper case). */
  readonly key: string;
  readonly icon: string;
  readonly task: number;
  /** The player picks a point or unit on the map after pressing it. */
  readonly aim: boolean;
  readonly doc: string;
  /** Whether a unit with these stats can take this task. */
  readonly can: (s: BlueprintStats) => boolean;
}

const has = (s: BlueprintStats, caps: number) => (s.caps & caps) === caps;

export const COMMON_ACTIONS: readonly CommonAction[] = [
  {
    id: 'move', label: 'Move', key: 'M', icon: '➜', task: TaskType.Move, aim: true,
    doc: 'Move to a point. On a building: set its rally point.',
    can: (s) => has(s, Caps.Move) || (s.structure && s.factory && s.cyclesPerTick > 0),
  },
  {
    id: 'attack', label: 'Attack', key: 'A', icon: '⚔', task: TaskType.Attack, aim: true,
    doc: 'Attack a unit, or attack-move to a point. Needs a weapon.',
    can: (s) => has(s, Caps.Fight),
  },
  {
    id: 'stop', label: 'Stop', key: 'S', icon: '■', task: TaskType.Stop, aim: false,
    doc: 'Stop what you are doing. Needs a CPU; buildings can\'t move, so it doesn\'t apply to them.',
    can: (s) => !s.structure && s.cyclesPerTick > 0,
  },
  {
    id: 'harvest', label: 'Harvest', key: 'H', icon: '⛏', task: TaskType.Harvest, aim: true,
    doc: 'Gather from a resource field (the nearest one to the point picked). Needs a cargo bay.',
    can: (s) => has(s, Caps.Harvest | Caps.Move),
  },
  {
    id: 'dock', label: 'Unload', key: 'D', icon: '⇩', task: TaskType.Dock, aim: false,
    doc: 'Take the cargo to the nearest depot. Needs a cargo bay.',
    can: (s) => has(s, Caps.Harvest | Caps.Move),
  },
  {
    id: 'repair', label: 'Repair', key: 'R', icon: '✚', task: TaskType.Repair, aim: true,
    doc: 'Mend an own unit or building (the damaged one nearest the point if none is picked). Costs energy and matter. Needs a repair module and a motor.',
    can: (s) => has(s, Caps.Repair | Caps.Move),
  },
  {
    id: 'charge', label: 'Recharge', key: 'C', icon: 'ϟ', task: TaskType.Charge, aim: false,
    doc: 'Recharge at the nearest charging pad. Needs a motor.',
    can: (s) => has(s, Caps.Move),
  },
];

export const COMMON_ACTION_BY_TASK = new Map(COMMON_ACTIONS.map((a) => [a.task, a]));

/** Hotkey of the Demolish button (a player command, not a task). */
export const DEMOLISH_KEY = 'X';
/** Keys taken by common actions and other controls; class buttons may not use them. */
export const RESERVED_KEYS: ReadonlyMap<string, string> = new Map([
  ...COMMON_ACTIONS.map((a) => [a.key, a.label] as const),
  [DEMOLISH_KEY, 'Demolish'],
]);

/** Compiles a class program exactly as the server does (game API, constants and button rules). */
export function compileUnitProgram(source: string): Program {
  return compile(source, UNIT_API, SCRIPT_CONSTANTS, { buttonBase: CUSTOM_TASK_BASE, reservedKeys: RESERVED_KEYS });
}
