import { describe, expect, it } from 'vitest';
import { DEBRIS_STAGES, debrisStage } from '../src/debris';

describe('debris art stages', () => {
  it('thins out as it is used up and is gone at zero', () => {
    expect(debrisStage(0, 100)).toBe(-1);
    expect(debrisStage(100, 100)).toBe(DEBRIS_STAGES - 1);
    expect(debrisStage(1, 100)).toBe(0);
    const stages = [100, 75, 50, 25, 5].map((a) => debrisStage(a, 100));
    expect([...stages].sort((a, b) => b - a)).toEqual(stages);
  });
});
