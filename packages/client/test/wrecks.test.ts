import { describe, expect, it } from 'vitest';
import type { Sprite } from 'pixi.js';
import { CRASH_CHANCE, landWrecks, WRECK_FIRE_CHANCE, WRECK_FIRE_MS, wreckFireMs, wreckFireScale, wreckFlameSize, wreckThrowsFragments, BIG_WRECK_SIZE, shouldCrash, startWreck, wreckGround, wreckHeight, wreckProgress, wreckRotation, type Wreck } from '../src/wrecks';

const stub = (rotation = 0) => ({ rotation }) as unknown as Sprite;
const make = (heading = 0, now = 0): Wreck => startWreck(stub(1), stub(), 10, 10, heading, 0.9, now, () => 0.5);

describe('wrecks', () => {
  it('crashes only for rolls under the chance', () => {
    expect(shouldCrash(() => CRASH_CHANCE - 0.01)).toBe(true);
    expect(shouldCrash(() => CRASH_CHANCE)).toBe(false);
  });

  it('flies a short distance along its heading', () => {
    const w = make(0);
    const end = wreckGround(w, w.born + w.ms);
    expect(end.x - w.x).toBeGreaterThan(1.5);
    expect(end.x - w.x).toBeLessThan(5);
    expect(Math.abs(end.y - w.y)).toBeLessThan(2);
    expect(wreckGround(w, w.born + w.ms * 10).x).toBeCloseTo(end.x); // stops at the landing point
  });

  it('drops from its start height to the ground and winds up its spin', () => {
    const w = make();
    expect(wreckHeight(0)).toBeGreaterThan(0);
    expect(wreckHeight(1)).toBe(0);
    expect(wreckHeight(0.5)).toBeGreaterThan(wreckHeight(0.8));
    expect(wreckRotation(w, 0)).toBe(1);
    expect(Math.abs(wreckRotation(w, 1) - 1)).toBeGreaterThan(Math.abs(wreckRotation(w, 0.5) - 1) * 2);
  });

  it('reports progress clamped to 0..1', () => {
    const w = make(0, 100);
    expect(wreckProgress(w, 0)).toBe(0);
    expect(wreckProgress(w, 100 + w.ms / 2)).toBeCloseTo(0.5);
    expect(wreckProgress(w, 1e9)).toBe(1);
  });

  it('lands wrecks once their time is up and keeps the rest', () => {
    const early = make(0, 0);
    const late = make(0, 5000);
    const list = [early, late];
    const landed: Wreck[] = [];
    landWrecks(list, early.ms + 1, (w) => landed.push(w));
    expect(landed).toEqual([early]);
    expect(list).toEqual([late]);
  });
});

describe('wrecks left burning', () => {
  it('catch fire now and then on a dry day, for a good while', () => {
    expect(wreckFireMs(0, WRECK_FIRE_CHANCE - 0.01)).toBe(WRECK_FIRE_MS);
    expect(wreckFireMs(0, WRECK_FIRE_CHANCE + 0.01)).toBe(0);
  });

  it('rain makes it rarer and shorter, and a downpour stops it', () => {
    expect(wreckFireMs(0.5, WRECK_FIRE_CHANCE * 0.5 - 0.01)).toBeLessThan(WRECK_FIRE_MS);
    expect(wreckFireMs(0.5, WRECK_FIRE_CHANCE * 0.5 + 0.01)).toBe(0);
    expect(wreckFireMs(1, 0)).toBe(0);
  });
});

describe('big wrecks', () => {
  it('catch fire more often and burn longer than small ones', () => {
    expect(wreckFireScale(0.3)).toBeLessThan(wreckFireScale(0.45));
    expect(wreckFireScale(1)).toBeGreaterThan(wreckFireScale(0.45));
    expect(wreckFireScale(10)).toBe(2.5);
    const roll = WRECK_FIRE_CHANCE * 1.5; // too high for a medium wreck, fine for a colossus
    expect(wreckFireMs(0, roll, 0.45)).toBe(0);
    expect(wreckFireMs(0, roll, 1)).toBeGreaterThan(WRECK_FIRE_MS);
    expect(wreckFireMs(0, 0, 0.3)).toBeLessThan(WRECK_FIRE_MS);
  });

  it('burn with bigger flames, and only the biggest throw fragments', () => {
    expect(wreckFlameSize(1)).toBeGreaterThan(wreckFlameSize(0.3));
    expect(wreckFlameSize(5)).toBeLessThanOrEqual(1.2);
    expect(wreckThrowsFragments(BIG_WRECK_SIZE - 0.01)).toBe(false);
    expect(wreckThrowsFragments(BIG_WRECK_SIZE)).toBe(true);
  });
});
