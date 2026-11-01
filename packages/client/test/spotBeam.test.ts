import { describe, expect, it } from 'vitest';
import { Terrain } from '@wst/engine';
import { BEAM_RAYS, BeamHeadings, beamReach } from '../src/spotBeam';

describe('spotlight beam', () => {
  it('reaches its full length over open ground', () => {
    const t = new Terrain(60, 20);
    const out = new Float32Array(BEAM_RAYS);
    beamReach(t, 5.5, 10.5, 0, 20, 1.1, out);
    expect(Array.from(out).every((r) => r === 20)).toBe(true);
  });

  it('is cut short by rock, and by a building, but not by water', () => {
    const t = new Terrain(60, 20);
    for (let y = 0; y < 20; y++) t.passable[y * 60 + 15] = 0; // a wall of rock across the beam
    const out = new Float32Array(BEAM_RAYS);
    beamReach(t, 5.5, 10.5, 0, 30, 1.1, out);
    expect(Math.max(...out)).toBeLessThanOrEqual(10.5);
    expect(Math.min(...out)).toBeGreaterThan(8);
    const lake = new Terrain(60, 20);
    for (let y = 0; y < 20; y++) {
      lake.passable[y * 60 + 15] = 0;
      lake.depth[y * 60 + 15] = 1;
    }
    beamReach(lake, 5.5, 10.5, 0, 30, 1.1, out);
    expect(Array.from(out).every((r) => r === 30)).toBe(true);
    const built = new Terrain(60, 20);
    built.occupy(15, 10, 1, 1);
    beamReach(built, 5.5, 10.5, 0, 30, 1.1, out);
    expect(out[Math.floor(BEAM_RAYS / 2)]).toBeLessThan(11);
  });

  it('leaves the building that holds the lamp out of the way', () => {
    const t = new Terrain(60, 20);
    t.occupy(4, 9, 3, 1);
    const out = new Float32Array(BEAM_RAYS);
    beamReach(t, 5.5, 10.5, 0, 20, 1.6, out);
    expect(out[Math.floor(BEAM_RAYS / 2)]).toBe(20);
  });

  it('glides a heading towards the replicated one the short way round', () => {
    const h = new BeamHeadings();
    expect(h.ease(1, 250, 1)).toBeCloseTo((250 / 256) * Math.PI * 2);
    const next = h.ease(1, 4, 1); // 250 -> 4 is a few steps clockwise, not nearly a full turn back
    expect(Math.abs(next - (250 / 256) * Math.PI * 2)).toBeLessThan(0.5);
    h.retain(new Set());
    expect(h.ease(1, 64, 0.5)).toBeCloseTo((64 / 256) * Math.PI * 2);
  });
});
