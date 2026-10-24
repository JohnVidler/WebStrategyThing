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
const LASER = 0x5ee6ff;
const TESLA = 0xa98bff;
const WARN = 0xff8a5c;

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
  readonly armour: number;
  readonly cargo: number;
  readonly builders: number;
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
    armour: count('armor'),
    cargo: count('cargo'),
    builders: count('builder'),
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
  // Wheels: a sleek wedge, pointed at the front.
  small: [[-1.05, 0.05], [-0.8, 0.4], [-0.3, 0.85], [0.4, 0.9], [0.8, 0.75], [0.95, 0.5]],
  // Big wheels or tracks: a blunt, boxy body.
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
  if (l.motor === 'small' || l.motor === 'large' || l.motor === 'huge') {
    const heavy = l.motor !== 'small';
    const w = l.motor === 'huge' ? r * 0.5 : heavy ? r * 0.42 : r * 0.26;
    const h = r * (heavy ? 1.7 : 1.4) * len;
    for (const sx of [-1, 1]) {
      g.roundRect(sx * r * 0.95 - w / 2, -h / 2, w, h, 2).fill(DARK).stroke({ width: 1, color: STEEL });
      if (heavy) for (let i = -2; i <= 2; i++) g.moveTo(sx * r * 0.95 - w / 2, i * h * 0.17).lineTo(sx * r * 0.95 + w / 2, i * h * 0.17).stroke({ width: 1, color: STEEL, alpha: 0.7 });
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

/** A weapon on a vehicle: its muzzle points up, the way units face. */
function weaponTurret(g: Graphics, kind: Look['weapon'], r: number, mass: number, dy = 0): void {
  if (kind === 'none') return;
  g.translateTransform(0, dy);
  drawTurret(g, kind, r, mass);
  g.resetTransform();
}

/** A turret ring: a dark housing with a bright rim; big ones get an inner ring and rivets, so they read as armoured mounts. */
function housing(g: Graphics, hr: number, accent: number): void {
  g.circle(0, 0, hr).fill(DARK).stroke({ width: 1.5, color: accent });
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

function drawTurret(g: Graphics, kind: Look['weapon'], r: number, mass = 0): void {
  switch (kind) {
    case 'gun':
      if (mass >= 8) {
        // Rotary gun: a cluster of barrels in a big round mount.
        const hr = housingRadius(r, mass, 0.3);
        housing(g, hr, STEEL);
        for (const x of [-0.5, 0, 0.5]) {
          g.rect(x * hr - 1.4, -r * 1.2, 2.8, r * 1.2 - hr * 0.2).fill(STEEL).stroke({ width: 0.8, color: DARK });
        }
        g.rect(-hr * 0.8, -r * 1.2, hr * 1.6, Math.max(2, r * 0.1)).fill(WARN);
      } else {
        g.circle(0, 0, r * 0.3).fill(DARK);
        g.rect(-1.5, -r * 1.05, 3, r * 1.05).fill(STEEL);
      }
      break;
    case 'cannon': {
      // A squat armoured mantlet with a counterweight behind it, and a muzzle brake.
      const hr = housingRadius(r, mass, 0.36);
      const w = r * (0.16 + 0.006 * mass);
      const len = r * (mass >= 10 ? 1.3 : 1.2);
      g.roundRect(-hr * 0.65, hr * 0.2, hr * 1.3, hr * 0.85, 2).fill(DARK).stroke({ width: 1, color: WARN });
      housing(g, hr, WARN);
      g.rect(-w, -len, w * 2, len).fill(STEEL).stroke({ width: 1, color: DARK });
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
        g.rect(x * r - r * 0.12, -r * 0.95, r * 0.24, r * 0.9).fill(0xdfe5ee);
        g.poly([x * r - r * 0.12, -r * 0.95, x * r + r * 0.12, -r * 0.95, x * r, -r * 1.25]).fill(WARN);
      }
      break;
    }
    case 'flak': {
      // Twin short barrels splayed upward on a round mount.
      housing(g, housingRadius(r, mass, 0.3), STEEL);
      for (const a of [-0.28, 0.28]) {
        g.moveTo(Math.sin(a) * r * 0.2, -Math.cos(a) * r * 0.2).lineTo(Math.sin(a) * r * 1.15, -Math.cos(a) * r * 1.15).stroke({ width: 3, color: STEEL });
      }
      break;
    }
    case 'laser':
      housing(g, housingRadius(r, mass, 0.26), LASER);
      g.poly([0, -r * 1.2, r * 0.18, -r * 0.3, -r * 0.18, -r * 0.3]).fill(LASER);
      break;
    case 'tesla': {
      g.circle(0, 0, r * 0.3).fill(DARK).stroke({ width: 1.5, color: TESLA });
      for (const a of [-0.7, 0, 0.7]) {
        const x = Math.sin(a) * r * 0.9, y = -Math.cos(a) * r * 0.9;
        g.moveTo(Math.sin(a) * r * 0.3, -Math.cos(a) * r * 0.3).lineTo(x, y).stroke({ width: 1.5, color: TESLA });
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

type Glyph = (g: Graphics, cx: number, cy: number, s: number) => void;
type GlyphKind = 'weapon' | 'factory' | 'builder' | 'solar' | 'wind' | 'charger' | 'silo' | 'battery' | 'antenna' | 'sensor' | 'cpu';
type KindGlyph = Glyph & { kind: GlyphKind };

/** Small module symbols that fill a building's cells. Highest priority first. */
function glyphs(l: Look): KindGlyph[] {
  const out: KindGlyph[] = [];
  const add = (kind: GlyphKind, draw: Glyph) => out.push(Object.assign(draw, { kind }));
  if (l.weapon !== 'none') {
    add('weapon', (g, cx, cy, s) => {
      const hr = s * Math.min(0.95, 0.55 + 0.025 * l.weaponMass); // heavy guns sit in bigger housings
      g.circle(cx, cy, hr).fill(DARK).stroke({ width: 1.5, color: l.weapon === 'laser' ? LASER : l.weapon === 'tesla' ? TESLA : l.weapon === 'cannon' || l.weapon === 'missile' ? WARN : STEEL });
      if (l.weaponMass >= 3) g.circle(cx, cy, hr * 0.72).stroke({ width: 1, color: STEEL, alpha: 0.55 });
      if (l.weapon === 'missile') {
        for (const x of [-s * 0.25, s * 0.25]) {
          g.rect(cx + x - s * 0.1, cy - s * 0.85, s * 0.2, s * 0.8).fill(0xdfe5ee);
          g.poly([cx + x - s * 0.1, cy - s * 0.85, cx + x + s * 0.1, cy - s * 0.85, cx + x, cy - s * 1.1]).fill(WARN);
        }
      } else if (l.weapon === 'tesla') {
        for (const a of [0, 2.1, 4.2]) g.moveTo(cx, cy).lineTo(cx + Math.sin(a) * s, cy - Math.cos(a) * s).stroke({ width: 1.5, color: TESLA });
      } else {
        const len = l.weapon === 'cannon' ? s * 1.1 : s * 0.9;
        const w = l.weapon === 'cannon' ? s * 0.4 : l.weapon === 'laser' ? s * 0.16 : s * 0.22;
        g.rect(cx - w / 2, cy - len, w, len).fill(l.weapon === 'laser' ? LASER : STEEL);
      }
    });
  }
  if (l.factories > 0) {
    add('factory', (g, cx, cy, s) => {
      g.rect(cx - s * 0.8, cy - s * 0.4, s * 1.6, s * 1.1).fill(DARK).stroke({ width: 1, color: STEEL });
      g.rect(cx - s * 0.5, cy - s * 0.95, s * 0.35, s * 0.55).fill(STEEL);
      g.rect(cx + s * 0.05, cy - s * 0.1, s * 0.5, s * 0.4).fill(ENERGY);
    });
  }
  if (l.builders > 0) {
    add('builder', (g, cx, cy, s) => {
      g.moveTo(cx - s * 0.7, cy + s * 0.7).lineTo(cx - s * 0.1, cy - s * 0.6).lineTo(cx + s * 0.7, cy - s * 0.6).stroke({ width: 2.2, color: ENERGY });
      g.circle(cx + s * 0.7, cy - s * 0.6, 2).fill(0xffffff);
    });
  }
  if (l.solar > 0) {
    add('solar', (g, cx, cy, s) => {
      const n = Math.min(4, l.solar);
      for (let i = 0; i < n; i++) {
        const x = cx + (i % 2 ? 0.05 : -0.95) * s, y = cy + (i < 2 ? -0.95 : 0.05) * s;
        g.rect(x, y, s * 0.9, s * 0.9).fill(SOLAR).stroke({ width: 1, color: 0x8fb8ff, alpha: 0.8 });
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
      g.poly([cx + s * 0.15, cy - s, cx - s * 0.6, cy + s * 0.1, cx, cy + s * 0.1, cx - s * 0.15, cy + s, cx + s * 0.6, cy - s * 0.1, cx, cy - s * 0.1]).fill(ENERGY);
    });
  }
  if (l.silos > 0) {
    add('silo', (g, cx, cy, s) => {
      g.circle(cx, cy, s * 0.8).fill(DARK).stroke({ width: 1.5, color: MATTER });
      g.circle(cx, cy, s * 0.35).fill(MATTER);
    });
  }
  if (l.batteries > 0) {
    add('battery', (g, cx, cy, s) => {
      const n = Math.min(3, l.batteries);
      for (let i = 0; i < n; i++) g.rect(cx - s * 0.9, cy + (i - (n - 1) / 2) * s * 0.62 - s * 0.2, s * 1.8, s * 0.4).fill(ENERGY);
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
  for (const [i, j] of cells) g.rect(x0 + i * tex, x0 + j * tex, tex, tex).fill({ color: colour, alpha: 0.85 });
  // Edges that face an empty tile (or the outside).
  const edges = (width: number, color: number, alpha: number, pad: number) => {
    for (const [i, j] of cells) {
      const left = x0 + i * tex + pad, right = x0 + (i + 1) * tex - pad, top = x0 + j * tex + pad, bottom = x0 + (j + 1) * tex - pad;
      if (!has(i, j - 1)) g.moveTo(left, top).lineTo(right, top);
      if (!has(i, j + 1)) g.moveTo(left, bottom).lineTo(right, bottom);
      if (!has(i - 1, j)) g.moveTo(left, top).lineTo(left, bottom);
      if (!has(i + 1, j)) g.moveTo(right, top).lineTo(right, bottom);
    }
    g.stroke({ width, color, alpha });
  };
  edges(2, 0xffffff, 0.5, inset);
  if (l.armour > 0) edges(Math.min(5, 1 + l.armour), STEEL, 0.9, inset + 2);
  drawGlyphs(g, l, tex, separate);
}

/** A module symbol placed on a building: its kind, the cell centre and the symbol size (texture pixels from the building's centre). */
interface PlacedGlyph {
  readonly kind: GlyphKind;
  readonly draw: Glyph;
  readonly cx: number;
  readonly cy: number;
  readonly s: number;
}

/** Where each module symbol goes: one per covered tile of a shaped building, a grid in a square one. */
function placeGlyphs(l: Look, tex: number): PlacedGlyph[] {
  const list = glyphs(l);
  const out: PlacedGlyph[] = [];
  if (l.shape) {
    const n = l.shape.length;
    const x0 = -(n * tex) / 2;
    const cells: [number, number][] = [];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) if (l.shape[j]?.[i] === 'X') cells.push([i, j]);
    const s = Math.min(tex * 0.4, 9);
    cells.slice(0, list.length).forEach(([i, j], k) => out.push({ kind: list[k].kind, draw: list[k], cx: x0 + (i + 0.5) * tex, cy: x0 + (j + 0.5) * tex, s }));
    return out;
  }
  if (list.length === 0) return out;
  const h = (l.size * tex) / 2 - 2;
  // A 1×1 building has room for four symbols, larger ones for nine.
  const cols = l.size === 1 ? 2 : 3;
  const shown = list.slice(0, cols * cols);
  const per = Math.ceil(Math.sqrt(shown.length));
  const inner = h - Math.min(4, h * 0.2);
  const cell = (inner * 2) / per;
  shown.forEach((draw, i) => {
    out.push({ kind: draw.kind, draw, cx: -inner + cell * ((i % per) + 0.5), cy: -inner + cell * (Math.floor(i / per) + 0.5), s: Math.min(cell * 0.4, 9) });
  });
  return out;
}

/** Draws the module symbols; with `separate`, the ones the renderer animates as sprites of their own are left out. */
function drawGlyphs(g: Graphics, l: Look, tex: number, separate: boolean): void {
  for (const p of placeGlyphs(l, tex)) {
    if (separate && ((p.kind === 'weapon' && aims(l)) || p.kind === 'wind')) continue;
    p.draw(g, p.cx, p.cy, p.kind === 'weapon' ? p.s * weaponScale(l) : p.s);
  }
}

/** A building's weapon is drawn bigger the heavier it is, so a siege gun is a real turret and not a dot. */
const weaponScale = (l: Pick<Look, 'weaponMass'>): number => 1 + 0.1 * Math.min(l.weaponMass, 14);

function drawBuilding(g: Graphics, l: Look, colour: number, tex: number, separate: boolean): void {
  if (l.shape) {
    drawShapedBuilding(g, l, l.shape, colour, tex, separate);
    return;
  }
  const h = (l.size * tex) / 2 - 2;
  plate(g, l.role, h, colour);
  if (l.armour > 0) {
    g.rect(-h + 2, -h + 2, (h - 2) * 2, (h - 2) * 2).stroke({ width: Math.min(5, 1 + l.armour), color: STEEL, alpha: 0.9 });
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
  return p ? { x: p.cx, y: p.cy, r: p.s * weaponScale(l) } : null;
}

/** The turret alone, drawn round the origin facing up (the renderer turns it): its own sprite, so it can aim. */
export function drawTurretSprite(g: Graphics, l: Look, tex: number): void {
  const a = turretAnchor(l, tex);
  if (!a) return;
  // Equal extents on every side keep the texture centred on the pivot.
  const box = a.r * 1.6;
  g.rect(-box, -box, box * 2, box * 2).fill({ color: 0, alpha: 0.001 });
  if (!l.structure) drawTurret(g, l.weapon, a.r, l.weaponMass);
  else placeGlyphs(l, tex).find((q) => q.kind === 'weapon')!.draw(g, 0, 0, a.r);
}

/** Where a building's wind turbine rotor sits, and its size; null for a class without one (or with no room to show it). */
export function windAnchor(l: Look, tex: number): { x: number; y: number; radius: number } | null {
  if (!l.structure || l.wind === 0) return null;
  const p = placeGlyphs(l, tex).find((q) => q.kind === 'wind');
  return p ? { x: p.cx, y: p.cy, radius: p.s * 1.15 } : null;
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
