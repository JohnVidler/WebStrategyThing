import { PARTS, type PartDef } from '@wst/engine';
import type { Graphics } from 'pixi.js';

/**
 * Procedural class art. A class's silhouette is derived from its module list, so
 * adding or removing a module visibly changes the sprite, while the frame/chassis
 * still fixes the overall size (a unit body's radius, a building's footprint).
 * Units face "up"; sprites are never rotated.
 */

const DARK = 0x0e1116;
const STEEL = 0x8b95a5;
const ENERGY = 0xf5c542;
const MATTER = 0x7ee0b5;
const SOLAR = 0x2b5fa8;
const SOLAR_SEAM = 0x0f2347;
const LASER = 0x5ee6ff;
const TESLA = 0xa98bff;
const WARN = 0xff8a5c;
/** Gun metal: pale, and outlined dark, so barrels stand out from any hull colour. */
const GUN = 0xe6ecf5;
/** Hazard stripes: yellow marks a unit that builds, red one that repairs. */
const BUILD_STRIPE = ENERGY;
const REPAIR_STRIPE = 0xff5d73;

/** What a design is made of, reduced to the things the art cares about. */
export interface Look {
  readonly structure: boolean;
  /** Chassis size tier (units: 0 micro to 5 colossus) or footprint in tiles (buildings). */
  readonly size: number;
  /** Units: hull radius in tiles (from the chassis). */
  readonly radius: number;
  readonly flying: boolean;
  /** Has a radar module: a dish spins on top (animated by the renderer; the static art leaves it out). */
  readonly radar: boolean;
  /** A vehicle chassis twice as long as it is wide. */
  readonly long: boolean;
  /** Building layout inside its footprint box ('X' = covered), null = a full square. */
  readonly shape: readonly string[] | null;
  readonly motor: 'none' | 'small' | 'large' | 'huge' | 'rotor' | 'legs';
  /** Legs, by the strongest pair fitted. */
  readonly legs: 'none' | 'light' | 'heavy' | 'colossus';
  readonly weapon: 'none' | 'gun' | 'cannon' | 'laser' | 'tesla' | 'missile' | 'flak';
  /** Mass of the weapon module: heavier guns get bigger turret housings. */
  readonly weaponMass: number;
  /** How many weapon modules: a building shows one turret for each it has room for. */
  readonly weapons: number;
  readonly armour: number;
  /** Every module fitted, armour included (the frame or chassis is not counted). */
  readonly modules: number;
  readonly cargo: number;
  readonly builders: number;
  readonly repairers: number;
  readonly sensor: 'none' | 'short' | 'long';
  readonly batteries: number;
  readonly cpu: 'none' | 'basic' | 'fast' | 'quantum';
  readonly factories: number;
  readonly silos: number;
  readonly chargers: number;
  readonly solar: number;
  readonly wind: number;
  readonly antenna: 'none' | 'small' | 'medium' | 'large';
  /** The hull shape follows the design's main job. */
  readonly role: 'combat' | 'worker' | 'scout' | 'industry' | 'power' | 'plain';
}

export function lookOf(parts: readonly string[]): Look {
  const defs = parts.map((id) => PARTS[id]).filter((d): d is PartDef => d !== undefined);
  const frame = defs.find((d) => d.slot === 'chassis');
  const mods = defs.filter((d) => d.slot !== 'chassis');
  const count = (slot: string) => mods.filter((d) => d.slot === slot).length;
  const biggest = (ids: readonly string[]) => ids.filter((id) => parts.includes(id)).pop();

  const rotor = mods.some((d) => d.flight);
  const legs = (biggest(['legs.light', 'legs.heavy', 'legs.colossus'])?.slice(5) ?? 'none') as Look['legs'];
  const motor = rotor ? 'rotor' : legs !== 'none' ? 'legs' : parts.includes('motor.huge') ? 'huge' : parts.includes('motor.large') ? 'large' : count('motor') > 0 ? 'small' : 'none';
  const weaponDef = mods.find((d) => d.weapon);
  const weapon = weaponDef ? (weaponDef.weapon!.kind ?? 'gun') : 'none';
  const sensor = parts.includes('sensor.long') ? 'long' : parts.includes('sensor.short') ? 'short' : 'none';
  const cpu = (biggest(['cpu.basic', 'cpu.fast', 'cpu.quantum'])?.slice(4) ?? 'none') as Look['cpu'];
  const antenna = (biggest(['antenna.small', 'antenna.medium', 'antenna.large'])?.slice(8) ?? 'none') as Look['antenna'];
  const structure = frame?.structure === true;
  const factories = count('factory');
  const solar = mods.filter((d) => d.generator === 'solar').length;
  const wind = mods.filter((d) => d.generator === 'wind').length;

  let role: Look['role'] = 'plain';
  if (weapon !== 'none') role = 'combat';
  else if (factories > 0 || count('builder') > 0) role = structure ? 'industry' : 'worker';
  else if (count('cargo') > 0) role = 'worker';
  else if (solar + wind > 0 || count('charger') > 0 || count('battery') >= 2) role = structure ? 'power' : 'plain';
  else if (sensor !== 'none') role = 'scout';

  return {
    structure,
    size: structure ? (frame?.footprint ?? 1) : (frame?.size ?? 0),
    radius: structure ? 0 : (frame?.radius ?? 0.3),
    flying: rotor,
    radar: count('radar') > 0,
    long: frame?.long === true,
    shape: structure ? (frame?.shape ?? null) : null,
    motor,
    legs,
    weapon,
    weaponMass: weaponDef?.mass ?? 0,
    weapons: mods.filter((d) => d.weapon).length,
    armour: count('armor'),
    modules: mods.length,
    cargo: count('cargo'),
    builders: count('builder'),
    repairers: count('repair'),
    sensor,
    batteries: count('battery'),
    cpu,
    factories,
    silos: count('depot'),
    chargers: count('charger'),
    solar,
    wind,
    antenna,
    role,
  };
}

/** Lighten or darken a 0xRRGGBB colour. */
function shade(colour: number, k: number): number {
  const ch = (shift: number) => {
    const v = (colour >> shift) & 0xff;
    return Math.max(0, Math.min(255, Math.round(k >= 0 ? v + (255 - v) * k : v * (1 + k))));
  };
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** Draw a class at `tex` pixels per tile, centred on the origin. */
/** `gait` is a walking unit's leg phase in radians; leave it out for a standing pose. */
export function drawLook(g: Graphics, look: Look, colour: number, tex: number, staticDish = false, gait?: number): void {
  // In the game the dish, the turret and the wind rotor are sprites of their own (they move); a static picture draws them in.
  if (look.structure) drawBuilding(g, look, colour, tex, !staticDish);
  else drawUnit(g, look, colour, tex, gait, !staticDish);
  if (staticDish && look.radar) {
    const a = dishAnchor(look, tex);
    g.translateTransform(a.x, a.y);
    drawDish(g, a.radius);
    g.resetTransform();
  }
}

/** Where a radar dish sits on a class (texture pixels from its centre) and how big it is. */
export function dishAnchor(look: Look, tex: number): { x: number; y: number; radius: number } {
  if (!look.structure) {
    const r = unitRadius(look, tex);
    return { x: 0, y: look.long ? r * 0.55 : r * 0.2, radius: r * 0.62 };
  }
  // On the covered tile nearest the middle (the middle itself may be a gap in a shaped building).
  let cx = 0, cy = 0;
  if (look.shape) {
    const n = look.shape.length;
    let best = Infinity;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const d = (i - (n - 1) / 2) ** 2 + (j - (n - 1) / 2) ** 2;
        if (look.shape[j][i] === 'X' && d < best) {
          best = d;
          cx = (i - (n - 1) / 2) * tex;
          cy = (j - (n - 1) / 2) * tex;
        }
      }
    }
  }
  return { x: cx, y: cy, radius: Math.min(tex * 0.45, (look.size * tex) / 2 - 3) };
}

/** A radar dish seen from above, centred on the origin: draw it rotated for the spin. */
export function drawDish(g: Graphics, r: number): void {
  g.circle(0, 0, r * 1.05).fill({ color: DARK, alpha: 0.55 });
  // The reflector: a thick curved rim on one side, with the feed horn out in front of it.
  g.arc(-r * 0.15, 0, r * 0.85, -1.05, 1.05).stroke({ width: Math.max(2, r * 0.22), color: 0xdfe5ee, cap: 'round' });
  g.moveTo(-r * 0.15, 0).lineTo(r * 0.55, 0).stroke({ width: 1.5, color: STEEL });
  g.circle(r * 0.55, 0, Math.max(1.5, r * 0.12)).fill(WARN);
  g.circle(0, 0, Math.max(2, r * 0.2)).fill(LASER).stroke({ width: 1, color: DARK });
}

/** Unit body radius in texture pixels: the only thing the chassis decides. */
export function unitRadius(look: Pick<Look, 'radius'>, tex: number): number {
  return look.radius * tex;
}

/** Leg pairs by chassis tier (micro .. colossus): six legs or more from medium up. */
const LEG_PAIRS = [2, 2, 3, 4, 5, 6];
/** Frames in one gait cycle; the renderer picks one by how far the unit has walked. */
export const GAIT_FRAMES = 8;

/** Legs on a look, in legs (not pairs). */
export function legCount(l: Pick<Look, 'size'>): number {
  return LEG_PAIRS[Math.max(0, Math.min(5, l.size))] * 2;
}

/** Tiles a unit walks in one gait cycle: bigger legs take longer strides. */
export function gaitLength(l: Pick<Look, 'radius'>): number {
  return Math.max(0.25, l.radius * 1.6);
}

/**
 * Walking legs seen from above: jointed, splayed out from the hull. `gait` is the cycle phase in
 * radians (undefined = standing). Neighbouring legs, and the two sides, swing in opposite phase, so
 * half the feet are always planted; a swinging foot lifts, pulling in towards the hull.
 */
function drawLegs(g: Graphics, l: Look, r: number, len: number, colour: number, gait?: number): void {
  const pairs = LEG_PAIRS[Math.max(0, Math.min(5, l.size))];
  const thick = (l.legs === 'light' ? Math.max(1.5, r * 0.09) : Math.max(2, r * 0.14)) * Math.min(1, Math.sqrt(3 / pairs) * 1.1);
  const amp = r * 0.4;
  for (let i = 0; i < pairs; i++) {
    const t = (i / (pairs - 1)) * 2 - 1; // -1 front .. 1 rear
    const y = t * r * len * 0.78;
    // The front legs reach forward, the rear legs back, the middle ones straight out.
    const reach = t * r * 0.35;
    for (const sx of [-1, 1]) {
      const phase = gait === undefined ? 0 : gait + ((i + (sx > 0 ? 1 : 0)) & 1 ? Math.PI : 0);
      const swing = gait === undefined ? 0 : -Math.sin(phase) * amp;
      const lift = gait === undefined ? 0 : Math.max(0, Math.cos(phase));
      const hipX = sx * r * 0.5;
      const kneeX = sx * r * (1.25 + 0.22 * lift);
      const kneeY = y + reach * 0.5 + swing * 0.5;
      const footX = sx * r * (1.4 - 0.14 * lift);
      const footY = y + reach + swing;
      g.moveTo(hipX, y).lineTo(kneeX, kneeY).lineTo(footX, footY).stroke({ width: thick, color: DARK, cap: 'round', join: 'round' });
      g.moveTo(hipX, y).lineTo(kneeX, kneeY).lineTo(footX, footY).stroke({ width: Math.max(1, thick * 0.45), color: STEEL, cap: 'round', join: 'round' });
      g.circle(kneeX, kneeY, thick * 0.6).fill(shade(colour, -0.35));
      g.circle(footX, footY, thick * (0.7 + 0.25 * lift)).fill(STEEL);
    }
  }
}

// --- units -------------------------------------------------------------------------

/**
 * Hull silhouettes come from two things the player picks: the drive (motor) and the chassis tier.
 * The drive gives the basic body, as a half-width profile along the length (front to rear, in body
 * units); the tier then reshapes that profile, so a tier is never just a bigger copy of the one
 * below it:
 *   micro      rounded off into a bean            light     tapered, narrow nose
 *   medium     the plain body                     heavy     a wide belt amidships with narrower ends
 *   superheavy a long prow, flared sponsons, a narrow stern     colossus  corner bastions round a narrow waist
 * What a unit carries (gun, cargo bay, build arm, sensors) is drawn on top of the hull, not in it.
 */
type Profile = readonly (readonly [y: number, w: number])[];

const DRIVE_PROFILE: Record<Look['motor'], Profile> = {
  // Immobile pod: an eight-sided cell.
  none: [[-1, 0.45], [-0.7, 0.8], [-0.3, 1], [0.3, 1], [0.7, 0.8], [1, 0.45]],
  // Wheels (small and turbo motors): a sleek wedge, pointed at the front.
  small: [[-1.05, 0.05], [-0.8, 0.4], [-0.3, 0.85], [0.4, 0.9], [0.8, 0.75], [0.95, 0.5]],
  // Large motor, on tracks: a blunt, boxy body.
  large: [[-0.95, 0.4], [-0.55, 0.95], [0.95, 0.95]],
  // Huge tracks: a blunt full-width dozer front, tapering to the stern.
  huge: [[-0.9, 1], [0.1, 1], [0.95, 0.6]],
  // Legs: head, thorax and abdomen, pinched in between, so the legs show.
  legs: [[-1, 0.3], [-0.65, 0.6], [-0.2, 0.45], [0.2, 0.8], [0.8, 0.75], [1, 0.35]],
  rotor: [],
};

interface TierShape {
  /** 0..1: how far to round the profile off into an ellipse. */
  round: number;
  /** Width multiplier along the length. */
  scale(y: number): number;
  /** Lengths where `scale` steps: the outline gets a square step there. */
  steps: readonly number[];
}

const TIER_SHAPE: readonly TierShape[] = [
  { round: 0.6, scale: () => 1, steps: [] },
  { round: 0, scale: (y) => 0.72 + 0.28 * ((y + 1) / 2), steps: [] },
  { round: 0, scale: () => 1, steps: [] },
  { round: 0, scale: (y) => (y >= -0.45 && y <= 0.55 ? 1 : 0.85), steps: [-0.45, 0.55] },
  { round: 0, scale: (y) => (y < -0.55 ? 0.62 : y < 0.05 ? 0.88 : y < 0.75 ? 1 : 0.7), steps: [-0.55, 0.05, 0.75] },
  { round: 0, scale: (y) => (Math.abs(y) > 0.5 ? 1 : 0.78), steps: [-0.5, 0.5] },
];

function profileWidth(p: Profile, y: number): number {
  if (y <= p[0][0]) return p[0][1];
  for (let i = 1; i < p.length; i++) {
    if (y <= p[i][0]) {
      const [y0, w0] = p[i - 1], [y1, w1] = p[i];
      return w0 + ((w1 - w0) * (y - y0)) / (y1 - y0);
    }
  }
  return p[p.length - 1][1];
}

/** A quadcopter-style cross; the tier thickens the arms and fills the inside corners. */
const ROTOR_ARMS: readonly { a: number; c: number; reach: number }[] = [
  { a: 0.4, c: 0.3, reach: 0.85 },
  { a: 0.28, c: 0, reach: 1 },
  { a: 0.3, c: 0.08, reach: 1 },
  { a: 0.38, c: 0.2, reach: 1 },
  { a: 0.45, c: 0.35, reach: 1 },
  { a: 0.5, c: 0.45, reach: 1 },
];

function rotorOutline(tier: number): number[] {
  const { a, c, reach: e } = ROTOR_ARMS[tier];
  // One quadrant: the up arm's tip and side, the filled corner. Rotated a quarter turn at a time, the next
  // quadrant's first two points are the right arm's tip.
  const q: [number, number][] = [[-a, -e], [a, -e], [a, -a - c], [a + c, -a]];
  const rot = (x: number, y: number, k: number): [number, number] => (k === 0 ? [x, y] : k === 1 ? [-y, x] : k === 2 ? [-x, -y] : [y, -x]);
  const pts: number[] = [];
  for (let k = 0; k < 4; k++) for (const [x, y] of q) pts.push(...rot(x, y, k));
  return dedupe(pts);
}

function dedupe(pts: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < pts.length; i += 2) {
    const n = out.length;
    if (n >= 2 && Math.abs(out[n - 2] - pts[i]) < 1e-6 && Math.abs(out[n - 1] - pts[i + 1]) < 1e-6) continue;
    out.push(pts[i], pts[i + 1]);
  }
  return out;
}

/** Hull outline in units of the body radius, facing up: from the drive and the chassis tier. */
export function hullOutline(l: Pick<Look, 'motor' | 'size'>): number[] {
  const tier = Math.max(0, Math.min(5, l.size));
  if (l.motor === 'rotor') return rotorOutline(tier);
  const profile = DRIVE_PROFILE[l.motor];
  const shape = TIER_SHAPE[tier];
  const ys = new Set<number>(profile.map(([y]) => y));
  for (const y of shape.steps) ys.add(y);
  if (shape.round > 0) for (let i = -5; i <= 5; i++) ys.add(i / 5);
  const sorted = [...ys].sort((p, q) => p - q);
  // `side` picks which side of a step to measure on.
  const width = (y: number, side: number): number => {
    const base = profileWidth(profile, y);
    const round = Math.sqrt(Math.max(0, 1 - Math.min(1, y * y)));
    return (base * (1 - shape.round) + round * shape.round) * shape.scale(y + 1e-6 * side);
  };
  const right: number[] = [];
  for (const y of sorted) {
    if (shape.steps.includes(y)) right.push(width(y, -1), y, width(y, 1), y);
    else right.push(width(y, 0), y);
  }
  const pts: number[] = [];
  for (let i = 0; i < right.length; i += 2) pts.push(right[i], right[i + 1]);
  for (let i = right.length - 2; i >= 0; i -= 2) pts.push(-right[i], right[i + 1]);
  return dedupe(pts);
}

/** How much longer than wide a long chassis is. */
const LONG = 1.9;

/** The hull path: the outline (or a disc) in body units, stretched lengthwise on a long chassis. */
function hullPath(g: Graphics, l: Look, r: number): Graphics {
  const stretch = l.long ? LONG : 1;
  return g.poly(hullOutline(l).map((v, i) => (i % 2 ? v * stretch : v) * r));
}

function hull(g: Graphics, l: Look, r: number, colour: number): void {
  const shape = hullPath(g, l, r);
  shape.fill(colour).stroke({ width: 2, color: 0xffffff, alpha: 0.5 });
}

function drawUnit(g: Graphics, l: Look, colour: number, tex: number, gait?: number, separate = false): void {
  const r = unitRadius(l, tex);
  // Keeps every unit of a size class the same texture box, so sprites stay centred.
  const len = l.long ? LONG : 1;
  const box = r * 1.45;
  g.rect(-box, -box * len, box * 2, box * 2 * len).fill({ color: 0, alpha: 0.001 });

  // Drive, underneath the hull.
  if (l.motor === 'legs') drawLegs(g, l, r, len, colour, gait);
  if (l.motor === 'small') {
    // Wheels: separate stubby tyres on axles, two a side (three on a long chassis), so they read apart from tracks.
    const n = l.long ? 3 : 2;
    const wl = r * 0.5, ww = r * 0.3;
    for (let i = 0; i < n; i++) {
      const y = ((i / (n - 1)) * 2 - 1) * r * 0.62 * len;
      g.moveTo(-r * 0.95, y).lineTo(r * 0.95, y).stroke({ width: 1.5, color: STEEL });
      for (const sx of [-1, 1]) {
        g.roundRect(sx * r * 0.95 - ww / 2, y - wl / 2, ww, wl, ww * 0.45).fill(DARK).stroke({ width: 1, color: STEEL });
        g.moveTo(sx * r * 0.95 - ww * 0.25, y - wl * 0.2).lineTo(sx * r * 0.95 + ww * 0.25, y - wl * 0.2)
          .moveTo(sx * r * 0.95 - ww * 0.25, y + wl * 0.2).lineTo(sx * r * 0.95 + ww * 0.25, y + wl * 0.2).stroke({ width: 1, color: STEEL, alpha: 0.7 });
      }
    }
  }
  if (l.motor === 'large' || l.motor === 'huge') {
    const w = l.motor === 'huge' ? r * 0.5 : r * 0.42;
    const h = r * 1.7 * len;
    for (const sx of [-1, 1]) {
      g.roundRect(sx * r * 0.95 - w / 2, -h / 2, w, h, 2).fill(DARK).stroke({ width: 1, color: STEEL });
      for (let i = -2; i <= 2; i++) g.moveTo(sx * r * 0.95 - w / 2, i * h * 0.17).lineTo(sx * r * 0.95 + w / 2, i * h * 0.17).stroke({ width: 1, color: STEEL, alpha: 0.7 });
    }
  }
  if (l.motor === 'rotor') {
    for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const cx = dx * r * 0.95, cy = dy * r * 0.95;
      g.moveTo(0, 0).lineTo(cx, cy).stroke({ width: 2, color: STEEL });
      g.circle(cx, cy, r * 0.42).stroke({ width: 1.5, color: colour });
      g.moveTo(cx - r * 0.38, cy).lineTo(cx + r * 0.38, cy).moveTo(cx, cy - r * 0.38).lineTo(cx, cy + r * 0.38).stroke({ width: 1, color: 0xffffff, alpha: 0.7 });
    }
  }

  // Cargo container sits at the back of the hull, behind the body.
  if (l.cargo > 0) {
    const w = r * Math.min(1.5, 0.9 + l.cargo * 0.3);
    g.roundRect(-w / 2, r * 0.35 * len, w, r * 0.85 * len, 2).fill(DARK).stroke({ width: 1.5, color: MATTER });
    g.moveTo(-w / 2, r * 0.77 * len).lineTo(w / 2, r * 0.77 * len).stroke({ width: 1, color: MATTER, alpha: 0.7 });
  }

  hull(g, l, r, colour);

  // Armour: a heavier rim, one more notch per plate.
  if (l.armour > 0) {
    const w = Math.min(6, 1.5 + l.armour * 1.5);
    hullPath(g, l, r).stroke({ width: w, color: STEEL });
  }

  // Compute core.
  if (l.cpu !== 'none') {
    const c = r * 0.32;
    const glow = l.cpu === 'quantum' ? LASER : l.cpu === 'fast' ? ENERGY : shade(colour, -0.5);
    g.rect(-c, -c * 0.4, c * 2, c * 1.4).fill(DARK).stroke({ width: 1, color: glow });
    if (l.cpu !== 'basic') g.circle(0, c * 0.3, c * 0.3).fill(glow);
  }

  // Battery cells: a row of pips across the stern.
  if (l.batteries > 0) {
    const n = Math.min(4, l.batteries);
    for (let i = 0; i < n; i++) g.rect((i - (n - 1) / 2) * r * 0.32 - r * 0.1, r * 0.55 * len, r * 0.2, r * 0.3).fill(ENERGY);
  }

  // Build arm: a jointed arm with a claw, out to the front-right.
  if (l.builders > 0) {
    g.moveTo(r * 0.2, -r * 0.1).lineTo(r * 0.75, -r * 0.55).lineTo(r * 1.15, -r * 0.4).stroke({ width: 2.5, color: ENERGY });
    g.circle(r * 1.15, -r * 0.4, 2.2).fill(0xffffff);
  }

  // Hazard stripes round the whole outer chassis: yellow for builders, red for repairers (alternating if both).
  hazardRim(g, hullOutline(l).map((v, i) => (i % 2 ? v * len : v) * r), l, Math.max(3, Math.min(7, r * 0.2)));

  // Sensors: a nub, or a dish on a mast.
  if (l.sensor === 'short') g.circle(-r * 0.55, -r * 0.55, 2.5).fill(0xffffff);
  if (l.sensor === 'long') {
    g.moveTo(-r * 0.5, -r * 0.2).lineTo(-r * 0.75, -r * 0.8).stroke({ width: 1.5, color: STEEL });
    g.arc(-r * 0.75, -r * 0.8, r * 0.38, Math.PI * 0.15, Math.PI * 1.15).stroke({ width: 2, color: 0xffffff });
    g.circle(-r * 0.75, -r * 0.8, 1.5).fill(0xffffff);
  }

  // On a long chassis the weapon rides forward of the middle, leaving the rear for cargo.
  if (!(separate && aims(l))) weaponTurret(g, l.weapon, r, l.weaponMass, l.long ? -r * (LONG - 1) * 0.55 : 0);
}

/**
 * A striped band along a closed outline (flat x,y list): dashes of the build colour and/or the repair
 * colour, each followed by a dark gap, so a worker's whole edge reads as hazard tape.
 */
function hazardRim(g: Graphics, pts: readonly number[], l: Pick<Look, 'builders' | 'repairers'>, width: number): void {
  const colours: number[] = [];
  if (l.builders > 0) colours.push(BUILD_STRIPE);
  if (l.repairers > 0) colours.push(REPAIR_STRIPE);
  if (colours.length === 0 || pts.length < 6) return;
  const n = pts.length / 2;
  const dash = width * 1.3;
  const cycle = colours.length * 2; // colour, dark, [colour, dark]
  // Dark underlay, then each colour's dashes over it.
  g.poly(pts as number[]).stroke({ width, color: DARK });
  colours.forEach((colour, k) => {
    let walked = 0; // distance round the outline so far
    for (let i = 0; i < n; i++) {
      const x0 = pts[i * 2], y0 = pts[i * 2 + 1], x1 = pts[((i + 1) % n) * 2], y1 = pts[((i + 1) % n) * 2 + 1];
      const len = Math.hypot(x1 - x0, y1 - y0);
      if (len > 0) {
        const ux = (x1 - x0) / len, uy = (y1 - y0) / len;
        let p = 0;
        while (p < len) {
          const slot = Math.floor((walked + p) / dash);
          const end = Math.min(len, Math.max(p + 1e-3, (slot + 1) * dash - walked));
          if (slot % cycle === 2 * k) g.moveTo(x0 + ux * p, y0 + uy * p).lineTo(x0 + ux * end, y0 + uy * end);
          p = end;
        }
      }
      walked += len;
    }
    g.stroke({ width, color: colour });
  });
}

/** A dark plate with slanted stripes of `colour`, clipped to the box (x, y, w, h). */
function stripes(g: Graphics, x: number, y: number, w: number, h: number, colour: number): void {
  g.rect(x, y, w, h).fill(DARK);
  const pitch = Math.max(3, h * 1.1), bar = pitch / 2;
  const clip = (v: number) => Math.max(x, Math.min(x + w, v));
  for (let sx = x - h; sx < x + w; sx += pitch) {
    g.poly([clip(sx + h), y, clip(sx + h + bar), y, clip(sx + bar), y + h, clip(sx), y + h]).fill(colour);
  }
  g.rect(x, y, w, h).stroke({ width: 1, color: DARK });
}

/** A weapon on a vehicle: its muzzle points up, the way units face. */
function weaponTurret(g: Graphics, kind: Look['weapon'], r: number, mass: number, dy = 0): void {
  if (kind === 'none') return;
  g.translateTransform(0, dy);
  drawTurret(g, kind, r, mass);
  g.resetTransform();
}

/** A turret ring: a dark housing with a bright rim; big ones get an inner ring and rivets, so they read as armoured mounts. */
function housing(g: Graphics, hr: number, accent: number): void {
  g.circle(0, 0, hr + 1).stroke({ width: 3, color: DARK, alpha: 0.9 }); // halo against the hull
  g.circle(0, 0, hr).fill(DARK).stroke({ width: 2, color: accent });
  if (hr < 7) return;
  g.circle(0, 0, hr * 0.7).stroke({ width: 1, color: STEEL, alpha: 0.55 });
  const n = hr >= 12 ? 8 : 6;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.PI / n;
    g.circle(Math.cos(a) * hr * 0.86, Math.sin(a) * hr * 0.86, Math.max(0.8, hr * 0.06)).fill(accent);
  }
}

/** Housing radius for a weapon of `mass` on a hull of radius r: a light gun has none to speak of, a siege gun nearly fills the hull. */
const housingRadius = (r: number, mass: number, base: number): number => Math.min(r * 0.85, r * (base + 0.022 * mass));

/** Barrels are drawn this many times longer than the turret's radius alone would give, so they read at a glance. */
const BARREL = 1.5;

function drawTurret(g: Graphics, kind: Look['weapon'], r: number, mass = 0): void {
  switch (kind) {
    case 'gun':
      if (mass >= 8) {
        // Rotary gun: a cluster of barrels in a big round mount.
        const hr = housingRadius(r, mass, 0.3);
        housing(g, hr, GUN);
        for (const x of [-0.5, 0, 0.5]) {
          g.rect(x * hr - 1.8, -r * 1.2 * BARREL, 3.6, r * 1.2 * BARREL - hr * 0.2).fill(GUN).stroke({ width: 1.2, color: DARK });
        }
        g.rect(-hr * 0.8, -r * 1.2 * BARREL, hr * 1.6, Math.max(2, r * 0.1)).fill(WARN);
      } else {
        g.circle(0, 0, r * 0.3).fill(DARK).stroke({ width: 1.5, color: GUN });
        g.rect(-2, -r * 1.05 * BARREL, 4, r * 1.05 * BARREL).fill(GUN).stroke({ width: 1.2, color: DARK });
      }
      break;
    case 'cannon': {
      // A squat armoured mantlet with a counterweight behind it, and a muzzle brake.
      const hr = housingRadius(r, mass, 0.36);
      const w = r * (0.16 + 0.006 * mass);
      const len = r * (mass >= 10 ? 1.3 : 1.2) * BARREL;
      g.roundRect(-hr * 0.65, hr * 0.2, hr * 1.3, hr * 0.85, 2).fill(DARK).stroke({ width: 1, color: WARN });
      housing(g, hr, WARN);
      g.rect(-w, -len, w * 2, len).fill(GUN).stroke({ width: 1.5, color: DARK });
      g.rect(-w * 1.5, -len, w * 3, r * 0.2).fill(WARN);
      if (mass >= 10) g.rect(-w * 1.5, -len + r * 0.32, w * 3, r * 0.12).fill(WARN);
      break;
    }
    case 'missile': {
      // A launcher rack on a pivot ring: two warheads, three on the big ones.
      const tubes = mass >= 10 ? [-0.38, 0, 0.38] : [-0.28, 0.28];
      const hw = r * (mass >= 10 ? 0.7 : 0.55);
      g.rect(-hw, -r * 0.35, hw * 2, r * 0.9).fill(DARK).stroke({ width: 1.5, color: WARN });
      if (mass >= 6) g.circle(0, r * 0.1, Math.min(r * 0.45, hw * 0.55)).fill(DARK).stroke({ width: 1, color: STEEL, alpha: 0.7 });
      for (const x of tubes) {
        g.rect(x * r - r * 0.12, -r * 0.95, r * 0.24, r * 0.9).fill(GUN).stroke({ width: 1, color: DARK });
        g.poly([x * r - r * 0.12, -r * 0.95, x * r + r * 0.12, -r * 0.95, x * r, -r * 1.25]).fill(WARN);
      }
      break;
    }
    case 'flak': {
      // Twin short barrels splayed upward on a round mount.
      housing(g, housingRadius(r, mass, 0.3), GUN);
      for (const a of [-0.28, 0.28]) {
        const x0 = Math.sin(a) * r * 0.2, y0 = -Math.cos(a) * r * 0.2, x1 = Math.sin(a) * r * 1.15 * BARREL, y1 = -Math.cos(a) * r * 1.15 * BARREL;
        g.moveTo(x0, y0).lineTo(x1, y1).stroke({ width: 5.5, color: DARK });
        g.moveTo(x0, y0).lineTo(x1, y1).stroke({ width: 3, color: GUN });
      }
      break;
    }
    case 'laser':
      housing(g, housingRadius(r, mass, 0.26), LASER);
      g.poly([0, -r * 1.2 * BARREL, r * 0.18, -r * 0.3, -r * 0.18, -r * 0.3]).fill(LASER).stroke({ width: 1.5, color: DARK });
      break;
    case 'tesla': {
      g.circle(0, 0, r * 0.3).fill(DARK).stroke({ width: 1.5, color: TESLA });
      for (const a of [-0.7, 0, 0.7]) {
        const x = Math.sin(a) * r * 0.9, y = -Math.cos(a) * r * 0.9;
        g.moveTo(Math.sin(a) * r * 0.3, -Math.cos(a) * r * 0.3).lineTo(x, y).stroke({ width: 4, color: DARK });
        g.moveTo(Math.sin(a) * r * 0.3, -Math.cos(a) * r * 0.3).lineTo(x, y).stroke({ width: 2, color: TESLA });
        g.circle(x, y, 2).fill(0xffffff);
      }
      break;
    }
    default:
  }
}

// --- buildings ---------------------------------------------------------------------

function plate(g: Graphics, role: Look['role'], h: number, colour: number): void {
  const fill = { color: colour, alpha: 0.85 };
  const outline = { width: 2, color: 0xffffff, alpha: 0.5 };
  const c = Math.min(h * 0.4, 10);
  switch (role) {
    case 'combat':
      // Chamfered corners.
      g.poly([-h + c, -h, h - c, -h, h, -h + c, h, h - c, h - c, h, -h + c, h, -h, h - c, -h, -h + c]).fill(fill).stroke(outline);
      break;
    case 'power':
      g.roundRect(-h, -h, h * 2, h * 2, Math.min(h, 12)).fill(fill).stroke(outline);
      break;
    case 'industry':
      g.rect(-h, -h, h * 2, h * 2).fill(fill).stroke(outline);
      // Hazard stripes on the lower edge.
      for (let x = -h; x < h - 3; x += 8) g.poly([x, h, x + 4, h, x + 8, h - 3, x + 4, h - 3]).fill({ color: ENERGY, alpha: 0.9 });
      break;
    default:
      g.roundRect(-h, -h, h * 2, h * 2, 4).fill(fill).stroke(outline);
  }
}

/** The most turrets a building shows: a 1×1 has four cells, and the rest of its modules still need room. */
const MAX_TURRETS = 4;

/** One photovoltaic panel: a pale aluminium frame round a grid of blue cells separated by dark seams, with a glint across the glass. */
function drawSolarPanel(g: Graphics, x: number, y: number, w: number, h: number): void {
  const edge = Math.max(0.6, w * 0.07);
  const ix = x + edge, iy = y + edge, iw = w - edge * 2, ih = h - edge * 2;
  g.rect(x, y, w, h).fill(0xaab6c6).stroke({ width: 0.6, color: 0x5d6b7e });
  g.rect(ix, iy, iw, ih).fill(SOLAR_SEAM);
  const n = 3, seam = Math.max(0.35, w * 0.035);
  const cw = (iw - seam * (n + 1)) / n, ch = (ih - seam * (n + 1)) / n;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const cx = ix + seam + c * (cw + seam), cy = iy + seam + r * (ch + seam);
      g.rect(cx, cy, cw, ch).fill(SOLAR);
      g.rect(cx, cy, cw, Math.max(0.3, ch * 0.22)).fill({ color: 0x8fb8ff, alpha: 0.35 }); // light catching the top of each cell
    }
  }
  g.poly([ix, iy + ih * 0.5, ix + iw * 0.5, iy, ix + iw * 0.75, iy, ix, iy + ih * 0.8]).fill({ color: 0xffffff, alpha: 0.13 });
}

type Glyph = (g: Graphics, cx: number, cy: number, s: number) => void;
type GlyphKind = 'weapon' | 'factory' | 'builder' | 'repair' | 'solar' | 'wind' | 'charger' | 'silo' | 'battery' | 'antenna' | 'sensor' | 'cpu';
type KindGlyph = Glyph & { kind: GlyphKind };

/** Small module symbols that fill a building's cells. Highest priority first. */
function glyphs(l: Look): KindGlyph[] {
  const out: KindGlyph[] = [];
  const add = (kind: GlyphKind, draw: Glyph) => out.push(Object.assign(draw, { kind }));
  // The same turret art as a vehicle's, one for each weapon module (as many as there are cells for).
  if (l.weapon !== 'none') {
    for (let i = 0; i < Math.min(l.weapons, MAX_TURRETS); i++) {
      add('weapon', (g, cx, cy, s) => {
        g.translateTransform(cx, cy);
        drawTurret(g, l.weapon, s, l.weaponMass);
        g.resetTransform();
      });
    }
  }
  // The bulky modules (factory, battery, solar, silo, charger) are drawn at the size of their whole cell: see BIG.
  if (l.factories > 0) {
    add('factory', (g, cx, cy, s) => {
      // A workshop: roof with two exhaust stacks, and a roller door on the south face where units drive out.
      g.rect(cx - s, cy - s, s * 2, s * 2).fill(DARK).stroke({ width: 1.5, color: STEEL });
      g.rect(cx - s * 0.9, cy - s * 0.9, s * 1.8, s * 0.8).fill({ color: STEEL, alpha: 0.3 });
      for (const sx of [-0.6, 0.6]) {
        g.circle(cx + sx * s, cy - s * 0.55, s * 0.22).fill(DARK).stroke({ width: 1.5, color: STEEL });
        g.circle(cx + sx * s, cy - s * 0.55, s * 0.1).fill(0x3a2a20);
      }
      const door = factoryDoor(cx, cy, s);
      g.rect(door.x - door.w / 2, door.y - door.h, door.w, door.h).fill(0x1b2029).stroke({ width: 1, color: STEEL });
      for (let i = 1; i < 4; i++) g.moveTo(door.x - door.w / 2, door.y - (door.h * i) / 4).lineTo(door.x + door.w / 2, door.y - (door.h * i) / 4).stroke({ width: 1, color: STEEL, alpha: 0.7 });
      stripes(g, door.x - door.w / 2 - s * 0.05, door.y - door.h - s * 0.14, door.w + s * 0.1, s * 0.14, ENERGY);
    });
  }
  if (l.builders > 0) {
    add('builder', (g, cx, cy, s) => {
      g.moveTo(cx - s * 0.7, cy + s * 0.7).lineTo(cx - s * 0.1, cy - s * 0.6).lineTo(cx + s * 0.7, cy - s * 0.6).stroke({ width: 2.2, color: ENERGY });
      g.circle(cx + s * 0.7, cy - s * 0.6, 2).fill(0xffffff);
      stripes(g, cx - s * 0.9, cy + s * 0.55, s * 1.8, s * 0.4, BUILD_STRIPE);
    });
  }
  if (l.repairers > 0) {
    add('repair', (g, cx, cy, s) => {
      g.rect(cx - s * 0.2, cy - s * 0.8, s * 0.4, s * 1.2).fill(REPAIR_STRIPE);
      g.rect(cx - s * 0.6, cy - s * 0.4, s * 1.2, s * 0.4).fill(REPAIR_STRIPE);
      stripes(g, cx - s * 0.9, cy + s * 0.55, s * 1.8, s * 0.4, REPAIR_STRIPE);
    });
  }
  if (l.solar > 0) {
    add('solar', (g, cx, cy, s) => {
      // Panel array: up to a 2×2 of cells, filling the tile.
      const n = Math.min(4, l.solar);
      for (let i = 0; i < n; i++) {
        const x = cx + (i % 2 ? 0.05 : -0.97) * s, y = cy + (i < 2 ? -0.97 : 0.05) * s;
        g.rect(x, y, s * 0.92, s * 0.92).fill(SOLAR).stroke({ width: 1, color: 0x8fb8ff, alpha: 0.8 });
        g.moveTo(x + s * 0.46, y).lineTo(x + s * 0.46, y + s * 0.92).moveTo(x, y + s * 0.46).lineTo(x + s * 0.92, y + s * 0.46).stroke({ width: 0.8, color: 0x8fb8ff, alpha: 0.5 });
      }
    });
  }
  if (l.wind > 0) {
    add('wind', (g, cx, cy, s) => {
      for (const a of [0, 2.1, 4.2]) g.moveTo(cx, cy).lineTo(cx + Math.sin(a) * s, cy - Math.cos(a) * s).stroke({ width: 2, color: 0xffffff });
      g.circle(cx, cy, 2).fill(DARK);
    });
  }
  if (l.chargers > 0) {
    add('charger', (g, cx, cy, s) => {
      g.roundRect(cx - s, cy - s, s * 2, s * 2, s * 0.2).fill(DARK).stroke({ width: 1.5, color: ENERGY });
      g.circle(cx, cy, s * 0.8).stroke({ width: 1, color: ENERGY, alpha: 0.5 });
      g.poly([cx + s * 0.12, cy - s * 0.7, cx - s * 0.45, cy + s * 0.08, cx, cy + s * 0.08, cx - s * 0.12, cy + s * 0.7, cx + s * 0.45, cy - s * 0.08, cx, cy - s * 0.08]).fill(ENERGY);
    });
  }
  if (l.silos > 0) {
    add('silo', (g, cx, cy, s) => {
      // A storage tank: ringed drum with a hatch.
      g.circle(cx, cy, s).fill(DARK).stroke({ width: 1.8, color: MATTER });
      g.circle(cx, cy, s * 0.72).stroke({ width: 1, color: MATTER, alpha: 0.5 });
      g.circle(cx, cy, s * 0.36).fill(MATTER).stroke({ width: 1, color: DARK });
      g.moveTo(cx - s * 0.36, cy).lineTo(cx + s * 0.36, cy).moveTo(cx, cy - s * 0.36).lineTo(cx, cy + s * 0.36).stroke({ width: 1, color: DARK });
    });
  }
  if (l.batteries > 0) {
    add('battery', (g, cx, cy, s) => {
      // Large external storage banks: one block, two side by side for a bigger bank, with terminals on top and charge bars.
      const cols = l.batteries >= 2 ? 2 : 1;
      const w = (s * 2) / cols;
      for (let c = 0; c < cols; c++) {
        const x = cx - s + c * w + w * 0.06, bw = w * 0.88;
        g.rect(x + bw * 0.15, cy - s - s * 0.02, bw * 0.2, s * 0.16).fill(STEEL);
        g.rect(x + bw * 0.65, cy - s - s * 0.02, bw * 0.2, s * 0.16).fill(STEEL);
        g.roundRect(x, cy - s * 0.88, bw, s * 1.76, s * 0.12).fill(DARK).stroke({ width: 1.5, color: STEEL });
        for (let i = 0; i < 4; i++) g.rect(x + bw * 0.14, cy - s * 0.74 + i * s * 0.4, bw * 0.72, s * 0.28).fill(ENERGY);
      }
    });
  }
  if (l.antenna !== 'none') {
    add('antenna', (g, cx, cy, s) => {
      const arcs = l.antenna === 'large' ? 3 : l.antenna === 'medium' ? 2 : 1;
      g.moveTo(cx, cy + s * 0.9).lineTo(cx, cy - s * 0.3).stroke({ width: 1.5, color: STEEL });
      g.circle(cx, cy - s * 0.4, 2).fill(ENERGY);
      for (let i = 1; i <= arcs; i++) g.arc(cx, cy - s * 0.4, s * 0.35 * i, Math.PI * 1.2, Math.PI * 1.8).stroke({ width: 1.2, color: ENERGY });
    });
  }
  if (l.sensor !== 'none') {
    add('sensor', (g, cx, cy, s) => {
      g.arc(cx, cy + s * 0.2, s * (l.sensor === 'long' ? 0.9 : 0.6), Math.PI * 0.1, Math.PI * 0.9).stroke({ width: 2, color: 0xffffff });
      g.moveTo(cx, cy + s * 0.2).lineTo(cx, cy - s * 0.7).stroke({ width: 1.2, color: STEEL });
    });
  }
  if (l.cpu !== 'none') {
    add('cpu', (g, cx, cy, s) => {
      const glow = l.cpu === 'quantum' ? LASER : l.cpu === 'fast' ? ENERGY : STEEL;
      g.rect(cx - s * 0.5, cy - s * 0.5, s, s).fill(DARK).stroke({ width: 1.2, color: glow });
      for (const d of [-0.25, 0.25]) g.moveTo(cx + d * s, cy - s * 0.5).lineTo(cx + d * s, cy - s * 0.8).moveTo(cx + d * s, cy + s * 0.5).lineTo(cx + d * s, cy + s * 0.8).stroke({ width: 1, color: glow });
    });
  }
  return out;
}

/** A shaped building: its covered tiles as one plate, an outline round the edge only, a symbol in each tile. */
function drawShapedBuilding(g: Graphics, l: Look, shape: readonly string[], colour: number, tex: number, separate: boolean): void {
  const n = shape.length;
  const x0 = -(n * tex) / 2;
  const has = (i: number, j: number) => shape[j]?.[i] === 'X';
  g.rect(x0, x0, n * tex, n * tex).fill({ color: 0, alpha: 0.001 });
  const inset = 1;
  const cells: [number, number][] = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) if (has(i, j)) cells.push([i, j]);
  // A margin is left clear on every side that faces the outside or a gap, so neighbouring buildings do not touch.
  const m = tex * BUILDING_MARGIN;
  for (const [i, j] of cells) {
    const l0 = has(i - 1, j) ? 0 : m, r0 = has(i + 1, j) ? 0 : m, t0 = has(i, j - 1) ? 0 : m, b0 = has(i, j + 1) ? 0 : m;
    g.rect(x0 + i * tex + l0, x0 + j * tex + t0, tex - l0 - r0, tex - t0 - b0).fill({ color: colour, alpha: 0.85 });
  }
  // Edges that face an empty tile (or the outside).
  const edges = (width: number, color: number, alpha: number, pad: number) => {
    for (const [i, j] of cells) {
      // The line sits `pad` inside an exposed side and runs to the cell's edge where the next cell continues it.
      const left = x0 + i * tex + pad, right = x0 + (i + 1) * tex - pad, top = x0 + j * tex + pad, bottom = x0 + (j + 1) * tex - pad;
      const l0 = has(i - 1, j) ? x0 + i * tex : left, r0 = has(i + 1, j) ? x0 + (i + 1) * tex : right;
      const t0 = has(i, j - 1) ? x0 + j * tex : top, b0 = has(i, j + 1) ? x0 + (j + 1) * tex : bottom;
      if (!has(i, j - 1)) g.moveTo(l0, top).lineTo(r0, top);
      if (!has(i, j + 1)) g.moveTo(l0, bottom).lineTo(r0, bottom);
      if (!has(i - 1, j)) g.moveTo(left, t0).lineTo(left, b0);
      if (!has(i + 1, j)) g.moveTo(right, t0).lineTo(right, b0);
    }
    g.stroke({ width, color, alpha });
  };
  edges(2, 0xffffff, 0.5, inset + m);
  if (l.armour > 0) edges(Math.min(5, 1 + l.armour), STEEL, 0.9, inset + m + 2);
  drawGlyphs(g, l, tex, separate);
}

/** Space left clear round the art of buildings bigger than one tile, as a share of a tile. */
const BUILDING_MARGIN = 0.09;
/** A one-tile building's art reaches this far from its centre (as a share of a tile), about half of what it used to fill. */
const SMALL_BUILDING_HALF = 0.23;

/** Half the side of a square building's art, in texture pixels. */
export const buildingHalf = (size: number, tex: number): number => (size === 1 ? tex * SMALL_BUILDING_HALF : (size * tex) / 2 - tex * BUILDING_MARGIN);

/** Bulky modules are drawn at the size of the whole cell they sit in, not as small symbols. */
const BIG: ReadonlySet<GlyphKind> = new Set<GlyphKind>(['factory', 'battery', 'solar', 'silo', 'charger']);

/** The roller door of a factory drawn at (cx, cy) with half-size s: bottom-centre x/y, width and height. */
function factoryDoor(cx: number, cy: number, s: number): { x: number; y: number; w: number; h: number } {
  return { x: cx, y: cy + s * 0.96, w: s * 1.1, h: s * 0.75 };
}

/** A module symbol placed on a building: its kind, the cell centre and the symbol size (texture pixels from the building's centre). */
interface PlacedGlyph {
  readonly kind: GlyphKind;
  readonly draw: Glyph;
  readonly cx: number;
  readonly cy: number;
  readonly s: number;
  /** Width of the cell it sits in, which caps how big a turret can be. */
  readonly cell: number;
  /** The size of the share of the whole footprint this symbol has, ignoring the margin: a wind rotor is sized from it and may overhang the walls. */
  readonly span: number;
}

/** Where each module symbol goes: one per covered tile of a shaped building, a grid in a square one. */
function placeGlyphs(l: Look, tex: number): PlacedGlyph[] {
  let list = glyphs(l);
  // A square building with weapons is a turret: they get its whole footprint (one in the middle, more in a grid) so they read at a glance.
  if (!l.shape && list.some((q) => q.kind === 'weapon')) list = list.filter((q) => q.kind === 'weapon');
  const out: PlacedGlyph[] = [];
  if (l.shape) {
    const n = l.shape.length;
    const x0 = -(n * tex) / 2;
    const cells: [number, number][] = [];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) if (l.shape[j]?.[i] === 'X') cells.push([i, j]);
    const s = tex * 0.38;
    cells.slice(0, list.length).forEach(([i, j], k) => out.push({ kind: list[k].kind, draw: list[k], cx: x0 + (i + 0.5) * tex, cy: x0 + (j + 0.5) * tex, s, cell: tex, span: tex }));
    return out;
  }
  if (list.length === 0) return out;
  const h = buildingHalf(l.size, tex);
  // A 1×1 building has room for four symbols, larger ones for nine. They share the whole top: a lone symbol fills it,
  // two sit side by side, and the last row is centred.
  const shown = list.slice(0, (l.size === 1 ? 2 : 3) ** 2);
  const k = shown.length;
  const cols = Math.ceil(Math.sqrt(k)), rows = Math.ceil(k / cols);
  const inner = h - Math.min(4, h * 0.2);
  const cw = (inner * 2) / cols, ch = (inner * 2) / rows;
  const s = Math.min(cw, ch) * 0.46;
  const span = Math.min((l.size * tex) / cols, (l.size * tex) / rows);
  shown.forEach((draw, i) => {
    const row = Math.floor(i / cols);
    const inRow = row === rows - 1 ? k - cols * (rows - 1) : cols;
    out.push({ kind: draw.kind, draw, cx: -inner + cw * ((i % cols) + 0.5) + ((cols - inRow) * cw) / 2, cy: -inner + ch * (row + 0.5), s, cell: Math.min(cw, ch), span });
  });
  return out;
}

/** Draws the module symbols; with `separate`, the ones the renderer animates as sprites of their own are left out. */
function drawGlyphs(g: Graphics, l: Look, tex: number, separate: boolean): void {
  for (const p of placeGlyphs(l, tex)) {
    if (separate && ((p.kind === 'weapon' && aims(l)) || p.kind === 'wind')) continue;
    p.draw(g, p.cx, p.cy, p.kind === 'weapon' ? turretRadius(l, p) : p.kind === 'wind' ? windRadius(l, p, tex) : BIG.has(p.kind) ? p.cell * 0.46 : p.s);
  }
}

/** A building's weapon is drawn bigger the heavier it is, so a siege gun is a real turret and not a dot. */
const weaponScale = (l: Pick<Look, 'weaponMass'>): number => 1 + 0.1 * Math.min(l.weaponMass, 14);
/** ...but never wider than its cell, so neighbouring turrets do not overlap. */
const turretRadius = (l: Pick<Look, 'weaponMass'>, p: PlacedGlyph): number => Math.min(p.s * weaponScale(l), p.cell * 0.5);

/** A lattice base nearly as wide as the tile: a steel frame with corner feet and cross braces, lit by a thin line of the owner's colour. */
function drawFramework(g: Graphics, tex: number, colour: number): void {
  const f = tex * 0.46, foot = tex * 0.11;
  g.rect(-f, -f, f * 2, f * 2).fill({ color: DARK, alpha: 0.55 });
  // Cross braces corner to corner, and a lighter inner square.
  g.moveTo(-f, -f).lineTo(f, f).moveTo(f, -f).lineTo(-f, f).stroke({ width: 1.2, color: STEEL, alpha: 0.75 });
  g.rect(-f * 0.62, -f * 0.62, f * 1.24, f * 1.24).stroke({ width: 1, color: STEEL, alpha: 0.6 });
  g.rect(-f, -f, f * 2, f * 2).stroke({ width: 1.8, color: STEEL });
  g.rect(-f + 1.5, -f + 1.5, f * 2 - 3, f * 2 - 3).stroke({ width: 1, color: colour, alpha: 0.7 });
  // Feet at the corners.
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      g.rect(sx * f - (sx > 0 ? foot : 0), sy * f - (sy > 0 ? foot : 0), foot, foot).fill(STEEL).stroke({ width: 0.8, color: DARK });
      g.circle(sx * (f - foot / 2), sy * (f - foot / 2), Math.max(0.7, foot * 0.16)).fill(DARK);
    }
  }
}

/** A square building with more armour than all its other modules together is a wall. */
export const isWall = (l: Look): boolean => l.structure && !l.shape && l.armour > l.modules - l.armour;

/** Sides of a wall that continue into another wall of the same owner (bits for `drawWall`). */
export const WALL_N = 1, WALL_E = 2, WALL_S = 4, WALL_W = 8;
/** Corners of a wall footprint that touch a wall only diagonally (set only when neither side next to that corner is joined). */
export const WALL_NE = 16, WALL_SE = 32, WALL_SW = 64, WALL_NW = 128;
const DIAGONALS: readonly [number, number, number][] = [[1, -1, WALL_NE], [1, 1, WALL_SE], [-1, 1, WALL_SW], [-1, -1, WALL_NW]];

/**
 * A wall is a plus inside its footprint. Where a neighbouring wall continues it, the arm on that side
 * runs out to the tile edge, so a line of walls becomes a bar (| or -) and corners and junctions keep their joined arms.
 * A wall bigger than one tile is a block of such cells joined to each other. `joined` lists the outer sides that continue into another wall.
 */
export function drawWall(g: Graphics, l: Look, colour: number, tex: number, joined = 0): void {
  const full = (l.size * tex) / 2;
  const h = tex / 2, reach = h - tex * BUILDING_MARGIN, arm = tex * 0.17, hub = arm * 1.45;
  const line = Math.min(4, 1 + l.armour);
  // Diagonal arms overhang the footprint a little so they overlap the neighbour's arm at the shared corner;
  // the texture is padded evenly all round (the same for every wall), so it stays centred.
  const pad = Math.ceil(arm + line);
  g.rect(-full - pad, -full - pad, (full + pad) * 2, (full + pad) * 2).fill({ color: 0, alpha: 0.001 });
  const rects: number[][] = []; // x0, y0, x1, y1 of every piece
  const bolts: number[][] = [];
  const slants: [number, number, number, number, boolean][] = []; // diagonal arms: centre, direction, reaches the corner
  for (let j = 0; j < l.size; j++) {
    for (let i = 0; i < l.size; i++) {
      const cx = -full + (i + 0.5) * tex, cy = -full + (j + 0.5) * tex;
      const n = j > 0 || !!(joined & WALL_N), s = j < l.size - 1 || !!(joined & WALL_S);
      const w = i > 0 || !!(joined & WALL_W), e = i < l.size - 1 || !!(joined & WALL_E);
      const vert = n || s, horiz = w || e;
      // Diagonal neighbours only touch at a footprint corner.
      const diag = DIAGONALS.map(([sx, sy, bit]) => !!(joined & bit) && (sx < 0 ? i === 0 : i === l.size - 1) && (sy < 0 ? j === 0 : j === l.size - 1));
      const anyDiag = diag.includes(true);
      if (!vert && !horiz && anyDiag) {
        // Touching diagonally only: a diagonal bar (its free end capped short); no hub, which would stick out beside it.
        DIAGONALS.forEach(([sx, sy], k) => {
          const opposite = diag[(k + 2) % 4];
          if (diag[k] || (opposite && !diag[(k + 1) % 4] && !diag[(k + 3) % 4])) slants.push([cx, cy, sx, sy, diag[k]]);
        });
      } else if (!vert && !horiz) {
        // On its own: a plus with its arms stopping short of the tile edge.
        rects.push([cx - arm, cy - reach, cx + arm, cy + reach], [cx - reach, cy - arm, cx + reach, cy + arm], [cx - hub, cy - hub, cx + hub, cy + hub]);
      } else if (vert !== horiz) {
        // One direction only: a bar (capped short of the edge on a free end).
        if (vert) rects.push([cx - arm, cy - (n ? h : reach), cx + arm, cy + (s ? h : reach)]);
        else rects.push([cx - (w ? h : reach), cy - arm, cx + (e ? h : reach), cy + arm]);
      } else {
        // A corner, T or cross: the arms that continue, round a hub.
        if (n) rects.push([cx - arm, cy - h, cx + arm, cy]);
        if (s) rects.push([cx - arm, cy, cx + arm, cy + h]);
        if (w) rects.push([cx - h, cy - arm, cx, cy + arm]);
        if (e) rects.push([cx, cy - arm, cx + h, cy + arm]);
        rects.push([cx - hub, cy - hub, cx + hub, cy + hub]);
      }
      if ((vert || horiz) && anyDiag) DIAGONALS.forEach(([sx, sy], k) => { if (diag[k]) slants.push([cx, cy, sx, sy, true]); });
      bolts.push([cx, cy]);
    }
  }
  // Outline first (every piece grown a little, kept inside the footprint), then the pieces on top, so joins have no seams.
  const clamp = (v: number) => Math.max(-full, Math.min(full, v));
  const clampPad = (v: number) => Math.max(-full - pad, Math.min(full + pad, v));
  // A diagonal arm is a slanted bar; where it reaches the corner it runs on past it, to overlap the diagonal neighbour's arm.
  const slant = (cx: number, cy: number, sx: number, sy: number, len: number, w: number): number[] => {
    const dx = sx / Math.SQRT2, dy = sy / Math.SQRT2, px = -dy, py = dx;
    const pts = [cx + px * w, cy + py * w, cx + dx * len + px * w, cy + dy * len + py * w, cx + dx * len - px * w, cy + dy * len - py * w, cx - px * w, cy - py * w];
    return pts.map((v) => clampPad(v));
  };
  const reachLen = h * Math.SQRT2 + arm * 0.3;
  for (const [cx, cy, sx, sy, far] of slants) {
    g.poly(slant(cx, cy, sx, sy, far ? reachLen : reach, arm + line)).fill(STEEL);
  }
  for (const [x0, y0, x1, y1] of rects) g.rect(clamp(x0 - line), clamp(y0 - line), clamp(x1 + line) - clamp(x0 - line), clamp(y1 + line) - clamp(y0 - line)).fill(STEEL);
  for (const [x0, y0, x1, y1] of rects) g.rect(x0, y0, x1 - x0, y1 - y0).fill(colour);
  for (const [cx, cy, sx, sy, far] of slants) {
    g.poly(slant(cx, cy, sx, sy, far ? reachLen : reach, arm)).fill(colour);
  }
  for (const [cx, cy] of bolts) g.circle(cx, cy, Math.max(1.2, arm * 0.35)).fill({ color: DARK, alpha: 0.8 }).stroke({ width: 0.8, color: STEEL });
}

function drawBuilding(g: Graphics, l: Look, colour: number, tex: number, separate: boolean): void {
  if (l.shape) {
    drawShapedBuilding(g, l, l.shape, colour, tex, separate);
    return;
  }
  if (isWall(l)) {
    drawWall(g, l, colour, tex);
    return;
  }
  const h = buildingHalf(l.size, tex);
  const full = (l.size * tex) / 2;
  g.rect(-full, -full, full * 2, full * 2).fill({ color: 0, alpha: 0.001 }); // keeps the texture the size of the footprint, margin included
  // Turrets and pylons are little more than their one module, so a framework under them covers the tile they stand on.
  if (l.size === 1 && (l.weapon !== 'none' || (l.antenna !== 'none' && glyphs(l).length === 1))) drawFramework(g, tex, colour);
  if (l.size === 1 && l.weapon !== 'none') {
    // A one-tile gun emplacement is a round plinth well inside its tile, so it reads as a turret and not a block; the barrels may poke past it.
    const pr = h * 0.9;
    g.circle(0, 0, pr).fill({ color: colour, alpha: 0.85 }).stroke({ width: 2, color: 0xffffff, alpha: 0.5 });
    g.circle(0, 0, pr * 0.82).stroke({ width: 1, color: DARK, alpha: 0.6 });
    if (l.armour > 0) g.circle(0, 0, pr - 2).stroke({ width: Math.min(4, 1 + l.armour), color: STEEL, alpha: 0.9 });
    drawGlyphs(g, l, tex, separate);
    return;
  }
  // A building with few modules is a smaller block inside its tile; each module bulks it up towards the tile edge.
  const mods = glyphs(l).length;
  const hp = mods === 0 ? h : h * Math.min(1, 0.78 + 0.08 * mods);
  plate(g, l.role, hp, colour);
  hazardRim(g, [-hp, -hp, hp, -hp, hp, hp, -hp, hp], l, Math.min(4, hp * 0.35));
  if (l.armour > 0) {
    g.rect(-hp + 2, -hp + 2, (hp - 2) * 2, (hp - 2) * 2).stroke({ width: Math.min(5, 1 + l.armour), color: STEEL, alpha: 0.9 });
  }
  drawGlyphs(g, l, tex, separate);
}

/** Weapons that swing round to face their target (a tesla coil strikes everything around it, so it does not). */
export const aims = (l: Pick<Look, 'weapon'>): boolean => l.weapon !== 'none' && l.weapon !== 'tesla';

/** Where a turret sits on a class (texture pixels from its centre) and the size its art is drawn at; null if it has none that turns. */
export function turretAnchor(l: Look, tex: number): { x: number; y: number; r: number } | null {
  if (!aims(l)) return null;
  if (!l.structure) {
    const r = unitRadius(l, tex);
    return { x: 0, y: l.long ? -r * (LONG - 1) * 0.55 : 0, r };
  }
  const p = placeGlyphs(l, tex).find((q) => q.kind === 'weapon');
  return p ? { x: p.cx, y: p.cy, r: turretRadius(l, p) } : null;
}

/** A headlight: `side` is across the hull (-1 port edge to 1 starboard, as a share of the half width), `power` its brightness and reach (0 to 1). */
export interface Lamp {
  readonly side: number;
  readonly power: number;
}

const TWIN: readonly Lamp[] = [{ side: -0.4, power: 1 }, { side: 0.4, power: 1 }];

/** Each body type has its own lamps: one to three, of different strength, some lopsided. */
const LAMPS: Readonly<Record<string, readonly Lamp[]>> = {
  'chassis.micro': [{ side: 0, power: 0.55 }],
  'chassis.light': TWIN,
  'chassis.medium': [{ side: -0.5, power: 0.9 }, { side: 0.5, power: 0.9 }],
  'chassis.heavy': [{ side: -0.5, power: 1 }, { side: 0.5, power: 1 }],
  'chassis.long.light': [{ side: -0.45, power: 0.9 }],
  'chassis.long.medium': [{ side: -0.5, power: 1 }, { side: 0.4, power: 0.5 }],
  'chassis.long.heavy': [{ side: -0.6, power: 1 }, { side: 0.05, power: 0.6 }, { side: 0.6, power: 0.8 }],
  'chassis.superheavy': [{ side: -0.5, power: 0.7 }, { side: 0, power: 1 }, { side: 0.5, power: 0.7 }],
  'chassis.colossus': [{ side: 0.5, power: 1 }, { side: -0.2, power: 0.5 }],
};

/** The headlights a unit design carries (two matched lamps if the chassis is unknown). */
export function headlampsOf(parts: readonly string[]): readonly Lamp[] {
  const frame = parts.find((id) => id.startsWith('chassis.'));
  return (frame && LAMPS[frame]) || TWIN;
}

/** Every turret of a class: one for a unit, one per weapon module (that fits) for a building. */
export function turretAnchors(l: Look, tex: number): { x: number; y: number; r: number }[] {
  if (!l.structure) {
    const a = turretAnchor(l, tex);
    return a ? [a] : [];
  }
  if (!aims(l)) return [];
  return placeGlyphs(l, tex).filter((q) => q.kind === 'weapon').map((p) => ({ x: p.cx, y: p.cy, r: turretRadius(l, p) }));
}

/** The turret alone, drawn round the origin facing up (the renderer turns it): its own sprite, so it can aim. */
export function drawTurretSprite(g: Graphics, l: Look, tex: number): void {
  const a = turretAnchor(l, tex);
  if (!a) return;
  // Equal extents on every side keep the texture centred on the pivot.
  const box = a.r * 2.1; // room for the longest barrel
  g.rect(-box, -box, box * 2, box * 2).fill({ color: 0, alpha: 0.001 });
  if (!l.structure) drawTurret(g, l.weapon, a.r, l.weaponMass);
  else drawTurret(g, l.weapon, a.r, l.weaponMass);
}

/**
 * The blades of a wind turbine may overhang the walls, but must stay inside the tile (or the edge of the footprint) so
 * the blades of two buildings side by side never touch: each is less than its own distance to the nearest edge.
 */
function windRadius(l: Look, p: PlacedGlyph, tex: number): number {
  const room = l.shape ? tex / 2 : (l.size * tex) / 2 - Math.max(Math.abs(p.cx), Math.abs(p.cy));
  return Math.min(room * 0.9, p.span * 0.5, tex * 0.9);
}

/** A working factory's door (where units come out) and exhaust stacks, in texture pixels from the building's centre; null if it has no factory cell. */
export function factoryAnchor(l: Look, tex: number): { door: { x: number; y: number }; stacks: { x: number; y: number }[] } | null {
  if (!l.structure || l.factories === 0) return null;
  const p = placeGlyphs(l, tex).find((q) => q.kind === 'factory');
  if (!p) return null;
  const s = p.cell * 0.46, d = factoryDoor(p.cx, p.cy, s);
  return { door: { x: d.x, y: d.y }, stacks: [-0.6, 0.6].map((sx) => ({ x: p.cx + sx * s, y: p.cy - s * 0.55 })) };
}

/** Where a building's wind turbine rotor sits, and its size; null for a class without one (or with no room to show it). */
export function windAnchor(l: Look, tex: number): { x: number; y: number; radius: number } | null {
  if (!l.structure || l.wind === 0) return null;
  const p = placeGlyphs(l, tex).find((q) => q.kind === 'wind');
  return p ? { x: p.cx, y: p.cy, radius: windRadius(l, p, tex) } : null;
}

/** Three turbine blades round a hub, centred on the origin: the renderer spins it. */
export function drawRotor(g: Graphics, r: number): void {
  g.circle(0, 0, r * 1.05).fill({ color: 0, alpha: 0.001 });
  for (let k = 0; k < 3; k++) {
    const a = (k * Math.PI * 2) / 3;
    const c = Math.cos(a), sn = Math.sin(a);
    // A tapered blade: wide at the hub, narrow at the tip.
    g.poly([c * r * 0.12 - sn * r * 0.16, sn * r * 0.12 + c * r * 0.16, c * r * 1.0 - sn * r * 0.05, sn * r * 1.0 + c * r * 0.05, c * r * 1.0 + sn * r * 0.05, sn * r * 1.0 - c * r * 0.05, c * r * 0.12 + sn * r * 0.16, sn * r * 0.12 - c * r * 0.16])
      .fill(0xf1f4f8).stroke({ width: 0.8, color: STEEL });
  }
  g.circle(0, 0, Math.max(1.8, r * 0.2)).fill(DARK).stroke({ width: 1, color: STEEL });
}
