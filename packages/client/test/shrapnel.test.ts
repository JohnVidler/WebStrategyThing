import { describe, expect, it } from 'vitest';
import { landShrapnel, MAX_SHRAPNEL, maxShrapnel, throwShrapnel, type Shrapnel } from '../src/shrapnel';

const seq = (...v: number[]) => {
  let i = 0;
  return () => v[i++ % v.length];
};

describe('shrapnel', () => {
  it('throws between 0 and 10 fragments', () => {
    const none: Shrapnel[] = [];
    throwShrapnel(none, 5, 5, 3, 0, () => 0);
    expect(none.length).toBe(0);
    const most: Shrapnel[] = [];
    throwShrapnel(most, 5, 5, 99, 0, () => 0.999);
    expect(most.length).toBe(10);
    expect(maxShrapnel(0.5)).toBeLessThanOrEqual(10);
  });

  it('staggers flight times', () => {
    const list: Shrapnel[] = [];
    throwShrapnel(list, 0, 0, 2, 100, seq(0.99, 0.1, 0.5, 0.5, 0.5, 0.9, 0.2, 0.2, 0.7, 0.3, 0.1, 0.8));
    expect(new Set(list.map((s) => s.ms)).size).toBeGreaterThan(1);
  });

  it('never holds more than the cap', () => {
    const list: Shrapnel[] = [];
    for (let i = 0; i < 100; i++) throwShrapnel(list, 0, 0, 3, 0, () => 0.999);
    expect(list.length).toBe(MAX_SHRAPNEL);
  });

  it('bounces 0 to 3 times at 0.75x the first hop, in a random direction', () => {
    const list: Shrapnel[] = [];
    // count, angle, dist, ms, size, bounce chance (hit), bounce count (0.999 -> 3)
    throwShrapnel(list, 0, 0, 1, 0, seq(0.2, 0, 0.5, 0.5, 0.5, 0.1, 0.999));
    const s = list[0];
    expect(s.bounces).toBe(3);
    const first = s.hop;
    const ms = s.ms;
    let landed = 0;
    for (let k = 1; k <= 3; k++) {
      const bx = s.tx, by = s.ty;
      landShrapnel(list, ms * k, () => landed++, () => 0.25); // angle = pi/2: straight down
      expect(list.length).toBe(1);
      expect(s.x).toBeCloseTo(bx);
      expect(s.y).toBeCloseTo(by);
      expect(s.tx).toBeCloseTo(bx);
      expect(s.ty - by).toBeCloseTo(first * 0.75);
    }
    expect(s.bounces).toBe(0);
    landShrapnel(list, ms * 4, () => landed++);
    expect(landed).toBe(4);
    expect(list.length).toBe(0);
  });

  it('does not bounce when the chance misses', () => {
    const list: Shrapnel[] = [];
    throwShrapnel(list, 0, 0, 1, 0, seq(0.2, 0, 0.5, 0.5, 0.5, 0.9, 0.5));
    expect(list[0].bounces).toBe(0);
  });

  it('lands each fragment once, when its time is up', () => {
    const list: Shrapnel[] = [];
    throwShrapnel(list, 0, 0, 3, 0, seq(0.999, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5));
    const total = list.length;
    let landed = 0;
    landShrapnel(list, 1, () => landed++);
    expect(landed).toBe(0);
    landShrapnel(list, 10000, () => landed++);
    expect(landed).toBe(total);
    expect(list.length).toBe(0);
  });
});
