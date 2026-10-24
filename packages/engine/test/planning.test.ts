import { describe, expect, it } from 'vitest';
import { CORNERS, createMatch, PLAN_WORK_PER_TICK, SCOUT_CLASS, setUpPlayer, TILE } from '../src';

function groupOrder(ticks: number) {
  const sim = createMatch(9, 'great-plains');
  setUpPlayer(sim, 1, CORNERS[0], 500);
  const scout = sim.blueprints.find(1, SCOUT_CLASS.name)!;
  const units = Array.from({ length: 128 }, (_, i) => sim.spawnUnit(scout, (20 + (i % 16) * 2) * TILE, (20 + Math.floor(i / 16) * 2) * TILE));
  sim.step();
  sim.commit();
  for (const e of units) sim.issueOrder(1, e, 90, 90, -1, true);
  const waiting = () => (sim as unknown as { planWaiting: Set<number> }).planWaiting.size;
  const early = (sim.step(), sim.commit(), waiting());
  for (let t = 1; t < ticks; t++) {
    sim.step();
    sim.commit();
  }
  return { sim, units, early, late: waiting() };
}

describe('path planning budget', () => {
  it('spreads a big group order over several ticks, and every unit gets its route in the end', () => {
    const { early, late } = groupOrder(40);
    expect(PLAN_WORK_PER_TICK).toBeGreaterThan(0);
    expect(early).toBeGreaterThan(0); // not everyone was planned in the first tick
    expect(late).toBe(0);
  });

  it('is deterministic: the same order gives the same positions', () => {
    const a = groupOrder(60);
    const b = groupOrder(60);
    expect(a.units.map((e) => [a.sim.pos.f.x[e], a.sim.pos.f.y[e]])).toEqual(b.units.map((e) => [b.sim.pos.f.x[e], b.sim.pos.f.y[e]]));
  });
});
