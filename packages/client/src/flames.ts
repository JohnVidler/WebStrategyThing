import type { Graphics } from 'pixi.js';
import { FLAME_RADIUS, TILE } from '@wst/engine';

/*
 * Flamethrower effects. A fireball is a glowing ball on a lobbed arc above a shadow, trailing flame and a little
 * smoke; a fire is a scorch mark with flickering tongues and a column of smoke puffs. Nothing here holds state: every
 * shape is a function of the clock and the entity's index, so a fire costs a few shapes per frame and nothing between.
 * Positions are screen pixels. With Reduce motion the clock stops (`still`), leaving a steady picture.
 */

export const FIRE_RED = 0xd8310a;
export const FIRE_ORANGE = 0xff8a1c;
export const FIRE_YELLOW = 0xffe27a;
/** The colour of a fire's light (tinting the soft glow). */
export const FIRE_LIGHT = 0xff7a18;
const SMOKE = 0x34343a;

/** How long a smoke puff takes to rise and fade, in ms, and how many hang over each fire. */
export const SMOKE_PUFF_MS = 2600;
export const SMOKE_PUFFS = 4;
/** Tongues of flame in a fire when there is room to spare; the renderer asks for fewer when a jet has laid many fires. */
export const MAX_TONGUES = 10;
/** Highest point of a lobbed fireball above the ground, in tiles. */
export const LOB_HEIGHT = 1.4;

/** Pseudo-random number in [0, 1) from two integers: the same every frame, different for every fire and tongue. */
export function hash01(a: number, b: number): number {
  let h = Math.imul(a + 1, 0x9e3779b1) ^ Math.imul(b + 1, 0x85ebca6b);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return ((h >>> 0) % 10000) / 10000;
}

/** Height of a lobbed fireball above the ground, in tiles, `progress` (0..1) of the way along its flight. */
export function lobHeight(progress: number): number {
  const p = Math.min(1, Math.max(0, progress));
  return 4 * p * (1 - p) * LOB_HEIGHT;
}

/** The fire's brightness and size follow what is left of it (0..1): full for most of its life, dying away at the end. */
export function fireStrength(life: number): number {
  return Math.min(1, Math.max(0, life) * 2.5);
}

/** Flicker in [0.7, 1] that differs between fires and tongues. */
export function flicker(now: number, seed: number, still: boolean): number {
  return still ? 0.85 : 0.85 + 0.15 * Math.sin(now / 70 + seed * 2.3) * Math.sin(now / 130 + seed);
}

/** Draws a soft round blob (pixels, tint, alpha): no hard edge, so overlapping smoke and scorch blend instead of showing rims. */
export type Blob = (x: number, y: number, radius: number, colour: number, alpha: number) => void;

const tongue: number[] = new Array(10).fill(0);

/** One flame tongue: a teardrop from a base point up to a swaying tip. */
function drawTongue(g: Graphics, bx: number, by: number, w: number, h: number, sway: number, colour: number, alpha: number): void {
  const tx = bx + sway;
  const ty = by - h;
  tongue[0] = bx - w; tongue[1] = by;
  tongue[2] = bx - w * 0.55 + sway * 0.3; tongue[3] = by - h * 0.55;
  tongue[4] = tx; tongue[5] = ty;
  tongue[6] = bx + w * 0.55 + sway * 0.3; tongue[7] = by - h * 0.55;
  tongue[8] = bx + w; tongue[9] = by;
  g.poly(tongue).fill({ color: colour, alpha });
}

/** A burning fire at (cx, cy): scorch mark, flames and smoke. `life` is what is left of it, 0..1. */
export function drawFire(g: Graphics, blob: Blob, cx: number, cy: number, scale: number, life: number, now: number, seed: number, still: boolean, tongues = MAX_TONGUES, smoke = true): void {
  const s = fireStrength(life);
  if (s <= 0) return;
  const reach = (FLAME_RADIUS / TILE) * scale;
  // A dark scorch mark, and a ring of dull embers.
  blob(cx, cy, reach * 1.1, 0x120a06, 0.3 * s);
  blob(cx, cy - scale * 0.05, reach * 0.8, FIRE_RED, 0.18 * s);
  for (let i = 0; i < tongues; i++) {
    // A few tall flames near the middle and shorter ones towards the edge, so the fire has a shape.
    const a = ((i + hash01(seed, i + 5) * 0.8) / tongues) * Math.PI * 2;
    const d = (i === 0 ? 0.1 : 0.35 + hash01(seed, i + 17) * 0.65) * reach * 0.8;
    const bx = cx + Math.cos(a) * d;
    const by = cy + Math.sin(a) * d * 0.7;
    const f = flicker(now, seed + i * 3.1, still);
    const edge = 1 - 0.45 * (d / (reach * 0.8));
    const h = scale * (0.4 + 0.45 * hash01(seed, i + 31)) * edge * f * (0.4 + 0.6 * s);
    const w = scale * 0.2 * (0.6 + 0.4 * s) * (0.8 + 0.4 * hash01(seed, i + 43));
    const sway = still ? 0 : Math.sin(now / 160 + seed + i) * scale * 0.08;
    drawTongue(g, bx, by, w, h, sway, FIRE_RED, 0.85 * s);
    drawTongue(g, bx, by, w * 0.7, h * 0.78, sway * 0.8, FIRE_ORANGE, 0.9 * s);
    drawTongue(g, bx, by, w * 0.4, h * 0.5, sway * 0.5, FIRE_YELLOW, 0.95 * s);
  }
  if (smoke) drawSmoke(blob, cx, cy - scale * 0.3, scale, Math.min(1, life * 3), now, seed, still);
}

/** Dark puffs that rise from (cx, cy), swell and fade, each at a different point of its climb. */
export function drawSmoke(blob: Blob, cx: number, cy: number, scale: number, strength: number, now: number, seed: number, still: boolean): void {
  if (strength <= 0) return;
  for (let i = 0; i < SMOKE_PUFFS; i++) {
    const phase = still ? (i + 0.5) / SMOKE_PUFFS : (now / SMOKE_PUFF_MS + i / SMOKE_PUFFS + hash01(seed, 99)) % 1;
    const drift = (hash01(seed, i + 50) - 0.3) * scale * 0.9 * phase;
    const x = cx + drift;
    const y = cy - phase * scale * 1.7;
    const r = scale * (0.16 + 0.34 * phase);
    const alpha = Math.min(0.85, 0.34 * strength) * (1 - phase) * Math.min(1, phase * 8);
    blob(x, y, r * 1.6, SMOKE, alpha);
  }
}

/** Anything (building or unit) shows smoke once it is below this share of its hit points, and fire below `DAMAGE_FIRE_BELOW`. */
export const DAMAGE_SMOKE_BELOW = 0.9;
export const DAMAGE_FIRE_BELOW = 0.6;
/** Most smoke columns and fires on one thing. */
const DAMAGE_MAX_SMOKES = 5;
const DAMAGE_MAX_FIRES = 5;

/** How many smoke columns and fires a thing `size` tiles across shows at `frac` (0..1) of its hit points. */
export function damageCounts(frac: number, size: number): { smokes: number; fires: number } {
  if (frac >= DAMAGE_SMOKE_BELOW || frac <= 0) return { smokes: 0, fires: 0 };
  const room = Math.min(4, Math.max(1, Math.round(size * 1.5)));
  const smoke = (DAMAGE_SMOKE_BELOW - frac) / DAMAGE_SMOKE_BELOW;
  const burn = frac >= DAMAGE_FIRE_BELOW ? 0 : (DAMAGE_FIRE_BELOW - frac) / DAMAGE_FIRE_BELOW;
  return {
    smokes: Math.min(DAMAGE_MAX_SMOKES, Math.max(1, Math.ceil(smoke * room) + (frac < 0.5 ? 1 : 0))),
    fires: burn <= 0 ? 0 : Math.min(DAMAGE_MAX_FIRES, Math.max(1, Math.ceil(burn * room))),
  };
}

/**
 * Smoke, then fire, on something centred at (cx, cy) that is `size` tiles across. `frac` is its hit points over its
 * maximum. Spots are fixed by `seed`, so the same ones keep burning as it gets worse; `budget` (0..1) thins the effect
 * when many are on screen. Bold on purpose: dense dark smoke, tall flames and a glow, so damage reads from across the map.
 */
export function drawDamage(g: Graphics, blob: Blob, cx: number, cy: number, scale: number, size: number, frac: number, now: number, seed: number, still: boolean, budget = 1): void {
  const { smokes, fires } = damageCounts(frac, size);
  if (smokes === 0) return;
  const span = Math.max(0.6, size) * scale * 0.5;
  const dense = (1.6 + 1.2 * (1 - frac)) * budget;
  const puff = scale * (1 + 0.25 * Math.min(size, 4));
  for (let i = 0; i < smokes; i++) {
    const x = cx + (hash01(seed, 200 + i) - 0.5) * span;
    const y = cy + (hash01(seed, 210 + i) - 0.5) * span;
    drawSmoke(blob, x, y, puff, dense, now, seed * 7 + i, still);
  }
  for (let i = 0; i < fires; i++) {
    const x = cx + (hash01(seed, 300 + i) - 0.5) * span;
    const y = cy + (hash01(seed, 310 + i) - 0.5) * span;
    const fs = scale * (0.8 + 0.15 * Math.min(size, 4));
    blob(x, y - fs * 0.2, fs * 0.9, FIRE_LIGHT, 0.3 * budget * flicker(now, seed + i, still));
    drawFire(g, blob, x, y, fs, 1, now, seed * 5 + i, still, budget < 1 ? 4 : 7, false);
  }
}

/** A fireball in the air at ground point (gx, gy), `progress` (0..1) along its lob, heading by (dirX, dirY) on screen. */
export function drawFireball(g: Graphics, blob: Blob, gx: number, gy: number, scale: number, progress: number, dirX: number, dirY: number, now: number, seed: number, still: boolean): void {
  const up = lobHeight(progress) * scale;
  const y = gy - up;
  const f = flicker(now, seed, still);
  const r = Math.max(2.5, scale * 0.17) * f;
  // The shadow stays on the ground and shrinks the higher the ball is.
  blob(gx, gy, r * 2 * (0.9 - 0.25 * Math.min(1, up / (scale * LOB_HEIGHT))), 0x000000, 0.3);
  // A tail of dying flame behind it, and a thin smoke trail.
  const len = Math.hypot(dirX, dirY) || 1;
  const bx = -dirX / len;
  const by = -dirY / len;
  for (let i = 3; i >= 1; i--) {
    const k = i / 3;
    blob(gx + bx * scale * 0.22 * i, y + by * scale * 0.22 * i + (still ? 0 : -k * 2), r * (1.8 - 0.3 * i), i === 3 ? FIRE_RED : FIRE_ORANGE, 0.6 * (1 - k * 0.5));
  }
  drawSmoke(blob, gx + bx * scale * 0.5, y + by * scale * 0.5, scale * 0.5, 0.6, now, seed, still);
  blob(gx, y, r * 2.6, FIRE_RED, 0.6);
  g.circle(gx, y, r).fill(FIRE_ORANGE);
  g.circle(gx, y, r * 0.55).fill(FIRE_YELLOW);
}
