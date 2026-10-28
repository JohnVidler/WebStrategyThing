import { describe, expect, it } from 'vitest';
import { CORNERS, createMatch, setUpAi, setUpPlayer, type AiPlayer, type Simulation } from '../src';

declare const performance: { now(): number };

function run(sim: Simulation, bots: readonly AiPlayer[], ticks: number): void {
  for (let t = 0; t < ticks; t++) {
    for (const b of bots) b.step();
    sim.step();
    sim.commit();
  }
}

const owned = (sim: Simulation, owner: number, name: string): number =>
  sim.unit.dense.filter((e) => sim.unit.f.owner[e] === owner && sim.blueprintOf(e)?.name === name && !sim.isSite(e)).length;

const buildings = (sim: Simulation, owner: number): number => sim.unit.dense.filter((e) => sim.unit.f.owner[e] === owner && sim.stats(e).structure).length;

/** One human who does nothing (the starting base only) against one AI. */
function versusPassive(map = 'small-basin'): { sim: Simulation; ai: AiPlayer } {
  const sim = createMatch(7, map);
  sim.requirePlacementVision = true;
  setUpPlayer(sim, 1, CORNERS[0], 300);
  return { sim, ai: setUpAi(sim, 2, CORNERS[1]).bot };
}

describe('player-like AI', () => {
  it('plays by the same rules: no cheating, it mines, and grows its base and army', () => {
    const { sim, ai } = versusPassive();
    expect(sim.cheaters.has(2)).toBe(false);
    run(sim, [ai], 2000);
    expect(sim.cheaters.has(2)).toBe(false);
    expect(owned(sim, 2, 'Harvester')).toBeGreaterThan(2);
    expect(owned(sim, 2, 'Builder')).toBeGreaterThanOrEqual(2);
    expect(owned(sim, 2, 'Wind Turbine') + owned(sim, 2, 'Solar Array')).toBeGreaterThan(2);
    expect(owned(sim, 2, 'Vehicle Factory') + owned(sim, 2, 'Light Factory')).toBeGreaterThanOrEqual(1);
    expect(owned(sim, 2, 'Laser Turret')).toBeGreaterThanOrEqual(1);
    const army = sim.unit.dense.filter((e) => sim.unit.f.owner[e] === 2 && sim.motion.has(e) && sim.stats(e).weapon).length;
    expect(army).toBeGreaterThan(4);
  });

  it('spreads to another resource field with a silo of its own', () => {
    const sim = createMatch(7, 'crossroads');
    sim.requirePlacementVision = true;
    const bots = [setUpAi(sim, 1, CORNERS[0]).bot, setUpAi(sim, 2, CORNERS[1]).bot];
    run(sim, bots, 5000);
    expect(owned(sim, 1, 'Resource Silo') + owned(sim, 2, 'Resource Silo')).toBeGreaterThanOrEqual(1);
  });

  it('scouts, then attacks and destroys an opponent who does not defend', () => {
    const { sim, ai } = versusPassive();
    const before = buildings(sim, 1);
    run(sim, [ai], 6000);
    expect(ai.wavesSent).toBeGreaterThanOrEqual(1);
    expect(buildings(sim, 1)).toBeLessThan(before);
  });

  it('is deterministic', () => {
    const fingerprint = (): string => {
      const { sim, ai } = versusPassive();
      run(sim, [ai], 2500);
      return [sim.pool(2), sim.unit.dense.length, ...sim.unit.dense.slice(0, 40).map((e) => `${sim.pos.f.x[e]},${sim.pos.f.y[e]}`)].join('|');
    };
    expect(fingerprint()).toBe(fingerprint());
  });

  it('keeps four of them going in a free-for-all within a small share of the tick', () => {
    const sim = createMatch(11, 'crossroads');
    sim.requirePlacementVision = true;
    const bots = CORNERS.map((c, i) => setUpAi(sim, i + 1, c).bot);
    let thinking = 0;
    const ticks = 3000;
    for (let t = 0; t < ticks; t++) {
      const t0 = performance.now();
      for (const b of bots) b.step();
      thinking += performance.now() - t0;
      sim.step();
      sim.commit();
    }
    expect(thinking / ticks).toBeLessThan(2); // ms per tick for all four, against a 100 ms tick
    for (let i = 1; i <= 4; i++) expect(buildings(sim, i)).toBeGreaterThan(7);
  });
});
