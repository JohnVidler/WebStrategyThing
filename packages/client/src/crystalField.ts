/**
 * Looks only: crystals that sit close together read as one glittering field, and ground vehicles driving over
 * them kick up crystal dust. Nothing here is a game rule; harvesting still happens at each crystal's own spot.
 */

/** Crystals closer than this (tiles) are joined into one field. */
export const FIELD_LINK = 3.4;
/** Half-width (tiles) of the filled field around a crystal and of the bridge between two, and of the fainter skirt outside it. */
export const FIELD_CORE = 1.15;
export const FIELD_SKIRT = 1.9;
/** Ground within this many tiles of a live crystal is dusty. */
export const DUST_REACH = 1.5;
/** Dust puffs per tile driven over crystals, the most alive at once, how long one lasts (ms) and the colour. */
export const DUST_PER_TILE = 5;
export const DUST_CAP = 192;
export const DUST_MS = 1400;
export const DUST_COLOUR = 0xc4f5de;

export interface CrystalField {
  /** Pairs of node indexes (a, b, a, b, ...) close enough to join. */
  readonly links: Int32Array;
  /** 1 for a node that has at least one neighbour. */
  readonly member: Uint8Array;
}

/** Joins nodes within `reach` tiles of each other. Rebuilt only when a crystal appears or is used up, never per frame. */
export function buildField(xs: ArrayLike<number>, ys: ArrayLike<number>, reach = FIELD_LINK): CrystalField {
  const n = xs.length;
  const member = new Uint8Array(n);
  const links: number[] = [];
  const cells = new Map<number, number[]>();
  const key = (cx: number, cy: number) => (cx + 4096) * 8192 + (cy + 4096);
  for (let i = 0; i < n; i++) {
    const k = key(Math.floor(xs[i] / reach), Math.floor(ys[i] / reach));
    const list = cells.get(k);
    if (list) list.push(i);
    else cells.set(k, [i]);
  }
  for (let i = 0; i < n; i++) {
    const cx = Math.floor(xs[i] / reach), cy = Math.floor(ys[i] / reach);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const list = cells.get(key(cx + dx, cy + dy));
        if (!list) continue;
        for (const j of list) {
          if (j <= i || Math.hypot(xs[i] - xs[j], ys[i] - ys[j]) > reach) continue;
          links.push(i, j);
          member[i] = 1;
          member[j] = 1;
        }
      }
    }
  }
  return { links: Int32Array.from(links), member };
}

/** Small shards strewn over a field: positions in tiles, a size (tiles) and an angle (radians) for each. */
export interface Shards {
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly size: Float32Array;
  readonly angle: Float32Array;
}

const SHARDS_PER_NODE = 6;
/** Tiles of bridge per shard. */
const SHARD_SPACING = 0.55;

function unit(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Scatters shards round each joined crystal and along each bridge, so the whole field looks seeded with crystal. The same field always gives the same scatter. */
export function scatterShards(xs: ArrayLike<number>, ys: ArrayLike<number>, field: CrystalField): Shards {
  const x: number[] = [], y: number[] = [], size: number[] = [], angle: number[] = [];
  const add = (px: number, py: number, k: number) => {
    x.push(px);
    y.push(py);
    size.push(0.09 + 0.1 * unit(k + 5));
    angle.push(unit(k + 9) * Math.PI * 2);
  };
  for (let i = 0; i < xs.length; i++) {
    if (!field.member[i]) continue;
    for (let s = 0; s < SHARDS_PER_NODE; s++) {
      const k = i * 31 + s * 7 + xs[i] * 3 + ys[i];
      const a = unit(k) * Math.PI * 2, r = (0.55 + 0.6 * unit(k + 1)) * FIELD_CORE;
      add(xs[i] + Math.cos(a) * r, ys[i] + Math.sin(a) * r, k);
    }
  }
  for (let l = 0; l < field.links.length; l += 2) {
    const a = field.links[l], b = field.links[l + 1];
    const dx = xs[b] - xs[a], dy = ys[b] - ys[a];
    const len = Math.hypot(dx, dy) || 1;
    const count = Math.max(1, Math.round(len / SHARD_SPACING));
    for (let s = 0; s < count; s++) {
      const k = l * 17 + s * 13 + xs[a] * 5 + ys[b];
      const t = (s + unit(k)) / count, side = (unit(k + 2) * 2 - 1) * FIELD_CORE * 0.8;
      add(xs[a] + dx * t - (dy / len) * side, ys[a] + dy * t + (dx / len) * side, k);
    }
  }
  return { x: Float32Array.from(x), y: Float32Array.from(y), size: Float32Array.from(size), angle: Float32Array.from(angle) };
}

/** Marks every tile within `reach` tiles of a node, so a vehicle can ask in one lookup whether it is on dusty ground. */
export function dustMask(xs: ArrayLike<number>, ys: ArrayLike<number>, width: number, height: number, reach = DUST_REACH): Uint8Array {
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < xs.length; i++) {
    const x0 = Math.max(0, Math.floor(xs[i] - reach)), x1 = Math.min(width - 1, Math.floor(xs[i] + reach));
    const y0 = Math.max(0, Math.floor(ys[i] - reach)), y1 = Math.min(height - 1, Math.floor(ys[i] + reach));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (Math.hypot(x + 0.5 - xs[i], y + 0.5 - ys[i]) <= reach) mask[y * width + x] = 1;
      }
    }
  }
  return mask;
}

type Blob = (x: number, y: number, radius: number, colour: number, alpha: number) => void;

/** A fixed pool of dust puffs in tile coordinates; a full pool reuses the oldest rather than growing. */
export class CrystalDust {
  private readonly x = new Float32Array(DUST_CAP);
  private readonly y = new Float32Array(DUST_CAP);
  private readonly vx = new Float32Array(DUST_CAP);
  private readonly vy = new Float32Array(DUST_CAP);
  private readonly born = new Float64Array(DUST_CAP);
  private readonly size = new Float32Array(DUST_CAP);
  private next = 0;

  get alive(): number {
    let n = 0;
    for (let i = 0; i < DUST_CAP; i++) if (this.born[i] > 0) n++;
    return n;
  }

  /** `r1`, `r2` are random numbers in 0..1 (the caller owns the randomness). Drifts out and up, away from the wheels. */
  puff(x: number, y: number, now: number, r1: number, r2: number, scale = 1): void {
    const i = this.next;
    this.next = (this.next + 1) % DUST_CAP;
    const a = r1 * Math.PI * 2;
    this.x[i] = x + Math.cos(a) * 0.15;
    this.y[i] = y + Math.sin(a) * 0.15;
    this.vx[i] = Math.cos(a) * (0.25 + 0.25 * r2);
    this.vy[i] = Math.sin(a) * (0.25 + 0.25 * r2) - 0.2;
    this.size[i] = (0.4 + 0.3 * r2) * scale;
    this.born[i] = now;
  }

  /** Draws every live puff: it swells, thins and drifts. Returns how many were drawn. */
  draw(now: number, blob: Blob, offX: number, offY: number, scale: number): number {
    let n = 0;
    for (let i = 0; i < DUST_CAP; i++) {
      if (this.born[i] <= 0) continue;
      const age = (now - this.born[i]) / DUST_MS;
      if (age >= 1) {
        this.born[i] = 0;
        continue;
      }
      const t = (now - this.born[i]) / 1000;
      const radius = this.size[i] * (0.7 + 1.3 * age);
      blob(offX + (this.x[i] + this.vx[i] * t) * scale, offY + (this.y[i] + this.vy[i] * t) * scale, radius * scale, DUST_COLOUR, 0.8 * (1 - age) * (1 - age));
      n++;
    }
    return n;
  }
}

/** Soft glow sprites that light the ground round the crystals: one big one on each, and smaller ones along each bridge. Overlaps add up, so a cluster is brightest in the middle and every edge fades out. */
export interface Glows {
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly radius: Float32Array;
  readonly alpha: Float32Array;
}

export const GLOW_NODE_RADIUS = 2.4;
export const GLOW_NODE_ALPHA = 0.2;
export const GLOW_BRIDGE_RADIUS = 1.8;
export const GLOW_BRIDGE_ALPHA = 0.1;
/** Tiles between the glows along a bridge. */
export const GLOW_STEP = 0.8;

export function glowPoints(xs: ArrayLike<number>, ys: ArrayLike<number>, field: CrystalField | null): Glows {
  const x: number[] = [], y: number[] = [], radius: number[] = [], alpha: number[] = [];
  for (let i = 0; i < xs.length; i++) {
    x.push(xs[i]);
    y.push(ys[i]);
    radius.push(GLOW_NODE_RADIUS);
    alpha.push(GLOW_NODE_ALPHA);
  }
  if (field) {
    for (let l = 0; l < field.links.length; l += 2) {
      const a = field.links[l], b = field.links[l + 1];
      const count = Math.max(1, Math.round(Math.hypot(xs[b] - xs[a], ys[b] - ys[a]) / GLOW_STEP));
      for (let s = 1; s < count; s++) {
        const t = s / count;
        x.push(xs[a] + (xs[b] - xs[a]) * t);
        y.push(ys[a] + (ys[b] - ys[a]) * t);
        radius.push(GLOW_BRIDGE_RADIUS);
        alpha.push(GLOW_BRIDGE_ALPHA);
      }
    }
  }
  return { x: Float32Array.from(x), y: Float32Array.from(y), radius: Float32Array.from(radius), alpha: Float32Array.from(alpha) };
}
