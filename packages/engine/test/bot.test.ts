import { describe, expect, it } from 'vitest';
import { BOT_FIRST_WAVE_TICKS, CORNERS, createMatch, setUpBot, setUpPlayer, type BotPlayer, type Simulation } from '../src';

function coop(): { sim: Simulation; bot: BotPlayer; human: number; botId: number } {
  const sim = createMatch(7, 'small-basin');
  setUpPlayer(sim, 1, CORNERS[0], 300);
  const { bot } = setUpBot(sim, 2, CORNERS[1], 1);
  return { sim, bot, human: 1, botId: 2 };
}

function run(sim: Simulation, bot: BotPlayer, ticks: number): void {
  for (let t = 0; t < ticks; t++) {
    bot.step();
    sim.step();
    sim.commit();
  }
}

const mobile = (sim: Simulation, owner: number) => sim.unit.dense.filter((e) => sim.unit.f.owner[e] === owner && sim.motion.has(e));

describe('co-op bots', () => {
  it('build a fortified base with assemblers and need no mining', () => {
    const { sim, botId } = coop();
    const buildings = sim.unit.dense.filter((e) => sim.unit.f.owner[e] === botId && sim.stats(e).structure);
    expect(buildings.filter((e) => sim.stats(e).factory)).toHaveLength(3);
    expect(sim.cheaters.has(botId)).toBe(true);
    expect(sim.pool(botId)).toBe(sim.poolCapacity(botId));
  });

  it('build only a small first wave, then stop producing while the pool stays full', () => {
    const { sim, bot, botId } = coop();
    run(sim, bot, 1000);
    expect(mobile(sim, botId).length).toBe(2);
    expect(sim.pool(botId)).toBe(sim.poolCapacity(botId));
  });

  it('hold the first wave back, then send everything staged and keep pressing until the enemy base falls', () => {
    const { sim, bot, human } = coop();
    run(sim, bot, BOT_FIRST_WAVE_TICKS - 10);
    expect(bot.wavesSent).toBe(0);
    const buildings = () => sim.unit.dense.filter((e) => sim.unit.f.owner[e] === human && sim.stats(e).structure).length;
    const before = buildings();
    run(sim, bot, 100);
    expect(bot.wavesSent).toBeGreaterThanOrEqual(1);
    run(sim, bot, 2500);
    expect(buildings()).toBeLessThan(before);
  });
});
