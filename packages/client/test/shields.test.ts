import { describe, expect, it } from 'vitest';
import { arcIntersections, onArc, shieldLevel, type ShieldDraw } from '../src/shields';

const shield = (x: number, y: number, r: number, head: number, arc: number): ShieldDraw => ({ e: 0, x, y, r, head, arc, colour: 0x4ea1ff, level: 1, seed: 0 });

describe('shield arcs', () => {
  it('knows which angles lie on the arc, across the wrap-around', () => {
    const s = shield(0, 0, 10, Math.PI, Math.PI / 2); // facing west, 90 degrees wide
    expect(onArc(s, Math.PI)).toBe(true);
    expect(onArc(s, Math.PI + 0.7)).toBe(true);
    expect(onArc(s, -Math.PI + 0.7)).toBe(true); // the same direction, written the other way round
    expect(onArc(s, 0)).toBe(false);
    expect(onArc(s, Math.PI + 0.9)).toBe(false);
    expect(onArc(s, Math.PI + 0.9, 0.2)).toBe(true); // with slack
  });

  it('finds where two shields cross, keeping only points on both arcs', () => {
    const out: number[] = [];
    // Two circles of radius 10 centred 10 apart cross at x = 5, y = about +-8.66.
    const a = shield(0, 0, 10, 0, Math.PI * 2 - 0.01); // all the way round
    const b = shield(10, 0, 10, Math.PI, Math.PI * 2 - 0.01);
    expect(arcIntersections(a, b, out)).toBe(2);
    expect(out[0]).toBeCloseTo(5);
    expect(Math.abs(out[1])).toBeCloseTo(8.66, 1);
    // Narrow arcs facing away from each other: the circles still cross, the arcs do not.
    const c = shield(0, 0, 10, Math.PI, 0.6);
    const d = shield(10, 0, 10, 0, 0.6);
    expect(arcIntersections(c, d, out)).toBe(0);
    expect(out.length).toBe(0);
    // One arc covering one crossing only.
    const e = shield(0, 0, 10, -Math.PI / 3, 0.6); // north-east, towards (5, -8.66)
    expect(arcIntersections(e, b, out)).toBe(1);
    expect(out[1]).toBeLessThan(0);
  });

  it('finds nothing for shields that do not touch, or sit inside each other', () => {
    const out: number[] = [];
    expect(arcIntersections(shield(0, 0, 5, 0, 6), shield(30, 0, 5, 0, 6), out)).toBe(0);
    expect(arcIntersections(shield(0, 0, 10, 0, 6), shield(1, 0, 2, 0, 6), out)).toBe(0);
    expect(arcIntersections(shield(0, 0, 10, 0, 6), shield(0, 0, 10, 0, 6), out)).toBe(0);
  });

  it('dims with the battery and stutters only when nearly flat (and never with Reduce motion)', () => {
    expect(shieldLevel(100, 0, 0, false)).toBeCloseTo(1);
    expect(shieldLevel(50, 0, 0, false)).toBeLessThan(shieldLevel(100, 0, 0, false));
    const flicker = new Set<number>();
    for (let t = 0; t < 2000; t += 20) flicker.add(Math.round(shieldLevel(5, t, 0.3, false) * 100));
    expect(flicker.size).toBeGreaterThan(1);
    const steady = new Set<number>();
    for (let t = 0; t < 2000; t += 20) steady.add(Math.round(shieldLevel(5, t, 0.3, true) * 100));
    expect(steady.size).toBe(1);
  });
});
