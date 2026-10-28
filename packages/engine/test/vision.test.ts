import { describe, expect, it } from 'vitest';
import { Simulation, TILE, VisionGrid, visionAt, visibleTo, type Viewer } from '../src';

const at = (t: number) => t * TILE + TILE / 2;

/** An open 40x40 map; a viewer at (10, 10) sees 8 tiles. */
function setup() {
  const sim = new Simulation({ width: 40, height: 40, seed: 1 });
  sim.terrain.passable.fill(1);
  sim.terrain.computeHeights();
  const viewer: Viewer = { x: at(10), y: at(10), r: 8 * TILE };
  const see = (v: Viewer = viewer) => {
    const g = VisionGrid.of(sim.terrain);
    g.begin();
    g.add(sim.terrain, [v]);
    return (tx: number, ty: number) => g.seen(tx, ty);
  };
  return { sim, viewer, see };
}

const rock = (sim: Simulation, x: number, y: number) => {
  sim.terrain.passable[y * sim.terrain.width + x] = 0;
  sim.terrain.computeHeights();
};

describe('line of sight', () => {
  it('sees a full circle on open ground', () => {
    const { see } = setup();
    const s = see();
    expect(s(10, 10)).toBe(true);
    expect(s(17, 10)).toBe(true);
    expect(s(10, 3)).toBe(true);
    expect(s(14, 14)).toBe(true);
    expect(s(19, 10)).toBe(false);
    expect(s(17, 15)).toBe(false);
  });

  it('is stopped by rock: the face is seen, the ground behind it is not', () => {
    const { sim, see } = setup();
    for (let y = 8; y <= 12; y++) rock(sim, 13, y);
    const s = see();
    expect(s(13, 10)).toBe(true);
    expect(s(12, 10)).toBe(true);
    expect(s(14, 10)).toBe(false);
    expect(s(16, 10)).toBe(false);
    // Round the end of the wall is still open.
    expect(s(14, 16)).toBe(true);
    expect(s(10, 17)).toBe(true);
  });

  it('is stopped by a building, but not by a gap beside it', () => {
    const { sim, see } = setup();
    sim.terrain.occupy(13, 9, 3, 1);
    const s = see();
    expect(s(13, 10)).toBe(true);
    expect(s(17, 10)).toBe(false);
    expect(s(16, 6)).toBe(true);
    expect(s(16, 14)).toBe(true);
    sim.terrain.occupy(13, 9, 3, -1);
    expect(see()(17, 10)).toBe(true);
  });

  it('lets a building see out of its own footprint', () => {
    const { sim, see } = setup();
    sim.terrain.occupy(9, 9, 3, 1);
    const s = see({ x: at(10), y: at(10), r: 6 * TILE, size: 3 });
    expect(s(10, 10)).toBe(true);
    expect(s(14, 10)).toBe(true);
    expect(s(10, 15)).toBe(true);
  });

  it('does not stop a flying viewer', () => {
    const { sim, see } = setup();
    for (let y = 6; y <= 14; y++) rock(sim, 13, y);
    expect(see()(15, 10)).toBe(false);
    expect(see({ x: at(10), y: at(10), r: 8 * TILE, air: true })(15, 10)).toBe(true);
  });

  it('copes with a viewer beside the map edge and one standing in rock', () => {
    const { sim, see } = setup();
    expect(() => see({ x: at(0), y: at(0), r: 8 * TILE })).not.toThrow();
    rock(sim, 10, 10);
    expect(see()(14, 10)).toBe(true);
  });

  it('reuses one grid per map and starts clean each time', () => {
    const { sim, see } = setup();
    see();
    const g = VisionGrid.of(sim.terrain);
    expect(g).toBe(VisionGrid.of(sim.terrain));
    g.begin();
    expect(g.seen(10, 10)).toBe(false);
  });
});

describe('visibleTo with terrain', () => {
  it('hides a unit behind a wall that the circle alone would show, and shows a building by its face', () => {
    const sim = new Simulation({ width: 40, height: 40, seed: 1 });
    sim.terrain.passable.fill(1);
    sim.terrain.computeHeights();
    const watcher = sim.blueprints.define(1, 'Watcher', ['chassis.medium', 'cpu.basic', 'sensor.short']);
    const dummy = sim.blueprints.define(2, 'Dummy', ['chassis.light', 'cpu.basic']);
    sim.spawnUnit(watcher, at(10), at(10));
    const behind = sim.spawnUnit(dummy, at(14), at(10));
    const beside = sim.spawnUnit(dummy, at(10), at(14));
    const stats = (e: number) => sim.stats(e);
    expect(visibleTo(sim.world, 1, stats).has(behind)).toBe(true);
    expect(visibleTo(sim.world, 1, stats, sim.terrain).has(behind)).toBe(true);
    for (let y = 8; y <= 12; y++) {
      sim.terrain.passable[y * 40 + 12] = 0;
    }
    sim.terrain.computeHeights();
    const seen = visibleTo(sim.world, 1, stats, sim.terrain);
    expect(seen.has(behind)).toBe(false);
    expect(seen.has(beside)).toBe(true);
    // Owner-side data is unchanged: own units are always seen.
    expect(visibleTo(sim.world, 2, stats, sim.terrain).has(behind)).toBe(true);
  });
});

describe('night vision', () => {
  const stats = (structure: boolean, sensorRange = 0) => ({ structure, sensorRange }) as Parameters<typeof visionAt>[0];

  it('is unchanged by day and closes in by up to a quarter, at most three tiles, at night', () => {
    const unit = stats(false);
    const building = stats(true);
    const far = stats(false, 20 * TILE);
    expect(visionAt(unit, 100)).toBe(4 * TILE);
    expect(visionAt(unit, 0)).toBe(3 * TILE);
    expect(visionAt(building, 0)).toBe(4.5 * TILE);
    expect(visionAt(far, 0)).toBe(17 * TILE);
    expect(visionAt(unit, 50)).toBeGreaterThan(visionAt(unit, 0));
    expect(visionAt(unit, 50)).toBeLessThan(visionAt(unit, 100));
  });
});
