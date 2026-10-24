import { configInt, configInts, type CompiledHandler } from '../flow/compile';
import { DetectKind, DetectSort } from '../flow/events';
import type { BlueprintStats } from './blueprint';
import { TILE } from './rules';
import type { Simulation } from './simulation';

/**
 * The sensor is configured on the `Detected` block (what to watch, how far, how often, in
 * which order, how many reports); better sensors allow more. This file is the one place
 * that turns that configuration into a sweep and decides what a sweep finds, so changing the
 * rules (line of sight, fog of war) leaves programs and events untouched.
 */

export interface SensorLimits {
  /** Most kinds a block may watch. */
  readonly kinds: number;
  /** Sort modes allowed. */
  readonly sorts: readonly number[];
  /** Most reports per sweep. */
  readonly limit: number;
  /** Fewest ticks between sweeps. */
  readonly minInterval: number;
}

const ALL_SORTS = [DetectSort.Nearest, DetectSort.Weakest, DetectSort.Strongest, DetectSort.MostDamaged];

/** Limits by sensor tier (1 = basic: what scan() does; 2 = better). */
const TIERS: readonly SensorLimits[] = [
  { kinds: 0, sorts: [], limit: 0, minInterval: 1 },
  { kinds: 1, sorts: [DetectSort.Nearest], limit: 1, minInterval: 1 },
  { kinds: 3, sorts: ALL_SORTS, limit: 3, minInterval: 1 },
];

export const sensorLimits = (stats: Pick<BlueprintStats, 'sensorTier'>): SensorLimits => TIERS[Math.min(stats.sensorTier, TIERS.length - 1)];

/** A `Detected` block's settings as the hardware allows them. */
export interface Sweep {
  readonly watch: readonly number[];
  /** Sub-tile units. */
  readonly range: number;
  readonly interval: number;
  readonly sort: number;
  readonly limit: number;
}

/** Applies the sensor's limits to a block's settings. `notes` says what was changed. */
export function resolveSweep(h: CompiledHandler, stats: BlueprintStats): { sweep: Sweep; notes: string[] } {
  const lim = sensorLimits(stats);
  const notes: string[] = [];
  const asked = configInts(h, 'watch');
  const watch = asked.slice(0, lim.kinds);
  if (watch.length < asked.length) notes.push(`Detected watch: this sensor can watch ${lim.kinds} kind(s), so ${asked.slice(lim.kinds).length} will be ignored`);
  const maxRange = stats.sensorRange / TILE;
  const askedRange = configInt(h, 'range');
  const range = Math.min(askedRange, maxRange);
  if (range < askedRange && maxRange > 0 && h.config.range !== undefined) notes.push(`Detected range ${askedRange}: this sensor reaches ${maxRange} tiles`);
  const askedInterval = configInt(h, 'interval');
  const interval = Math.max(askedInterval, lim.minInterval);
  const askedSort = configInt(h, 'sort');
  const sort = lim.sorts.includes(askedSort) ? askedSort : DetectSort.Nearest;
  if (sort !== askedSort) notes.push('Detected sort: this sensor can only report the nearest first');
  const askedLimit = configInt(h, 'limit');
  const limit = Math.min(askedLimit, lim.limit);
  if (limit < askedLimit) notes.push(`Detected limit ${askedLimit}: this sensor reports at most ${lim.limit} per sweep`);
  if (lim.kinds === 0) notes.push('Detected needs a sensor module: this class has none, so the block never fires');
  return { sweep: { watch, range: range * TILE, interval, sort, limit }, notes };
}

/** Resolved sweeps, by handler and stats (both immutable and shared, so this is computed once per class and module state). */
const sweeps = new WeakMap<CompiledHandler, WeakMap<BlueprintStats, Sweep>>();

/** `resolveSweep(h, stats).sweep`, cached: the per-tick path. */
export function sweepFor(h: CompiledHandler, stats: BlueprintStats): Sweep {
  let byStats = sweeps.get(h);
  if (!byStats) sweeps.set(h, (byStats = new WeakMap()));
  let sweep = byStats.get(stats);
  if (!sweep) byStats.set(stats, (sweep = resolveSweep(h, stats).sweep));
  return sweep;
}

/**
 * One sweep for unit `e`: what its sensor finds, as [kind, handle, ...] pairs, in report order
 * (watch priority, then sort), at most `limit` of them. Does not spend energy.
 */
export function sensorSweep(sim: Simulation, e: number, sweep: Sweep): number[] {
  const out: number[] = [];
  const x = sim.pos.f.x[e];
  const y = sim.pos.f.y[e];
  const owner = sim.unit.f.owner[e];
  // The common case (a basic sensor: one report, nearest first) keeps only the best so far, without a list or a sort.
  const nearestOnly = sweep.limit === 1 && sweep.sort === DetectSort.Nearest;
  for (const kind of sweep.watch) {
    const found: { o: number; d: number; hp: number; pct: number }[] = [];
    let bestO = -1;
    let bestD = Infinity;
    const add = (o: number, hp: number, max: number) => {
      const d = (sim.pos.f.x[o] - x) ** 2 + (sim.pos.f.y[o] - y) ** 2;
      if (!nearestOnly) found.push({ o, d, hp, pct: hp / Math.max(1, max) });
      else if (d < bestD || (d === bestD && o < bestO)) (bestO = o), (bestD = d);
    };
    sim.spatial.forEachInRadius(x, y, sweep.range, (o) => {
      if (o === e) return;
      if (kind === DetectKind.Enemy) {
        if (sim.unit.has(o) && !sim.allied(sim.unit.f.owner[o], owner)) add(o, sim.health.f.hp[o], sim.stats(o).hp);
        // Incoming missiles are enemies too, so a sentry can shoot them down.
        else if (sim.missile.has(o) && !sim.allied(sim.missile.f.owner[o], owner)) add(o, sim.health.f.hp[o], sim.flights[o]?.hp ?? 1);
      } else if (kind === DetectKind.Missile) {
        if (sim.missile.has(o) && !sim.allied(sim.missile.f.owner[o], owner)) add(o, sim.health.f.hp[o], sim.flights[o]?.hp ?? 1);
      } else if (kind === DetectKind.Resource) {
        if (sim.resource.has(o) && sim.resource.f.amount[o] > 0) add(o, sim.resource.f.amount[o], sim.resource.f.amount[o]);
      } else if (kind === DetectKind.DamagedAlly) {
        if (sim.unit.has(o) && sim.unit.f.owner[o] === owner && !sim.isSite(o) && sim.health.f.hp[o] < sim.stats(o).hp) {
          add(o, sim.health.f.hp[o], sim.stats(o).hp);
        }
      }
    });
    if (nearestOnly) {
      if (bestO >= 0) return [kind, sim.world.handle(bestO)];
      continue;
    }
    found.sort((a, b) => {
      switch (sweep.sort) {
        case DetectSort.Weakest: return a.hp - b.hp || a.d - b.d || a.o - b.o;
        case DetectSort.Strongest: return b.hp - a.hp || a.d - b.d || a.o - b.o;
        case DetectSort.MostDamaged: return a.pct - b.pct || a.d - b.d || a.o - b.o;
        default: return a.d - b.d || a.o - b.o;
      }
    });
    for (const f of found) {
      if (out.length >= sweep.limit * 2) return out;
      out.push(kind, sim.world.handle(f.o));
    }
  }
  return out;
}
