import { describe, expect, it } from 'vitest';
import type { Graphics } from 'pixi.js';
import { drawIonBolt, drawIonHold, drawRailBeam, drawRailCharge, drawSmokeCloud, hash, ION_COLOUR, RAIL_COLOUR } from '../src/weaponFx';
import { drawShot, SHOT_LIFE_MS, shotKindOf } from '../src/beams';

/** A Graphics stand-in that records the colour and alpha of every stroke and fill (the calls chain, so each returns itself). */
function recorder() {
  const fills: { colour: number; alpha: number }[] = [];
  let calls = 0;
  const g: Record<string, unknown> = {};
  const paint = (o: { color?: number; alpha?: number }): Record<string, unknown> => {
    fills.push({ colour: o.color ?? 0, alpha: o.alpha ?? 1 });
    return g;
  };
  for (const name of ['moveTo', 'lineTo', 'circle', 'arc', 'ellipse', 'rect']) g[name] = () => (calls++, g);
  g.stroke = paint;
  g.fill = paint;
  return { g: g as unknown as Graphics, fills, calls: () => calls };
}

describe('weapon effects', () => {
  it('hash is repeatable and stays in 0..1', () => {
    for (let i = 0; i < 50; i++) {
      expect(hash(i)).toBe(hash(i));
      expect(hash(i)).toBeGreaterThanOrEqual(0);
      expect(hash(i)).toBeLessThan(1);
    }
  });

  it('a railgun charge draws more strongly as it fills, in the rail colour', () => {
    const early = recorder();
    const late = recorder();
    drawRailCharge(early.g, 100, 100, 0, 0.1, 400, 40, 0, true);
    drawRailCharge(late.g, 100, 100, 0, 1, 400, 40, 0, true);
    const strength = (r: ReturnType<typeof recorder>) => r.fills.reduce((s, f) => s + f.alpha, 0);
    expect(strength(late)).toBeGreaterThan(strength(early));
    expect(late.fills.some((f) => f.colour === RAIL_COLOUR)).toBe(true);
  });

  it('a railgun beam fades out and draws nothing once its life is over; Reduce motion drops the shock rings', () => {
    const fresh = recorder();
    const gone = recorder();
    drawRailBeam(fresh.g, 0, 0, 0, 800, 0.1, 40, false);
    drawRailBeam(gone.g, 0, 0, 0, 800, 1, 40, false);
    expect(fresh.fills.length).toBeGreaterThan(0);
    expect(gone.fills.length).toBe(0);
    const still = recorder();
    drawRailBeam(still.g, 0, 0, 0, 800, 0.5, 40, true);
    const moving = recorder();
    drawRailBeam(moving.g, 0, 0, 0, 800, 0.5, 40, false);
    expect(moving.calls()).toBeGreaterThan(still.calls());
  });

  it('an ion bolt is violet and is not flickering with Reduce motion on', () => {
    const a = recorder();
    drawIonBolt(a.g, 0, 0, 300, 100, 0.3, 7, 40, true);
    expect(a.fills.some((f) => f.colour === ION_COLOUR)).toBe(true);
    const still1 = recorder();
    const still2 = recorder();
    drawIonBolt(still1.g, 0, 0, 300, 100, 0.2, 7, 40, true);
    drawIonBolt(still2.g, 0, 0, 300, 100, 0.2, 7, 40, true);
    expect(still1.fills).toEqual(still2.fills);
    const hold = recorder();
    drawIonHold(hold.g, 50, 50, 20, 3, 0, true);
    expect(hold.fills.length).toBeGreaterThan(0);
  });

  it('smoke thins as its life runs out, swells in, and is the same every frame with Reduce motion', () => {
    const total = (life: number, swell: number) => {
      const r = recorder();
      drawSmokeCloud(r.g, 0, 0, 60, life, swell, 5, 100, 0, true);
      return r.fills.reduce((s, f) => s + f.alpha, 0);
    };
    expect(total(1, 1)).toBeGreaterThan(total(0.1, 1));
    expect(total(0, 1)).toBe(0);
    const a = recorder();
    const b = recorder();
    drawSmokeCloud(a.g, 0, 0, 60, 1, 1, 5, 100, 0, true);
    drawSmokeCloud(b.g, 0, 0, 60, 1, 1, 5, 100, 99999, true);
    expect(a.fills).toEqual(b.fills);
  });

  it('the ion gun and point defence have shot looks of their own', () => {
    expect(shotKindOf('ion')).toBe('ion');
    expect(SHOT_LIFE_MS.pd).toBeGreaterThan(0);
    for (const kind of ['ion', 'pd'] as const) {
      const r = recorder();
      drawShot(r.g, kind, 0, 0, 200, 0, 0.3, 0xffffff, 0.5, 40, 1, false);
      expect(r.fills.length).toBeGreaterThan(0);
    }
  });
});
