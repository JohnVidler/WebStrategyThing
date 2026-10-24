import type { Graphics } from 'pixi.js';

/**
 * Short-lived sparks thrown off by work and damage: a harvester biting a resource, a module
 * breaking. Each is a streak that flies out along a fixed heading, slowing as it goes, and fades.
 * Positions are in tiles; `speed` is the distance (tiles) a spark covers over its whole life.
 */
export interface Spark {
  x: number;
  y: number;
  angle: number;
  reach: number;
  born: number;
  ms: number;
  colour: number;
  width: number;
}

/** Never hold more than this many at once: a mass of harvesters must not slow the frame. */
export const MAX_SPARKS = 240;

export interface BurstOptions {
  colour: number;
  /** Centre of the cone the sparks leave in (radians) and its half-width; omit for all directions. */
  heading?: number;
  spread?: number;
  /** Tiles a spark flies over its life, and how long that takes. */
  reach?: [number, number];
  ms?: [number, number];
  width?: number;
}

/** Adds `count` sparks at (x, y) (tiles). */
export function burstSparks(list: Spark[], x: number, y: number, count: number, now: number, o: BurstOptions): void {
  const reach = o.reach ?? [0.3, 0.7];
  const ms = o.ms ?? [250, 450];
  for (let k = 0; k < count && list.length < MAX_SPARKS; k++) {
    const angle = o.heading === undefined ? Math.random() * Math.PI * 2 : o.heading + (Math.random() * 2 - 1) * (o.spread ?? Math.PI);
    list.push({
      x,
      y,
      angle,
      reach: reach[0] + Math.random() * (reach[1] - reach[0]),
      born: now,
      ms: ms[0] + Math.random() * (ms[1] - ms[0]),
      colour: o.colour,
      width: o.width ?? 1.6,
    });
  }
}

/** Drops finished sparks, in place. */
export function expireSparks(list: Spark[], now: number): void {
  let w = 0;
  for (let i = 0; i < list.length; i++) if (now - list[i].born < list[i].ms) list[w++] = list[i];
  list.length = w;
}

/** How far along its flight a spark is at progress t (0..1): fast at first, then easing out. */
const flown = (t: number): number => 1 - (1 - t) * (1 - t);

/** Draws every spark as a streak (screen = origin + tile * scale). */
export function drawSparks(g: Graphics, list: readonly Spark[], now: number, offX: number, offY: number, scale: number): void {
  for (const s of list) {
    const t = (now - s.born) / s.ms;
    if (t < 0 || t >= 1) continue;
    const head = flown(t) * s.reach;
    const tail = flown(Math.max(0, t - 0.18)) * s.reach;
    const c = Math.cos(s.angle), sn = Math.sin(s.angle);
    g.moveTo(offX + (s.x + c * tail) * scale, offY + (s.y + sn * tail) * scale)
      .lineTo(offX + (s.x + c * head) * scale, offY + (s.y + sn * head) * scale)
      .stroke({ width: s.width, color: s.colour, alpha: 1 - t * t, cap: 'round' });
  }
}
