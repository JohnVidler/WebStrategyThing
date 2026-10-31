import type { Graphics } from 'pixi.js';

/**
 * What the instant (hit-scan) weapons look like. The engine resolves these shots at once, so the effect is purely visual:
 * lasers are glowing beams with a bloom at the muzzle and a hot spot where they land, guns fire bright tracers that
 * cross the gap, flak is a string of dim puffs that ends in an air-burst (the burst itself is a `flak` blast).
 * Positions are screen pixels; `age` runs 0..1 over the shot's life.
 */
export type ShotKind = 'gun' | 'laser' | 'flak';

/** How long (ms) each kind of shot lasts on screen. */
export const SHOT_LIFE_MS: Record<ShotKind, number> = { gun: 160, laser: 260, flak: 220 };

/** The weapon kinds that are drawn as shots; anything else has its own effect (shells, missiles, tesla). */
export function shotKindOf(weapon: string | undefined): ShotKind {
  return weapon === 'laser' ? 'laser' : weapon === 'flak' ? 'flak' : 'gun';
}

/** 0..1 strength of a shot from its damage: a light gun (5) is slight, a rotary gun (20) full. */
export const shotPower = (damage: number): number => Math.max(0.2, Math.min(1, damage / 20));

const WHITE = 0xffffff;
const TRACER = 0xfff2c0;
const FLAK_PUFF = 0xd8dde6;

/** Mixes a colour towards white by `k` (0..1), so a beam's inner glow is a paler shade of its owner's colour. */
export function paler(colour: number, k: number): number {
  const r = (colour >> 16) & 255, g = (colour >> 8) & 255, b = colour & 255;
  const m = (c: number) => Math.round(c + (255 - c) * k);
  return (m(r) << 16) | (m(g) << 8) | m(b);
}

/**
 * Draws one shot from (ax, ay) to (bx, by). `unit` is pixels per tile (sizes follow the zoom), `seed` varies the flicker
 * from shot to shot, `still` turns the flicker off (Reduce motion).
 */
export function drawShot(g: Graphics, kind: ShotKind, ax: number, ay: number, bx: number, by: number, age: number, colour: number, power: number, unit: number, seed: number, still: boolean): void {
  if (age < 0 || age >= 1) return;
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len < 1) return;
  const nx = dx / len, ny = dy / len;
  const fade = 1 - age;
  if (kind === 'laser') drawLaser(g, ax, ay, bx, by, nx, ny, age, fade, colour, power, unit, seed, still);
  else if (kind === 'flak') drawFlakTrail(g, ax, ay, bx, by, len, nx, ny, age, fade, unit);
  else drawTracer(g, ax, ay, bx, by, len, nx, ny, age, fade, colour, power, unit, seed);
}

/** A beam: a wide soft halo, a coloured body, a pale inner glow and a white core, all thinning as it fades; bloom at both ends. */
function drawLaser(g: Graphics, ax: number, ay: number, bx: number, by: number, nx: number, ny: number, age: number, fade: number, colour: number, power: number, unit: number, seed: number, still: boolean): void {
  const flicker = still ? 1 : 0.88 + 0.12 * Math.sin(age * 70 + seed * 1.7);
  const w = Math.max(2, unit * 0.05) * (0.7 + 0.9 * power) * (1 - 0.5 * age) * flicker;
  const a = fade ** 1.4 * flicker;
  g.moveTo(ax, ay).lineTo(bx, by).stroke({ width: w * 6, color: colour, alpha: 0.1 * a, cap: 'round' });
  g.moveTo(ax, ay).lineTo(bx, by).stroke({ width: w * 3.2, color: colour, alpha: 0.24 * a, cap: 'round' });
  g.moveTo(ax, ay).lineTo(bx, by).stroke({ width: w * 1.7, color: paler(colour, 0.55), alpha: 0.7 * a, cap: 'round' });
  g.moveTo(ax, ay).lineTo(bx, by).stroke({ width: w * 0.7, color: WHITE, alpha: 0.95 * a, cap: 'round' });
  // Muzzle bloom, and a hot spot at the target with a ring that spreads from it.
  g.circle(ax, ay, w * 3).fill({ color: colour, alpha: 0.35 * a });
  g.circle(ax, ay, w * 1.4).fill({ color: WHITE, alpha: 0.9 * a });
  g.circle(bx, by, w * (3.5 + 2 * age)).fill({ color: colour, alpha: 0.3 * a });
  g.circle(bx, by, w * 1.7).fill({ color: WHITE, alpha: 0.9 * a });
  g.circle(bx, by, w * (2 + 7 * age)).stroke({ width: 1.2, color: paler(colour, 0.5), alpha: 0.7 * fade ** 2 });
  // Beads of light run down the beam, a little ahead of the fade.
  if (!still) {
    for (let i = 0; i < 3; i++) {
      const u = (age * 2.4 + i / 3 + (seed % 7) / 7) % 1;
      g.circle(ax + (bx - ax) * u, ay + (by - ay) * u, w * 0.9).fill({ color: WHITE, alpha: 0.7 * a });
    }
  }
}

/** Tracers: a bright streak with a hot head crosses the gap in the first half of the shot; a heavy gun sends two. */
function drawTracer(g: Graphics, ax: number, ay: number, bx: number, by: number, len: number, nx: number, ny: number, age: number, fade: number, colour: number, power: number, unit: number, seed: number): void {
  const w = Math.max(1.5, unit * 0.04) * (0.8 + 0.6 * power);
  const streak = Math.min(len, unit * (0.5 + 0.9 * power));
  const count = power > 0.7 ? 2 : 1;
  // A faint trail in the owner's colour along the whole line, so the direction of fire reads.
  g.moveTo(ax, ay).lineTo(bx, by).stroke({ width: Math.max(1, w * 0.6), color: colour, alpha: 0.18 * fade });
  for (let k = 0; k < count; k++) {
    const u = Math.min(1, Math.max(0, (age - k * 0.1) / 0.55));
    if (u <= 0 || (u >= 1 && age > 0.75)) continue;
    const head = u * len;
    const tail = Math.max(0, head - streak);
    // The second tracer of a rotary gun runs a hair to one side.
    const off = k === 0 ? 0 : (seed % 2 === 0 ? 1 : -1) * w * 1.6;
    const ox = -ny * off, oy = nx * off;
    const hx = ax + nx * head + ox, hy = ay + ny * head + oy;
    const tx = ax + nx * tail + ox, ty = ay + ny * tail + oy;
    const a = u >= 1 ? fade * 2 : 1;
    g.moveTo(tx, ty).lineTo(hx, hy).stroke({ width: w * 3, color: colour, alpha: 0.28 * a, cap: 'round' });
    g.moveTo(tx, ty).lineTo(hx, hy).stroke({ width: w, color: TRACER, alpha: 0.95 * a, cap: 'round' });
    g.circle(hx, hy, w * 1.1).fill({ color: WHITE, alpha: 0.9 * a });
  }
  // Muzzle flash: a short hot puff and three spikes along the barrel in the first third of the shot.
  const flash = Math.max(0, 1 - age / 0.33);
  if (flash > 0) {
    const r = Math.max(3, unit * 0.14) * (0.8 + 0.5 * power);
    g.circle(ax, ay, r * flash).fill({ color: TRACER, alpha: 0.7 * flash });
    for (const s of [-0.35, 0, 0.35]) {
      const c = Math.cos(s), sn = Math.sin(s);
      g.moveTo(ax, ay).lineTo(ax + (nx * c - ny * sn) * r * 2.4 * flash, ay + (nx * sn + ny * c) * r * 2.4 * flash).stroke({ width: Math.max(1.2, w * 0.8), color: WHITE, alpha: 0.8 * flash, cap: 'round' });
    }
  }
  // Impact flash where the first tracer lands.
  const hit = Math.max(0, 1 - Math.abs(age - 0.55) / 0.2);
  if (hit > 0) g.circle(bx, by, Math.max(2.5, unit * 0.1) * (0.8 + 0.5 * power) * (0.6 + 0.6 * hit)).fill({ color: TRACER, alpha: 0.65 * hit });
}

/** Flak: dim puffs strung along the line (the shell is hard to see), thinning as they go; the air-burst is a separate blast. */
function drawFlakTrail(g: Graphics, ax: number, ay: number, bx: number, by: number, len: number, nx: number, ny: number, age: number, fade: number, unit: number): void {
  const head = Math.min(1, age / 0.6) * len;
  const puffs = Math.max(3, Math.min(12, Math.round(len / (unit * 0.6))));
  for (let i = 0; i < puffs; i++) {
    const d = (i / puffs) * head;
    const life = Math.max(0, 1 - (age - (d / len) * 0.6) / 0.4);
    if (life <= 0) continue;
    g.circle(ax + nx * d, ay + ny * d, Math.max(1.5, unit * 0.06) * (0.6 + 0.8 * (1 - life))).fill({ color: FLAK_PUFF, alpha: 0.4 * life * fade });
  }
  g.circle(ax + nx * head, ay + ny * head, Math.max(1.5, unit * 0.05)).fill({ color: WHITE, alpha: 0.9 * fade });
}
