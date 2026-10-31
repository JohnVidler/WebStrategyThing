import { Rng } from '../util/rng';
import { TILE } from './rules';
import type { ClearArea } from './terrain';
import type { Simulation } from './simulation';

/**
 * Fixed features of the map that belong to nobody. They are not units: they cannot be selected, attacked or
 * destroyed, and cost the tick nothing. Steam vents are open ground that a building with a steam turbine
 * can sit on; the rest is scenery: small buildings that block movement and sight and do nothing else.
 */
export const FeatureKind = {
  /** A steam vent: one tile, never blocks anything. A building over it with a steam turbine makes power. */
  Vent: 1,
  Shack: 2,
  Tank: 3,
  Hall: 4,
  Ruin: 5,
} as const;

export interface FeatureDef {
  readonly name: string;
  /** Footprint, tiles per side. */
  readonly size: number;
  /** Blocks movement and sight, like a building. */
  readonly solid: boolean;
}

export const FEATURES: Readonly<Record<number, FeatureDef>> = {
  [FeatureKind.Vent]: { name: 'Steam vent', size: 1, solid: false },
  [FeatureKind.Shack]: { name: 'Shack', size: 1, solid: true },
  [FeatureKind.Tank]: { name: 'Storage tank', size: 1, solid: true },
  [FeatureKind.Hall]: { name: 'Hall', size: 2, solid: true },
  [FeatureKind.Ruin]: { name: 'Ruin', size: 2, solid: true },
};

/** Top-left tile of a feature from its position (the centre of its footprint, as for buildings). */
export const featureTile = (kind: number, px: number, py: number): { x: number; y: number; size: number } => {
  const size = FEATURES[kind]?.size ?? 1;
  return { x: Math.round(px / TILE - size / 2), y: Math.round(py / TILE - size / 2), size };
};

/** Vents per quadrant group (a group is four mirrored vents) for every this many tiles of map. */
const TILES_PER_VENT_GROUP = 2800;
/** One scenery cluster for every this many tiles of map. */
const TILES_PER_CLUSTER = 700;
/** Scenery clusters keep this many tiles clear around them (so a cluster never closes off a lane), and apart. */
const CLUSTER_MARGIN = 4;
const CLUSTER_SPACING = 11;
/** Nothing is placed this close (tiles) to a resource field, a base area, or a vent. */
const FIELD_GAP = 3;

/**
 * Scatters steam vents and scenery clusters over a freshly generated map. It draws from its own `Rng`, so
 * it never changes the numbers the rest of map setup draws, and it keeps clear of the base areas (`clear`)
 * and resource fields. Vents come in mirrored groups of four (one per quadrant) so no start gets more
 * than another. Call it after the fields are placed and before players are added.
 */
export function placeFeatures(sim: Simulation, seed: number, clear: readonly ClearArea[]): void {
  const rng = new Rng(seed ^ 0x7e57fea7);
  const { width, height } = sim.config;
  const t = sim.terrain;
  const fields: { x: number; y: number }[] = [];
  for (const r of sim.resource.dense) fields.push({ x: sim.pos.f.x[r] / TILE, y: sim.pos.f.y[r] / TILE });
  const placed: { x: number; y: number }[] = [];

  const open = (x: number, y: number) => t.inBounds(x, y) && t.walkable(x, y) && t.heightAt(x, y) === 0;
  /** Every tile within `r` of (x, y) is open ground. */
  const openSquare = (x: number, y: number, r: number) => {
    for (let j = y - r; j <= y + r; j++) for (let i = x - r; i <= x + r; i++) if (!open(i, j)) return false;
    return true;
  };
  const awayFrom = (x: number, y: number, gap: number) =>
    clear.every((a) => (x - a.x) ** 2 + (y - a.y) ** 2 > (a.r + gap) ** 2) &&
    fields.every((f) => (x - f.x) ** 2 + (y - f.y) ** 2 > (gap + 1) ** 2) &&
    placed.every((p) => (x - p.x) ** 2 + (y - p.y) ** 2 > gap * gap);

  // Vents: one random spot in the top-left quadrant, mirrored into the other three. A group is dropped unless all four fit.
  const groups = Math.max(1, Math.min(8, Math.round((width * height) / TILES_PER_VENT_GROUP)));
  for (let g = 0; g < groups; g++) {
    for (let attempt = 0; attempt < 40; attempt++) {
      const x = 3 + rng.int(Math.floor(width / 2) - 5);
      const y = 3 + rng.int(Math.floor(height / 2) - 5);
      const spots = [
        [x, y],
        [width - 1 - x, y],
        [x, height - 1 - y],
        [width - 1 - x, height - 1 - y],
      ];
      if (spots.some(([sx, sy]) => !openSquare(sx, sy, 1) || !awayFrom(sx, sy, FIELD_GAP))) continue;
      // A group's spots must not crowd each other either (a tiny map folds them close together).
      if (spots.some(([ax, ay], i) => spots.some(([bx, by], j) => i < j && Math.max(Math.abs(ax - bx), Math.abs(ay - by)) < 4))) continue;
      for (const [sx, sy] of spots) {
        sim.spawnFeature(FeatureKind.Vent, sx, sy);
        placed.push({ x: sx, y: sy });
      }
      break;
    }
  }

  // Scenery: small clusters of buildings, each with open ground all round so it can be walked past.
  const clusters = Math.max(1, Math.round((width * height) / TILES_PER_CLUSTER));
  const centres: { x: number; y: number }[] = [];
  for (let c = 0; c < clusters; c++) {
    for (let attempt = 0; attempt < 80; attempt++) {
      // Tight country (ridges): after many misses, settle for a smaller cluster in a smaller clearing, still 2 tiles of open ground round it.
      const half = attempt < 50 ? 2 : 1;
      const margin = half + 2;
      const cx = CLUSTER_MARGIN + 1 + rng.int(width - 2 * CLUSTER_MARGIN - 2);
      const cy = CLUSTER_MARGIN + 1 + rng.int(height - 2 * CLUSTER_MARGIN - 2);
      if (!openSquare(cx, cy, margin) || !awayFrom(cx, cy, margin + 1)) continue;
      if (centres.some((o) => Math.max(Math.abs(o.x - cx), Math.abs(o.y - cy)) < CLUSTER_SPACING)) continue;
      centres.push({ x: cx, y: cy });
      const wanted = half === 2 ? 3 + rng.int(4) : 2 + rng.int(2);
      for (let k = 0, tries = 0; k < wanted && tries < 20; tries++) {
        const roll = rng.int(100);
        const kind = roll < 35 ? FeatureKind.Shack : roll < 60 ? FeatureKind.Tank : roll < 80 ? FeatureKind.Hall : FeatureKind.Ruin;
        const size = FEATURES[kind].size;
        const tx = cx - half + rng.int(2 * half + 1 - size + 1);
        const ty = cy - half + rng.int(2 * half + 1 - size + 1);
        if (!t.footprintFree(tx, ty, size)) continue;
        sim.spawnFeature(kind, tx, ty);
        k++;
      }
      break;
    }
  }
}
