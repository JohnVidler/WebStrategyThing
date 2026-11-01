import { describe, expect, it } from 'vitest';
import { drawDischarge, hopStrength, makeDischarge } from '../src/discharge';

/** A repeatable stand-in for Math.random. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe('discharge', () => {
  it('jumps from point to point: each hop starts where its chain left off', () => {
    const hops = makeDischarge(0, 0, 6, [], 3, seeded(4));
    expect(hops.length).toBeGreaterThan(3);
    const starts = hops.filter((h) => h.x0 === 0 && h.y0 === 0);
    expect(starts.length).toBe(3);
    for (const h of hops) {
      if (h.x0 === 0 && h.y0 === 0) continue;
      expect(hops.some((p) => p.x1 === h.x0 && p.y1 === h.y0 && p.at < h.at)).toBe(true);
    }
  });

  it('stays within the reach, and fires later hops later', () => {
    for (let seed = 1; seed < 20; seed++) {
      for (const h of makeDischarge(2, 3, 5, [], 6, seeded(seed))) expect(Math.hypot(h.x1 - 2, h.y1 - 3)).toBeLessThanOrEqual(5 * 1.15 + 1e-6);
    }
    const hops = makeDischarge(0, 0, 6, [], 1, seeded(9), { maxHops: 5 });
    for (let i = 1; i < hops.length; i++) expect(hops[i].at).toBeGreaterThan(hops[i - 1].at - 0.02);
  });

  it('prefers units and buildings in range to open ground', () => {
    const targets = [2, 0, 0, 2.5, -2, -1];
    const hops = makeDischarge(0, 0, 6, targets, 4, seeded(7));
    const hits = hops.filter((h) => h.hit);
    expect(hits.length).toBeGreaterThanOrEqual(3);
    for (const h of hits) {
      expect(targets.some((_, i) => i % 2 === 0 && Math.hypot(h.x1 - targets[i], h.y1 - targets[i + 1]) < 0.3)).toBe(true);
    }
  });

  it('ignores targets out of reach, and hits none of them with no targets', () => {
    expect(makeDischarge(0, 0, 3, [40, 40], 4, seeded(1)).some((h) => h.hit)).toBe(false);
    expect(makeDischarge(0, 0, 3, [], 4, seeded(1)).some((h) => h.hit)).toBe(false);
  });

  it('lights a hop only while it is live, brightest at its flash', () => {
    const [h] = makeDischarge(0, 0, 4, [], 1, seeded(2));
    expect(hopStrength(h, h.at - 0.01)).toBe(0);
    expect(hopStrength(h, h.at + 0.01)).toBe(1);
    expect(hopStrength(h, h.at + 0.2)).toBeGreaterThan(0);
    expect(hopStrength(h, h.at + 0.2)).toBeLessThan(1);
    expect(hopStrength(h, h.at + 0.5)).toBe(0);
  });

  it('draws only the live hops', () => {
    const hops = makeDischarge(0, 0, 4, [], 3, seeded(3));
    const strokes = (t: number): number => {
      let n = 0;
      const g: any = new Proxy({}, { get: (_t, name: string) => (name === 'stroke' ? () => (n++, g) : () => g) });
      drawDischarge(g, hops, t, 0x7fd8ff, 0xffffff, 0, 0, 0, 32);
      return n;
    };
    expect(strokes(-0.1)).toBe(0);
    expect(strokes(0.02)).toBeGreaterThan(0);
    expect(strokes(0.95)).toBe(0);
  });
});
