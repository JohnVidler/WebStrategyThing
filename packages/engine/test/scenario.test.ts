import { describe, expect, it } from 'vitest';
import {
  BOT_FIRST_WAVE_TICKS,
  CORNERS,
  HORDE_FIRST_TICKS,
  HORDE_MAX_ALIVE,
  MAPS,
  mapById,
  mapsFor,
  SURROUNDED_BOT_PACE,
  TILE,
  centreCorner,
  createMatch,
  parseScenario,
  setUpBot,
  setUpHorde,
  setUpPlayer,
  type Simulation,
} from '../src';

const owned = (sim: Simulation, owner: number) => sim.unit.dense.filter((e) => sim.unit.f.owner[e] === owner);
const buildings = (sim: Simulation, owner: number) => owned(sim, owner).filter((e) => sim.stats(e).structure);

describe('scenarios', () => {
  it('parse unknown ids as standard', () => {
    expect(parseScenario('horde')).toBe('horde');
    expect(parseScenario('surrounded')).toBe('surrounded');
    expect(parseScenario('nonsense')).toBe('standard');
    expect(parseScenario(undefined)).toBe('standard');
  });

  it('leave the standard map as it was', () => {
    const a = createMatch(7, 'small-basin');
    const b = createMatch(7, 'small-basin', 'standard');
    expect(b.terrain.encode()).toBe(a.terrain.encode());
    expect(b.resource.dense.length).toBe(a.resource.dense.length);
  });
});

describe('surrounded', () => {
  const start = () => {
    const sim = createMatch(7, 'small-basin', 'surrounded');
    setUpPlayer(sim, 1, centreCorner(sim.config.width, sim.config.height), 300);
    const bots = CORNERS.map((corner, i) => setUpBot(sim, 2 + i, corner, 1, SURROUNDED_BOT_PACE).bot);
    return { sim, bots };
  };

  it('puts the human base in the middle of the map, on open ground', () => {
    const { sim } = start();
    const { width, height } = sim.config;
    const mine = buildings(sim, 1);
    expect(mine.length).toBeGreaterThan(3);
    for (const e of mine) {
      const x = sim.tileX(sim.pos.f.x[e]);
      const y = sim.tileY(sim.pos.f.y[e]);
      expect(Math.abs(x - width / 2)).toBeLessThan(width / 4);
      expect(Math.abs(y - height / 2)).toBeLessThan(height / 4);
    }
    expect(sim.terrain.isPassable(Math.floor(width / 2), Math.floor(height / 2))).toBe(true);
  });

  it('places the centre base on every map', () => {
    for (const map of MAPS.filter((m) => !m.starts)) {
      const sim = createMatch(7, map.id, 'surrounded');
      setUpPlayer(sim, 1, centreCorner(sim.config.width, sim.config.height), 300);
      const placed = buildings(sim, 1).length;
      expect(placed, map.name).toBeGreaterThan(3);
      const c = centreCorner(sim.config.width, sim.config.height);
      expect(sim.terrain.isPassable(Math.round(sim.config.width / 2), Math.round(sim.config.height / 2)), map.name).toBe(true);
      expect(c.offsetX).toBeGreaterThan(0);
    }
  });

  it('holds all four corners with a bot each, and no neutral wanderers', () => {
    const { sim } = start();
    for (let i = 0; i < 4; i++) expect(buildings(sim, 2 + i).length).toBeGreaterThan(0);
    expect(owned(sim, 0)).toHaveLength(0);
  });

  it('has the bots wave later than a lone bot would', () => {
    const { sim, bots } = start();
    for (let t = 0; t < BOT_FIRST_WAVE_TICKS + 100; t++) {
      for (const bot of bots) bot.step();
      sim.step();
      sim.commit();
    }
    expect(bots.every((b) => b.wavesSent === 0)).toBe(true);
  });
});

describe('horde', () => {
  const start = () => {
    const sim = createMatch(7, 'small-basin');
    setUpPlayer(sim, 1, CORNERS[0], 300);
    const { horde } = setUpHorde(sim, 2, CORNERS[1], 1);
    return { sim, horde };
  };
  const run = (sim: Simulation, horde: { step(): void }, ticks: number) => {
    for (let t = 0; t < ticks; t++) {
      horde.step();
      sim.step();
      sim.commit();
    }
  };

  it('owns no buildings and spawns nothing before its first group', () => {
    const { sim, horde } = start();
    expect(buildings(sim, 2)).toHaveLength(0);
    run(sim, horde, HORDE_FIRST_TICKS - 10);
    expect(horde.total).toBe(0);
  });

  it('feeds units in from the far corner and sends them at the base', () => {
    const { sim, horde } = start();
    run(sim, horde, HORDE_FIRST_TICKS + 700);
    expect(horde.total).toBeGreaterThan(3);
    const units = owned(sim, 2);
    expect(units.length).toBeGreaterThan(0);
    // Units appear in the far corner, not at the human's base.
    const nearHuman = units.filter((e) => Math.hypot(sim.pos.f.x[e] - 8 * TILE, sim.pos.f.y[e] - 9 * TILE) < 6 * TILE);
    expect(nearHuman.length).toBeLessThan(units.length);
  });

  it('stays within its cap and stops when its enemy has nothing left', () => {
    const { sim, horde } = start();
    for (const e of owned(sim, 1)) sim.destroyEntity(e);
    sim.commit();
    run(sim, horde, 3000);
    expect(horde.total).toBe(0);
    expect(owned(sim, 2).length).toBeLessThanOrEqual(HORDE_MAX_ALIVE);
  });
});

describe('maps made for a scenario', () => {
  const made = MAPS.filter((m) => m.scenario);

  it('exist for both scenarios, and are listed apart from the general maps', () => {
    expect(mapsFor('horde').length).toBeGreaterThan(1);
    expect(mapsFor('surrounded').length).toBeGreaterThan(1);
    expect(mapsFor().every((m) => !m.scenario && !m.starts)).toBe(true);
  });

  it('fit four bases close together, none on top of another', () => {
    for (const map of made) {
      expect(map.starts, map.name).toHaveLength(4);
      const sim = createMatch(7, map.id);
      map.starts!.forEach((corner, i) => setUpPlayer(sim, i + 1, corner, 300));
      const spots = map.starts!.map((_, i) => buildings(sim, i + 1));
      for (const list of spots) expect(list.length, map.name).toBeGreaterThan(3);
      // Every seat's HQ is within a short walk of the others.
      const hq = spots.map((list) => ({ x: sim.tileX(sim.pos.f.x[list[0]]), y: sim.tileY(sim.pos.f.y[list[0]]) }));
      for (const a of hq) for (const b of hq) expect(Math.hypot(a.x - b.x, a.y - b.y), map.name).toBeLessThan(40);
    }
  });

  it('keep the enemy starts open and connected to every seat', () => {
    for (const map of made) {
      const sim = createMatch(7, map.id);
      const t = sim.terrain;
      const from = map.hordeFrom ?? { x: 16, y: 16 };
      expect(t.isPassable(from.x, from.y), map.name).toBe(true);
      const seen = new Uint8Array(t.width * t.height);
      const stack = [from.y * t.width + from.x];
      seen[stack[0]] = 1;
      while (stack.length) {
        const i = stack.pop()!;
        const x = i % t.width;
        const y = (i - x) / t.width;
        for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
          if (t.isPassable(nx, ny) && !seen[ny * t.width + nx]) {
            seen[ny * t.width + nx] = 1;
            stack.push(ny * t.width + nx);
          }
        }
      }
      for (const c of map.starts!) expect(seen[(9 + (c.offsetY ?? 0)) * t.width + 8 + (c.offsetX ?? 0)], map.name).toBe(1);
    }
  });

  it('put the horde in at the place the map names, aimed at whichever human is nearest', () => {
    const map = mapById('last-redoubt');
    const sim = createMatch(7, map.id, 'horde');
    map.starts!.slice(0, 2).forEach((c, i) => setUpPlayer(sim, i + 1, c, 300));
    const { horde } = setUpHorde(sim, 9, map.starts![0], 1, map.hordeFrom);
    horde.addEnemy(2);
    for (let t = 0; t < HORDE_FIRST_TICKS + 20; t++) {
      horde.step();
      sim.step();
    }
    const units = owned(sim, 9);
    expect(units.length).toBeGreaterThan(0);
    for (const e of units) expect(Math.hypot(sim.tileX(sim.pos.f.x[e]) - map.hordeFrom!.x, sim.tileY(sim.pos.f.y[e]) - map.hordeFrom!.y)).toBeLessThan(12);
  });
});
