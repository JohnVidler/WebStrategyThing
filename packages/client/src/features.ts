/**
 * Art for the map's fixed features: steam vents (the hole, and the steam that comes out of it, which looks
 * different for an open vent, one with a building site on it, one plugged by a building and one worked by a
 * steam turbine) and neutral scenery (small buildings that do nothing). The textures are drawn once and
 * shared; the steam is redrawn each frame for the few vents on screen. With Reduce motion on, steam is
 * frozen: a few still puffs over an open vent, a steady ring over a working one, nothing else.
 */
import type { Graphics } from 'pixi.js';
import { FeatureKind } from '@wst/engine';
import { VentCover } from './state';

const STEAM = 0xe8eef3;
const ENERGY = 0x6fd3ff;

const ROOF = 0x7b828c;
const ROOF_DARK = 0x5d636c;
const ROOF_LIGHT = 0xa3a9b2;
const EDGE = 0x2b2f36;

/** How many variants of each kind of scenery there are (picked per feature, so a cluster is not all alike). */
export const SCENERY_VARIANTS = 3;

/** The hole: a scorched, chamfered slab of ground with a dark throat and a crust of mineral deposits round the lip. */
export function drawVent(g: Graphics, tex: number): void {
  const slab = (half: number) => {
    const k = half * 0.28;
    return [-half + k, -half, half - k, -half, half, -half + k, half, half - k, half - k, half, -half + k, half, -half, half - k, -half, -half + k];
  };
  g.poly(slab(0.62 * tex)).fill({ color: 0x1a1512, alpha: 0.28 });
  g.poly(slab(0.46 * tex)).fill({ color: 0x2a2420, alpha: 0.55 }).stroke({ width: 1, color: 0x8c8174, alpha: 0.55 });
  // Mineral crust round the lip: small pale squares, the same on every vent.
  for (let i = 0; i < 10; i++) {
    const a = i * 0.7 + 0.3;
    const r = (0.36 + 0.05 * Math.sin(i * 2.1)) * tex;
    const s = (0.05 + 0.025 * ((i * 7) % 3)) * tex;
    g.rect(Math.cos(a) * r - s / 2, Math.sin(a) * r - s / 2, s, s).fill({ color: i % 2 ? 0xd9cdb0 : 0xc4b48a, alpha: 0.8 });
  }
  g.poly(slab(0.27 * tex)).fill(0x0d0b0a).stroke({ width: 1.5, color: 0x6b6258 });
  g.poly(slab(0.15 * tex)).fill({ color: 0xffb36b, alpha: 0.35 });
}

/** One piece of neutral scenery, drawn at `tex` pixels per tile and centred on (0, 0). */
export function drawScenery(g: Graphics, kind: number, variant: number, tex: number): void {
  const edge = { width: 1.5, color: EDGE, alpha: 0.9 };
  switch (kind) {
    case FeatureKind.Shack: {
      const w = (variant === 1 ? 0.62 : 0.72) * tex, h = (variant === 2 ? 0.6 : 0.72) * tex;
      g.rect(-w / 2, -h / 2, w, h).fill(ROOF).stroke(edge);
      g.rect(-w / 2, -h / 2, w / 2, h).fill(ROOF_LIGHT); // the lit slope of a pitched roof
      g.moveTo(0, -h / 2).lineTo(0, h / 2).stroke({ width: 1.5, color: EDGE, alpha: 0.7 });
      g.rect(w * 0.12, -h * 0.4, w * 0.16, w * 0.16).fill(ROOF_DARK).stroke({ width: 1, color: EDGE, alpha: 0.8 }); // chimney
      break;
    }
    case FeatureKind.Tank: {
      const r = (variant === 0 ? 0.4 : 0.34) * tex;
      g.circle(0, 0, r).fill(ROOF_LIGHT).stroke(edge);
      g.circle(0, 0, r * 0.72).stroke({ width: 1.5, color: ROOF_DARK, alpha: 0.9 });
      g.circle(-r * 0.2, -r * 0.2, r * 0.22).fill(ROOF_DARK).stroke({ width: 1, color: EDGE, alpha: 0.8 }); // hatch
      g.moveTo(r * 0.25, r * 0.1).lineTo(r * 0.85, r * 0.55).stroke({ width: 2, color: ROOF_DARK }); // ladder / pipe
      break;
    }
    case FeatureKind.Hall: {
      const w = (variant === 1 ? 1.6 : 1.76) * tex, h = (variant === 2 ? 1.5 : 1.76) * tex;
      g.rect(-w / 2, -h / 2, w, h).fill(ROOF).stroke({ width: 2, color: EDGE, alpha: 0.9 });
      for (let i = 1; i < 4; i++) g.moveTo(-w / 2 + (w * i) / 4, -h / 2).lineTo(-w / 2 + (w * i) / 4, h / 2).stroke({ width: 1.5, color: ROOF_DARK, alpha: 0.8 });
      g.rect(-w / 2, -h / 2, w, h * 0.16).fill({ color: ROOF_LIGHT, alpha: 0.8 });
      g.rect(-w * 0.2, h / 2 - h * 0.14, w * 0.4, h * 0.14).fill(EDGE); // loading door on the south side
      g.rect(w * 0.18, -h * 0.28, w * 0.14, w * 0.14).fill(ROOF_DARK).stroke({ width: 1, color: EDGE, alpha: 0.8 });
      break;
    }
    case FeatureKind.Ruin: {
      // Broken walls round a rubble floor: each side has a gap somewhere, which moves with the variant.
      const w = 1.7 * tex, t = 0.18 * tex, h = w / 2;
      g.rect(-h, -h, w, w).fill({ color: 0x3a3f46, alpha: 0.55 });
      const walls: [number, number, number, number][] = [
        [-h, -h, w * (variant === 0 ? 0.62 : 0.8), t],
        [h - t, -h + w * 0.1, t, w * (variant === 1 ? 0.5 : 0.78)],
        [-h + w * (variant === 2 ? 0.3 : 0.2), h - t, w * 0.62, t],
        [-h, -h + w * 0.18, t, w * (variant === 2 ? 0.5 : 0.6)],
      ];
      for (const [x, y, ww, hh] of walls) g.rect(x, y, ww, hh).fill(ROOF_DARK).stroke({ width: 1.2, color: EDGE, alpha: 0.9 });
      for (let i = 0; i < 9; i++) {
        const s = (0.07 + 0.03 * ((i * 5) % 3)) * tex;
        g.rect(Math.sin(i * 2.3 + variant) * h * 0.55 - s / 2, Math.cos(i * 1.7 + variant * 2) * h * 0.55 - s / 2, s, s).fill({ color: i % 2 ? ROOF : ROOF_LIGHT, alpha: 0.9 });
      }
      break;
    }
  }
}

/**
 * The steam over one vent. (`cx`, `cy`) is the vent's centre on screen and `tile` the size of a tile in pixels;
 * `cover` is a VentCover; `now` is milliseconds and `seed` keeps neighbouring vents out of step.
 */
export function drawVentSteam(g: Graphics, cx: number, cy: number, tile: number, cover: number, now: number, seed: number, reduced: boolean): void {
  if (cover === VentCover.Tapped) {
    // Worked by a turbine: a thin, steady column from the roof and rings of energy spreading from it.
    if (reduced) {
      g.circle(cx, cy, tile * 0.5).stroke({ width: Math.max(1.5, tile * 0.05), color: ENERGY, alpha: 0.4 });
      return;
    }
    for (let i = 0; i < 2; i++) {
      const t = ((now / 1800 + i * 0.5 + seed * 0.21) % 1 + 1) % 1;
      g.circle(cx, cy, tile * (0.3 + 0.55 * t)).stroke({ width: Math.max(1, tile * 0.04), color: ENERGY, alpha: 0.45 * (1 - t) });
    }
    for (let i = 0; i < 5; i++) {
      const t = ((now / 1500 + i * 0.2 + seed * 0.37) % 1 + 1) % 1;
      g.circle(cx + Math.sin(seed + i * 2.3) * tile * 0.05 * t, cy - tile * 0.2 - t * tile * 0.9, tile * (0.07 + 0.12 * t)).fill({ color: STEAM, alpha: 0.4 * (1 - t) });
    }
    return;
  }
  if (cover === VentCover.Plugged || cover === VentCover.Site) {
    // Capped: thin wisps leak out round the edges, fewer and fainter under a site.
    if (reduced) return;
    const n = cover === VentCover.Plugged ? 4 : 2;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + seed;
      const t = ((now / 2200 + i * 0.27 + seed * 0.13) % 1 + 1) % 1;
      const r = tile * 0.55;
      g.circle(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.8 - t * tile * 0.5, tile * (0.05 + 0.1 * t)).fill({ color: STEAM, alpha: (cover === VentCover.Plugged ? 0.3 : 0.18) * (1 - t) });
    }
    return;
  }
  // Open: a plume that breathes, swelling to a burst and easing off, with a low mist round the hole.
  const breath = 0.5 + 0.5 * Math.sin(now / 1700 + seed * 1.9);
  if (reduced) {
    for (let i = 0; i < 5; i++) {
      const t = i / 5;
      g.circle(cx + Math.sin(seed + i * 2.1) * tile * 0.12, cy - tile * 0.2 - t * tile * 1.3, tile * (0.18 + 0.4 * t)).fill({ color: STEAM, alpha: 0.4 * (1 - t) });
    }
    return;
  }
  g.circle(cx, cy, tile * (0.5 + 0.08 * breath)).fill({ color: STEAM, alpha: 0.14 + 0.1 * breath });
  const puffs = 10;
  for (let i = 0; i < puffs; i++) {
    const t = ((now / 2400 + i / puffs + seed * 0.37) % 1 + 1) % 1;
    const rise = tile * (1.0 + 0.9 * breath) * t;
    const drift = Math.sin(seed * 3 + i * 1.9 + now / 2600) * tile * 0.25 * t + t * t * tile * 0.15;
    g.circle(cx + drift, cy - tile * 0.15 - rise, tile * (0.14 + 0.5 * t)).fill({ color: STEAM, alpha: (0.5 + 0.2 * breath) * (1 - t) * (1 - t * 0.3) });
  }
}
