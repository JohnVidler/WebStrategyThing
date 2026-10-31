import { describe, expect, it } from 'vitest';
import { CORNERS, createMatch, setUpPlayer, TILE, type Simulation } from '../src';

function setup() {
  const sim = createMatch(42);
  setUpPlayer(sim, 1, CORNERS[0], 500);
  setUpPlayer(sim, 2, CORNERS[1], 500);
  for (const e of [...sim.unit.dense]) if (sim.unit.f.owner[e] === 1 && sim.motion.has(e)) sim.destroyEntity(e);
  return sim;
}
const dist = (sim: Simulation, e: number, x: number, y: number) => Math.hypot(sim.pos.f.x[e] - x, sim.pos.f.y[e] - y) / TILE;

describe('units walk round each other', () => {
  // A row with 15 open tiles and open rows either side, found on the map itself.
  const rowOf = (sim: Simulation) => {
    for (let r = 3; r < 40; r++) {
      for (let x0 = 4; x0 < 40; x0++) {
        let ok = true;
        for (let x = x0; x < x0 + 15 && ok; x++) for (let k = r - 2; k <= r + 2; k++) if (!sim.terrain.walkable(x, k)) ok = false;
        if (ok) return { row: r, x0 };
      }
    }
    return { row: -1, x0: -1 };
  };

  it('two units meeting head on both get through', () => {
    const sim = setup();
    const { row, x0 } = rowOf(sim);
    expect(row).toBeGreaterThan(0);
    const y = row * TILE + TILE / 2;
    const bp = sim.blueprints.find(1, 'Scout')!;
    const a = sim.spawnUnit(bp, x0 * TILE, y);
    const b = sim.spawnUnit(bp, (x0 + 14) * TILE, y);
    sim.setDestination(a, (x0 + 14) * TILE, y);
    sim.setDestination(b, x0 * TILE, y);
    let crossed = -1;
    for (let t = 0; t < 600; t++) {
      sim.step();
      if (crossed < 0 && sim.pos.f.x[a] > sim.pos.f.x[b] + TILE) crossed = t;
    }
    expect(crossed).toBeGreaterThan(0);
    expect(dist(sim, a, (x0 + 14) * TILE, y)).toBeLessThan(2.6);
    expect(dist(sim, b, x0 * TILE, y)).toBeLessThan(2.6);
  });

  it('a unit goes round one that stands still in its way', () => {
    const sim = setup();
    const { row, x0 } = rowOf(sim);
    expect(row).toBeGreaterThan(0);
    const y = row * TILE + TILE / 2;
    const bp = sim.blueprints.find(1, 'Scout')!;
    const a = sim.spawnUnit(bp, x0 * TILE, y);
    const wall = sim.spawnUnit(bp, (x0 + 7) * TILE, y);
    sim.setDestination(a, (x0 + 14) * TILE, y);
    let maxOff = 0;
    for (let t = 0; t < 600; t++) {
      sim.step();
      maxOff = Math.max(maxOff, Math.abs(sim.pos.f.y[a] - y));
    }
    expect(dist(sim, a, (x0 + 14) * TILE, y)).toBeLessThan(2.6);
    expect(maxOff).toBeGreaterThan(0.2 * TILE);
    expect(sim.world.isAlive(wall)).toBe(true);
  });
});
