import type { Graphics } from 'pixi.js';

/*
 * Looks for the railgun, the ion gun and smoke. Each is meant to be told apart at a glance from the other weapons:
 *  - the railgun shows a thin blue aim line and a glint that gathers for the whole charge, then a white-blue beam with shock rings
 *    marching down it (so the charge is a warning everyone can read, and the shot is the biggest line on the field);
 *  - the ion gun is a jagged violet bolt that crackles on its target, and a unit with a module held down crackles with violet arcs;
 *  - smoke is soft grey billows that swell out, drift in place and thin away (with Reduce motion they are still discs).
 * Everything here is pure drawing in screen pixels; `unit` is pixels per tile, `still` is Reduce motion.
 */

export const RAIL_COLOUR = 0x8fd8ff;
export const ION_COLOUR = 0xc27bff;
/** How long (ms) the beam of a railgun shot, an ion bolt and the swelling of a new smoke cloud last. */
export const RAIL_BEAM_MS = 520;
export const ION_BOLT_MS = 340;
export const SMOKE_SWELL_MS = 600;

const WHITE = 0xffffff;
const TAU = Math.PI * 2;

/** A repeatable pseudo-random number in 0..1 from an integer, so effects look the same each frame without storing anything. */
export const hash = (n: number): number => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

const easeOut = (t: number): number => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3;

/**
 * A railgun gathering its charge: a dashed aim line out to full range, and a glint at the muzzle that grows, brightens and shrinks
 * rings into itself. `pct` is 0..1 of the charge.
 */
export function drawRailCharge(g: Graphics, x: number, y: number, heading: number, pct: number, reach: number, unit: number, now: number, still: boolean): void {
  const dx = Math.cos(heading), dy = Math.sin(heading);
  const mx = x + dx * unit * 0.7, my = y + dy * unit * 0.7;
  const a = 0.12 + 0.5 * pct;
  const dash = Math.max(6, unit * 0.3);
  const gap = still ? 0 : dash * 0.8;
  const shift = still ? 0 : ((now / 40) % (dash + gap));
  for (let d = -shift; d < reach; d += dash + gap) {
    const s = Math.max(0, d), e = Math.min(reach, d + dash);
    if (e <= s) continue;
    g.moveTo(mx + dx * s, my + dy * s).lineTo(mx + dx * e, my + dy * e).stroke({ width: 1.4 + 1.6 * pct, color: RAIL_COLOUR, alpha: a * (1 - 0.5 * (s / reach)) });
  }
  const r = unit * (0.1 + 0.3 * pct);
  g.circle(mx, my, r * 2.2).fill({ color: RAIL_COLOUR, alpha: 0.12 + 0.2 * pct });
  g.circle(mx, my, r).fill({ color: RAIL_COLOUR, alpha: 0.35 + 0.5 * pct });
  g.circle(mx, my, r * 0.45).fill({ color: WHITE, alpha: 0.5 + 0.5 * pct });
  if (still) return;
  for (let k = 0; k < 2; k++) {
    const f = ((now / 380 + k / 2) % 1);
    g.circle(mx, my, r * (3.2 - 2.4 * f)).stroke({ width: 1.4, color: RAIL_COLOUR, alpha: (0.15 + 0.5 * pct) * f });
  }
}

/** The shot: a blue-white beam along `heading` for `len` pixels, shock rings spreading down it, fading over its life (`age` 0..1). */
export function drawRailBeam(g: Graphics, x: number, y: number, heading: number, len: number, age: number, unit: number, still: boolean): void {
  if (age < 0 || age >= 1 || len < 2) return;
  const dx = Math.cos(heading), dy = Math.sin(heading);
  const fade = (1 - age) ** 1.5;
  const ax = x + dx * unit * 0.7, ay = y + dy * unit * 0.7;
  const bx = x + dx * len, by = y + dy * len;
  const w = Math.max(3, unit * 0.16);
  g.moveTo(ax, ay).lineTo(bx, by).stroke({ width: w * 5 * (0.4 + 0.6 * fade), color: RAIL_COLOUR, alpha: 0.1 * fade, cap: 'round' });
  g.moveTo(ax, ay).lineTo(bx, by).stroke({ width: w * 2.4, color: RAIL_COLOUR, alpha: 0.45 * fade, cap: 'round' });
  g.moveTo(ax, ay).lineTo(bx, by).stroke({ width: w * 1.1, color: WHITE, alpha: 0.95 * fade, cap: 'round' });
  g.circle(ax, ay, w * 3.2 * fade).fill({ color: WHITE, alpha: 0.6 * fade });
  if (still) return;
  // Shock rings: a ring every couple of tiles, each spreading as it ages.
  const step = unit * 2;
  const n = Math.min(14, Math.floor((len - unit) / step));
  for (let k = 1; k <= n; k++) {
    const delay = k / (n + 2) * 0.4;
    const t = Math.max(0, age - delay);
    if (t <= 0) continue;
    g.circle(x + dx * (unit * 0.7 + k * step), y + dy * (unit * 0.7 + k * step), unit * (0.15 + 1.1 * t)).stroke({ width: 1.6, color: RAIL_COLOUR, alpha: 0.5 * (1 - t) });
  }
}

/** An ion bolt: a jagged violet line that crackles on its target. `seed` makes each bolt different; `age` 0..1. */
export function drawIonBolt(g: Graphics, ax: number, ay: number, bx: number, by: number, age: number, seed: number, unit: number, still: boolean): void {
  if (age < 0 || age >= 1) return;
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len < 1) return;
  const nx = -dy / len, ny = dx / len;
  const fade = (1 - age) ** 1.3;
  const segs = Math.max(3, Math.min(24, Math.round(len / (unit * 0.45))));
  const frame = still ? 0 : Math.floor(age * 9);
  const px: number[] = [ax], py: number[] = [ay];
  for (let i = 1; i < segs; i++) {
    const j = (hash(seed * 31 + i * 7 + frame * 131) - 0.5) * unit * 0.4 * Math.sin((i / segs) * Math.PI);
    px.push(ax + dx * (i / segs) + nx * j);
    py.push(ay + dy * (i / segs) + ny * j);
  }
  px.push(bx);
  py.push(by);
  const path = (width: number, colour: number, alpha: number): void => {
    g.moveTo(px[0], py[0]);
    for (let i = 1; i < px.length; i++) g.lineTo(px[i], py[i]);
    g.stroke({ width, color: colour, alpha, join: 'round', cap: 'round' });
  };
  const w = Math.max(1.5, unit * 0.045);
  path(w * 5, ION_COLOUR, 0.14 * fade);
  path(w * 2, ION_COLOUR, 0.8 * fade);
  path(w * 0.8, WHITE, 0.95 * fade);
  // The target crackles: a ring and a few forked stubs.
  g.circle(bx, by, unit * (0.15 + 0.5 * age)).stroke({ width: 1.6, color: ION_COLOUR, alpha: 0.7 * fade });
  g.circle(bx, by, w * 2.2).fill({ color: WHITE, alpha: 0.8 * fade });
  if (still) return;
  for (let k = 0; k < 4; k++) {
    const a = hash(seed + k * 17 + frame * 7) * TAU;
    const l = unit * (0.2 + 0.35 * hash(seed + k * 29 + frame));
    g.moveTo(bx, by).lineTo(bx + Math.cos(a) * l, by + Math.sin(a) * l).stroke({ width: 1.2, color: ION_COLOUR, alpha: 0.7 * fade });
  }
}

/** A unit with a module held down by an ion bolt: violet arcs flicker round it. `r` is its radius in pixels. */
export function drawIonHold(g: Graphics, x: number, y: number, r: number, seed: number, now: number, still: boolean): void {
  g.circle(x, y, r * 1.15).stroke({ width: 1.3, color: ION_COLOUR, alpha: still ? 0.45 : 0.25 });
  if (still) return;
  const frame = Math.floor(now / 90);
  for (let k = 0; k < 3; k++) {
    const a0 = hash(seed * 13 + k * 5 + frame) * TAU;
    const span = 0.5 + hash(seed + k + frame * 3) * 0.7;
    g.arc(x, y, r * (1.05 + 0.2 * hash(seed + k * 3 + frame)), a0, a0 + span).stroke({ width: 1.8, color: ION_COLOUR, alpha: 0.35 + 0.5 * hash(seed + k + frame * 11) });
  }
}

/** Soft grey colours of day and night smoke. */
const SMOKE_DAY = 0xa7adb7;
const SMOKE_NIGHT = 0x4a5062;

/**
 * One smoke cloud: a cluster of billows, each three stacked discs (so the edge is soft), swelling out when it lands, turning slowly
 * and thinning as its `life` (0..1) runs out. `swell` is 0..1 of the landing animation; `daylight` is 0..100.
 */
export function drawSmokeCloud(g: Graphics, x: number, y: number, radius: number, life: number, swell: number, id: number, daylight: number, now: number, still: boolean): void {
  const colour = daylight > 35 ? SMOKE_DAY : SMOKE_NIGHT;
  const grow = 0.25 + 0.75 * easeOut(swell);
  const thin = Math.min(1, life * 3);
  const spin = still ? 0 : now * 0.00012;
  const billows = 9;
  for (let i = 0; i < billows; i++) {
    const a = hash(id * 17 + i) * TAU + spin * (i % 2 === 0 ? 1 : -1.4);
    const d = (0.15 + 0.5 * hash(id * 5 + i * 3)) * radius * grow;
    const s = (0.4 + 0.3 * hash(id * 3 + i * 11)) * radius * (0.6 + 0.4 * grow) * (still ? 1 : 1 + 0.06 * Math.sin(now * 0.0012 + i * 2));
    const cx = x + Math.cos(a) * d, cy = y + Math.sin(a) * d;
    g.circle(cx, cy, s).fill({ color: colour, alpha: 0.1 * thin });
    g.circle(cx, cy, s * 0.78).fill({ color: colour, alpha: 0.14 * thin });
    g.circle(cx, cy, s * 0.55).fill({ color: colour, alpha: 0.18 * thin });
  }
}
