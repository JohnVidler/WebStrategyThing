import { describe, expect, it } from 'vitest';
import { fireStrength, flicker, hash01, lobHeight, LOB_HEIGHT } from '../src/flames';

describe('flame effects', () => {
  it('lobs up and comes down: no height at either end, highest in the middle', () => {
    expect(lobHeight(0)).toBe(0);
    expect(lobHeight(1)).toBe(0);
    expect(lobHeight(0.5)).toBeCloseTo(LOB_HEIGHT);
    expect(lobHeight(-1)).toBe(0);
    expect(lobHeight(2)).toBe(0);
  });

  it('keeps a fire at full strength for most of its life and dies away at the end', () => {
    expect(fireStrength(1)).toBe(1);
    expect(fireStrength(0.5)).toBe(1);
    expect(fireStrength(0.2)).toBeCloseTo(0.5);
    expect(fireStrength(0)).toBe(0);
  });

  it('flickers over time, but holds still with Reduce motion', () => {
    const seen = new Set<number>();
    for (let t = 0; t < 2000; t += 37) seen.add(flicker(t, 3, false));
    expect(seen.size).toBeGreaterThan(10);
    for (const v of seen) {
      expect(v).toBeGreaterThanOrEqual(0.7);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(flicker(0, 3, true)).toBe(flicker(999, 3, true));
  });

  it('hashes the same inputs to the same number, in range', () => {
    expect(hash01(5, 2)).toBe(hash01(5, 2));
    expect(hash01(5, 2)).not.toBe(hash01(6, 2));
    for (let i = 0; i < 100; i++) expect(hash01(i, 7)).toBeLessThan(1);
  });
});
