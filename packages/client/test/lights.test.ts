import { describe, expect, it } from 'vitest';
import { BEAM_H, BEAM_LAMP_Y, BEAM_W, beamIntensity, glowIntensity } from '../src/lights';
import { headlampsOf } from '../src/art';

describe('lights', () => {
  it('a glow is brightest in the middle, fades smoothly and is exactly dark at its edge', () => {
    let last = glowIntensity(0);
    expect(last).toBeCloseTo(1, 5);
    for (let d = 0.05; d < 1; d += 0.05) {
      const v = glowIntensity(d);
      expect(v).toBeLessThan(last);
      last = v;
    }
    expect(glowIntensity(1)).toBe(0);
    expect(glowIntensity(1.5)).toBe(0);
  });

  it('a headlight beam falls off along its length and towards its sides, with no hard edge', () => {
    const mid = BEAM_W / 2;
    const near = beamIntensity(mid, BEAM_LAMP_Y - 20);
    const far = beamIntensity(mid, BEAM_LAMP_Y - 150);
    expect(near).toBeGreaterThan(far);
    expect(far).toBeGreaterThan(0);
    expect(beamIntensity(mid, 1)).toBeLessThan(0.02); // dies out at the far end
    const centre = beamIntensity(mid, BEAM_LAMP_Y - 100);
    const side = beamIntensity(mid + 25, BEAM_LAMP_Y - 100);
    const edge = beamIntensity(mid + 50, BEAM_LAMP_Y - 100);
    expect(centre).toBeGreaterThan(side);
    expect(side).toBeGreaterThan(edge);
    // Light spills round the lamp itself, including a little behind it.
    expect(beamIntensity(mid, BEAM_LAMP_Y + 10)).toBeGreaterThan(0.1);
    expect(beamIntensity(mid, BEAM_H - 1)).toBeLessThan(0.05);
  });
});

describe('headlamps', () => {
  const chassis = ['micro', 'light', 'medium', 'heavy', 'long.light', 'long.medium', 'long.heavy', 'superheavy', 'colossus'].map((c) => `chassis.${c}`);

  it('every body type has one to three lamps, within the hull and not brighter than full', () => {
    for (const c of chassis) {
      const lamps = headlampsOf([c, 'cpu.basic']);
      expect(lamps.length, c).toBeGreaterThanOrEqual(1);
      expect(lamps.length, c).toBeLessThanOrEqual(3);
      for (const l of lamps) {
        expect(Math.abs(l.side), c).toBeLessThanOrEqual(1);
        expect(l.power, c).toBeGreaterThan(0);
        expect(l.power, c).toBeLessThanOrEqual(1);
      }
    }
  });

  it('body types differ, and some are lopsided or single', () => {
    const counts = new Set(chassis.map((c) => headlampsOf([c]).length));
    expect(counts).toEqual(new Set([1, 2, 3]));
    const lopsided = chassis.filter((c) => {
      const sides = headlampsOf([c]).map((l) => l.side);
      return Math.abs(sides.reduce((a, b) => a + b, 0)) > 0.05;
    });
    expect(lopsided.length).toBeGreaterThan(0);
  });

  it('an unknown chassis gets a matched pair', () => {
    const lamps = headlampsOf(['whatever']);
    expect(lamps.length).toBe(2);
    expect(lamps[0].side).toBe(-lamps[1].side);
  });
});
