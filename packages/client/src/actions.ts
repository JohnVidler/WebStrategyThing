import { COMMON_ACTIONS, DEMOLISH_KEY, DEMOLISH_REFUND, Unit } from '@wst/engine';
import type { ClientState } from './state';

/** One square in the sidebar action grid. */
export interface ActionButton {
  /** `cmd:<task>` for common actions, `ui:demolish`, or `btn:<name>` for class-declared buttons. */
  readonly id: string;
  readonly label: string;
  readonly key: string;
  readonly icon: string;
  readonly aim: boolean;
  readonly doc: string;
  readonly custom: boolean;
  /** The selected own units it applies to (empty: shown but disabled). */
  readonly units: number[];
}

/**
 * The action grid for a selection: every common action (enabled when some unit
 * can carry it out), then every button declared by the selected classes, merged
 * by name. Each button lists only the units it will actually reach.
 */
export function actionsFor(state: ClientState, selection: readonly number[]): ActionButton[] {
  const unit = state.world.store(Unit);
  const own = selection.filter((e) => state.isMine(e) && !state.isSite(e));
  const out: ActionButton[] = COMMON_ACTIONS.map((a) => ({
    id: `cmd:${a.task}`,
    label: a.label,
    key: a.key,
    icon: a.icon,
    aim: a.aim,
    doc: a.doc,
    custom: false,
    units: own.filter((e) => {
      const s = state.stats(e);
      return s !== undefined && a.can(s);
    }),
  }));
  // Demolish is a player command rather than a task (scripts can't refuse it).
  const buildings = selection.filter((e) => state.isMine(e) && state.isStructure(e));
  const sitesOnly = buildings.length > 0 && buildings.every((e) => state.isSite(e));
  out.push({
    id: 'ui:demolish',
    label: sitesOnly ? 'Cancel' : 'Demolish',
    key: DEMOLISH_KEY,
    icon: '✖',
    aim: false,
    doc: `Press twice. Sites refund everything invested; finished buildings refund ${DEMOLISH_REFUND * 100}% of their cost, plus any silo contents.`,
    custom: false,
    units: buildings,
  });
  const custom = new Map<string, ActionButton>();
  for (const e of own) {
    for (const b of state.buttonsOf(unit.f.blueprint[e])) {
      let entry = custom.get(b.name);
      if (!entry) {
        entry = {
          id: `btn:${b.name}`,
          label: b.label,
          key: b.key,
          icon: b.label.slice(0, 2),
          aim: b.aim,
          doc: `Class button '${b.name}'${b.aim ? ' (then pick a point or unit)' : ''}`,
          custom: true,
          units: [],
        };
        custom.set(b.name, entry);
      }
      entry.units.push(e);
    }
  }
  // Common keys win; a custom key used by two classes goes to the first one seen.
  const taken = new Set(out.map((a) => a.key));
  for (const b of custom.values()) {
    out.push(taken.has(b.key) ? { ...b, key: '' } : b);
    if (b.key) taken.add(b.key);
  }
  return out;
}
