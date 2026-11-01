import { describe, expect, it } from 'vitest';
import { buildField, CrystalDust, DUST_CAP, DUST_MS, dustMask, FIELD_LINK, glowPoints, scatterShards } from '../src/crystalField';

describe('crystal fields', () => {
  it('joins crystals that sit close together and leaves a lone one out', () => {
    const f = buildField([10, 12, 13, 40], [10, 10, 11, 40]);
    expect([...f.member]).toEqual([1, 1, 1, 0]);
    expect(f.links.length / 2).toBe(3);
  });

  it('does not join crystals further apart than the link distance', () => {
    const f = buildField([0, FIELD_LINK + 0.1], [0, 0]);
    expect(f.links.length).toBe(0);
    expect(f.member[0]).toBe(0);
  });

  it('marks dusty ground only near a crystal, and copes with the map edge', () => {
    const m = dustMask([0.5, 9.5], [0.5, 9.5], 10, 10, 1.5);
    expect(m[0]).toBe(1);
    expect(m[9 * 10 + 9]).toBe(1);
    expect(m[5 * 10 + 5]).toBe(0);
  });
});

describe('crystal dust', () => {
  it('draws a puff while it lives, fading, and forgets it afterwards', () => {
    const dust = new CrystalDust();
    dust.puff(5, 5, 1000, 0.1, 0.5);
    const alphas: number[] = [];
    const blob = (_x: number, _y: number, _r: number, _c: number, a: number) => alphas.push(a);
    expect(dust.draw(1000 + DUST_MS * 0.2, blob, 0, 0, 10)).toBe(1);
    expect(dust.draw(1000 + DUST_MS * 0.8, blob, 0, 0, 10)).toBe(1);
    expect(alphas[1]).toBeLessThan(alphas[0]);
    expect(dust.draw(1000 + DUST_MS + 1, blob, 0, 0, 10)).toBe(0);
    expect(dust.alive).toBe(0);
  });

  it('never holds more than its cap', () => {
    const dust = new CrystalDust();
    for (let i = 0; i < DUST_CAP * 3; i++) dust.puff(0, 0, 1000, 0.3, 0.3);
    expect(dust.alive).toBe(DUST_CAP);
  });
});

describe('crystal shards', () => {
  it('strews shards over a joined field only, the same way every time', () => {
    const xs = [10, 12, 40], ys = [10, 10, 40];
    const f = buildField(xs, ys);
    const a = scatterShards(xs, ys, f);
    const b = scatterShards(xs, ys, f);
    expect(a.x.length).toBeGreaterThan(6);
    expect([...a.x]).toEqual([...b.x]);
    for (let i = 0; i < a.x.length; i++) expect(Math.hypot(a.x[i] - 40, a.y[i] - 40)).toBeGreaterThan(5);
  });
});

describe('crystal glow', () => {
  it('lights every crystal and fills the bridge between joined ones with smaller glows', () => {
    const xs = [10, 13], ys = [10, 10];
    const lone = glowPoints([10], [10], null);
    expect(lone.x.length).toBe(1);
    const g = glowPoints(xs, ys, buildField(xs, ys));
    expect(g.x.length).toBeGreaterThan(3);
    for (let i = 2; i < g.x.length; i++) {
      expect(g.x[i]).toBeGreaterThan(10);
      expect(g.x[i]).toBeLessThan(13);
      expect(g.radius[i]).toBeLessThan(g.radius[0]);
    }
  });
});
