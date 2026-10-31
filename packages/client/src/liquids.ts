/**
 * Outlines for water, lava and voids, with no hard edges. Everything here is pure (plain numbers in, plain
 * arrays out) so Node tests can drive it; the renderer turns the loops into Pixi paths.
 *
 * Each cell centre is a sample of a 0/1 field ("is this cell liquid of this tier?"). Marching squares on the dual
 * grid (corners at cell centres) puts the outline at the cell boundary on straight shores and cuts the corner
 * diagonally elsewhere; two rounds of Chaikin corner-cutting then turn the corners into curves. Under the rock the
 * liquid is extended by a cell (rock is painted over it), so the two never leave a gap between them.
 *
 * Depth bands (see `rules.ts`): 1-5 water (1-2 shallow, 3-5 deep), 6-8 lava, 9 a void.
 */

/** Cells of padding round the map: one copy of the edge (so liquid runs off the map) and one of nothing (so loops close). */
const PAD = 2;
/** Rounds of corner-cutting. */
const SMOOTH_ROUNDS = 2;

export type Loop = Float32Array;

/** What a tier of liquid is drawn as. */
export type TierKind = 'water' | 'lava' | 'void';

export interface Tier {
  /** Cells whose depth is in lo..hi belong to this tier's field. */
  readonly lo: number;
  readonly hi: number;
  readonly kind: TierKind;
  /** 0 for the first (shallowest) tier of its kind, counting up: the deeper, the darker or hotter. */
  readonly index: number;
}

/** Water gets five steps (one per depth), lava three, a void one: each deeper step is drawn over the last. */
export const TIERS: readonly Tier[] = [
  { lo: 1, hi: 5, kind: 'water', index: 0 },
  { lo: 2, hi: 5, kind: 'water', index: 1 },
  { lo: 3, hi: 5, kind: 'water', index: 2 },
  { lo: 4, hi: 5, kind: 'water', index: 3 },
  { lo: 5, hi: 5, kind: 'water', index: 4 },
  { lo: 6, hi: 8, kind: 'lava', index: 0 },
  { lo: 7, hi: 8, kind: 'lava', index: 1 },
  { lo: 8, hi: 8, kind: 'lava', index: 2 },
  { lo: 9, hi: 9, kind: 'void', index: 0 },
];

export interface TierOutline {
  readonly tier: Tier;
  /** Closed outlines in tile units, rounded; liquid under rock is included (fills). */
  readonly fill: Loop[];
  /** The same outline without the extension under rock: where the liquid really ends (shore lines, foam). Only built for the first tier of a kind. */
  readonly shore: Loop[];
  /** For each `fill` loop, the loop round it (-1: none) and how many loops it sits inside: an even depth is a shore, an odd one an island. */
  readonly nest: { readonly parent: number[]; readonly depth: number[] };
}

export interface Liquids {
  readonly tiers: TierOutline[];
  /** Tile coordinates [x, y, ...] of a sparse set of lava cells, for lighting. */
  readonly lava: Float32Array;
}

/** What the outliner needs to know about the terrain. */
export interface LiquidSource {
  readonly width: number;
  readonly height: number;
  /** Liquid depth of a cell (0: none). */
  depthAt(x: number, y: number): number;
  /** Solid rock (or off the map). */
  isRock(x: number, y: number): boolean;
}

/** Outlines of every tier that has any cells (an empty map costs one scan). */
export function buildLiquids(src: LiquidSource): Liquids {
  const { width, height } = src;
  let seen = 0; // bit per depth present
  const lavaAll: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const d = src.depthAt(x, y);
      if (d <= 0) continue;
      seen |= 1 << d;
      if (d >= 6 && d <= 8) lavaAll.push(x + 0.5, y + 0.5);
    }
  }
  // A light over every fourth lava cell (every cell of a small pool), in scan order.
  const step = lavaAll.length <= 24 ? 1 : 4;
  const lava: number[] = [];
  for (let i = 0; i < lavaAll.length; i += 2 * step) lava.push(lavaAll[i], lavaAll[i + 1]);
  const tiers: TierOutline[] = [];
  for (const tier of TIERS) {
    let present = false;
    for (let d = tier.lo; d <= tier.hi; d++) if (seen & (1 << d)) present = true;
    if (!present) continue;
    const fill = outline(src, tier.lo, tier.hi, true);
    const shore = tier.index === 0 ? outline(src, tier.lo, tier.hi, false) : [];
    tiers.push({ tier, fill, shore, nest: nesting(fill) });
  }
  return { tiers, lava: Float32Array.from(lava) };
}

/** Rounded closed loops round the cells whose liquid depth is lo..hi; `underRock` extends them one cell under neighbouring rock. */
export function outline(src: LiquidSource, lo: number, hi: number, underRock: boolean, rounds = SMOOTH_ROUNDS): Loop[] {
  const { width, height } = src;
  const inField = (x: number, y: number): boolean => {
    const d = src.depthAt(x, y);
    return d >= lo && d <= hi;
  };
  const W = width + 2 * PAD;
  const H = height + 2 * PAD;
  const mask = new Uint8Array(W * H);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const cx = i - PAD;
      const cy = j - PAD;
      if (cx < -1 || cy < -1 || cx > width || cy > height) continue; // the outer ring stays empty so every loop closes
      const x = Math.min(width - 1, Math.max(0, cx));
      const y = Math.min(height - 1, Math.max(0, cy));
      let on = inField(x, y);
      if (!on && underRock && src.isRock(x, y)) {
        for (let dy = -1; dy <= 1 && !on; dy++) for (let dx = -1; dx <= 1 && !on; dx++) if ((dx || dy) && inBounds(width, height, x + dx, y + dy) && inField(x + dx, y + dy)) on = true;
      }
      mask[j * W + i] = on ? 1 : 0;
    }
  }
  return march(mask, W, H, width, height, rounds);
}

const inBounds = (w: number, h: number, x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h;

/** Marching squares over the padded mask, stitched into closed loops in tile units (padding removed), then rounded and clipped to the map. */
function march(mask: Uint8Array, W: number, H: number, width: number, height: number, rounds: number): Loop[] {
  // An edge is a crossing point between two samples: id = 2 * (j * W + i) + (0: between (i, j) and (i + 1, j); 1: between (i, j) and (i, j + 1)).
  const hEdge = (i: number, j: number) => 2 * (j * W + i);
  const vEdge = (i: number, j: number) => 2 * (j * W + i) + 1;
  const links = new Map<number, number[]>();
  const link = (a: number, b: number) => {
    const la = links.get(a);
    if (la) la.push(b);
    else links.set(a, [b]);
    const lb = links.get(b);
    if (lb) lb.push(a);
    else links.set(b, [a]);
  };
  for (let j = 0; j + 1 < H; j++) {
    for (let i = 0; i + 1 < W; i++) {
      const tl = mask[j * W + i];
      const tr = mask[j * W + i + 1];
      const br = mask[(j + 1) * W + i + 1];
      const bl = mask[(j + 1) * W + i];
      const code = (tl << 3) | (tr << 2) | (br << 1) | bl;
      if (code === 0 || code === 15) continue;
      const top = hEdge(i, j);
      const bottom = hEdge(i, j + 1);
      const left = vEdge(i, j);
      const right = vEdge(i + 1, j);
      switch (code) {
        case 1: case 14: link(left, bottom); break;
        case 2: case 13: link(bottom, right); break;
        case 3: case 12: link(left, right); break;
        case 4: case 11: link(top, right); break;
        case 6: case 9: link(top, bottom); break;
        case 7: case 8: link(left, top); break;
        // Two liquid corners meeting diagonally stay two separate corners.
        case 5: link(top, right); link(left, bottom); break;
        case 10: link(left, top); link(bottom, right); break;
      }
    }
  }
  const point = (id: number, out: number[]) => {
    const idx = id >> 1;
    const i = idx % W;
    const j = (idx - i) / W;
    if (id & 1) out.push(i - PAD + 0.5, j - PAD + 1);
    else out.push(i - PAD + 1, j - PAD + 0.5);
  };
  const loops: Loop[] = [];
  const done = new Set<number>();
  for (const start of links.keys()) {
    if (done.has(start)) continue;
    const pts: number[] = [];
    let prev = -1;
    let cur = start;
    for (;;) {
      done.add(cur);
      point(cur, pts);
      const next = links.get(cur)!.find((n) => n !== prev && !(done.has(n) && n !== start)) ?? -1;
      if (next < 0 || next === start) break;
      prev = cur;
      cur = next;
    }
    if (pts.length < 6) continue;
    loops.push(clip(chaikin(pts, rounds), width, height));
  }
  return loops;
}

/** Corner-cutting on a closed loop: each round replaces every corner by two points a quarter of the way along its sides. */
function chaikin(pts: number[], rounds: number): Float32Array {
  let cur = pts;
  for (let r = 0; r < rounds; r++) {
    const n = cur.length / 2;
    const next: number[] = new Array(n * 4);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const x0 = cur[2 * i], y0 = cur[2 * i + 1], x1 = cur[2 * j], y1 = cur[2 * j + 1];
      next[4 * i] = 0.75 * x0 + 0.25 * x1;
      next[4 * i + 1] = 0.75 * y0 + 0.25 * y1;
      next[4 * i + 2] = 0.25 * x0 + 0.75 * x1;
      next[4 * i + 3] = 0.25 * y0 + 0.75 * y1;
    }
    cur = next;
  }
  return Float32Array.from(cur);
}

/** Keeps a loop on the map: liquid that runs off the edge ends at the edge. */
function clip(loop: Float32Array, width: number, height: number): Float32Array {
  for (let i = 0; i < loop.length; i += 2) {
    loop[i] = Math.min(width, Math.max(0, loop[i]));
    loop[i + 1] = Math.min(height, Math.max(0, loop[i + 1]));
  }
  return loop;
}

/** Signed area of a loop (positive one way round, negative the other). */
export function loopArea(loop: Loop): number {
  let a = 0;
  const n = loop.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += loop[2 * i] * loop[2 * j + 1] - loop[2 * j] * loop[2 * i + 1];
  }
  return a / 2;
}

/** Even-odd test: is the point inside an odd number of these loops (a lake, not its island)? */
export function insideLoops(loops: readonly Loop[], x: number, y: number): boolean {
  let inside = false;
  for (const loop of loops) if (insideOne(loop, x, y)) inside = !inside;
  return inside;
}

function insideOne(loop: Loop, x: number, y: number): boolean {
  let inside = false;
  const n = loop.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = loop[2 * i], yi = loop[2 * i + 1], xj = loop[2 * j], yj = loop[2 * j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** A loop that is a lake's outer shore (not an island): its nesting depth among `loops` is even. Returns, per loop, its parent index (the smallest loop round it) or -1. */
export function nesting(loops: readonly Loop[]): { parent: number[]; depth: number[] } {
  const areas = loops.map((l) => Math.abs(loopArea(l)));
  const parent = loops.map((l, i) => {
    let best = -1;
    for (let k = 0; k < loops.length; k++) {
      if (k === i || areas[k] <= areas[i]) continue;
      if (insideOne(loops[k], l[0], l[1]) && (best < 0 || areas[k] < areas[best])) best = k;
    }
    return best;
  });
  const depth = loops.map((_, i) => {
    let d = 0;
    for (let p = parent[i]; p >= 0; p = parent[p]) d++;
    return d;
  });
  return { parent, depth };
}
