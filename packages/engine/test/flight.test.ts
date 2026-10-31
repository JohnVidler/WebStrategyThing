import { describe, expect, it } from 'vitest';
import { CORNERS, createMatch, FLY_LOITER_RADIUS, FLY_LOITER_TICKS, setUpPlayer, TILE } from '../src';

function fly(seed = 42) {
  const sim = createMatch(seed);
  setUpPlayer(sim, 1, CORNERS[0], 500);
  setUpPlayer(sim, 2, CORNERS[1], 500);
  const bp = sim.blueprints.find(1, 'Hawk')!;
  const e = sim.spawnUnit(bp, 8 * TILE, 8 * TILE);
  return { sim, e };
}

describe('flying units', () => {
  it('fly in arcs, circle before landing, then land on the goal', () => {
    const { sim, e } = fly();
    expect(sim.stats(e).flying).toBe(true);
    const gx = 30 * TILE + TILE / 2;
    const gy = 20 * TILE + TILE / 2;
    sim.setDestination(e, gx, gy);
    let prev: [number, number] = [sim.pos.f.x[e], sim.pos.f.y[e]];
    let maxTurn = 0;
    let loiterTicks = 0;
    let arrivedAt = -1;
    let heading = NaN;
    for (let t = 0; t < 1500 && arrivedAt < 0; t++) {
      sim.step();
      const x = sim.pos.f.x[e];
      const y = sim.pos.f.y[e];
      if (x !== prev[0] || y !== prev[1]) {
        const h = Math.atan2(y - prev[1], x - prev[0]);
        if (!Number.isNaN(heading)) maxTurn = Math.max(maxTurn, Math.abs(Math.atan2(Math.sin(h - heading), Math.cos(h - heading))));
        heading = h;
      }
      if (Math.hypot(gx - x, gy - y) < FLY_LOITER_RADIUS) loiterTicks++;
      prev = [x, y];
      if (!sim.motion.f.moving[e]) arrivedAt = t;
    }
    expect(arrivedAt).toBeGreaterThan(0);
    expect(Math.hypot(sim.pos.f.x[e] - gx, sim.pos.f.y[e] - gy)).toBeLessThan(TILE);
    expect(maxTurn).toBeLessThan(0.6); // never snaps round
    expect(maxTurn).toBeGreaterThan(0.02); // and does turn
    expect(loiterTicks).toBeGreaterThanOrEqual(FLY_LOITER_TICKS);
  });

  it('does not fly the straight line', () => {
    const { sim, e } = fly();
    const gx = 40 * TILE;
    const gy = 8 * TILE;
    sim.setDestination(e, gx, gy);
    let off = 0;
    for (let t = 0; t < 200; t++) {
      sim.step();
      off = Math.max(off, Math.abs(sim.pos.f.y[e] - 8 * TILE));
    }
    expect(off).toBeGreaterThan(0.05 * TILE);
  });

  it('is deterministic', () => {
    const run = () => {
      const { sim, e } = fly();
      sim.setDestination(e, 30 * TILE, 20 * TILE);
      for (let t = 0; t < 150; t++) sim.step();
      return [sim.pos.f.x[e], sim.pos.f.y[e]];
    };
    expect(run()).toEqual(run());
  });
});
