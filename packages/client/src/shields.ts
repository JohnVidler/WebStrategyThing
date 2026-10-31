import { circleArcCrossings } from '@wst/engine';
import type { Graphics } from 'pixi.js';

/*
 * Energy shields: a translucent arc of energy drawn round its owner. Everything here is in screen pixels unless
 * it says tiles. The layer these are drawn on adds light, so two shields that overlap burn brighter where they
 * meet; where their edges cross, the renderer throws sparks (see `Renderer.drawShields`).
 */

/** A hit on the arc lights up the part of it that was struck for this long. */
export const FLASH_MS = 380;
/** Most hit flashes kept at once. */
export const MAX_FLASHES = 64;
/** More shields than this on screen and the interference between them is not worked out (it is pairwise). */
export const MAX_INTERFERING = 48;

export interface ShieldDraw {
  /** The entity that casts it (hit flashes are matched on it). */
  e: number;
  /** Centre and radius of the circle the arc is part of. */
  x: number;
  y: number;
  r: number;
  /** Where the arc points and how wide it is (radians, 0 = east, increasing towards south). */
  head: number;
  arc: number;
  colour: number;
  /** How full its owner's battery is, 0 to 1: a weak shield is dimmer, and a nearly empty one stutters. */
  level: number;
  /** Per-shield offset so neighbours do not shimmer in step. */
  seed: number;
}

/** A hit on the arc: where on it (radians from the owner) and how hard (0 to 1). */
export interface ShieldFlash {
  e: number;
  angle: number;
  born: number;
  power: number;
}

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
const mix = (a: number, b: number, k: number): number => {
  const ch = (shift: number) => Math.round(((a >> shift) & 0xff) * (1 - k) + ((b >> shift) & 0xff) * k);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
};

/** The brightness of a shield: its battery level, with a stutter when it is nearly flat (none with Reduce motion). */
export function shieldLevel(percent: number, now: number, seed: number, reduce: boolean): number {
  const level = 0.4 + 0.6 * Math.max(0, Math.min(1, percent / 100));
  if (reduce || percent >= 20) return level;
  return Math.sin(now * 0.045 + seed * 7) > -0.2 ? level : level * 0.35;
}

/** True if the angle (radians from the shield's centre) lies on the arc, with a little slack in radians. */
export function onArc(s: Pick<ShieldDraw, 'head' | 'arc'>, angle: number, slack = 0): boolean {
  return Math.abs(wrap(angle - s.head)) <= s.arc / 2 + slack;
}

/**
 * Where the circles of two shields cross, keeping only the crossings that lie on both arcs. Writes [x, y, ...] into `out`
 * (cleared first, so it can be reused) and returns how many points. Same maths as the engine's, which bills the power.
 */
export function arcIntersections(a: ShieldDraw, b: ShieldDraw, out: number[]): number {
  out.length = 0;
  return circleArcCrossings(a.x, a.y, a.r, a.head, a.arc, b.x, b.y, b.r, b.head, b.arc, out);
}

/** Moves a displayed value a share of the way to the latest replicated one (`k` from `easeBy`), for smooth arcs between ticks. */
export const easeBy = (dtSeconds: number): number => 1 - Math.exp(-Math.min(0.25, Math.max(0, dtSeconds)) * 14);
export const easeAngle = (cur: number, want: number, k: number): number => cur + wrap(want - cur) * k;

/** Strokes the arc as a polyline (a few degrees per segment), so it never depends on how the renderer joins arcs. */
function arcPath(g: Graphics, s: ShieldDraw, from: number, to: number, r = s.r): Graphics {
  const steps = Math.max(2, Math.min(48, Math.ceil(Math.abs(to - from) / 0.07)));
  for (let i = 0; i <= steps; i++) {
    const a = from + ((to - from) * i) / steps;
    const x = s.x + Math.cos(a) * r;
    const y = s.y + Math.sin(a) * r;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  return g;
}

/** A soft round bloom: stacked discs that thin out towards the rim, with a hot white middle. Drawn on the additive shield layer. */
export function drawBloom(g: Graphics, x: number, y: number, radius: number, colour: number, alpha: number): void {
  if (alpha < 0.01 || radius < 1) return;
  const steps = 6;
  for (let i = steps; i >= 1; i--) {
    const k = i / steps;
    g.circle(x, y, radius * k).fill({ color: k < 0.4 ? mix(colour, 0xffffff, 0.7) : colour, alpha: alpha * 0.2 * (1.2 - k) });
  }
}

/** How long a crossing's bloom lasts without being refreshed (ms), and the most drawn at once. */
export const CROSSING_BLOOM_MS = 130;
export const MAX_CROSSING_BLOOMS = 64;

/** Draws one shield: a soft body, a bright core line, dashes of energy running along it, and a flare wherever it was just hit. */
export function drawShield(g: Graphics, s: ShieldDraw, flashes: readonly ShieldFlash[], now: number, thickness: number, reduce: boolean): void {
  const from = s.head - s.arc / 2;
  const to = s.head + s.arc / 2;
  const core = mix(s.colour, 0xffffff, 0.6);
  const lv = s.level;
  // The dome the arc encloses is faintly tinted, so the covered ground reads as protected.
  g.moveTo(s.x, s.y);
  for (let i = 0; i <= 12; i++) g.lineTo(s.x + Math.cos(from + ((to - from) * i) / 12) * s.r, s.y + Math.sin(from + ((to - from) * i) / 12) * s.r);
  g.closePath().fill({ color: s.colour, alpha: 0.045 * lv });
  // The glow lives inside the border: bands of the same arc stepping towards the centre, each fainter than the last.
  const depth = Math.min(s.r * 0.3, thickness * 9);
  const bands = 6;
  for (let i = bands; i >= 1; i--) {
    const inset = (depth * i) / bands;
    arcPath(g, s, from, to, s.r - inset).stroke({ width: depth / bands + 1, color: s.colour, alpha: 0.13 * lv * (1 - (i - 1) / bands) ** 2, cap: 'butt', join: 'round' });
  }
  // The border itself: a thin bright line with a hair of halo outside it.
  arcPath(g, s, from, to).stroke({ width: thickness * 2.6, color: s.colour, alpha: 0.12 * lv, cap: 'round', join: 'round' });
  arcPath(g, s, from, to).stroke({ width: thickness, color: core, alpha: 0.9 * lv, cap: 'round', join: 'round' });
  // The two ends, where the energy is anchored.
  for (const a of [from, to]) g.circle(s.x + Math.cos(a) * s.r, s.y + Math.sin(a) * s.r, Math.max(1.5, thickness * 0.9)).fill({ color: core, alpha: 0.8 * lv });
  if (!reduce) {
    // Dashes of brighter energy slide along the arc.
    const length = s.arc * s.r;
    const n = Math.max(2, Math.min(16, Math.round(length / Math.max(14, thickness * 6))));
    const slide = (now / 2400 + s.seed) % 1;
    for (let i = 0; i < n; i++) {
      const t = (i / n + slide) % 1;
      const a0 = from + s.arc * t;
      const a1 = Math.min(to, a0 + (s.arc / n) * 0.35);
      const pulse = 0.5 + 0.5 * Math.sin(now * 0.004 + i * 1.7 + s.seed * 6);
      arcPath(g, s, a0, a1).stroke({ width: Math.max(1.5, thickness * 1.3), color: core, alpha: (0.25 + 0.45 * pulse) * lv, cap: 'round' });
    }
  }
  for (const f of flashes) {
    const age = (now - f.born) / FLASH_MS;
    if (f.e !== s.e || age < 0 || age >= 1) continue;
    const spread = 0.12 + 0.35 * age + 0.2 * f.power;
    const a0 = Math.max(from, f.angle - spread);
    const a1 = Math.min(to, f.angle + spread);
    if (a1 <= a0) continue;
    const fade = (1 - age) * (0.55 + 0.45 * f.power);
    arcPath(g, s, a0, a1).stroke({ width: thickness * (9 - 5 * age), color: s.colour, alpha: 0.16 * fade, cap: 'round' });
    arcPath(g, s, a0, a1).stroke({ width: thickness * (4 - 2 * age), color: s.colour, alpha: 0.4 * fade, cap: 'round' });
    arcPath(g, s, a0, a1).stroke({ width: thickness * 1.5, color: 0xffffff, alpha: 0.9 * fade, cap: 'round' });
    // The bloom: a glow that swells at the point struck, then dies back.
    const at = Math.max(from, Math.min(to, f.angle));
    const swell = (1 - age) ** 2;
    drawBloom(g, s.x + Math.cos(at) * s.r, s.y + Math.sin(at) * s.r, thickness * (7 + 14 * f.power) * (0.6 + 0.4 * age), s.colour, (reduce ? 0.6 : 1.3) * swell * (0.5 + 0.5 * f.power) * lv);
  }
}
