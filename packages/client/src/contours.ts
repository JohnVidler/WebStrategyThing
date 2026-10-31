/**
 * Faint contour lines across open ground, so the floor reads as gently rolling country instead of a flat grid.
 * Purely decorative and client-side: the height field is smooth value noise from the match seed (the engine's
 * `heightAt` is rock height only), so every player sees the same lines. Computed once per map and cached by
 * the renderer; the lines are in tile units.
 */

/** Noise lattice spacing in tiles: the size of the swells. */
const SWELL = 16.5;
/** Heights (0 to 1) the lines are drawn at: few, so the lines are spread far apart. */
export const CONTOUR_LEVELS = [0.4, 0.62];
/** Marching-squares cell size in tiles. */
const STEP = 2;

function hash(ix: number, iy: number, seed: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed | 0, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise, 0 to 1, with two octaves (the second half the size, a third of the weight). */
export function groundHeight(x: number, y: number, seed: number): number {
  const octave = (px: number, py: number, s: number): number => {
    const ix = Math.floor(px), iy = Math.floor(py);
    const fx = px - ix, fy = py - iy;
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const a = hash(ix, iy, s), b = hash(ix + 1, iy, s), c = hash(ix, iy + 1, s), d = hash(ix + 1, iy + 1, s);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  return (octave(x / SWELL, y / SWELL, seed) * 3 + octave(x / (SWELL / 2), y / (SWELL / 2), seed ^ 0x5bd1e995)) / 4;
}

/**
 * Contour segments as a flat array [x1, y1, x2, y2, ...] in tiles. A segment is dropped where it would lie
 * on rock (`open` false at its middle), so the lines only mark open ground.
 */
export function contourSegments(width: number, height: number, seed: number, open: (x: number, y: number) => boolean): Float32Array {
  const out: number[] = [];
  const cols = Math.ceil(width / STEP) + 1;
  const rows = Math.ceil(height / STEP) + 1;
  const field = new Float32Array(cols * rows);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) field[j * cols + i] = groundHeight(i * STEP, j * STEP, seed);

  for (const level of CONTOUR_LEVELS) {
    for (let j = 0; j + 1 < rows; j++) {
      for (let i = 0; i + 1 < cols; i++) {
        const tl = field[j * cols + i], tr = field[j * cols + i + 1];
        const bl = field[(j + 1) * cols + i], br = field[(j + 1) * cols + i + 1];
        const code = (tl > level ? 8 : 0) | (tr > level ? 4 : 0) | (br > level ? 2 : 0) | (bl > level ? 1 : 0);
        if (code === 0 || code === 15) continue;
        const x0 = i * STEP, y0 = j * STEP;
        // Where the level crosses each side, as a position along it.
        const lerp = (p: number, q: number) => (level - p) / (q - p);
        const top: [number, number] = [x0 + lerp(tl, tr) * STEP, y0];
        const right: [number, number] = [x0 + STEP, y0 + lerp(tr, br) * STEP];
        const bottom: [number, number] = [x0 + lerp(bl, br) * STEP, y0 + STEP];
        const left: [number, number] = [x0, y0 + lerp(tl, bl) * STEP];
        const pairs: [[number, number], [number, number]][] = [];
        switch (code) {
          case 1: case 14: pairs.push([left, bottom]); break;
          case 2: case 13: pairs.push([bottom, right]); break;
          case 3: case 12: pairs.push([left, right]); break;
          case 4: case 11: pairs.push([top, right]); break;
          case 6: case 9: pairs.push([top, bottom]); break;
          case 7: case 8: pairs.push([left, top]); break;
          case 5: pairs.push([left, top], [bottom, right]); break;
          case 10: pairs.push([top, right], [left, bottom]); break;
        }
        for (const [a, b] of pairs) {
          if (!open(Math.floor((a[0] + b[0]) / 2), Math.floor((a[1] + b[1]) / 2))) continue;
          out.push(a[0], a[1], b[0], b[1]);
        }
      }
    }
  }
  return Float32Array.from(out);
}
