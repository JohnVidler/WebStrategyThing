import type { Graphics } from 'pixi.js';

/**
 * Chunks thrown clear when something blows up. Each flies in an arc to a landing spot and, a moment
 * later, goes off there (the renderer adds a small blast and a burst of sparks when it lands).
 * Positions are in tiles.
 */
export interface Shrapnel {
  x: number;
  y: number;
  /** Where it comes down. */
  tx: number;
  ty: number;
  born: number;
  /** Flight time; fragments of one blast get different times, so they go off one after another. */
  ms: number;
  size: number;
  /** Bounces still to come after the next landing (0 to 3). */
  bounces: number;
  /** Ground distance of the first hop, in tiles; every bounce travels `BOUNCE_SPEED` times this far. */
  hop: number;
}

/** Never hold more than this many at once: a big battle must not slow the frame. */
export const MAX_SHRAPNEL = 120;

/** Flight times (ms): the first goes off quickly, the last well after the main blast has faded. */
const FLIGHT_MS: [number, number] = [220, 950];
/** Peak height of the arc, in tiles per tile flown. */
const ARC = 0.35;

/** Chance that a fragment bounces at all; it then bounces 1 to 3 times. */
export const BOUNCE_CHANCE = 0.4;
/** A bounce leaves at this fraction of the first hop's speed (each hop lasts as long as the first, so it goes this much of the distance). */
export const BOUNCE_SPEED = 0.75;

/** How many fragments a blast of this radius can throw (the actual count is 0..this). */
export const maxShrapnel = (radius: number): number => Math.min(10, Math.round(3 + radius * 3));

/** Adds 0..maxShrapnel(radius) fragments at (x, y). `rand` returns [0, 1). */
export function throwShrapnel(list: Shrapnel[], x: number, y: number, radius: number, now: number, rand: () => number = Math.random): void {
  const n = Math.floor(rand() * (maxShrapnel(radius) + 1));
  for (let k = 0; k < n && list.length < MAX_SHRAPNEL; k++) {
    const angle = rand() * Math.PI * 2;
    const dist = 0.4 + radius * (0.8 + rand() * 1.6);
    list.push({
      x,
      y,
      tx: x + Math.cos(angle) * dist,
      ty: y + Math.sin(angle) * dist,
      born: now,
      ms: FLIGHT_MS[0] + rand() * (FLIGHT_MS[1] - FLIGHT_MS[0]),
      size: 1.4 + rand() * 1.4,
      bounces: rand() < BOUNCE_CHANCE ? 1 + Math.floor(rand() * 3) : 0,
      hop: dist,
    });
  }
}

/**
 * Calls `land` for each fragment that has come down. One with bounces left is thrown again from where it
 * landed, in a random direction; the rest are removed. In place, so bouncing never grows the list.
 */
export function landShrapnel(list: Shrapnel[], now: number, land: (s: Shrapnel) => void, rand: () => number = Math.random): void {
  let w = 0;
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    if (now - s.born < s.ms) {
      list[w++] = s;
      continue;
    }
    land(s);
    if (s.bounces <= 0) continue;
    const angle = rand() * Math.PI * 2;
    s.x = s.tx;
    s.y = s.ty;
    s.tx += Math.cos(angle) * s.hop * BOUNCE_SPEED;
    s.ty += Math.sin(angle) * s.hop * BOUNCE_SPEED;
    s.born += s.ms;
    s.bounces--;
    list[w++] = s;
  }
  list.length = w;
}

/** Draws each fragment as a hot dot with a short trail, rising and falling along its arc. */
export function drawShrapnel(g: Graphics, list: readonly Shrapnel[], now: number, offX: number, offY: number, scale: number): void {
  for (const s of list) {
    const t = (now - s.born) / s.ms;
    if (t < 0 || t >= 1) continue;
    const dx = s.tx - s.x, dy = s.ty - s.y;
    const lift = Math.sqrt(dx * dx + dy * dy) * ARC;
    const u = Math.max(0, t - 0.12);
    const hx = offX + (s.x + dx * t) * scale;
    const hy = offY + (s.y + dy * t - 4 * lift * t * (1 - t)) * scale;
    const tx = offX + (s.x + dx * u) * scale;
    const ty = offY + (s.y + dy * u - 4 * lift * u * (1 - u)) * scale;
    g.moveTo(tx, ty).lineTo(hx, hy).stroke({ width: s.size * 0.7, color: 0xff9a2e, alpha: 0.7, cap: 'round' });
    g.circle(hx, hy, s.size).fill({ color: t < 0.5 ? 0xffe08a : 0xff7a1a });
  }
}
