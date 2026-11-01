import { PARTS } from '@wst/engine';
import type { Graphics } from 'pixi.js';
import { ARC_REACH, drawDischarge, makeDischarge, type Hop } from './discharge';

/**
 * Blasts: what a death, a shell, a missile, a collapsing building, a bursting battery bank or a failing shield looks like.
 * Each kind has its own palette, timing and parts; `fire` (units) has three flavours picked at random so a battlefield is
 * not all one blast. Positions and radii are in tiles. A blast is rolled once (`makeBlast`) and drawn each frame (`drawBlast`).
 */
export type BlastKind = 'fire' | 'shell' | 'flak' | 'missile' | 'structure' | 'energy' | 'shield';

/** One flying piece of a blast; angle and speed are fixed when it spawns. */
interface Frag {
  angle: number;
  /** Distance travelled by the end, in blast radii. */
  reach: number;
  size: number;
}

/** A secondary fireball inside a collapsing building. */
interface Pop {
  angle: number;
  /** Distance from the centre, in blast radii. */
  dist: number;
  size: number;
  /** When it goes off, as a share of the blast's life. */
  delay: number;
}

interface Palette {
  ring: number;
  body: number;
  core: number;
  spark: number;
  sparkCool: number;
  /** Colour and size (in radii) of the light it throws at night. */
  light: number;
}

export interface Blast {
  kind: BlastKind;
  /** 0 to 2 for `fire`; 0 otherwise. */
  variant: number;
  x: number;
  y: number;
  radius: number;
  born: number;
  /** Bigger blasts last longer. */
  ms: number;
  /** 0..1: how much a battery held, or how hard a shield was hit. */
  power: number;
  /** Colour of the shield (its owner's) in a `shield` blast. */
  colour: number;
  palette: Palette;
  /** How far the night light reaches, in radii. */
  lightScale: number;
  sparks: Frag[];
  debris: Frag[];
  smoke: Frag[];
  pops: Pop[];
  /** Charge jumping out from the centre (`energy` and `shield`), in tiles. */
  discharge: Hop[];
}

export interface BlastOptions {
  /** Where units and buildings stand near the blast, as a flat list of x, y pairs (tiles): a discharge prefers to jump to these. */
  targets?: ArrayLike<number>;
  /** Energy held (0..1) for `energy`; ignored elsewhere. */
  power?: number;
  /** Shield colour for `shield`. */
  colour?: number;
}

export const BLAST_MS = 600;
/** Extra lifetime per tile of blast radius, so a building's blast lingers longer than a unit's. */
export const BLAST_MS_PER_TILE = 260;

const FIRE_PALETTES: Palette[] = [
  { ring: 0xff3b30, body: 0xff8a1f, core: 0xffd36a, spark: 0xfff2a0, sparkCool: 0xff9a2e, light: 0xff9a3c },
  { ring: 0xffb347, body: 0xffc04a, core: 0xffffff, spark: 0xffffff, sparkCool: 0xffd36a, light: 0xffd27a },
  { ring: 0xb02a20, body: 0xd9501a, core: 0xff9a2e, spark: 0xffc070, sparkCool: 0xd9501a, light: 0xff6a2a },
];
const SHELL_PALETTE: Palette = { ring: 0xffe9a8, body: 0xffb347, core: 0xfff7d6, spark: 0xffe08a, sparkCool: 0xffb347, light: 0xffc060 };
const FLAK_PALETTE: Palette = { ring: 0xe8edf5, body: 0xffb060, core: 0xfff0d0, spark: 0xffffff, sparkCool: 0xffc890, light: 0xffd8a0 };
const MISSILE_PALETTE: Palette = { ring: 0xffd27a, body: 0xff7a1a, core: 0xfff2c0, spark: 0xfff2a0, sparkCool: 0xff7a1a, light: 0xffa040 };
const STRUCTURE_PALETTE: Palette = { ring: 0xff5a2a, body: 0xff7a1a, core: 0xffd36a, spark: 0xffe08a, sparkCool: 0xff7a1a, light: 0xff8a30 };
const ENERGY_PALETTE: Palette = { ring: 0x7fd8ff, body: 0x4fb4ff, core: 0xf3fbff, spark: 0xffffff, sparkCool: 0x7fd8ff, light: 0x8fd8ff };
const SHIELD_PALETTE: Palette = { ring: 0x8fd0ff, body: 0x6ab8ff, core: 0xffffff, spark: 0xffffff, sparkCool: 0x8fd0ff, light: 0x9fdcff };

const DUST = 0xb59a72;
const SMOKE = 0x2a2d33;
/** How often (ms) the crackle of an electric blast re-rolls. */
const FLICKER_MS = 55;

/** Cheap deterministic noise in [-1, 1) from three integers, so a bolt's shape is stable within one flicker frame. */
export const noise = (a: number, b: number, c: number): number => {
  let h = Math.imul(a + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35) ^ Math.imul(c + 0x1b873593, 0x27d4eb2f);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  return ((h ^ (h >>> 13)) >>> 0) / 2147483648 - 1;
};

/**
 * True if batteries are the majority of a design's modules (the frame or chassis is not counted): its building bursts as a
 * discharge, not as plain fire. A building that merely carries a battery among other things burns normally.
 */
export function hasBatteryPart(parts: readonly string[]): boolean {
  let modules = 0;
  let batteries = 0;
  for (const id of parts) {
    const slot = PARTS[id]?.slot;
    if (slot === undefined || slot === 'chassis') continue;
    modules++;
    if (slot === 'battery') batteries++;
  }
  return batteries * 2 > modules;
}

/** The radius (tiles) of a discharge: a flat bank is a pop, a full big one is a large blast. */
export function energyRadius(footprint: number, power: number): number {
  return Math.max(0.5, footprint * (0.5 + 0.7 * power));
}

/** The radius (tiles) of a collapsing shield, from the energy capacity of its owner. */
export function shieldRadius(capacity: number): number {
  return Math.min(4.5, 0.8 + capacity / 1500);
}

/** Rolls the random pieces of one blast; bigger blasts throw more of them. */
export function makeBlast(kind: BlastKind, x: number, y: number, radius: number, born: number, o: BlastOptions = {}, rand: () => number = Math.random): Blast {
  const frags = (n: number, reach: [number, number], size: [number, number]): Frag[] =>
    Array.from({ length: n }, () => ({
      angle: rand() * Math.PI * 2,
      reach: reach[0] + rand() * (reach[1] - reach[0]),
      size: size[0] + rand() * (size[1] - size[0]),
    }));
  const big = Math.min(3, radius);
  const power = Math.max(0, Math.min(1, o.power ?? 0));
  const variant = kind === 'fire' ? Math.floor(rand() * FIRE_PALETTES.length) : 0;
  const b: Blast = {
    kind,
    variant,
    x,
    y,
    radius,
    born,
    ms: BLAST_MS + BLAST_MS_PER_TILE * radius,
    power,
    colour: o.colour ?? SHIELD_PALETTE.ring,
    palette: FIRE_PALETTES[variant],
    lightScale: 3.4,
    sparks: [],
    debris: [],
    smoke: [],
    pops: [],
    discharge: [],
  };
  switch (kind) {
    case 'fire':
      // Flash: quick, bright, many sparks, little smoke. Smouldering: slow, dark, lots of smoke and chunks.
      b.ms *= variant === 1 ? 0.8 : variant === 2 ? 1.25 : 1;
      b.sparks = frags(Math.round((10 + big * 6) * (variant === 1 ? 1.5 : 1)), [1.1, 2.2], [1.5, 2.5]);
      b.debris = frags(Math.round((4 + big * 3) * (variant === 2 ? 1.5 : 1)), [0.8, 1.7], [1.5, 3.5]);
      b.smoke = frags(Math.round((3 + big * 2) * (variant === 1 ? 0.5 : variant === 2 ? 2 : 1)), [0.1, 0.7], [0.3, 0.5]);
      break;
    case 'shell':
      // A short sharp pop: no smoke, a handful of fast sparks.
      b.palette = SHELL_PALETTE;
      b.ms = 360 + 160 * radius;
      b.sparks = frags(Math.round(5 + big * 3), [0.9, 1.8], [1.2, 2]);
      b.lightScale = 2.4;
      break;
    case 'flak':
      // An air-burst: a pale flash, a ring of fast thin fragments and a puff of grey smoke that hangs in the air.
      b.palette = FLAK_PALETTE;
      b.ms = 480 + 140 * radius;
      b.sparks = frags(Math.round(14 + big * 4), [1.2, 2.4], [0.9, 1.5]);
      b.smoke = frags(Math.round(5 + big * 2), [0.1, 0.6], [0.35, 0.55]);
      b.lightScale = 3;
      break;
    case 'missile':
      b.palette = MISSILE_PALETTE;
      b.ms *= 1.15;
      b.sparks = frags(Math.round(14 + big * 7), [1.2, 2.4], [1.5, 2.8]);
      b.debris = frags(Math.round(5 + big * 3), [0.9, 1.8], [1.5, 3.5]);
      b.smoke = frags(Math.round(5 + big * 3), [0.2, 0.9], [0.35, 0.6]);
      b.lightScale = 4;
      break;
    case 'structure': {
      // Several fireballs go off one after another inside a rising cloud of dust and smoke.
      b.palette = STRUCTURE_PALETTE;
      b.ms *= 1.5;
      b.sparks = frags(Math.round(12 + big * 6), [0.9, 2], [1.5, 2.5]);
      b.debris = frags(Math.round(8 + big * 4), [0.7, 1.6], [2, 4.5]);
      b.smoke = frags(Math.round(6 + big * 3), [0.2, 0.9], [0.4, 0.7]);
      const pops = Math.round(3 + big * 2);
      for (let i = 0; i < pops; i++) {
        b.pops.push({ angle: rand() * Math.PI * 2, dist: 0.15 + rand() * 0.7, size: 0.28 + rand() * 0.22, delay: 0.04 + rand() * 0.4 });
      }
      b.lightScale = 3.8;
      break;
    }
    case 'energy': {
      // The charge held comes out at once: arcs, a blue-white ring and almost no fire.
      b.palette = ENERGY_PALETTE;
      b.ms = 520 + 300 * radius * (0.4 + 0.6 * power);
      b.sparks = frags(Math.round(8 + power * 16), [0.9, 2.1], [1.2, 2.2]);
      b.discharge = makeDischarge(x, y, radius * (1.2 + 0.8 * power) * ARC_REACH, o.targets ?? [], Math.round(4 + power * 5), rand, { maxHops: Math.round(4 + power * 2) });
      b.lightScale = 3 + 2 * power;
      break;
    }
    case 'shield': {
      // The field folds in, then the emitter sheds shards of it: chips of the shield's colour with a few arcs.
      b.palette = SHIELD_PALETTE;
      b.ms = 750 + 280 * radius;
      b.sparks = frags(Math.round(10 + big * 4), [1, 2.2], [1.2, 2]);
      b.debris = frags(Math.round(8 + big * 4), [0.8, 1.9], [0.8, 1.6]);
      b.discharge = makeDischarge(x, y, radius * 1.3 * ARC_REACH, o.targets ?? [], Math.round(3 + big), rand, { maxHops: 4 });
      b.lightScale = 3.6;
      break;
    }
  }
  return b;
}

/** Draws one blast at time `now`; `still` freezes the electric flicker (Reduce motion). */
export function drawBlast(g: Graphics, b: Blast, now: number, offX: number, offY: number, scale: number, still = false): void {
  const t = (now - b.born) / b.ms;
  if (t < 0 || t >= 1) return;
  const cx = offX + b.x * scale;
  const cy = offY + b.y * scale;
  const R = b.radius * scale;
  switch (b.kind) {
    case 'energy':
      drawEnergy(g, b, t, cx, cy, R, scale, still ? 0 : Math.floor((now - b.born) / FLICKER_MS));
      break;
    case 'shield':
      drawShieldBurst(g, b, t, cx, cy, R, scale, still ? 0 : Math.floor((now - b.born) / FLICKER_MS));
      break;
    default:
      drawFire(g, b, t, cx, cy, R);
  }
}

/** Flash, fireball, shockwaves, sparks, debris and smoke (and, for buildings, a dust cloud and staggered pops); every motion eases out. */
function drawFire(g: Graphics, b: Blast, t: number, cx: number, cy: number, R: number): void {
  const p = b.palette;
  const out = 1 - (1 - t) ** 3;
  const shell = b.kind === 'shell';
  const structure = b.kind === 'structure';
  const missile = b.kind === 'missile';

  // Light: a bright flash in the first moments, then a warm glow that fades with the fireball.
  const flash = Math.max(0, 1 - t / (shell ? 0.3 : 0.2));
  if (flash > 0) {
    g.circle(cx, cy, R * 2.6).fill({ color: p.ring, alpha: 0.14 * flash });
    g.circle(cx, cy, R * 1.7).fill({ color: p.core, alpha: 0.3 * flash });
    g.circle(cx, cy, R * 0.9).fill({ color: 0xffffff, alpha: 0.85 * flash });
  }
  const glow = (1 - t) ** 2;
  g.circle(cx, cy, R * 2.2).fill({ color: p.body, alpha: 0.1 * glow });
  g.circle(cx, cy, R * 1.4).fill({ color: p.body, alpha: 0.14 * glow });

  // A collapsing building throws up a low dust cloud that spreads along the ground.
  if (structure) {
    const dustT = Math.max(0, (t - 0.05) / 0.95);
    const ease = 1 - (1 - dustT) ** 2;
    for (const f of b.smoke) {
      const d = R * f.reach * 1.1 * ease;
      g.circle(cx + Math.cos(f.angle) * d, cy + Math.sin(f.angle) * d * 0.8, R * f.size * (0.6 + 1.1 * ease)).fill({ color: DUST, alpha: 0.28 * (1 - dustT) });
    }
  }

  // Smoke: dark puffs that drift up and swell once the fireball dies back (none from a shell).
  const smokeT = Math.max(0, (t - 0.15) / 0.85);
  if (smokeT > 0 && !shell) {
    const ease = 1 - (1 - smokeT) ** 2;
    const rise = missile || structure ? 1.1 : 0.6;
    for (const f of b.smoke) {
      const d = R * f.reach * ease;
      const px = cx + Math.cos(f.angle) * d;
      const py = cy + Math.sin(f.angle) * d - R * rise * ease;
      g.circle(px, py, R * f.size * (0.5 + ease)).fill({ color: SMOKE, alpha: (b.variant === 2 ? 0.55 : 0.4) * (1 - smokeT) });
    }
  }

  // Secondary fireballs: each flares, swells and dies in a third of the blast's life.
  for (const pop of b.pops) {
    const pt = (t - pop.delay) / 0.35;
    if (pt <= 0 || pt >= 1) continue;
    const px = cx + Math.cos(pop.angle) * R * pop.dist;
    const py = cy + Math.sin(pop.angle) * R * pop.dist;
    const pr = R * pop.size * (0.4 + 0.9 * (1 - (1 - pt) ** 2));
    g.circle(px, py, pr * 1.5).fill({ color: p.ring, alpha: 0.2 * (1 - pt) });
    g.circle(px, py, pr).fill({ color: p.body, alpha: 0.7 * (1 - pt) });
    g.circle(px, py, pr * 0.55).fill({ color: pt < 0.3 ? 0xffffff : p.core, alpha: 0.9 * (1 - pt) });
  }

  // Fireball: hot core inside a coloured body, shrinking in brightness as it grows.
  const body = R * (0.25 + 0.55 * out);
  g.circle(cx, cy, body).fill({ color: p.body, alpha: 0.55 * (1 - t) });
  g.circle(cx, cy, body * 0.6).fill({ color: p.core, alpha: 0.7 * (1 - t) ** 1.5 });

  // Shockwaves: the coloured ring, plus a thin fast white one ahead of it (a missile's is wider and has a third, fainter one).
  g.circle(cx, cy, R * (0.2 + 0.8 * out)).fill({ color: p.ring, alpha: 0.2 * (1 - t) });
  g.circle(cx, cy, R * (0.2 + 0.8 * out)).stroke({ width: shell ? 1.5 : 3, color: p.ring, alpha: 1 - t });
  g.circle(cx, cy, R * (0.3 + 1.2 * out)).stroke({ width: 1.5, color: 0xffffff, alpha: 0.6 * (1 - t) ** 2 });
  if (missile) g.circle(cx, cy, R * (0.4 + 1.8 * out)).stroke({ width: 1, color: p.ring, alpha: 0.4 * (1 - t) ** 2 });

  // Sparks: bright streaks flung outwards, cooling as they go.
  for (const f of b.sparks) {
    const head = R * f.reach * out;
    const tail = R * f.reach * Math.max(0, out - 0.18);
    const cos = Math.cos(f.angle);
    const sin = Math.sin(f.angle);
    g.moveTo(cx + cos * tail, cy + sin * tail)
      .lineTo(cx + cos * head, cy + sin * head)
      .stroke({ width: f.size, color: t < 0.4 ? p.spark : p.sparkCool, alpha: (1 - t) ** 1.5 });
  }

  // Debris: dark chunks that arc outwards and fall back under gravity.
  for (const f of b.debris) {
    const d = R * f.reach * out;
    const px = cx + Math.cos(f.angle) * d;
    const py = cy + Math.sin(f.angle) * d + R * 0.5 * t * t;
    g.circle(px, py, f.size).fill({ color: t < 0.3 ? 0xffb347 : 0x3b3f47, alpha: 1 - t * t });
  }
}

/** A battery bank discharging: a blue-white flash, a ring of charge racing out, and arcs that crackle; no smoke. */
function drawEnergy(g: Graphics, b: Blast, t: number, cx: number, cy: number, R: number, scale: number, frame: number): void {
  const p = b.palette;
  const out = 1 - (1 - t) ** 3;
  const fade = 1 - t;
  const flash = Math.max(0, 1 - t / 0.22);
  if (flash > 0) {
    g.circle(cx, cy, R * 2.4).fill({ color: p.body, alpha: 0.16 * flash });
    g.circle(cx, cy, R * 1.5).fill({ color: p.ring, alpha: 0.3 * flash });
    g.circle(cx, cy, R * 0.8).fill({ color: 0xffffff, alpha: 0.9 * flash });
  }
  // A cold glow that lingers while the charge drains away.
  g.circle(cx, cy, R * 1.6).fill({ color: p.body, alpha: 0.1 * (1 - t) ** 2 });
  g.circle(cx, cy, R * (0.15 + 0.35 * out)).fill({ color: p.core, alpha: 0.75 * fade ** 2 });

  // Two rings of charge, the outer one thin and fast; beads ride the inner one.
  const ring = R * (0.2 + 0.9 * out);
  g.circle(cx, cy, ring).stroke({ width: 3, color: p.ring, alpha: fade });
  g.circle(cx, cy, R * (0.3 + 1.5 * out)).stroke({ width: 1.2, color: 0xffffff, alpha: 0.6 * fade ** 2 });
  const beads = 12;
  for (let i = 0; i < beads; i++) {
    const a = (i / beads) * Math.PI * 2 + noise(b.discharge[0]?.seed ?? 1, i, frame) * 0.12;
    g.circle(cx + Math.cos(a) * ring, cy + Math.sin(a) * ring, Math.max(1.2, scale * 0.05)).fill({ color: 0xffffff, alpha: fade });
  }

  // The charge jumps outwards from point to point, each hop flashing and fading in turn.
  drawDischarge(g, b.discharge, t, p.ring, 0xf3fbff, frame, cx - b.x * scale, cy - b.y * scale, scale);

  for (const f of b.sparks) {
    const head = R * f.reach * out;
    const tail = R * f.reach * Math.max(0, out - 0.2);
    const cos = Math.cos(f.angle);
    const sin = Math.sin(f.angle);
    g.moveTo(cx + cos * tail, cy + sin * tail)
      .lineTo(cx + cos * head, cy + sin * head)
      .stroke({ width: f.size, color: t < 0.5 ? p.spark : p.sparkCool, alpha: fade ** 1.5 });
  }
}

/** The share of a failing shield's life spent folding in, before it goes out. */
export const SHIELD_IMPLODE = 0.22;

/** A shield failing: the field folds in on its emitter, then goes out in a ring of the owner's colour and flying shards of it. */
function drawShieldBurst(g: Graphics, b: Blast, t: number, cx: number, cy: number, R: number, scale: number, frame: number): void {
  const p = b.palette;
  const IMPLODE = SHIELD_IMPLODE;
  if (t < IMPLODE) {
    // Everything is drawn in: a ring shrinking to a point, with streaks racing inwards.
    const k = t / IMPLODE;
    const r = R * (1.4 - 1.2 * k * k);
    g.circle(cx, cy, r).stroke({ width: 2.5, color: b.colour, alpha: 0.35 + 0.65 * k });
    g.circle(cx, cy, r * 0.8).stroke({ width: 1, color: 0xffffff, alpha: 0.5 * k });
    g.circle(cx, cy, R * (0.1 + 0.25 * k)).fill({ color: p.core, alpha: 0.4 + 0.5 * k });
    for (const f of b.sparks) {
      const head = r * (1 - 0.15 * k);
      const tail = r * (1 + 0.3 * (1 - k));
      const cos = Math.cos(f.angle);
      const sin = Math.sin(f.angle);
      g.moveTo(cx + cos * tail, cy + sin * tail).lineTo(cx + cos * head, cy + sin * head).stroke({ width: 1.2, color: p.spark, alpha: 0.7 * k });
    }
    return;
  }
  const u = (t - IMPLODE) / (1 - IMPLODE);
  const out = 1 - (1 - u) ** 3;
  const fade = 1 - u;
  const flash = Math.max(0, 1 - u / 0.2);
  if (flash > 0) {
    g.circle(cx, cy, R * 2.2).fill({ color: b.colour, alpha: 0.2 * flash });
    g.circle(cx, cy, R * 1.1).fill({ color: 0xffffff, alpha: 0.85 * flash });
  }
  g.circle(cx, cy, R * 1.5).fill({ color: b.colour, alpha: 0.08 * fade ** 2 });
  // Shockwave: a thick ring in the shield's colour, a thin white one ahead of it, and a faint disc between.
  g.circle(cx, cy, R * (0.2 + 1.1 * out)).fill({ color: b.colour, alpha: 0.12 * fade });
  g.circle(cx, cy, R * (0.2 + 1.1 * out)).stroke({ width: 3.5, color: b.colour, alpha: fade });
  g.circle(cx, cy, R * (0.3 + 1.7 * out)).stroke({ width: 1.2, color: 0xffffff, alpha: 0.6 * fade ** 2 });

  // Shards: short bright chips of the field that spin as they fly.
  for (let i = 0; i < b.debris.length; i++) {
    const f = b.debris[i];
    const d = R * f.reach * out;
    const px = cx + Math.cos(f.angle) * d;
    const py = cy + Math.sin(f.angle) * d;
    const spin = f.angle + u * (i % 2 === 0 ? 5 : -5);
    const len = Math.max(3, scale * 0.1) * f.size * 2.2;
    g.moveTo(px - Math.cos(spin) * len, py - Math.sin(spin) * len)
      .lineTo(px + Math.cos(spin) * len, py + Math.sin(spin) * len)
      .stroke({ width: 1.6, color: i % 3 === 0 ? 0xffffff : b.colour, alpha: fade ** 1.2 });
  }
  // The emitter's discharge: a few arcs that jump outwards.
  drawDischarge(g, b.discharge, u, b.colour, 0xffffff, frame, cx - b.x * scale, cy - b.y * scale, scale);
  for (const f of b.sparks) {
    const head = R * f.reach * out;
    const tail = R * f.reach * Math.max(0, out - 0.18);
    const cos = Math.cos(f.angle);
    const sin = Math.sin(f.angle);
    g.moveTo(cx + cos * tail, cy + sin * tail)
      .lineTo(cx + cos * head, cy + sin * head)
      .stroke({ width: f.size, color: u < 0.4 ? p.spark : p.sparkCool, alpha: fade ** 1.5 });
  }
}
