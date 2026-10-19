import { describe, expect, it } from 'vitest';
import { buildSparksDone, makeBuildSparks } from '../src/buildSparks';

describe('build completion sparks', () => {
  it('start on the footprint outline, move one grid step at a time and never head back inwards', () => {
    for (let trial = 0; trial < 50; trial++) {
      const fx = makeBuildSparks(10, 20, 3, 0);
      const cx = 11.5;
      const cy = 21.5;
      expect(fx.routes.length).toBeGreaterThan(0);
      for (const r of fx.routes) {
        const [sx, sy] = [r[0], r[1]];
        expect(sx >= 10 && sx <= 13 && sy >= 20 && sy <= 23).toBe(true);
        expect(sx === 10 || sx === 13 || sy === 20 || sy === 23).toBe(true);
        for (let i = 2; i < r.length; i += 2) {
          expect(Math.abs(r[i] - r[i - 2]) + Math.abs(r[i + 1] - r[i - 1])).toBe(1);
          const dx = r[i] - r[i - 2];
          const dy = r[i + 1] - r[i - 1];
          // Each step leaves the previous crossing away from (or alongside) the centre.
          expect(dx * (r[i - 2] - cx) + dy * (r[i - 1] - cy)).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('throws off just the odd spark mid-build, and a bigger burst with a flash on completion', () => {
    const odd = makeBuildSparks(0, 0, 3, 0, 2);
    expect(odd.routes.length).toBe(2);
    expect(odd.flash).toBeUndefined();
    const done = makeBuildSparks(0, 0, 3, 0);
    expect(done.routes.length).toBeGreaterThan(20);
    expect(done.flash).toEqual({ x: 0, y: 0, size: 3 });
  });

  it('finishes after its lifetime', () => {
    const fx = makeBuildSparks(0, 0, 2, 100);
    expect(buildSparksDone(fx, 100)).toBe(false);
    expect(buildSparksDone(fx, 100 + fx.ms)).toBe(true);
  });
});
