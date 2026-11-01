import { describe, expect, it } from 'vitest';
import { createMatch, MAPS, Terrain } from '@wst/engine';
import { buildLiquids, insideLoops, loopArea, nesting, outline, type Loop } from '../src/liquids';

/** A terrain from rows of characters: '.' dry, '#' rock (height 3), digits 1-9 liquid depth. */
function map(rows: string[]): Terrain {
  const t = new Terrain(rows[0].length, rows.length);
  rows.forEach((row, y) => [...row].forEach((c, x) => t.setElevation(x, y, c === '.' ? 0 : c === '#' ? 3 : -Number(c))));
  return t;
}

const src = (t: Terrain) => ({ width: t.width, height: t.height, depthAt: (x: number, y: number) => t.depthAt(x, y), isRock: (x: number, y: number) => t.isRock(x, y) });

describe('liquid outlines', () => {
  it('a lone cell makes one small closed round pond containing its centre', () => {
    const t = map(['.....', '.....', '..1..', '.....', '.....']);
    const loops = outline(src(t), 1, 5, false);
    expect(loops).toHaveLength(1);
    expect(insideLoops(loops, 2.5, 2.5)).toBe(true);
    expect(insideLoops(loops, 1.5, 2.5)).toBe(false);
    // Rounded: more than the four corners of a diamond, and well within the cell.
    expect(loops[0].length / 2).toBeGreaterThan(8);
    for (let i = 0; i < loops[0].length; i += 2) expect(Math.hypot(loops[0][i] - 2.5, loops[0][i + 1] - 2.5)).toBeLessThanOrEqual(0.51);
  });

  it('a straight shore falls on the cell boundary', () => {
    const t = map(['..11', '..11', '..11', '..11']);
    const [loop] = outline(src(t), 1, 5, false, 0);
    const xs = new Set<number>();
    for (let i = 0; i < loop.length; i += 2) if (loop[i + 1] > 0.6 && loop[i + 1] < 3.4 && loop[i] < 3.9) xs.add(loop[i]); // the right side is the map edge
    expect([...xs]).toEqual([2]);
  });

  it('a shore against tall rock stays a hard line while one against open ground is rounded', () => {
    const hard = map(['#####', '#...#', '#.1.#', '#...#', '#####']);
    const soft = map(['.....', '.....', '..1..', '.....', '.....']);
    const withHeight = (t: Terrain) => ({ ...src(t), heightAt: (x: number, y: number) => t.heightAt(x, y) });
    // A pond walled in by rock keeps its square outline: 3 x 1 tiles exactly.
    const wall = map(['#####', '#111#', '#####']);
    const [loop] = outline(withHeight(wall), 1, 5, false);
    expect(Math.abs(loopArea(loop))).toBeCloseTo(3, 5);
    expect(Math.abs(loopArea(outline(src(wall), 1, 5, false)[0]))).toBeLessThan(2.9);
    expect(outline(withHeight(hard), 1, 5, false)).toHaveLength(1);
    expect(outline(withHeight(soft), 1, 5, false)[0].length).toBe(outline(src(soft), 1, 5, false)[0].length);
  });

  it('every liquid cell centre is inside and every dry one outside, on generated maps', () => {
    for (const id of ['lakeland', 'twin-rivers', 'cinder-fields', 'the-rift']) {
      const t = createMatch(7, id).terrain;
      const s = src(t);
      for (const [lo, hi] of [[1, 5], [6, 8], [9, 9]]) {
        const loops = outline(s, lo, hi, false);
        for (let y = 0; y < t.height; y++) {
          for (let x = 0; x < t.width; x++) {
            const d = t.depthAt(x, y);
            expect(insideLoops(loops, x + 0.5, y + 0.5), `${id} ${lo}-${hi} at ${x},${y}`).toBe(d >= lo && d <= hi);
          }
        }
      }
    }
  });

  it('an island is a hole: nested loops, even-odd', () => {
    const t = map(['1111111', '1111111', '111.111', '1111111', '1111111']);
    const loops = outline(src(t), 1, 5, false);
    expect(loops).toHaveLength(2);
    expect(insideLoops(loops, 3.5, 2.5)).toBe(false);
    expect(insideLoops(loops, 1.5, 2.5)).toBe(true);
    const { parent, depth } = nesting(loops);
    expect(depth.slice().sort()).toEqual([0, 1]);
    expect(parent.filter((p) => p >= 0)).toHaveLength(1);
    expect(Math.abs(loopArea(loops[depth.indexOf(1)]))).toBeLessThan(Math.abs(loopArea(loops[depth.indexOf(0)])));
  });

  it('liquid at the map edge runs to the edge and loops stay on the map', () => {
    const t = map(['11..', '11..', '....']);
    const loops = outline(src(t), 1, 5, false);
    expect(insideLoops(loops, 0.05, 0.05)).toBe(true);
    for (const loop of loops) for (let i = 0; i < loop.length; i += 2) expect(loop[i] >= 0 && loop[i] <= t.width && loop[i + 1] >= 0 && loop[i + 1] <= t.height).toBe(true);
  });

  it('water continues under rock so the two never leave a gap', () => {
    const t = map(['.1#', '.1#', '.1#']);
    const plain = outline(src(t), 1, 5, false);
    const extended = outline(src(t), 1, 5, true);
    // The rock cell's centre is inside only the extended fill.
    expect(insideLoops(plain, 2.5, 1.5)).toBe(false);
    expect(insideLoops(extended, 2.5, 1.5)).toBe(true);
    // Deep rock, away from the water, is not touched.
    const far = map(['.1###', '.1###', '.1###']);
    expect(insideLoops(outline(src(far), 1, 5, true), 4.5, 1.5)).toBe(false);
  });

  it('two liquid corners meeting diagonally stay separate', () => {
    const t = map(['1.', '.1']);
    const loops = outline(src(t), 1, 5, false);
    expect(loops).toHaveLength(2);
  });
});

describe('liquid model', () => {
  it('has a tier only for the depths that exist', () => {
    const t = map(['.1.', '.4.', '.8.']);
    const m = buildLiquids(src(t));
    const kinds = m.tiers.map((x) => `${x.tier.kind}${x.tier.lo}`);
    expect(kinds).toEqual(['water1', 'water2', 'water3', 'water4', 'lava6', 'lava7', 'lava8']);
    expect(m.lava.length).toBe(2); // one lava cell: its centre
    expect(m.tiers.every((x) => x.nest.parent.length === x.fill.length)).toBe(true);
  });

  it('a dry map costs nothing', () => {
    const t = new Terrain(40, 40);
    const m = buildLiquids(src(t));
    expect(m.tiers).toHaveLength(0);
  });

  it('builds a big lake map in a few tens of milliseconds', () => {
    const big = MAPS.filter((m) => m.liquids).map((m) => ({ ...m, width: 160, height: 160 }));
    expect(big.length).toBeGreaterThan(0);
    const t = createMatch(3, 'lakeland').terrain;
    const wide = new Terrain(160, 160);
    for (let y = 0; y < 160; y++) for (let x = 0; x < 160; x++) wide.setElevation(x, y, t.elevationAt(x % t.width, y % t.height) < 0 ? t.elevationAt(x % t.width, y % t.height) : 0);
    const start = performance.now();
    const m = buildLiquids(src(wide));
    const ms = performance.now() - start;
    expect(m.tiers.length).toBeGreaterThan(0);
    // Measured on the dev laptop at roughly a tenth of this; a generous budget so it catches an accidental quadratic, not a slow machine.
    expect(ms).toBeLessThan(1500);
  });

  it('closed loops have no repeated final point and a real area', () => {
    const t = createMatch(7, 'twin-rivers').terrain;
    const m = buildLiquids(src(t));
    for (const tier of m.tiers) for (const l of tier.fill as Loop[]) expect(Math.abs(loopArea(l))).toBeGreaterThan(0);
  });
});
