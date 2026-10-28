import { describe, expect, it } from 'vitest';
import {
  BOT_UNIT_CLASSES,
  CORNERS,
  Interest,
  SCOUT_CLASS,
  TANK_CLASS,
  TILE,
  TaskType,
  createMatch,
  encodeTick,
  setUpHorde,
  setUpPlayer,
  visibleTo,
  type Simulation,
} from '../src';

declare const performance: { now(): number };
declare const process: { env: Record<string, string | undefined>; stdout: { write(text: string): void } };

/*
 * Performance under load, by number of units: real fights, not parked armies (perf.test.ts holds the
 * single-number budgets and the parked 256-a-side tick). Each size runs a fight between two or four
 * armies on Great Plains, each army marching on the one opposite, and measures what a server tick costs:
 * the simulation step, then the work the server does after it (fog filtering and encoding the tick for
 * every client). The tick is 100 ms and is shared by every match on the process (see AGENTS.md).
 *
 * The absolute budgets are several times what a desktop needs, so a slow CI runner passes and only a real
 * regression fails; the growth checks compare sizes with each other, which does not depend on the machine.
 * WST_PERF_SLACK loosens the wall-clock budgets (the growth checks stay as they are).
 * WST_PERF_REPORT=1 prints the measured table.
 */
const SLACK = Number(process.env.WST_PERF_SLACK ?? 1) || 1;
const REPORT = process.env.WST_PERF_REPORT === '1';
const out = (text: string) => process.stdout.write(`${text}\n`);

const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const quantile = (xs: readonly number[], q: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * q))];

interface Fight {
  readonly sim: Simulation;
  readonly owners: readonly number[];
  /** One fog view per client, as the server keeps. */
  readonly interests: readonly Interest[];
}

const mobile = (sim: Simulation) => sim.unit.dense.filter((e) => sim.motion.has(e)).length;

/** `total` fighters split between `sides` armies (2 face each other across the middle, 4 sit on the compass points), all ordered to attack-move on the army opposite. */
function fight(total: number, sides: 2 | 4): Fight {
  const sim = createMatch(9, 'great-plains');
  const owners = Array.from({ length: sides }, (_, i) => i + 1);
  owners.forEach((owner, i) => setUpPlayer(sim, owner, CORNERS[i], 500));
  const c = sim.config.width / 2;
  const radius = 20;
  const spots = sides === 2
    ? [{ x: c - radius, y: c }, { x: c + radius, y: c }]
    : [{ x: c - radius, y: c }, { x: c + radius, y: c }, { x: c, y: c - radius }, { x: c, y: c + radius }];
  const per = Math.floor(total / sides);
  const columns = Math.ceil(Math.sqrt(per));
  owners.forEach((owner, s) => {
    const scout = sim.blueprints.find(owner, SCOUT_CLASS.name)!;
    const tank = sim.blueprints.find(owner, TANK_CLASS.name)!;
    const goal = spots[(s + sides / 2) % sides];
    for (let i = 0; i < per; i++) {
      const x = spots[s].x + (i % columns) * 1.5 - (columns * 1.5) / 2;
      const y = spots[s].y + Math.floor(i / columns) * 1.5 - (columns * 1.5) / 2;
      const e = sim.spawnUnit(i % 4 === 0 ? tank : scout, x * TILE, y * TILE);
      sim.issueCommand(owner, e, TaskType.Attack, Math.round(goal.x), Math.round(goal.y), -1, false);
    }
  });
  sim.commit();
  return { sim, owners, interests: owners.map(() => new Interest()) };
}

interface Cost {
  readonly step: number[];
  /** Fog filtering and encoding for every client, per tick. */
  readonly net: number[];
  /** Bytes sent per tick to all clients together. */
  readonly bytes: number[];
}

/** Runs the way `Match.tick` does: step, then build every client's packet, then commit. */
function measure(f: Fight, warm: number, ticks: number): Cost {
  const { sim, owners, interests } = f;
  const cost: Cost = { step: [], net: [], bytes: [] };
  const tickOnce = (record: boolean) => {
    const t0 = performance.now();
    sim.step();
    const t1 = performance.now();
    let bytes = 0;
    owners.forEach((owner, i) => {
      const view = interests[i].update(visibleTo(sim.world, owner, (e) => sim.stats(e), sim.terrain), sim.world.despawned);
      bytes += encodeTick(sim.world, sim.tick, sim.events, false, view, sim.alerts).byteLength;
    });
    const t2 = performance.now();
    sim.commit();
    if (record) {
      cost.step.push(t1 - t0);
      cost.net.push(t2 - t1);
      cost.bytes.push(bytes);
    }
  };
  for (const [i, owner] of owners.entries()) interests[i].reset(visibleTo(sim.world, owner, (e) => sim.stats(e), sim.terrain));
  for (let t = 0; t < warm; t++) tickOnce(false);
  for (let t = 0; t < ticks; t++) tickOnce(true);
  return cost;
}

const row = (label: string, c: Cost, alive: number) =>
  out(
    `${label.padEnd(16)} step mean ${mean(c.step).toFixed(2)} p50 ${quantile(c.step, 0.5).toFixed(2)} p95 ${quantile(c.step, 0.95).toFixed(2)} max ${Math.max(...c.step).toFixed(1)} | ` +
      `net mean ${mean(c.net).toFixed(2)} p95 ${quantile(c.net, 0.95).toFixed(2)} | ${Math.round(mean(c.bytes))} B/tick | ${alive} mobile left`,
  );

describe('performance by unit count', () => {
  const SIZES = [64, 128, 256, 512, 1024];
  it.each(SIZES)('a two-army fight of %i units ticks well inside the 100 ms budget', (total) => {
    const f = fight(total, 2);
    const before = mobile(f.sim);
    const cost = measure(f, 30, 200);
    if (REPORT) row(`2 armies ${total}`, cost, mobile(f.sim));
    // The armies really met: someone lost units (otherwise this measured two parked blocks).
    expect(mobile(f.sim)).toBeLessThan(before);
    const all = cost.step.map((s, i) => s + cost.net[i]);
    // About 6x what a desktop needs today (2026-10-27: 0.3 ms at 64 units, 2.3 ms at 1024), so a slow runner passes and a quadratic slip fails.
    const budget = { 64: 3, 128: 3, 256: 4, 512: 7, 1024: 15 }[total as 64]!;
    expect(mean(all)).toBeLessThan(budget * SLACK);
    expect(quantile(all, 0.95)).toBeLessThan(budget * 2.5 * SLACK);
  }, 120_000);

  it('does not grow faster than linearly as the armies grow', () => {
    // Four times the units should cost about four times as much (quadratic would be sixteen); eight is the limit.
    // Four-fold steps, because the cost of a doubling is too small and noisy to compare. Median of step plus net.
    const medians = [64, 256, 1024].map((total) => {
      const cost = measure(fight(total, 2), 30, 150);
      return { total, ms: quantile(cost.step.map((s, i) => s + cost.net[i]), 0.5) };
    });
    const floor = 0.05; // ms: below this, timer noise decides the ratio
    for (let i = 1; i < medians.length; i++) {
      const [a, b] = [medians[i - 1], medians[i]];
      expect(b.ms / Math.max(floor, a.ms), `${a.total} -> ${b.total} units`).toBeLessThan(8);
    }
  }, 120_000);

  it('copes with four armies of 256 (1024 units, every player at the unit cap) in one free-for-all', () => {
    const f = fight(1024, 4);
    const before = mobile(f.sim);
    const cost = measure(f, 30, 200);
    if (REPORT) row('4 armies 1024', cost, mobile(f.sim));
    expect(mobile(f.sim)).toBeLessThan(before);
    const total = cost.step.map((s, i) => s + cost.net[i]);
    expect(mean(total)).toBeLessThan(15 * SLACK);
    expect(quantile(total, 0.95)).toBeLessThan(40 * SLACK);
  }, 120_000);

  it('sends deltas that stay small: bytes per tick grow with what moves, not with the world', () => {
    // A parked world costs almost nothing on the wire; a fight costs more but stays a few bytes per unit.
    const f = fight(512, 2);
    const cost = measure(f, 30, 100);
    const perUnit = mean(cost.bytes) / 512;
    if (REPORT) out(`wire 512 units: ${Math.round(mean(cost.bytes))} B/tick = ${perUnit.toFixed(1)} B/unit/tick`);
    expect(perUnit).toBeLessThan(30);
  }, 60_000);
});

describe('performance of a full horde', () => {
  it('120 horde units against a defended base keep the tick small', () => {
    const sim = createMatch(9, 'crossroads');
    setUpPlayer(sim, 1, CORNERS[0], 500);
    const { classes } = setUpHorde(sim, 2, CORNERS[1], 1);
    sim.cheaters.add(2);
    const scout = sim.blueprints.find(1, SCOUT_CLASS.name)!;
    // 64 defenders in front of the base, 120 attackers (the cap) one class in four of each BOT_UNIT_CLASSES.
    for (let i = 0; i < 64; i++) sim.spawnUnit(scout, (14 + (i % 8) * 1.5) * TILE, (14 + Math.floor(i / 8) * 1.5) * TILE);
    for (let i = 0; i < 120; i++) {
      const bp = classes[i % BOT_UNIT_CLASSES.length];
      const e = sim.spawnUnit(bp, (40 + (i % 12) * 1.5) * TILE, (40 + Math.floor(i / 12) * 1.5) * TILE);
      sim.issueCommand(2, e, TaskType.Attack, 10, 10, -1, false);
    }
    sim.commit();
    const f: Fight = { sim, owners: [1, 2], interests: [new Interest(), new Interest()] };
    const cost = measure(f, 20, 200);
    if (REPORT) row('horde 120 v 64', cost, mobile(sim));
    const total = cost.step.map((s, i) => s + cost.net[i]);
    expect(mean(total)).toBeLessThan(3 * SLACK);
    expect(quantile(total, 0.95)).toBeLessThan(10 * SLACK);
  }, 60_000);
});
