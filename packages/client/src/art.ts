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
  /** Chassis size class (units) or footprint in tiles (buildings). */
  readonly size: number;
  readonly flying: boolean;
  readonly motor: 'none' | 'small' | 'large' | 'rotor';
  readonly weapon: 'none' | 'gun' | 'cannon' | 'laser' | 'tesla' | 'missile' | 'flak';
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
  const largeMotor = parts.includes('motor.large');
  const motor = rotor ? 'rotor' : largeMotor ? 'large' : count('motor') > 0 ? 'small' : 'none';
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
    flying: rotor,
    motor,
    weapon,
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
export function drawLook(g: Graphics, look: Look, colour: number, tex: number): void {
  if (look.structure) drawBuilding(g, look, colour, tex);
  else drawUnit(g, look, colour, tex);
}

/** Unit body radius in texture pixels: the only thing the chassis decides. */
export function unitRadius(size: number, tex: number): number {
  return (0.3 + size * 0.08) * tex;
}

// --- units -------------------------------------------------------------------------

/** Hull outline in units of the body radius, facing up; null is a plain disc. */
export function hullOutline(l: Look): number[] | null {
  if (l.weapon === 'cannon') {
    // Squat tank: broad, blunt front.
    return [-0.8, -0.95, 0.8, -0.95, 1, -0.55, 1, 0.9, -1, 0.9, -1, -0.55];
  }
  if (l.weapon === 'missile') {
    // Launcher truck: a boxy bed behind a short cab.
    return [-0.6, -0.95, 0.6, -0.95, 0.6, -0.6, 1, -0.6, 1, 0.95, -1, 0.95, -1, -0.6, -0.6, -0.6];
  }
  if (l.weapon === 'laser') {
    // Swept-wing dart.
    return [0, -1.2, 0.5, -0.1, 0.95, 0.95, 0, 0.55, -0.95, 0.95, -0.5, -0.1];
  }
  if (l.weapon === 'tesla') {
    // Spiked gear.
    const pts: number[] = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2, rad = i % 2 ? 0.72 : 1.05;
      pts.push(Math.sin(a) * rad, -Math.cos(a) * rad);
    }
    return pts;
  }
  if (l.weapon === 'gun') return [0, -1.05, 0.95, 0.8, 0, 0.4, -0.95, 0.8];
  if (l.cargo > 0) {
    // Hauler: narrow cab ahead of a wide bed.
    return [-0.55, -0.95, 0.55, -0.95, 0.55, -0.5, 0.95, -0.5, 0.95, 0.95, -0.95, 0.95, -0.95, -0.5, -0.55, -0.5];
  }
  if (l.builders > 0) {
    // Dozer: a notched front edge between two blades.
    return [-0.95, -0.85, -0.35, -0.85, 0, -0.45, 0.35, -0.85, 0.95, -0.85, 0.95, 0.9, -0.95, 0.9];
  }
  if (l.flying) {
    // Quad-copter cross.
    return [-0.3, -1, 0.3, -1, 0.3, -0.3, 1, -0.3, 1, 0.3, 0.3, 0.3, 0.3, 1, -0.3, 1, -0.3, 0.3, -1, 0.3, -1, -0.3, -0.3, -0.3];
  }
  if (l.sensor === 'long') return [0, -1.1, 0.6, -0.2, 0.8, 0.5, 0.4, 0.95, -0.4, 0.95, -0.8, 0.5, -0.6, -0.2];
  if (l.sensor === 'short') return [0, -1.1, 0.7, 0, 0, 0.9, -0.7, 0];
  if (l.motor === 'none') {
    // Immobile pod.
    const pts: number[] = [];
    for (let i = 0; i < 8; i++) {
      const a = ((i + 0.5) / 8) * Math.PI * 2;
      pts.push(Math.sin(a) * 1.05, -Math.cos(a) * 1.05);
    }
    return pts;
  }
  if (l.batteries >= 2) return [-0.55, -0.95, 0.55, -0.95, 0.8, -0.6, 0.8, 0.6, 0.55, 0.95, -0.55, 0.95, -0.8, 0.6, -0.8, -0.6];
  return null;
}

function hull(g: Graphics, l: Look, r: number, colour: number): void {
  const pts = hullOutline(l);
  const shape = pts ? g.poly(pts.map((v) => v * r)) : g.circle(0, 0, r);
  shape.fill(colour).stroke({ width: 2, color: 0xffffff, alpha: 0.5 });
}

function drawUnit(g: Graphics, l: Look, colour: number, tex: number): void {
  const r = unitRadius(l.size, tex);
  // Keeps every unit of a size class the same texture box, so sprites stay centred.
  const box = r * 1.45;
  g.rect(-box, -box, box * 2, box * 2).fill({ color: 0, alpha: 0.001 });

  // Drive, underneath the hull.
  if (l.motor === 'small' || l.motor === 'large') {
    const w = l.motor === 'large' ? r * 0.42 : r * 0.26;
    const h = r * (l.motor === 'large' ? 1.7 : 1.4);
    for (const sx of [-1, 1]) {
      g.roundRect(sx * r * 0.95 - w / 2, -h / 2, w, h, 2).fill(DARK).stroke({ width: 1, color: STEEL });
      if (l.motor === 'large') for (let i = -2; i <= 2; i++) g.moveTo(sx * r * 0.95 - w / 2, i * h * 0.17).lineTo(sx * r * 0.95 + w / 2, i * h * 0.17).stroke({ width: 1, color: STEEL, alpha: 0.7 });
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
    g.roundRect(-w / 2, r * 0.35, w, r * 0.85, 2).fill(DARK).stroke({ width: 1.5, color: MATTER });
    g.moveTo(-w / 2, r * 0.77).lineTo(w / 2, r * 0.77).stroke({ width: 1, color: MATTER, alpha: 0.7 });
  }

  hull(g, l, r, colour);

  // Armour: a heavier rim, one more notch per plate.
  if (l.armour > 0) {
    const w = Math.min(6, 1.5 + l.armour * 1.5);
    const pts = hullOutline(l);
    (pts ? g.poly(pts.map((v) => v * r)) : g.circle(0, 0, r)).stroke({ width: w, color: STEEL });
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
    for (let i = 0; i < n; i++) g.rect((i - (n - 1) / 2) * r * 0.32 - r * 0.1, r * 0.55, r * 0.2, r * 0.3).fill(ENERGY);
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

  weaponTurret(g, l.weapon, r);
}

/** A weapon on a vehicle: its muzzle points up, the way units face. */
function weaponTurret(g: Graphics, kind: Look['weapon'], r: number): void {
  switch (kind) {
    case 'gun':
      g.circle(0, 0, r * 0.3).fill(DARK);
      g.rect(-1.5, -r * 1.05, 3, r * 1.05).fill(STEEL);
      break;
    case 'cannon':
      g.circle(0, 0, r * 0.42).fill(DARK).stroke({ width: 1.5, color: WARN });
      g.rect(-r * 0.16, -r * 1.2, r * 0.32, r * 1.2).fill(STEEL).stroke({ width: 1, color: DARK });
      g.rect(-r * 0.24, -r * 1.2, r * 0.48, r * 0.2).fill(WARN);
      break;
    case 'missile':
      // Two warheads on a rack, nose up.
      g.rect(-r * 0.55, -r * 0.35, r * 1.1, r * 0.9).fill(DARK).stroke({ width: 1.5, color: WARN });
      for (const x of [-r * 0.28, r * 0.28]) {
        g.rect(x - r * 0.12, -r * 0.95, r * 0.24, r * 0.9).fill(0xdfe5ee);
        g.poly([x - r * 0.12, -r * 0.95, x + r * 0.12, -r * 0.95, x, -r * 1.25]).fill(WARN);
      }
      break;
    case 'flak':
      // Twin short barrels splayed upward on a round mount.
      g.circle(0, 0, r * 0.4).fill(DARK).stroke({ width: 1.5, color: STEEL });
      for (const a of [-0.28, 0.28]) {
        g.moveTo(Math.sin(a) * r * 0.2, -Math.cos(a) * r * 0.2).lineTo(Math.sin(a) * r * 1.15, -Math.cos(a) * r * 1.15).stroke({ width: 3, color: STEEL });
      }
      break;
    case 'laser':
      g.circle(0, 0, r * 0.3).fill(DARK).stroke({ width: 1.5, color: LASER });
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

/** Small module symbols that fill a building's cells. Highest priority first. */
function glyphs(l: Look): Glyph[] {
  const out: Glyph[] = [];
  if (l.weapon !== 'none') {
    out.push((g, cx, cy, s) => {
      g.circle(cx, cy, s * 0.55).fill(DARK).stroke({ width: 1.5, color: l.weapon === 'laser' ? LASER : l.weapon === 'tesla' ? TESLA : l.weapon === 'cannon' || l.weapon === 'missile' ? WARN : STEEL });
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
    out.push((g, cx, cy, s) => {
      g.rect(cx - s * 0.8, cy - s * 0.4, s * 1.6, s * 1.1).fill(DARK).stroke({ width: 1, color: STEEL });
      g.rect(cx - s * 0.5, cy - s * 0.95, s * 0.35, s * 0.55).fill(STEEL);
      g.rect(cx + s * 0.05, cy - s * 0.1, s * 0.5, s * 0.4).fill(ENERGY);
    });
  }
  if (l.builders > 0) {
    out.push((g, cx, cy, s) => {
      g.moveTo(cx - s * 0.7, cy + s * 0.7).lineTo(cx - s * 0.1, cy - s * 0.6).lineTo(cx + s * 0.7, cy - s * 0.6).stroke({ width: 2.2, color: ENERGY });
      g.circle(cx + s * 0.7, cy - s * 0.6, 2).fill(0xffffff);
    });
  }
  if (l.solar > 0) {
    out.push((g, cx, cy, s) => {
      const n = Math.min(4, l.solar);
      for (let i = 0; i < n; i++) {
        const x = cx + (i % 2 ? 0.05 : -0.95) * s, y = cy + (i < 2 ? -0.95 : 0.05) * s;
        g.rect(x, y, s * 0.9, s * 0.9).fill(SOLAR).stroke({ width: 1, color: 0x8fb8ff, alpha: 0.8 });
      }
    });
  }
  if (l.wind > 0) {
    out.push((g, cx, cy, s) => {
      for (const a of [0, 2.1, 4.2]) g.moveTo(cx, cy).lineTo(cx + Math.sin(a) * s, cy - Math.cos(a) * s).stroke({ width: 2, color: 0xffffff });
      g.circle(cx, cy, 2).fill(DARK);
    });
  }
  if (l.chargers > 0) {
    out.push((g, cx, cy, s) => {
      g.poly([cx + s * 0.15, cy - s, cx - s * 0.6, cy + s * 0.1, cx, cy + s * 0.1, cx - s * 0.15, cy + s, cx + s * 0.6, cy - s * 0.1, cx, cy - s * 0.1]).fill(ENERGY);
    });
  }
  if (l.silos > 0) {
    out.push((g, cx, cy, s) => {
      g.circle(cx, cy, s * 0.8).fill(DARK).stroke({ width: 1.5, color: MATTER });
      g.circle(cx, cy, s * 0.35).fill(MATTER);
    });
  }
  if (l.batteries > 0) {
    out.push((g, cx, cy, s) => {
      const n = Math.min(3, l.batteries);
      for (let i = 0; i < n; i++) g.rect(cx - s * 0.9, cy + (i - (n - 1) / 2) * s * 0.62 - s * 0.2, s * 1.8, s * 0.4).fill(ENERGY);
    });
  }
  if (l.antenna !== 'none') {
    out.push((g, cx, cy, s) => {
      const arcs = l.antenna === 'large' ? 3 : l.antenna === 'medium' ? 2 : 1;
      g.moveTo(cx, cy + s * 0.9).lineTo(cx, cy - s * 0.3).stroke({ width: 1.5, color: STEEL });
      g.circle(cx, cy - s * 0.4, 2).fill(ENERGY);
      for (let i = 1; i <= arcs; i++) g.arc(cx, cy - s * 0.4, s * 0.35 * i, Math.PI * 1.2, Math.PI * 1.8).stroke({ width: 1.2, color: ENERGY });
    });
  }
  if (l.sensor !== 'none') {
    out.push((g, cx, cy, s) => {
      g.arc(cx, cy + s * 0.2, s * (l.sensor === 'long' ? 0.9 : 0.6), Math.PI * 0.1, Math.PI * 0.9).stroke({ width: 2, color: 0xffffff });
      g.moveTo(cx, cy + s * 0.2).lineTo(cx, cy - s * 0.7).stroke({ width: 1.2, color: STEEL });
    });
  }
  if (l.cpu !== 'none') {
    out.push((g, cx, cy, s) => {
      const glow = l.cpu === 'quantum' ? LASER : l.cpu === 'fast' ? ENERGY : STEEL;
      g.rect(cx - s * 0.5, cy - s * 0.5, s, s).fill(DARK).stroke({ width: 1.2, color: glow });
      for (const d of [-0.25, 0.25]) g.moveTo(cx + d * s, cy - s * 0.5).lineTo(cx + d * s, cy - s * 0.8).moveTo(cx + d * s, cy + s * 0.5).lineTo(cx + d * s, cy + s * 0.8).stroke({ width: 1, color: glow });
    });
  }
  return out;
}

function drawBuilding(g: Graphics, l: Look, colour: number, tex: number): void {
  const h = (l.size * tex) / 2 - 2;
  plate(g, l.role, h, colour);
  if (l.armour > 0) {
    g.rect(-h + 2, -h + 2, (h - 2) * 2, (h - 2) * 2).stroke({ width: Math.min(5, 1 + l.armour), color: STEEL, alpha: 0.9 });
  }
  const list = glyphs(l);
  if (list.length === 0) return;
  // A 1×1 building has room for four symbols, larger ones for nine.
  const cols = l.size === 1 ? 2 : 3;
  const shown = list.slice(0, cols * cols);
  const per = Math.ceil(Math.sqrt(shown.length));
  const inner = h - Math.min(4, h * 0.2);
  const cell = (inner * 2) / per;
  shown.forEach((draw, i) => {
    const cx = -inner + cell * ((i % per) + 0.5);
    const cy = -inner + cell * (Math.floor(i / per) + 0.5);
    draw(g, cx, cy, Math.min(cell * 0.4, 9));
  });
}
