import { describe, expect, it } from 'vitest';
import { BEAM_H, BEAM_LAMP_Y, BEAM_W, beamIntensity, FLICKER_MS, glowIntensity, lampDaylight, lampLevel, mistIntensity, mixColour } from '../src/lights';
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

describe('lamp flicker', () => {
  it('holds the old state until the switch, settles after FLICKER_MS, and stutters in between', () => {
    for (const seed of [1, 7, 42]) {
      expect(lampLevel(-5, true, seed)).toBe(0);
      expect(lampLevel(-5, false, seed)).toBe(1);
      expect(lampLevel(FLICKER_MS, true, seed)).toBe(1);
      expect(lampLevel(FLICKER_MS, false, seed)).toBe(0);
      const levels = Array.from({ length: 70 }, (_, i) => lampLevel(1 + i * 10, true, seed));
      expect(levels.every((l) => l >= 0 && l <= 1)).toBe(true);
      expect(new Set(levels).size).toBeGreaterThan(3); // it really changes
      expect(levels.some((l) => l === 0)).toBe(true); // with dark gaps
      expect(lampLevel(100, true, seed)).toBe(lampLevel(100, true, seed)); // deterministic
    }
  });
});

describe('lamps in haze', () => {
  it('come on in the middle of the day in mist and dust, but not in clear air or light rain', () => {
    expect(lampDaylight(100, 0)).toBe(100);
    expect(lampDaylight(100, 20)).toBeGreaterThan(45); // storm: still off
    expect(lampDaylight(100, 40)).toBeLessThan(45); // mist
    expect(lampDaylight(100, 65)).toBeLessThan(20); // dust: fully on
    expect(lampDaylight(10, 0)).toBe(10); // dusk is unchanged
    expect(lampDaylight(100, 100)).toBe(0);
  });

  it('mixes colours', () => {
    expect(mixColour(0xff0000, 0x0000ff, 0)).toBe(0xff0000);
    expect(mixColour(0xff0000, 0x0000ff, 1)).toBe(0x0000ff);
    expect(mixColour(0x000000, 0xffffff, 0.5)).toBe(0x808080);
  });
});

describe('mist puffs', () => {
  it('are brightest in the middle and ease to nothing at the edge, with no step', () => {
    expect(mistIntensity(0)).toBe(1);
    expect(mistIntensity(1)).toBe(0);
    expect(mistIntensity(1.5)).toBe(0);
    let last = 1;
    for (let d = 0.05; d < 1; d += 0.05) {
      const v = mistIntensity(d);
      expect(v).toBeLessThanOrEqual(last);
      expect(last - v).toBeLessThan(0.2); // never a hard step
      last = v;
    }
    expect(mistIntensity(0.95)).toBeLessThan(0.02);
  });
});
