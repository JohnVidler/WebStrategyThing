/**
 * Art for debris, the wreck of a unit that broke down: a scorched smudge strewn with mechanical scrap (gears, bent
 * plates, a tyre, pipe, bolts, loose wire). Bigger hulls leave a wider spread; a flyer leaves rotor blades and
 * thin plating instead of a tyre. As harvesters take it the pieces thin out from the outside in, until only a
 * smudge and a few scraps are left. Drawn once per look, stage and variant and shared, like the crystal fields.
 */
import type { Graphics } from 'pixi.js';

const METAL = 0x8b95a5;
const METAL_DARK = 0x4d5560;
const RUST = 0x8a5a3c;
const SOOT = 0x15171b;
const HAZARD = 0xd9a62e;
const WIRE = 0xc27a3a;

/** How many stages debris is drawn in: 0 nearly used up, up to STAGES - 1 untouched. */
export const DEBRIS_STAGES = 4;
export const DEBRIS_VARIANTS = 3;

/** Stage for `amount` left of `maximum`: 0 .. DEBRIS_STAGES - 1, or -1 for nothing left. */
export function debrisStage(amount: number, maximum: number): number {
  if (amount <= 0) return -1;
  return Math.min(DEBRIS_STAGES - 1, Math.floor((amount / Math.max(1, maximum)) * DEBRIS_STAGES));
}

/** Small deterministic generator, so the same wreck always looks the same. */
function noise(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x9e3779b9) >>> 0;
    return (s >>> 8) / 0x1000000;
  };
}

/** `look` is the Debris component's: hull tier 0 to 5, plus 8 if the unit flew. `stage` is from `debrisStage`. */
export function drawDebris(g: Graphics, look: number, stage: number, variant: number, tex: number): void {
  const tier = look & 7;
  const flew = (look & 8) !== 0;
  const spread = (0.34 + 0.07 * tier) * tex;
  const rnd = noise(look * 31 + variant * 7 + 1);
  const slab = (half: number): number[] => {
    const k = half * 0.3;
    return [-half + k, -half, half - k, -half, half, -half + k, half, half - k, half - k, half, -half + k, half, -half, half - k, -half, -half + k];
  };

  // Scorch mark: a dark chamfered smudge with a lighter ring of burnt ground.
  g.poly(slab(spread * 1.55)).fill({ color: SOOT, alpha: 0.12 + 0.05 * Math.max(0, stage) });
  g.poly(slab(spread * 1.05)).fill({ color: SOOT, alpha: 0.2 + 0.06 * Math.max(0, stage) });
  if (stage < 0) return;

  const pieces = 3 + stage * 2 + tier; // fewer as it is used up, more for a big hull
  const at = (i: number): [number, number] => {
    const a = rnd() * Math.PI * 2;
    // Pieces thin out from the outside in: later ones sit closer to the middle.
    const r = spread * (0.2 + 0.8 * rnd()) * (0.55 + 0.45 * ((pieces - i) / pieces));
    return [Math.cos(a) * r, Math.sin(a) * r];
  };
  for (let i = 0; i < pieces; i++) {
    const [x, y] = at(i);
    const size = (0.08 + 0.1 * rnd() + 0.012 * tier) * tex;
    const turn = rnd() * Math.PI;
    const kind = (i + variant) % (flew ? 6 : 5);
    switch (kind) {
      case 0: {
        // A gear: toothed ring with a hub.
        const r = size * 0.9;
        const teeth = 8;
        const pts: number[] = [];
        for (let t = 0; t < teeth * 2; t++) {
          const a = turn + (t * Math.PI) / teeth;
          const rr = t % 2 ? r * 0.78 : r;
          pts.push(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
        }
        g.poly(pts).fill(METAL).stroke({ width: 1, color: METAL_DARK });
        g.circle(x, y, r * 0.32).fill(SOOT);
        break;
      }
      case 1: {
        // A bent plate: a skewed slab, one edge rusty.
        const w = size * 1.5, h = size * 0.8;
        const c = Math.cos(turn), s = Math.sin(turn);
        const p = (px: number, py: number): [number, number] => [x + px * c - py * s, y + px * s + py * c];
        const q = [p(-w, -h), p(w, -h * 0.6), p(w * 0.8, h), p(-w * 0.9, h * 0.7)];
        g.poly(q.flat()).fill(METAL).stroke({ width: 1, color: METAL_DARK });
        g.moveTo(q[2][0], q[2][1]).lineTo(q[3][0], q[3][1]).stroke({ width: 2, color: RUST });
        break;
      }
      case 2: {
        // A tyre (or a track link, for the bigger hulls): a dark ring with a hub.
        const r = size * 0.85;
        if (tier >= 3) {
          g.rect(x - r, y - r * 0.5, r * 2, r).fill(METAL_DARK).stroke({ width: 1, color: METAL });
          for (let t = -1; t <= 1; t++) g.moveTo(x + t * r * 0.6, y - r * 0.5).lineTo(x + t * r * 0.6, y + r * 0.5).stroke({ width: 1, color: SOOT });
        } else {
          g.circle(x, y, r).fill(SOOT).stroke({ width: 1.5, color: METAL_DARK });
          g.circle(x, y, r * 0.4).fill(METAL);
        }
        break;
      }
      case 3: {
        // A length of pipe, with a hazard-yellow band.
        const l = size * 1.6;
        const c = Math.cos(turn), s = Math.sin(turn);
        g.moveTo(x - c * l, y - s * l).lineTo(x + c * l, y + s * l).stroke({ width: Math.max(2, size * 0.55), color: METAL });
        g.moveTo(x - c * l * 0.3, y - s * l * 0.3).lineTo(x + c * l * 0.1, y + s * l * 0.1).stroke({ width: Math.max(2, size * 0.55), color: HAZARD });
        break;
      }
      case 4: {
        // Bolts, a circuit board chip and a loose wire.
        g.rect(x - size * 0.5, y - size * 0.35, size, size * 0.7).fill(METAL_DARK).stroke({ width: 1, color: WIRE, alpha: 0.9 });
        g.circle(x + size * 0.9, y + size * 0.3, size * 0.18).fill(METAL);
        g.moveTo(x, y).quadraticCurveTo(x + Math.cos(turn) * size * 1.4, y + Math.sin(turn) * size * 1.4, x + Math.cos(turn + 1.2) * size * 2, y + Math.sin(turn + 1.2) * size * 2).stroke({ width: 1, color: WIRE });
        break;
      }
      default: {
        // A flyer's rotor blade and thin plating.
        const l = size * 2.2;
        const c = Math.cos(turn), s = Math.sin(turn);
        g.poly([x - c * l, y - s * l, x - s * size * 0.3, y + c * size * 0.3, x + c * l, y + s * l, x + s * size * 0.3, y - c * size * 0.3]).fill(METAL).stroke({ width: 1, color: METAL_DARK });
        break;
      }
    }
  }
  // Always some small scrap: scattered bolts and chips.
  for (let i = 0; i < 2 + stage * 2; i++) {
    const [x, y] = at(i);
    const s = (0.025 + 0.02 * rnd()) * tex;
    g.rect(x - s / 2, y - s / 2, s, s).fill({ color: i % 3 === 0 ? RUST : METAL, alpha: 0.95 });
  }
}
