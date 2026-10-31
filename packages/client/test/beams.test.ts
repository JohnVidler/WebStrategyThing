import { describe, expect, it } from 'vitest';
import { drawShot, paler, SHOT_LIFE_MS, shotKindOf, shotPower, type ShotKind } from '../src/beams';

/** A Graphics stand-in that counts what is drawn and how wide the widest stroke is. */
function recorder() {
  const calls = { fills: 0, strokes: 0, widest: 0 };
  const g: any = new Proxy(
    {},
    {
      get: (_t, name: string) => {
        if (name === 'stroke') return (o: { width: number }) => (calls.strokes++, (calls.widest = Math.max(calls.widest, o.width)), g);
        if (name === 'fill') return () => (calls.fills++, g);
        return () => g;
      },
    },
  );
  return { g, calls };
}

const KINDS: ShotKind[] = ['gun', 'laser', 'flak'];

describe('hit-scan shot effects', () => {
  it('maps weapon kinds to shot looks', () => {
    expect(shotKindOf('laser')).toBe('laser');
    expect(shotKindOf('flak')).toBe('flak');
    expect(shotKindOf('gun')).toBe('gun');
    expect(shotKindOf('cannon')).toBe('gun'); // a cannon at a missile is a quick tracer
    expect(shotKindOf(undefined)).toBe('gun');
  });

  it('scales strength with damage', () => {
    expect(shotPower(5)).toBeLessThan(shotPower(20));
    expect(shotPower(1)).toBeGreaterThan(0);
    expect(shotPower(500)).toBe(1);
  });

  it('draws every kind at every stage, and nothing outside its life', () => {
    for (const kind of KINDS) {
      for (const age of [0, 0.1, 0.3, 0.55, 0.8, 0.99]) {
        const { g, calls } = recorder();
        drawShot(g, kind, 10, 10, 200, 90, age, 0x4ea1ff, 0.5, 32, 7, false);
        expect(calls.fills + calls.strokes, `${kind} at ${age}`).toBeGreaterThan(0);
      }
      for (const age of [-0.1, 1]) {
        const { g, calls } = recorder();
        drawShot(g, kind, 10, 10, 200, 90, age, 0x4ea1ff, 0.5, 32, 7, false);
        expect(calls.fills + calls.strokes, `${kind} outside its life`).toBe(0);
      }
      const { g, calls } = recorder();
      drawShot(g, kind, 5, 5, 5, 5, 0.3, 0x4ea1ff, 0.5, 32, 7, false); // no length: nothing to draw, no NaN
      expect(calls.fills + calls.strokes).toBe(0);
    }
  });

  it('gives a laser a glow wider than its core, and a stronger laser a thicker one', () => {
    const weak = recorder();
    const strong = recorder();
    drawShot(weak.g, 'laser', 0, 0, 100, 0, 0.1, 0xff6b5b, 0.2, 32, 1, true);
    drawShot(strong.g, 'laser', 0, 0, 100, 0, 0.1, 0xff6b5b, 1, 32, 1, true);
    expect(strong.calls.widest).toBeGreaterThan(weak.calls.widest);
    expect(weak.calls.widest).toBeGreaterThan(4); // the halo, not just a 2px line
    expect(weak.calls.strokes).toBeGreaterThanOrEqual(4);
  });

  it('lasts longest for a laser and keeps lights pale', () => {
    expect(SHOT_LIFE_MS.laser).toBeGreaterThan(SHOT_LIFE_MS.gun);
    expect(paler(0x000000, 1)).toBe(0xffffff);
    expect(paler(0x4ea1ff, 0)).toBe(0x4ea1ff);
    expect(paler(0x4ea1ff, 0.5)).toBeGreaterThan(0x4ea1ff);
  });
});
