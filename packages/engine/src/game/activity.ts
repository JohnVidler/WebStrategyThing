import { enqueueContinuation, type FlowState } from '../flow/run';
import { Caps } from './blueprint';
import { BUILDING_BUILD_RANGE, TILE } from './rules';
import type { Simulation } from './simulation';

/*
 * Activities: the long jobs a unit does (walk somewhere, gather until full, dock, build,
 * repair, recharge, fight). A program starts one; the engine carries it out every tick, with
 * no program code running, and reports how it ended. A unit does one activity at a time:
 * starting another cancels the current one. Outcomes can have chains attached in the program
 * (`harvest(field, { full: () => { ... } })`); an ended activity runs the matching chain as its
 * own short handler, in the frame the call was made in.
 */

export const ActivityKind = {
  None: 0,
  GoTo: 1,
  Approach: 2,
  Harvest: 3,
  Dock: 4,
  Take: 5,
  Build: 6,
  Repair: 7,
  Charge: 8,
  Supply: 9,
  Engage: 10,
} as const;

/** Outcome names of each activity, in the order programs and editors list them (and the index used below). */
export const ACTIVITY_OUTCOMES: Readonly<Record<string, readonly string[]>> = {
  goTo: ['arrived', 'blocked'],
  approach: ['arrived', 'lost', 'blocked'],
  harvest: ['full', 'empty', 'lost', 'blocked'],
  dock: ['docked', 'noRoom', 'lost', 'blocked'],
  take: ['taken', 'lost', 'blocked'],
  build: ['built', 'gone', 'starved', 'blocked'],
  repair: ['repaired', 'gone', 'starved', 'blocked'],
  charge: ['charged', 'lost', 'blocked'],
  supply: ['revived', 'refused', 'blocked'],
  engage: ['destroyed', 'lost', 'blocked'],
};

/** A harvester swaps a field for another when it is down to this much matter. */
export const EMPTY_BELOW = 4;
/** Charged means this share of capacity (percent). */
export const CHARGED_PERCENT = 95;
/** A flat unit is revived to this share (percent). */
export const REVIVED_PERCENT = 50;
/** How close an engaging unit tries to get to a target it cannot reach with its weapon (tiles). */
const ENGAGE_CLOSE = 3;
/** Ticks between energy hand-overs while supplying. */
const SUPPLY_EVERY = 2;

export interface ActivityState {
  readonly kind: number;
  /** Entity handle of the target, or -1. */
  readonly target: number;
  /** Tile coordinates of a point target. */
  readonly x: number;
  readonly y: number;
  /** Activity-specific: range in tiles, amount to take. */
  readonly arg: number;
  /** For each outcome, the instruction its chain starts at (-1: none). */
  readonly entries?: Int32Array;
  readonly handler: number;
  readonly frame?: Int32Array;
  /** Started while handling an order: when it ends with no chain, the order is finished. */
  readonly forOrder: boolean;
  /** Ticks since it started (for supply pacing). */
  age: number;
}

/** Outcome indexes that every activity shares. */
const BLOCKED = (kind: number): number => ACTIVITY_OUTCOMES[NAME[kind]].length - 1;
const NAME: Readonly<Record<number, string>> = {
  [ActivityKind.GoTo]: 'goTo',
  [ActivityKind.Approach]: 'approach',
  [ActivityKind.Harvest]: 'harvest',
  [ActivityKind.Dock]: 'dock',
  [ActivityKind.Take]: 'take',
  [ActivityKind.Build]: 'build',
  [ActivityKind.Repair]: 'repair',
  [ActivityKind.Charge]: 'charge',
  [ActivityKind.Supply]: 'supply',
  [ActivityKind.Engage]: 'engage',
};

const tileCentre = (t: number) => t * TILE + TILE / 2;

/** Clears whatever a unit's modules were pointed at for the old activity. */
function release(sim: Simulation, e: number): void {
  if (sim.harvester.has(e)) sim.harvester.f.target[e] = -1;
  if (sim.builder.has(e)) sim.builder.f.target[e] = -1;
  if (sim.repairer.has(e)) sim.repairer.f.target[e] = -1;
}

/** Stops the current activity without running any of its chains. `halt`: also stop moving. `forget`: also drop activities put aside. */
export function cancelActivity(sim: Simulation, e: number, halt = false, forget = false): void {
  if (forget) sim.suspended[e] = undefined;
  const a = sim.activities[e];
  if (!a) return;
  sim.activities[e] = undefined;
  sim.activeUnits.delete(e);
  release(sim, e);
  if (a.kind === ActivityKind.Engage && sim.weapon.has(e)) sim.weapon.f.target[e] = -1;
  if (halt) sim.halt(e);
}

/** Puts the current activity aside (to be restored by `resumeActivity`) and stops the unit. */
export function suspendActivity(sim: Simulation, e: number): boolean {
  const a = sim.activities[e];
  if (!a) return false;
  (sim.suspended[e] ??= []).push(a);
  cancelActivity(sim, e, true);
  return true;
}

/** Brings back the activity last put aside. False if there is none. */
export function resumeActivity(sim: Simulation, e: number): boolean {
  const a = sim.suspended[e]?.pop();
  if (!a) return false;
  cancelActivity(sim, e);
  sim.activities[e] = a;
  sim.activeUnits.add(e);
  return true;
}

/**
 * Starts an activity (cancelling the current one). Returns 1 if started. A job that cannot start
 * (no motor, no cargo bay, ...) still "starts" and ends at once as `blocked`, so a program's chain for it runs.
 */
export function startActivity(sim: Simulation, e: number, kind: number, target: number, x: number, y: number, arg: number): number {
  cancelActivity(sim, e);
  const fs: FlowState | undefined = sim.flows[e];
  const latent = fs && fs.latentTable >= 0 ? fs.latentTable : -1;
  const state: ActivityState = {
    kind,
    target,
    x,
    y,
    arg,
    entries: latent >= 0 ? fs!.program.tables[latent] : undefined,
    handler: latent >= 0 ? fs!.program.tableHandler[latent] : -1,
    frame: latent >= 0 ? fs!.locals.slice(0, Math.max(1, fs!.program.nLocals)) : undefined,
    forOrder: fs?.orderContext ?? false,
    age: 0,
  };
  sim.activities[e] = state;
  sim.activeUnits.add(e);
  return 1;
}

/** Ends the activity with the given outcome: runs the attached chain, or marks the unit free. */
function finish(sim: Simulation, e: number, a: ActivityState, outcome: number): void {
  cancelActivity(sim, e);
  const fs = sim.flows[e];
  if (!fs) return;
  const entry = a.entries?.[outcome] ?? -1;
  // A chain is only lost when the queue is full of orders and other chains.
  const chained = entry >= 0 && a.frame && a.handler >= 0 && enqueueContinuation(fs, a.handler, entry, a.frame, a.forOrder);
  if (!chained && a.forOrder && (sim.tasks[e]?.count ?? 0) > 0) {
    // Nothing continues the work, so the order is done: on to the next.
    sim.nextOrder(e);
    return;
  }
  // Whatever the chain does (or if there is none), the unit is told it is free once nothing is left to do.
  fs.freePending = true;
}

type Approach = 'in' | 'moving' | 'blocked';

/** Walks toward target `t` until within `tiles` of its edge (re-pathing as it moves). */
function approach(sim: Simulation, e: number, t: number, tiles: number): Approach {
  if (sim.edgeDistance(e, t) <= tiles * TILE) {
    if (sim.motion.has(e) && sim.motion.f.moving[e]) sim.halt(e);
    return 'in';
  }
  if (!sim.motion.has(e) || sim.stats(e).speed <= 0) return 'blocked';
  const m = sim.motion.f;
  const tx = sim.pos.f.x[t];
  const ty = sim.pos.f.y[t];
  if (m.arrived[e] && m.tx[e] === tx && m.ty[e] === ty) {
    // End of the path but still out of range: unreachable. Stopped by a crowd: try again.
    if (m.arrived[e] === 1) return 'blocked';
    m.arrived[e] = 0;
  }
  return sim.setDestination(e, tx, ty) < 0 ? 'blocked' : 'moving';
}

/** How far a build arm or repair beam reaches from the unit (tiles): the whole crane for buildings, one tile for units. */
const reachOf = (sim: Simulation, e: number): number => (sim.stats(e).structure ? BUILDING_BUILD_RANGE / TILE : 1);

/** One tick of one activity. Returns the outcome index if it has ended, else -1. */
function step(sim: Simulation, e: number, a: ActivityState): number {
  const s = sim.stats(e);
  const blocked = BLOCKED(a.kind);
  const t = a.target >= 0 ? sim.world.resolve(a.target) : -1;
  switch (a.kind) {
    case ActivityKind.GoTo: {
      if (!sim.motion.has(e) || s.speed <= 0) return blocked;
      const gx = tileCentre(a.x);
      const gy = tileCentre(a.y);
      const dx = gx - sim.pos.f.x[e];
      const dy = gy - sim.pos.f.y[e];
      if (dx * dx + dy * dy <= (TILE / 2) ** 2) {
        sim.halt(e);
        return 0;
      }
      const m = sim.motion.f;
      if (m.arrived[e] && m.tx[e] === gx && m.ty[e] === gy) return 0; // as close as it can get
      return sim.setDestination(e, gx, gy) < 0 ? blocked : -1;
    }
    case ActivityKind.Approach: {
      const target = t >= 0 ? sim.locate(e, a.target) : -1;
      if (target < 0) return 1;
      const r = approach(sim, e, target, a.arg);
      return r === 'in' ? 0 : r === 'blocked' ? 2 : -1;
    }
    case ActivityKind.Harvest: {
      if (s.cargo <= 0 || !sim.harvester.has(e)) return blocked;
      if (t < 0 || !sim.resource.has(t)) return 2;
      if (sim.cargo.f.amount[e] >= s.cargo) return 0;
      if (sim.resource.f.amount[t] <= EMPTY_BELOW) return 1;
      const r = approach(sim, e, t, 1);
      if (r === 'blocked') return blocked;
      if (r === 'in') sim.harvester.f.target[e] = a.target;
      return -1;
    }
    case ActivityKind.Dock: {
      if (!sim.cargo.has(e)) return blocked;
      if (t < 0 || !sim.stockpile.has(t) || sim.unit.f.owner[t] !== sim.unit.f.owner[e]) return 2;
      const r = approach(sim, e, t, 1);
      if (r === 'blocked') return blocked;
      if (r === 'in' && sim.dock(e, t)) return sim.cargo.f.amount[e] > 0 ? 1 : 0;
      return -1;
    }
    case ActivityKind.Take: {
      if (!sim.cargo.has(e)) return blocked;
      if (t < 0 || !sim.stockpile.has(t) || sim.unit.f.owner[t] !== sim.unit.f.owner[e]) return 1;
      const r = approach(sim, e, t, 1);
      if (r === 'blocked') return blocked;
      if (r === 'in') {
        sim.take(e, t, a.arg);
        return 0;
      }
      return -1;
    }
    case ActivityKind.Build: {
      if (!sim.builder.has(e) || s.buildRate <= 0) return blocked;
      if (t < 0) return 1;
      if (!sim.isSite(t)) return 0;
      if (sim.unit.f.owner[t] !== sim.unit.f.owner[e]) return 1;
      if (!sim.siteSupplied(t) && !(sim.cargo.has(e) && sim.cargo.f.amount[e] > 0)) return 2;
      const r = approach(sim, e, t, reachOf(sim, e));
      if (r === 'blocked') return blocked;
      if (r === 'in') sim.builder.f.target[e] = a.target;
      return -1;
    }
    case ActivityKind.Repair: {
      if (!sim.repairer.has(e) || s.repairRate <= 0) return blocked;
      if (t < 0 || !sim.health.has(t) || sim.unit.f.owner[t] !== sim.unit.f.owner[e] || sim.isSite(t)) return 1;
      if (sim.health.f.hp[t] >= sim.stats(t).hp) return 0;
      if (!s.structure && !(sim.cargo.has(e) && sim.cargo.f.amount[e] > 0)) return 2;
      const r = approach(sim, e, t, reachOf(sim, e));
      if (r === 'blocked') return blocked;
      if (r === 'in') sim.repairer.f.target[e] = a.target;
      return -1;
    }
    case ActivityKind.Charge: {
      if (!sim.motion.has(e) || s.speed <= 0) return blocked;
      if (t < 0 || !(sim.stats(t).caps & Caps.Charger) || sim.unit.f.owner[t] !== sim.unit.f.owner[e]) return 1;
      if (s.energyCapacity > 0 && sim.energy.f.amount[e] * 100 >= s.energyCapacity * CHARGED_PERCENT) return 0;
      const r = approach(sim, e, t, 1);
      return r === 'blocked' ? blocked : -1;
    }
    case ActivityKind.Supply: {
      if (t < 0 || !sim.energy.has(t) || sim.unit.f.owner[t] !== sim.unit.f.owner[e]) return 1;
      if (sim.energyView.f.pct[t] >= REVIVED_PERCENT) return 0;
      if (sim.energy.f.amount[e] * 2 < s.energyCapacity) return 1;
      const r = approach(sim, e, t, 1);
      if (r === 'blocked') return blocked;
      if (r === 'in' && a.age % SUPPLY_EVERY === 0) sim.transferEnergy(e, t, Math.floor(s.energyCapacity / 10));
      return -1;
    }
    case ActivityKind.Engage: {
      const w = s.weapon;
      if (!w || !sim.weapon.has(e)) return blocked;
      if (t < 0 || !sim.health.has(t)) return 0;
      const seen = sim.locate(e, a.target);
      if (seen < 0) return 1;
      sim.weapon.f.target[e] = a.target;
      if (sim.edgeDistance(e, t) > w.range) {
        const r = approach(sim, e, t, ENGAGE_CLOSE);
        if (r === 'blocked') return blocked;
      } else if (sim.motion.has(e) && sim.motion.f.moving[e]) {
        sim.halt(e);
      }
      return -1;
    }
    default:
      return blocked;
  }
}

/** Drives every unit's activity one tick; ended activities run their chains (or mark the unit free). */
export function activitySystem(sim: Simulation): void {
  for (const e of [...sim.activeUnits]) {
    const a = sim.activities[e];
    if (!a) {
      sim.activeUnits.delete(e);
      continue;
    }
    if (!sim.world.isAlive(e) || sim.isSite(e)) {
      cancelActivity(sim, e);
      continue;
    }
    const outcome = step(sim, e, a);
    a.age++;
    if (outcome >= 0) finish(sim, e, a, outcome);
  }
}
