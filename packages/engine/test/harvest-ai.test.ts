import { describe, expect, it } from 'vitest';
import { ActivityKind, Caps, CORNERS, createMatch, setUpPlayer, TILE, type Simulation } from '../src';

/** A match where player 1 has only its base (the starting harvesters are removed), so crowding is what the test sets up. */
function bareMatch() {
  const sim = createMatch(42);
  setUpPlayer(sim, 1, CORNERS[0], 500);
  setUpPlayer(sim, 2, CORNERS[1], 500);
  for (const e of [...sim.unit.dense]) if (sim.unit.f.owner[e] === 1 && sim.blueprintOf(e)!.name === 'Harvester') sim.destroyEntity(e);
  return sim;
}

const run = (sim: Simulation, ticks: number) => {
  for (let i = 0; i < ticks; i++) sim.step();
};

/** The tile of a resource. */
const at = (sim: Simulation, r: number): [number, number] => [sim.pos.f.x[r] / TILE, sim.pos.f.y[r] / TILE];

/** The field a unit is heading for (its harvest activity or its front harvest order), or -1. */
function target(sim: Simulation, e: number): number {
  const a = sim.activities[e];
  if (a && a.kind === ActivityKind.Harvest) return sim.world.resolve(a.target);
  return -1;
}

/** A second silo out by two far-off fields, with the resources there kept full. */
function outpost(sim: Simulation) {
  const far = sim.resource.dense.filter((r) => at(sim, r)[0] > 40 && at(sim, r)[1] < 20);
  const [fx, fy] = at(sim, far[0]);
  const silo = sim.spawnStructure(sim.blueprints.find(1, 'Resource Silo')!, Math.floor(fx) - 3, Math.floor(fy));
  return { silo, far };
}

describe('harvesters pick work near a depot', () => {
  it('sends a free harvester to a field next to the depot it is nearest to, not to a far one', () => {
    const sim = bareMatch();
    const { silo, far } = outpost(sim);
    const harvester = sim.spawnUnit(sim.blueprints.find(1, 'Harvester')!, sim.pos.f.x[silo], sim.pos.f.y[silo] + TILE);
    run(sim, 60);
    const t = target(sim, harvester);
    expect(far).toContain(t);
    // It is one of the fields nearest that silo, not just any field.
    const byDistance = [...sim.resource.dense].sort((p, q) => Math.hypot(sim.pos.f.x[p] - sim.pos.f.x[silo], sim.pos.f.y[p] - sim.pos.f.y[silo]) - Math.hypot(sim.pos.f.x[q] - sim.pos.f.x[silo], sim.pos.f.y[q] - sim.pos.f.y[silo]));
    expect(byDistance.slice(0, 4)).toContain(t);
  });

  it('prefers the nearer field however big a far one is', () => {
    const sim = bareMatch();
    const near = sim.resource.dense.filter((r) => at(sim, r)[0] < 20 && at(sim, r)[1] < 20);
    const farOnes = sim.resource.dense.filter((r) => at(sim, r)[0] > 40);
    for (const r of near) sim.resource.f.amount[r] = 30;
    for (const r of farOnes) sim.resource.f.amount[r] = 5000;
    const base = sim.unit.dense.find((e) => sim.unit.f.owner[e] === 1 && sim.blueprintOf(e)!.name === 'HQ')!;
    const harvester = sim.spawnUnit(sim.blueprints.find(1, 'Harvester')!, sim.pos.f.x[base] + 2 * TILE, sim.pos.f.y[base]);
    // The first field it heads for (it may be docking again after a quick fill by tick 60).
    let first = -1;
    for (let i = 0; i < 60 && first < 0; i++) {
      sim.step();
      first = target(sim, harvester);
    }
    expect(near).toContain(first);
  });

  it('moves on to another depot, and its fields, when the nearest one is overcrowded', () => {
    const sim = bareMatch();
    const { silo, far } = outpost(sim);
    const passive = sim.blueprints.define(1, 'Passive Harvester', ['chassis.light', 'cpu.basic', 'motor.small', 'cargo.bay']);
    // Ten idle harvesters stand round the outpost silo.
    for (let i = 0; i < 10; i++) sim.spawnUnit(passive, sim.pos.f.x[silo] + (i % 5) * 0.4 * TILE, sim.pos.f.y[silo] + 1.5 * TILE + Math.floor(i / 5) * 0.4 * TILE);
    const harvester = sim.spawnUnit(sim.blueprints.find(1, 'Harvester')!, sim.pos.f.x[silo], sim.pos.f.y[silo] + TILE);
    run(sim, 60);
    const t = target(sim, harvester);
    expect(t).toBeGreaterThanOrEqual(0);
    expect(far).not.toContain(t); // it works from the base instead
  });

  it('starts with the same choice on every run', () => {
    const choose = () => {
      const sim = bareMatch();
      const base = sim.unit.dense.find((e) => sim.unit.f.owner[e] === 1 && sim.blueprintOf(e)!.name === 'HQ')!;
      const harvester = sim.spawnUnit(sim.blueprints.find(1, 'Harvester')!, sim.pos.f.x[base], sim.pos.f.y[base] + 2 * TILE);
      run(sim, 60);
      return target(sim, harvester);
    };
    expect(choose()).toBe(choose());
  });
});

describe('harvesters keep working', () => {
  it('none stands idle for long, and the pool grows, over a few minutes', () => {
    const sim = createMatch(42);
    setUpPlayer(sim, 1, CORNERS[0], 500);
    setUpPlayer(sim, 2, CORNERS[1], 500);
    const mine = () => sim.unit.dense.filter((e) => sim.unit.f.owner[e] === 1 && sim.blueprintOf(e)!.name === 'Harvester');
    const idleFor = new Map<number, number>();
    let worst = 0;
    const start = sim.pool(1);
    for (let t = 0; t < 3000; t++) {
      sim.step();
      for (const e of mine()) {
        // Waiting with a full load while every silo is full is correct (the player needs more silos), not stuck.
        const waiting = sim.cargo.f.amount[e] > 0 && sim.nearestOwn(e, Caps.Depot, (b) => sim.stockpile.f.amount[b] < sim.stats(b).resourceCapacity) < 0;
        const busy = waiting || sim.activities[e] !== undefined || (sim.tasks[e]?.count ?? 0) > 0;
        const n = busy ? 0 : (idleFor.get(e) ?? 0) + 1;
        idleFor.set(e, n);
        worst = Math.max(worst, n);
      }
    }
    expect(mine().length).toBeGreaterThan(0);
    expect(worst).toBeLessThan(150);
    expect(sim.pool(1)).toBeGreaterThan(start);
  });
});
