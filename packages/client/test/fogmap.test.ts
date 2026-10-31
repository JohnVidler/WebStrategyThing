import { describe, expect, it } from 'vitest';
import { FOG_SEEN_ALPHA, FOG_UNSEEN_ALPHA, MIST_FOG_COLOUR, fogDarkness, fogImage } from '../src/fogmap';

describe('fog image', () => {
  const alpha = (out: Uint8ClampedArray, w: number, x: number, y: number): number => out[(y * w + x) * 4 + 3] / 255;

  it('is clear in view, light where seen before and dark where never seen', () => {
    expect(fogDarkness(2)).toBe(0);
    expect(fogDarkness(1)).toBe(FOG_SEEN_ALPHA);
    expect(fogDarkness(0)).toBe(FOG_UNSEEN_ALPHA);
    const w = 9;
    const out = new Uint8ClampedArray(w * w * 4);
    fogImage(new Uint8Array(w * w).fill(2), w, w, out);
    expect(alpha(out, w, 4, 4)).toBe(0);
    fogImage(new Uint8Array(w * w).fill(0), w, w, out);
    expect(alpha(out, w, 0, 0)).toBeCloseTo(FOG_UNSEEN_ALPHA, 2); // the border does not fade
    expect(alpha(out, w, 4, 4)).toBeCloseTo(FOG_UNSEEN_ALPHA, 2);
  });

  it('fades across the edge of what you can see instead of stepping', () => {
    const w = 12;
    const vision = new Uint8Array(w * w).fill(0);
    for (let y = 0; y < w; y++) for (let x = 0; x < 6; x++) vision[y * w + x] = 2; // the left half is in view
    const out = new Uint8ClampedArray(w * w * 4);
    fogImage(vision, w, w, out);
    const row = Array.from({ length: w }, (_, x) => alpha(out, w, x, 6));
    expect(row[2]).toBe(0);
    expect(row[9]).toBeCloseTo(FOG_UNSEEN_ALPHA, 2);
    // Every step across the edge is a fraction of the full change, rising steadily.
    for (let x = 1; x < w; x++) expect(row[x]).toBeGreaterThanOrEqual(row[x - 1]);
    expect(row[5]).toBeGreaterThan(0);
    expect(row[6]).toBeLessThan(FOG_UNSEEN_ALPHA);
    expect(row[6] - row[5]).toBeLessThan(FOG_UNSEEN_ALPHA * 0.6);
  });
});

describe('fog in mist', () => {
  const w = 14;
  const vision = new Uint8Array(w * w).fill(0);
  for (let y = 0; y < w; y++) for (let x = 0; x < 7; x++) vision[y * w + x] = 2;
  const render = (mist: number): Uint8ClampedArray => {
    const out = new Uint8ClampedArray(w * w * 4);
    fogImage(vision, w, w, out, mist);
    return out;
  };

  it('turns pale grey-white instead of near black', () => {
    const clear = render(0);
    const misty = render(1);
    expect(misty[0]).toBeGreaterThan(clear[0] + 100);
    expect(misty[1]).toBeGreaterThan(clear[1] + 100);
    expect([misty[0], misty[1], misty[2]]).toEqual([...MIST_FOG_COLOUR]);
    expect(render(0.5)[0]).toBeGreaterThan(clear[0]);
    expect(render(0.5)[0]).toBeLessThan(misty[0]);
  });

  it('fades over a wider band than in clear air, still reaching full dark far from the edge', () => {
    const band = (out: Uint8ClampedArray): number => {
      let n = 0;
      for (let x = 0; x < w; x++) {
        const a = out[(7 * w + x) * 4 + 3] / 255;
        if (a > 0.02 && a < FOG_UNSEEN_ALPHA - 0.02) n++;
      }
      return n;
    };
    expect(band(render(1))).toBeGreaterThan(band(render(0)));
    expect(render(1)[(7 * w + 13) * 4 + 3] / 255).toBeCloseTo(FOG_UNSEEN_ALPHA, 1);
  });
});
