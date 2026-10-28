import { describe, expect, it } from 'vitest';
import { findPath, Terrain } from '../src';

describe('findPath to a goal inside a building', () => {
  const building = () => {
    const t = new Terrain(24, 24);
    t.occupy(9, 9, 3, 1); // 3x3 building, centre (10, 10)
    return t;
  };

  it('ends on the side of the building the unit comes from, not always the top', () => {
    const t = building();
    const south = findPath(t, 10, 18, 10, 10);
    expect(south.slice(-1)[0]).toBeGreaterThanOrEqual(12);
    expect(south.length / 2).toBeLessThanOrEqual(2);
    const east = findPath(t, 18, 10, 10, 10);
    expect(east.slice(-2)[0]).toBeGreaterThanOrEqual(12);
  });

  it('takes a side that is open even when the nearest cell to the centre is walled off', () => {
    const t = building();
    for (let x = 6; x < 15; x++) t.occupy(x, 7, 1, 1); // closes the top: cells above the building cannot be reached directly
    const p = findPath(t, 10, 16, 10, 10);
    expect(p.slice(-1)[0]).toBeGreaterThanOrEqual(12);
  });
});
