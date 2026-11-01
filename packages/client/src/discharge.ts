import type { Graphics } from 'pixi.js';

/**
 * Electrical discharges: what a tesla pulse, a lightning strike's ring, a bursting battery bank or a failing shield throws out.
 * Instead of straight spokes from the centre, charge jumps from point to point: each chain leaves the centre, hops to a
 * unit or building in reach if there is one (otherwise to open ground further out) and goes on from there. A discharge is
 * a flat list of hops rolled once (`makeDischarge`) and drawn each frame (`drawDischarge`); the renderer also lights the
 * ground and mist round every live hop (`hopStrength`). Positions are in tiles.
 */
export interface Hop {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** When the hop fires, as a share of the effect's life. */
  at: number;
  /** Fixes the kinks of the arc (re-rolled every flicker frame). */
  seed: number;
  /** Lands on a unit or building rather than on open ground. */
  hit: boolean;
}

/** Arcs jump this many times further than the ring or blast they come with (callers multiply the effect's radius by it). */
export const ARC_REACH = 2;

/** Gap between one hop and the next in a chain, and how long a hop stays lit, as shares of the effect's life. */
const HOP_STEP = 0.055;
const HOP_LIFE = 0.32;
/** The brightest part of a hop's life, as a share of the effect's life. */
const HOP_FLASH = 0.07;
/** A hop is at most this share of the reach long (and a free jump at least a third of that). */
const HOP_REACH = 0.5;
/** A target may be hit by this many chains. */
const MAX_HITS = 2;
/** How far past the reach a target may sit and still be taken, so a unit on the very edge is not skipped. */
const REACH_SLACK = 1.15;
/** Kinks per tile of a hop (at least `MIN_KINKS`, at most `MAX_KINKS` segments) and their sideways size in tiles. */
const KINKS_PER_TILE = 3;
const MIN_KINKS = 3;
const MAX_KINKS = 9;
const KINK_SIZE = 0.28;
const FLICKER_MS = 55;

/** Cheap deterministic noise in [-1, 1) from three integers. */
const noise = (a: number, b: number, c: number): number => {
  let h = Math.imul(a + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35) ^ Math.imul(c + 0x1b873593, 0x27d4eb2f);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  return ((h ^ (h >>> 13)) >>> 0) / 2147483648 - 1;
};

export interface DischargeOptions {
  /** Most hops in one chain. */
  maxHops?: number;
}

/**
 * Rolls a discharge from (ox, oy) that reaches `reach` tiles. `targets` is a flat list of x, y pairs (tiles) of the units
 * and buildings it may jump to. Each of `chains` chains prefers the nearest unhit target within one hop; with none in
 * reach it jumps outwards over open ground, and it stops at the edge of the reach.
 */
export function makeDischarge(ox: number, oy: number, reach: number, targets: ArrayLike<number>, chains: number, rand: () => number, o: DischargeOptions = {}): Hop[] {
  const hops: Hop[] = [];
  const count = targets.length >> 1;
  const hits = new Uint8Array(count);
  const maxHops = o.maxHops ?? 6;
  const hopMax = Math.max(0.5, reach * HOP_REACH);
  const limit = reach * REACH_SLACK;
  for (let c = 0; c < chains; c++) {
    let x = ox;
    let y = oy;
    // Chains leave in different directions, so they do not all take the same first target.
    let heading = ((c + rand() * 0.8) / chains) * Math.PI * 2;
    for (let h = 0; h < maxHops; h++) {
      let best = -1;
      let bestScore = Infinity;
      for (let i = 0; i < count; i++) {
        if (hits[i] >= MAX_HITS) continue;
        const tx = targets[i * 2];
        const ty = targets[i * 2 + 1];
        const d = Math.hypot(tx - x, ty - y);
        if (d < 0.05 || d > hopMax || Math.hypot(tx - ox, ty - oy) > limit) continue;
        // Nearer is better, with a little chance in it and a leaning towards the way this chain was already going.
        const off = Math.atan2(ty - y, tx - x) - heading;
        const turn = Math.abs(Math.atan2(Math.sin(off), Math.cos(off)));
        const score = d / hopMax + rand() * 0.5 + hits[i] * 0.8 + (h === 0 ? turn * 0.15 : turn * 0.05);
        if (score < bestScore) {
          bestScore = score;
          best = i;
        }
      }
      let nx: number;
      let ny: number;
      let hit = false;
      if (best >= 0) {
        hits[best]++;
        // Land on the target, a touch off its centre so two chains do not draw the same point.
        nx = targets[best * 2] + (rand() - 0.5) * 0.3;
        ny = targets[best * 2 + 1] + (rand() - 0.5) * 0.3;
        hit = true;
      } else {
        // Nothing to jump to: arc outwards over open ground, wandering a little off the chain's heading.
        if (h > 0) heading = Math.atan2(y - oy, x - ox) + (rand() - 0.5) * 1.2;
        const len = hopMax * (0.35 + rand() * 0.55);
        nx = x + Math.cos(heading) * len;
        ny = y + Math.sin(heading) * len;
        if (Math.hypot(nx - ox, ny - oy) > limit) {
          // Over the edge: shorten the last hop to end on it, then stop.
          const k = Math.max(0, (limit - Math.hypot(x - ox, y - oy)) / len);
          if (k < 0.2) break;
          nx = x + (nx - x) * k;
          ny = y + (ny - y) * k;
          h = maxHops;
        }
      }
      hops.push({ x0: x, y0: y, x1: nx, y1: ny, at: h * HOP_STEP + rand() * 0.015, seed: Math.floor(rand() * 100000), hit });
      heading = Math.atan2(ny - y, nx - x);
      x = nx;
      y = ny;
      // A chain that has found something sometimes spends itself there.
      if (hit && rand() < 0.2) break;
    }
  }
  return hops;
}

/** How lit a hop is at time `t` (a share of the effect's life): 0 before it fires, 1 at its flash, fading to 0. */
export function hopStrength(h: Hop, t: number): number {
  const k = t - h.at;
  if (k < 0 || k >= HOP_LIFE) return 0;
  return k < HOP_FLASH ? 1 : (1 - (k - HOP_FLASH) / (HOP_LIFE - HOP_FLASH)) ** 1.5;
}

/** The frame the crackle is on at `now`; `still` (Reduce motion) holds it. */
export function flickerFrame(born: number, now: number, still: boolean): number {
  return still ? 0 : Math.floor((now - born) / FLICKER_MS);
}

/**
 * Draws every live hop at time `t`: a wide glow stroke and a hot core along a kinked line (re-rolled each `frame`),
 * and a bright flare where the charge lands. `offX`, `offY` and `scale` map tiles to pixels.
 */
export function drawDischarge(g: Graphics, hops: readonly Hop[], t: number, colour: number, core: number, frame: number, offX: number, offY: number, scale: number): void {
  for (let n = 0; n < hops.length; n++) {
    const h = hops[n];
    const s = hopStrength(h, t);
    if (s <= 0) continue;
    const ax = offX + h.x0 * scale;
    const ay = offY + h.y0 * scale;
    const bx = offX + h.x1 * scale;
    const by = offY + h.y1 * scale;
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 1) continue;
    const ux = (bx - ax) / len;
    const uy = (by - ay) / len;
    const segs = Math.max(MIN_KINKS, Math.min(MAX_KINKS, Math.round((len / scale) * KINKS_PER_TILE)));
    const kink = scale * KINK_SIZE;
    for (let pass = 0; pass < 2; pass++) {
      let px = ax;
      let py = ay;
      for (let i = 1; i <= segs; i++) {
        const along = i / segs;
        // The kick is zero at both ends, so a hop joins its neighbours exactly.
        const edge = Math.sin(along * Math.PI);
        const kick = i === segs ? 0 : noise(h.seed, i, frame) * kink * edge;
        const x = ax + (bx - ax) * along - uy * kick;
        const y = ay + (by - ay) * along + ux * kick;
        g.moveTo(px, py).lineTo(x, y);
        px = x;
        py = y;
      }
      g.stroke(pass === 0 ? { width: Math.max(2, scale * 0.09), color: colour, alpha: 0.55 * s } : { width: Math.max(1, scale * 0.035), color: core, alpha: 0.95 * s });
    }
    // The charge lands: a soft flare, brighter on a unit or building, with a hot centre.
    const r = Math.max(2, scale * (h.hit ? 0.3 : 0.16));
    g.circle(bx, by, r * 1.8).fill({ color: colour, alpha: 0.18 * s });
    g.circle(bx, by, r * 0.55).fill({ color: core, alpha: (h.hit ? 0.95 : 0.6) * s });
  }
}
