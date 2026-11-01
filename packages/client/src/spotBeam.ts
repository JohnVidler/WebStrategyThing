import { LIGHT_HALF_ANGLE, type Terrain } from '@wst/engine';
import type { Graphics } from 'pixi.js';

/*
 * Spotlight beams: a soft wedge of warm light thrown from a spotlight module. The engine decides what the beam shows (see
 * `viewersOf`); this only draws it, so it ends where rock or a building would stop the sight. Everything is in screen pixels
 * unless it says tiles. The layer these are drawn on adds light.
 */

/** Rays cast across the beam to find where it is cut short; more is smoother and dearer. */
export const BEAM_RAYS = 13;
/** Step (tiles) along each ray. */
const STEP = 0.5;
/** The warm white of the lamp. */
export const BEAM_LIGHT = 0xfff1c4;
/**
 * Nested layers from the widest and faintest to the narrow, bright core: share of the beam's half width, share of its length, alpha.
 * Many faint layers add up (the layer blends with added light) to a smooth falloff: bright down the middle, fading towards the sides,
 * and towards the far end, since the wide layers stop short of the core.
 */
const LAYER_COUNT = 14;
const LAYERS: readonly (readonly [number, number, number])[] = Array.from({ length: LAYER_COUNT }, (_, i) => {
  const k = i / (LAYER_COUNT - 1); // 0 = widest, 1 = the core
  return [1.25 - 1.15 * k, 0.5 + 0.5 * k, 0.02] as const;
});

const TAU = Math.PI * 2;
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * How far (tiles) each of `out.length` rays across the beam gets before rock or a building stops it, up to `length`. The beam starts
 * `skip` tiles out from the lamp (clear of the building that holds it, which would otherwise stop every ray at once). Writes into `out`.
 */
export function beamReach(terrain: Terrain, x: number, y: number, head: number, length: number, skip: number, out: Float32Array): void {
  const n = out.length;
  const { width, height, passable, depth, occupied } = terrain;
  for (let i = 0; i < n; i++) {
    const a = head + (n === 1 ? 0 : (i / (n - 1) - 0.5) * 2 * LIGHT_HALF_ANGLE);
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    let d = skip;
    for (; d < length; d += STEP) {
      const tx = Math.floor(x + dx * d);
      const ty = Math.floor(y + dy * d);
      if (tx < 0 || ty < 0 || tx >= width || ty >= height) break;
      const c = ty * width + tx;
      if ((passable[c] !== 1 && depth[c] === 0) || occupied[c] !== 0) break;
    }
    out[i] = Math.min(length, d);
  }
}

export interface BeamDraw {
  /** The lamp, in screen pixels. */
  x: number;
  y: number;
  /** Pixels per tile. */
  scale: number;
  head: number;
  /** Where each ray ends, in tiles (see `beamReach`), and the tiles the beam starts out from the lamp. */
  reach: Float32Array;
  skip: number;
  /** 0..1: how bright the beam looks (fainter by day, when it hardly shows). */
  strength: number;
}

/** Draws the beam as three nested wedges, each a fan from the lamp out to where its rays ended. */
export function drawBeam(g: Graphics, b: BeamDraw): void {
  const n = b.reach.length;
  for (const [width, long, alpha] of LAYERS) {
    g.moveTo(b.x + Math.cos(b.head) * b.skip * b.scale, b.y + Math.sin(b.head) * b.skip * b.scale);
    for (let i = 0; i < n; i++) {
      const a = b.head + (n === 1 ? 0 : (i / (n - 1) - 0.5) * 2 * LIGHT_HALF_ANGLE * width);
      const r = (b.skip + (b.reach[i] - b.skip) * long) * b.scale;
      g.lineTo(b.x + Math.cos(a) * r, b.y + Math.sin(a) * r);
    }
    g.closePath().fill({ color: BEAM_LIGHT, alpha: alpha * b.strength });
  }
}

/** The heading a beam is drawn at: eased towards the replicated one (256ths of a turn) so it glides between ticks. */
export class BeamHeadings {
  private readonly view = new Map<number, number>();

  ease(e: number, heading: number, k: number): number {
    const want = (heading / 256) * TAU;
    const cur = this.view.get(e);
    const next = cur === undefined ? want : cur + wrap(want - cur) * k;
    this.view.set(e, next);
    return next;
  }

  /** Forgets every light not in `keep` (it is gone or out of sight). */
  retain(keep: ReadonlySet<number>): void {
    for (const e of this.view.keys()) if (!keep.has(e)) this.view.delete(e);
  }
}
