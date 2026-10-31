import type { Sprite } from 'pixi.js';

/**
 * A flying unit that has been shot down sometimes does not blow up where it was hit: it tumbles on for a
 * moment, trailing fire, and goes off where it comes down. Purely a picture: the unit is already gone from
 * the simulation. Positions are in tiles.
 */
export interface Wreck {
  /** The dead unit's own sprite and shadow, kept alive for the fall. */
  sprite: Sprite;
  shadow: Sprite;
  /** Where it was hit. */
  x: number;
  y: number;
  /** Ground speed in tiles per ms. */
  vx: number;
  vy: number;
  /** Radians per ms the sprite spins at the end of the fall (it starts slow and winds up). */
  spin: number;
  /** Rotation when the fall began. */
  turn0: number;
  born: number;
  ms: number;
  /** Next time (ms) it throws off sparks. */
  nextSmoke: number;
  /** Blast radius, in tiles, of the explosion at the end. */
  radius: number;
  /** Hull radius of the unit, in tiles: how big a fire it leaves (see `wreckFireMs`). */
  size: number;
}

/** Chance that a shot-down flier crashes on instead of blowing up at once. */
export const CRASH_CHANCE = 0.3;
/** Chance that a crashed wreck is left burning where it came down, and for how long (ms) on a dry day. */
export const WRECK_FIRE_CHANCE = 0.2;
export const WRECK_FIRE_MS = 7000;

/** Hull radius (tiles) of a medium unit: the size at which the chance and duration are the plain ones above. */
export const WRECK_FIRE_REFERENCE_SIZE = 0.45;
/** A wreck with a hull at least this big (super-heavy and up) throws fragments now and then while it burns. */
export const BIG_WRECK_SIZE = 0.7;

/** How much more (or less) a wreck of this hull radius (tiles) burns than a medium one: 0.4x for the smallest up to 2.5x for the biggest. */
export const wreckFireScale = (size: number): number => Math.min(2.5, Math.max(0.4, size / WRECK_FIRE_REFERENCE_SIZE));

/**
 * How long (ms) a wreck that has just come down burns, or 0 if it does not catch. Big wrecks catch more often and burn longer;
 * rain makes it less likely and shortens it (`wet` 0..1). `roll` is in [0, 1), `size` is the hull radius in tiles.
 */
export function wreckFireMs(wet: number, roll: number, size = WRECK_FIRE_REFERENCE_SIZE): number {
  const w = Math.min(1, Math.max(0, wet));
  const k = wreckFireScale(size);
  return roll < WRECK_FIRE_CHANCE * k * (1 - w) ? WRECK_FIRE_MS * Math.sqrt(k) * (1 - 0.75 * w) : 0;
}

/** How big the flames of a burning wreck are, as a multiple of a fragment's fire: 0.5 up to 1.2. */
export const wreckFlameSize = (size: number): number => Math.min(1.2, 0.4 + size * 0.8);

/** Whether a burning wreck of this hull radius throws fragments from time to time. */
export const wreckThrowsFragments = (size: number): boolean => size >= BIG_WRECK_SIZE;

/** Never hold more than this many at once: a big air battle must not slow the frame. */
export const MAX_WRECKS = 12;

/** Fall time (ms). */
const FALL_MS: [number, number] = [550, 1100];
/** Ground speed (tiles per second), so the whole fall covers roughly 2 to 4 tiles. */
const SPEED: [number, number] = [3, 4.5];
/** Spin at the end of the fall (radians per second, either way round). */
const SPIN: [number, number] = [4, 9];
/** How high above its shadow (in tiles) the wreck starts. */
const START_HEIGHT = 0.6;
/** Gap between puffs of fire. */
export const SMOKE_EVERY_MS = 70;

/** Whether this death should be a crash. `rand` returns [0, 1). */
export const shouldCrash = (rand: () => number = Math.random): boolean => rand() < CRASH_CHANCE;

/**
 * Sets the fall in motion from the unit's last position. `heading` is the direction it was travelling
 * (radians, 0 along +x); a flier that was hovering still lurches off along the way it faced.
 */
export function startWreck(sprite: Sprite, shadow: Sprite, x: number, y: number, heading: number, radius: number, now: number, rand: () => number = Math.random, size = WRECK_FIRE_REFERENCE_SIZE): Wreck {
  const speed = (SPEED[0] + rand() * (SPEED[1] - SPEED[0])) / 1000;
  const slew = (rand() * 2 - 1) * 0.5; // veers a little off its line
  const angle = heading + slew;
  return {
    sprite,
    shadow,
    x,
    y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    spin: (rand() < 0.5 ? -1 : 1) * (SPIN[0] + rand() * (SPIN[1] - SPIN[0])) / 1000,
    turn0: sprite.rotation,
    born: now,
    ms: FALL_MS[0] + rand() * (FALL_MS[1] - FALL_MS[0]),
    nextSmoke: now,
    radius,
    size,
  };
}

/** Progress through the fall, 0 to 1. */
export const wreckProgress = (w: Wreck, now: number): number => Math.min(1, Math.max(0, (now - w.born) / w.ms));

/** Where the shadow (the point on the ground) is, in tiles. It speeds up a little as the unit drops. */
export function wreckGround(w: Wreck, now: number): { x: number; y: number } {
  const dt = Math.min(now - w.born, w.ms);
  return { x: w.x + w.vx * dt, y: w.y + w.vy * dt };
}

/** How far above the ground the wreck is, in tiles: it drops slowly at first and then faster. */
export const wreckHeight = (t: number): number => START_HEIGHT * (1 - t * t);

/** Rotation of the sprite at progress `t`: the spin winds up, so the angle grows with t squared. */
export const wreckRotation = (w: Wreck, t: number): number => w.turn0 + w.spin * w.ms * t * t;

/** Calls `land` for each wreck that has finished falling, and removes it; in place. */
export function landWrecks(list: Wreck[], now: number, land: (w: Wreck) => void): void {
  let keep = 0;
  for (let i = 0; i < list.length; i++) {
    const w = list[i];
    if (now - w.born < w.ms) list[keep++] = w;
    else land(w);
  }
  list.length = keep;
}
