import { describe, expect, it } from 'vitest';
import { BOT_SKILLS, CORNERS, createMatch, DEFAULT_BOT_LEVEL, parseBotLevel, setUpAi, setUpPlayer, type AiPlayer, type Simulation } from '../src';

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
function versusPassive(map = 'small-basin', seed = 7): { sim: Simulation; ai: AiPlayer } {
  const sim = createMatch(seed, map);
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
    // Against a passive player, so it measures expansion and not who wins a war: two bots fighting each other on Crossroads
    // expand by tick 5000 in about 1 seed in 12 (a lottery that every combat change re-drew); alone it is 10 in 12, this
    // seed by about tick 2900.
    const { sim, ai } = versusPassive('crossroads', 6);
    run(sim, [ai], 5000);
    expect(owned(sim, 2, 'Resource Silo')).toBeGreaterThanOrEqual(1);
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

describe('bot difficulty levels', () => {
  const at = (level: number, ticks: number) => {
    const sim = createMatch(7, 'small-basin');
    sim.requirePlacementVision = true;
    setUpPlayer(sim, 1, CORNERS[0], 300);
    const ai = setUpAi(sim, 2, CORNERS[1], 1, level).bot;
    run(sim, [ai], ticks);
    return { sim, ai };
  };
  const units = (sim: Simulation) => sim.unit.dense.filter((e) => sim.unit.f.owner[e] === 2 && sim.motion.has(e)).length;

  it('names six levels from Patsy to Insane, each one gentler than the next in pace', () => {
    expect(BOT_SKILLS.map((s) => s.name)).toEqual(['Patsy', 'Beginner', 'Normal', 'Experienced', 'Hard', 'Insane']);
    for (let i = 1; i < BOT_SKILLS.length; i++) expect(BOT_SKILLS[i].pace).toBeLessThan(BOT_SKILLS[i - 1].pace);
    expect(parseBotLevel(3)).toBe(3);
    expect(parseBotLevel(6)).toBe(DEFAULT_BOT_LEVEL);
    expect(parseBotLevel('x', 1)).toBe(1);
  });

  it('grows a bigger base and army the higher the level', () => {
    // Score is what a side owns (stored matter plus the cost of everything built); measured on this seed it climbs with every level.
    const scores = [0, 2, 4, 5].map((l) => at(l, 4500).sim.score(2));
    for (let i = 1; i < scores.length; i++) expect(scores[i]).toBeGreaterThan(scores[i - 1]);
  });

  it('Hard plays exactly as the AI did before levels', () => {
    const a = at(4, 1500).sim;
    const sim = createMatch(7, 'small-basin');
    sim.requirePlacementVision = true;
    setUpPlayer(sim, 1, CORNERS[0], 300);
    run(sim, [setUpAi(sim, 2, CORNERS[1]).bot], 1500);
    expect(units(a)).toBe(units(sim));
    expect(a.tick).toBe(sim.tick);
  });
});
