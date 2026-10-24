import { describe, expect, it } from 'vitest';
import {
  CORNERS,
  createMatch,
  findPath,
  HARVESTER_CLASS,
  SCOUT_CLASS,
  setUpPlayer,
  Simulation,
  Terrain,
  TILE,
} from '../src';
import { prog } from './helpers';

// The engine is typed without DOM or Node globals; the tests run under Node, which has both.
declare const performance: { now(): number };
declare const process: { env: Record<string, string | undefined> };

/*
 * Performance budgets, run with every `npm test` (and so in CI). The server ticks at 10 Hz, so a
 * tick has 100 ms; these budgets sit far below that but well above what the engine needs today,
 * so a slow CI runner passes and only an order-of-magnitude regression fails. Ratios (bigger
 * world vs smaller one) are used where they can be, because they do not depend on the machine.
 * Set WST_PERF_SLACK (e.g. 3) to loosen the wall-clock budgets on a very slow machine.
 */
const SLACK = Number(process.env.WST_PERF_SLACK ?? 1) || 1;

function tickTimes(sim: Simulation, ticks: number): number[] {
  const out: number[] = [];
  for (let t = 0; t < ticks; t++) {
    const start = performance.now();
    sim.step();
    sim.commit();
    out.push(performance.now() - start);
  }
  return out;
}

const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const quantile = (xs: readonly number[], q: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * q))];

/** Two starter bases on a large map, plus `perSide` units each (one harvester in four, the rest scouts) in a block near the middle. */
function armies(perSide: number): Simulation {
  const sim = createMatch(9, 'great-plains');
  setUpPlayer(sim, 1, CORNERS[0], 500);
  setUpPlayer(sim, 2, CORNERS[1], 500);
  for (const owner of [1, 2]) {
    const scout = sim.blueprints.find(owner, SCOUT_CLASS.name)!;
    const harvester = sim.blueprints.find(owner, HARVESTER_CLASS.name)!;
    for (let i = 0; i < perSide; i++) {
      const x = 20 + (i % 16) * 2 + (owner === 2 ? 50 : 0);
      const y = 20 + Math.floor(i / 16) * 2;
      sim.spawnUnit(i % 4 === 0 ? harvester : scout, x * TILE, y * TILE);
    }
  }
  return sim;
}

describe('performance budgets', () => {
  it('ticks a large match (256 units a side at the unit cap) well inside the 100 ms tick', () => {
    const sim = armies(256);
    tickTimes(sim, 40); // warm-up: JIT, first plans and sweeps
    const times = tickTimes(sim, 200);
    // Today (2026-10-24, desktop): mean ~2 ms, p95 ~10 ms, max ~15 ms.
    expect(mean(times)).toBeLessThan(15 * SLACK);
    expect(quantile(times, 0.95)).toBeLessThan(50 * SLACK);
  }, 60_000);

  it('scales about linearly with the number of units', () => {
    // Median tick, so the odd long tick (a path plan, GC) does not decide it. 4x the units should cost
    // well under 16x (quadratic); today it is about 2x.
    const small = armies(64);
    const big = armies(256);
    tickTimes(small, 30);
    tickTimes(big, 30);
    const ratio = quantile(tickTimes(big, 150), 0.5) / Math.max(0.01, quantile(tickTimes(small, 150), 0.5));
    expect(ratio).toBeLessThan(8);
  }, 60_000);

  it('runs flow programs at a sane rate (cycles per millisecond)', () => {
    const sim = new Simulation({ width: 16, height: 16, seed: 1 }, new Terrain(16, 16));
    const bp = sim.blueprints.define(1, 'Busy', ['chassis.medium', 'cpu.quantum']);
    sim.setProgram(bp.id, prog(`let a = 0;
let b = 0;
on(Idle, () => {
  a = 0;
  while (a < 100) {
    b = (b * 3 + a) % 1000;
    a = a + 1;
  }
});`));
    for (let i = 0; i < 200; i++) sim.spawnUnit(bp, (2 + (i % 12)) * TILE, (2 + (Math.floor(i / 12) % 12)) * TILE);
    tickTimes(sim, 20);
    let cycles = 0;
    const start = performance.now();
    for (let t = 0; t < 60; t++) {
      sim.step();
      for (const e of sim.cpu.dense) cycles += sim.cpu.f.used[e];
      sim.commit();
    }
    const ms = performance.now() - start;
    expect(sim.cpu.dense.every((e) => sim.cpu.f.fault[e] === 0)).toBe(true);
    expect(cycles).toBeGreaterThanOrEqual(60 * 200 * 200); // every CPU saturated (a statement may overdraw): the work really ran
    // Today: ~8000 cycles/ms for the whole tick (VM plus the rest of the engine).
    expect(cycles / ms).toBeGreaterThan(1000 / SLACK);
  }, 60_000);

  it('a purely reactive unit costs nothing between events', () => {
    // Deterministic: no clock involved. 300 units that only react to orders and hits must not run a cycle.
    const sim = new Simulation({ width: 40, height: 40, seed: 1 }, new Terrain(40, 40));
    const bp = sim.blueprints.define(1, 'Calm', ['chassis.light', 'cpu.basic', 'motor.small']);
    sim.setProgram(bp.id, prog(`on(Order, { types: [MOVE] }, (type, tx, ty) => {
  goTo(tx, ty);
});
on(Damaged, (amount, attacker) => {
  alert('ouch', 500);
});`));
    for (let i = 0; i < 300; i++) sim.spawnUnit(bp, (1 + (i % 38)) * TILE, (1 + Math.floor(i / 38)) * TILE);
    tickTimes(sim, 5); // Spawned / Free have nothing to run
    let cycles = 0;
    for (let t = 0; t < 100; t++) {
      sim.step();
      for (const e of sim.cpu.dense) cycles += sim.cpu.f.used[e];
      sim.commit();
    }
    expect(cycles).toBe(0);
  });

  it('plans paths on the largest maps quickly when the goal is open ground', () => {
    const sim = createMatch(3, 'badlands');
    const t = sim.terrain;
    const open = (x: number, y: number) => sim.terrain.nearestWalkable(x, y, 30)!;
    const [sx, sy] = open(4, 4);
    const [gx, gy] = open(t.width - 5, t.height - 5);
    findPath(t, sx, sy, gx, gy); // warm-up
    const start = performance.now();
    for (let i = 0; i < 20; i++) findPath(t, sx, sy, gx, gy);
    const per = (performance.now() - start) / 20;
    // Corner to corner across the 144x112 maze. Today: a few ms.
    expect(per).toBeLessThan(25 * SLACK);
  }, 60_000);

  it('gives a 256-unit group order quickly', () => {
    const sim = armies(0);
    const scout = sim.blueprints.find(1, SCOUT_CLASS.name)!;
    const units = Array.from({ length: 256 }, (_, i) => sim.spawnUnit(scout, (20 + (i % 16) * 2) * TILE, (20 + Math.floor(i / 16) * 2) * TILE));
    tickTimes(sim, 1);
    const start = performance.now();
    for (const e of units) sim.issueOrder(1, e, 90, 90, -1, true);
    // freeMoveTile looks at every unit's orders for each unit ordered (O(n^2)). Today: ~17 ms.
    expect(performance.now() - start).toBeLessThan(100 * SLACK);
  }, 60_000);

  // Routes are planned under a per-tick work budget (`PLAN_WORK_PER_TICK`); the rest of the group heads straight for the goal until its turn.
  it('does not stall the tick after a 256-unit group order across the map', () => {
    const sim = armies(0);
    const scout = sim.blueprints.find(1, SCOUT_CLASS.name)!;
    const units = Array.from({ length: 256 }, (_, i) => sim.spawnUnit(scout, (20 + (i % 16) * 2) * TILE, (20 + Math.floor(i / 16) * 2) * TILE));
    tickTimes(sim, 5);
    for (const e of units) sim.issueOrder(1, e, 90, 90, -1, true);
    expect(Math.max(...tickTimes(sim, 10))).toBeLessThan(100 * SLACK);
  }, 60_000);

  // A goal inside a building (docking, charging, approach to a building) is unwalkable: findPath retargets it to the
  // nearest cell the unit fits in instead of flooding every reachable tile.
  it('plans a path to a building about as fast as to the open tile next to it', () => {
    const sim = createMatch(9, 'great-plains');
    setUpPlayer(sim, 1, CORNERS[0], 500);
    const t = sim.terrain;
    const hq = sim.unit.dense.find((e) => sim.unit.f.owner[e] === 1 && sim.stats(e).structure && sim.stockpile.has(e))!;
    const f = sim.footprintOf(hq);
    const [gx, gy] = [f.x + Math.floor(f.size / 2), f.y + Math.floor(f.size / 2)]; // inside the footprint
    expect(t.walkable(gx, gy)).toBe(false);
    const [ox, oy] = sim.terrain.nearestWalkable(gx, gy, 10)!;
    const [sx, sy] = sim.terrain.nearestWalkable(f.x + 25, f.y + 25, 10)!;
    const time = (x: number, y: number) => {
      findPath(t, sx, sy, x, y);
      const start = performance.now();
      for (let i = 0; i < 10; i++) findPath(t, sx, sy, x, y);
      return performance.now() - start;
    };
    expect(time(gx, gy) / Math.max(0.05, time(ox, oy))).toBeLessThan(10);
  }, 60_000);
});
