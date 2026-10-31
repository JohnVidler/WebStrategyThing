import { describe, expect, it } from 'vitest';
import { contourSegments, groundHeight } from '../src/contours';

describe('ground contours', () => {
  it('has a smooth height field in 0..1 that depends on the seed', () => {
    for (let i = 0; i < 200; i++) {
      const h = groundHeight(i * 1.7, i * 0.9, 5);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(1);
    }
    expect(Math.abs(groundHeight(10.001, 10, 5) - groundHeight(10, 10, 5))).toBeLessThan(0.01);
    expect(groundHeight(10, 10, 5)).not.toBe(groundHeight(10, 10, 6));
  });

  it('is deterministic, sparse and stays off rock', () => {
    const a = contourSegments(128, 128, 42, () => true);
    const b = contourSegments(128, 128, 42, () => true);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(a.length).toBeGreaterThan(0);
    expect(a.length / 4).toBeLessThan(128 * 128 / 4); // far fewer segments than cells
    expect(contourSegments(128, 128, 42, () => false).length).toBe(0);
  });
});
