import { describe, expect, it } from 'vitest';
import { Terrain } from '@wst/engine';
import { footprintProblem, PLACEMENT_PROBLEMS } from '../src/placement';

describe('footprintProblem', () => {
  const t = new Terrain(12, 12);

  it('is null on open ground', () => {
    expect(footprintProblem(t, 2, 2, 2)).toBeNull();
  });

  it('names a building in the way, rock, water and the map edge', () => {
    t.occupy(5, 5, 1, 1);
    expect(footprintProblem(t, 4, 4, 2)).toBe('building');
    expect(footprintProblem(t, -1, 0, 2)).toBe('bounds');
    t.setElevation(8, 8, 3);
    expect(footprintProblem(t, 8, 8, 1)).toBe('rock');
    t.setElevation(1, 8, -1);
    expect(footprintProblem(t, 1, 8, 1)).toBe('water');
    t.setElevation(3, 8, -7);
    expect(footprintProblem(t, 3, 8, 1)).toBe('lava');
  });

  it('ignores cells outside a shaped footprint', () => {
    expect(footprintProblem(t, 8, 8, 2, ['.X', 'XX'])).toBeNull();
    expect(footprintProblem(t, 8, 8, 2, ['X.', 'XX'])).toBe('rock');
  });

  it('gives every problem text and a sound event', () => {
    for (const p of Object.values(PLACEMENT_PROBLEMS)) {
      expect(p.text.length).toBeGreaterThan(0);
      expect(p.sound).toMatch(/^build\.invalid_/);
    }
  });
});
