/**
 * What a factory looks like while it builds a unit, so everyone who can see it knows it is in production:
 * a pulsing outline in the owner's colour, a scan line sweeping up and down the building, a ring of
 * rotating tick marks, and sparks flying out of the exit edge where the unit will appear. With Reduce motion
 * on, only a steady outline is drawn.
 */
import type { Graphics } from 'pixi.js';

const AMBER = 0xf5c542;

/**
 * Draws one factory. `cx`/`cy` is the centre and `size` the footprint in pixels; `progress` is 0-100, `now` is in
 * milliseconds and `seed` makes neighbouring factories run out of step.
 */
export function drawFactoryFx(g: Graphics, cx: number, cy: number, size: number, progress: number, now: number, colour: number, seed: number, reduced: boolean): void {
  const half = size / 2;
  const pulse = 0.5 + 0.5 * Math.sin(now / 260 + seed);
  g.rect(cx - half, cy - half, size, size).stroke({ width: Math.max(1.5, size * 0.04), color: colour, alpha: reduced ? 0.6 : 0.35 + 0.35 * pulse });
  if (reduced) return;

  // Scan line: sweeps the footprint top to bottom and back, brighter as the unit nears completion.
  const sweep = 0.5 + 0.5 * Math.sin(now / 520 + seed * 1.7);
  const y = cy - half + sweep * size;
  g.rect(cx - half, y - 1, size, 2).fill({ color: AMBER, alpha: 0.55 + progress / 300 });
  g.rect(cx - half, y - size * 0.06, size, size * 0.12).fill({ color: AMBER, alpha: 0.12 });

  // Rotating tick marks, spinning faster as the unit nears completion.
  const r = half * 0.62;
  const spin = (now / (900 - progress * 4)) + seed;
  for (let i = 0; i < 8; i++) {
    const a = spin + (i * Math.PI) / 4;
    const inner = r * 0.82;
    g.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner)
      .lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r)
      .stroke({ width: Math.max(1.5, size * 0.04), color: AMBER, alpha: 0.25 + 0.5 * (i % 2 === 0 ? pulse : 1 - pulse) });
  }

  // Sparks out of the bottom edge, where finished units appear.
  for (let i = 0; i < 5; i++) {
    const t = ((now / 700 + i * 0.2 + seed * 0.13) % 1 + 1) % 1;
    const sx = cx + (Math.sin(seed * 3 + i * 2.3) * 0.8) * half;
    const sy = cy + half + t * size * 0.45;
    g.circle(sx + Math.sin(i * 5.1) * t * half * 0.4, sy, Math.max(1, size * 0.03)).fill({ color: AMBER, alpha: 0.8 * (1 - t) });
  }
}
