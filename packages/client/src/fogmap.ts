/**
 * The fog of war as a picture one pixel per tile, for the renderer to scale up with smoothing. Drawing every
 * fogged tile as a flat block gave a hard stair-stepped edge round whatever you can see; as a small image that is
 * stretched with linear filtering, and softened a little first, the edge fades over a couple of tiles instead.
 */

export const FOG_COLOUR = [5, 7, 10] as const;
/** How dark (0..1) tiles are: ones seen before, and ones never seen. In view is clear. */
export const FOG_SEEN_ALPHA = 0.35;
export const FOG_UNSEEN_ALPHA = 0.65;

/** Darkness 0..1 of a tile from its vision level (2 in view now, 1 seen before, anything else never seen). */
export function fogDarkness(level: number): number {
  return level === 2 ? 0 : level === 1 ? FOG_SEEN_ALPHA : FOG_UNSEEN_ALPHA;
}

/**
 * Never-seen ground gets darker the further it is from anything seen or in view, until the map cannot be made out at all.
 * `FOG_DEEP_ALPHA` is the darkness (0..1) it reaches (1 = black), `FOG_DEEP_START` the distance in tiles from known ground
 * before it starts to deepen, `FOG_DEEP_FALLOFF` how many more tiles it takes to reach full depth (smaller = quicker), and
 * `FOG_DEEP_CURVE` the shape (1 = steady, above 1 = slow at first then sharp, below 1 = quick at first then gentle).
 */
export const FOG_DEEP_ALPHA = 1;
export const FOG_DEEP_START = 2;
export const FOG_DEEP_FALLOFF = 10;
export const FOG_DEEP_CURVE = 1;

/** The colour fogged ground turns in mist: a pale grey-white instead of near black. */
export const MIST_FOG_COLOUR = [196, 205, 212] as const;

let scratchA = new Float32Array(0);
let scratchB = new Float32Array(0);
let scratchD = new Float32Array(0);

/** Distance in tiles (a chamfer approximation) from each tile to the nearest tile that has been seen; 0 on seen tiles. */
function distanceFromKnown(vision: Uint8Array, width: number, height: number, dist: Float32Array): void {
  const far = width + height;
  const DIAG = Math.SQRT2;
  for (let i = 0, n = width * height; i < n; i++) dist[i] = vision[i] === 1 || vision[i] === 2 ? 0 : far;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      let d = dist[i];
      if (x > 0) d = Math.min(d, dist[i - 1] + 1);
      if (y > 0) {
        d = Math.min(d, dist[i - width] + 1);
        if (x > 0) d = Math.min(d, dist[i - width - 1] + DIAG);
        if (x < width - 1) d = Math.min(d, dist[i - width + 1] + DIAG);
      }
      dist[i] = d;
    }
  }
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x;
      let d = dist[i];
      if (x < width - 1) d = Math.min(d, dist[i + 1] + 1);
      if (y < height - 1) {
        d = Math.min(d, dist[i + width] + 1);
        if (x < width - 1) d = Math.min(d, dist[i + width + 1] + DIAG);
        if (x > 0) d = Math.min(d, dist[i + width - 1] + DIAG);
      }
      dist[i] = d;
    }
  }
}

/** One 3x3 weighted blur (centre 4, sides 2, corners 1) of `src` into `dst`; tiles past the edge count as the nearest tile. */
function blur(src: Float32Array, dst: Float32Array, width: number, height: number): void {
  const at = (x: number, y: number): number => src[Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      dst[y * width + x] =
        (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1) +
          2 * at(x - 1, y) + 4 * at(x, y) + 2 * at(x + 1, y) +
          at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)) / 16;
    }
  }
}

/**
 * Fills `out` (RGBA, width x height x 4 bytes) with the fog: the darkness of each tile in the alpha, after a 3x3 weighted
 * blur so neighbouring tiles blend, and the same colour everywhere. Tiles past the map's edge count as their nearest
 * tile, so the map's border does not fade. `mist` (0..1) turns the fog from near black towards a pale grey-white and
 * blurs it twice as wide, so in mist the edge of what you can see closes in with a soft white haze.
 */
export function fogImage(vision: Uint8Array, width: number, height: number, out: Uint8ClampedArray, mist = 0): void {
  const n = width * height;
  if (scratchA.length < n) {
    scratchA = new Float32Array(n);
    scratchB = new Float32Array(n);
    scratchD = new Float32Array(n);
  }
  distanceFromKnown(vision, width, height, scratchD);
  const deepen = Math.max(0, FOG_DEEP_ALPHA - FOG_UNSEEN_ALPHA);
  for (let i = 0; i < n; i++) {
    let a = fogDarkness(vision[i]);
    if (a === FOG_UNSEEN_ALPHA && deepen > 0) {
      const t = Math.min(1, Math.max(0, (scratchD[i] - FOG_DEEP_START) / Math.max(0.01, FOG_DEEP_FALLOFF)));
      a += deepen * (FOG_DEEP_CURVE === 1 ? t : Math.pow(t, FOG_DEEP_CURVE));
    }
    scratchA[i] = a;
  }
  blur(scratchA, scratchB, width, height);
  let dark = scratchB;
  if (mist > 0.02) {
    blur(scratchB, scratchA, width, height);
    dark = scratchA;
  }
  const m = Math.min(1, Math.max(0, mist));
  const r = Math.round(FOG_COLOUR[0] + (MIST_FOG_COLOUR[0] - FOG_COLOUR[0]) * m);
  const g = Math.round(FOG_COLOUR[1] + (MIST_FOG_COLOUR[1] - FOG_COLOUR[1]) * m);
  const b = Math.round(FOG_COLOUR[2] + (MIST_FOG_COLOUR[2] - FOG_COLOUR[2]) * m);
  for (let i = 0; i < n; i++) {
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = Math.round(dark[i] * 255);
  }
}
