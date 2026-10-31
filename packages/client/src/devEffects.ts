/*
 * Dev Options > Effects: spawns the renderer's visual effects at a tile, for looking at them without waiting for a fight.
 * Nothing is sent to the server. Only in a client built with WST_DEV_TOOLS=1 (devTools.ts is the only importer).
 * Effects tied to a live entity (tesla pulses, shield arcs, beams, missiles, headlamps) cannot be spawned here: build the
 * thing with the Spawn tab instead.
 */
import type { ShotKind } from './beams';
import { energyRadius, makeBlast, type Blast, type BlastKind } from './blasts';
import { makeBuildSparks, type BuildSparks } from './buildSparks';
import { burstSparks, type Spark } from './sparks';
import { throwShrapnel, type Shrapnel } from './shrapnel';

/** A light with no entity behind it: a soft additive glow that fades over `ms` (strongest at night). */
export interface DevGlow {
  x: number;
  y: number;
  /** Radius in tiles. */
  radius: number;
  colour: number;
  born: number;
  ms: number;
}

/** The renderer's live effect lists, as handed out by `Renderer.devSinks()`. */
export interface EffectSinks {
  explosions: Blast[];
  sparks: Spark[];
  shrapnel: Shrapnel[];
  buildSparks: BuildSparks[];
  glows: DevGlow[];
  /** A hit-scan shot between two tiles. */
  shot(kind: ShotKind, damage: number, x1: number, y1: number, x2: number, y2: number, colour: number, now: number): void;
  /** Makes every shot-down flier crash on (not just some of them) while on. */
  alwaysCrash(on: boolean): void;
  /** Drops every effect at once. */
  clear(): void;
}

/** What the panel's controls say right now. */
export interface EffectOptions {
  /** 0..1: charge of a battery discharge. */
  power: number;
  /** Colour of a shield collapse (an owner's). */
  colour: number;
  /** Blast radius in tiles. */
  radius: number;
}

export interface EffectDef {
  id: string;
  label: string;
  title: string;
  spawn(s: EffectSinks, x: number, y: number, now: number, o: EffectOptions): void;
}

export interface EffectGroup {
  title: string;
  effects: EffectDef[];
}

/** A random source whose first draw picks a given flavour of unit fire (see `makeBlast`: the variant is its first draw). */
const flavour = (index: number): (() => number) => {
  let first = true;
  return () => {
    if (!first) return Math.random();
    first = false;
    return (index + 0.5) / 3;
  };
};

const blast = (id: string, label: string, kind: BlastKind, title: string): EffectDef => ({
  id,
  label,
  title,
  spawn: (s, x, y, now, o) => {
    const power = kind === 'energy' ? o.power : 0;
    // A battery discharge grows with its charge, as in a match.
    const radius = kind === 'energy' ? energyRadius(o.radius, power) : o.radius;
    s.explosions.push(makeBlast(kind, x, y, radius, now, { power, colour: o.colour }));
  },
});

/** A unit death of one flavour (a fresh random source each time, so the pick is the only thing forced). */
const fire = (index: number, label: string, title: string): EffectDef => ({
  id: `fire-${index}`,
  label,
  title,
  spawn: (s, x, y, now, o) => void s.explosions.push(makeBlast('fire', x, y, o.radius, now, {}, flavour(index))),
});

const spark = (id: string, label: string, title: string, count: number, o: Parameters<typeof burstSparks>[5]): EffectDef => ({
  id,
  label,
  title,
  spawn: (s, x, y, now) => burstSparks(s.sparks, x, y, count, now, o),
});

/** A shot fired from 3 tiles left of the target to 3 tiles right of it, in the colour chosen. */
const shot = (id: string, label: string, title: string, kind: ShotKind, damage: number): EffectDef => ({
  id,
  label,
  title,
  spawn: (s, x, y, now, o) => s.shot(kind, damage, x - 3, y, x + 3, y, o.colour, now),
});

const glow = (id: string, label: string, title: string, colour: number, radius: number, ms: number): EffectDef => ({
  id,
  label,
  title,
  spawn: (s, x, y, now) => void s.glows.push({ x, y, radius, colour, born: now, ms }),
});

export const EFFECT_GROUPS: readonly EffectGroup[] = [
  {
    title: 'Blasts',
    effects: [
      fire(0, 'Unit: classic', 'Orange fireball with a red ring'),
      fire(1, 'Unit: flash', 'Quick, white-hot, extra sparks'),
      fire(2, 'Unit: smoulder', 'Slow, dark red, heavy smoke and chunks'),
      blast('flak', 'Flak burst', 'flak', 'Pale air-burst with thin fragments and hanging smoke'),
      blast('shell', 'Cannon shell', 'shell', 'A short sharp pop with no smoke'),
      blast('missile', 'Missile', 'missile', 'Bigger fireball, third ring, rolling smoke'),
      blast('structure', 'Building', 'structure', 'Dust cloud and a chain of secondary fireballs'),
      blast('energy', 'Battery discharge', 'energy', 'Blue-white arcs; the Charge slider sets how full the bank was'),
      blast('shield', 'Shield collapse', 'shield', 'Folds in, then a ring and shards in the chosen colour'),
    ],
  },
  {
    title: 'Shots (colour: the Shield colour setting)',
    effects: [
      shot('shot-laser', 'Laser', 'Glowing beam with muzzle bloom and a hot spot', 'laser', 8),
      shot('shot-laser-heavy', 'Laser (strong)', 'A thicker beam, as a heavy laser fires', 'laser', 20),
      shot('shot-gun', 'Light gun', 'One tracer with a muzzle flash and impact sparks', 'gun', 5),
      shot('shot-rotary', 'Rotary gun', 'Two tracers, a bigger flash', 'gun', 20),
      shot('shot-flak', 'Flak', 'A string of puffs that ends in an air-burst', 'flak', 12),
    ],
  },
  {
    title: 'Sparks and fragments',
    effects: [
      spark('spark-harvest', 'Harvest (outward)', 'Green and white sparks off a harvester', 8, { colour: 0xc8ffe6, spread: 1.1, reach: [0.25, 0.65], ms: [220, 420] }),
      spark('spark-mine', 'Harvest (inward)', 'Matter streaming into a crystal', 10, { colour: 0x7ee0b5, inward: true, reach: [0.5, 1.05], ms: [280, 520] }),
      spark('spark-break', 'Module break', 'Orange burst when a module breaks', 18, { colour: 0xffb066, reach: [0.4, 1.1], ms: [300, 650], width: 2 }),
      spark('spark-shell', 'Shell glance', 'Sparks flying off a ricochet', 7, { colour: 0xffe08a, heading: -Math.PI / 4, spread: 0.9, reach: [0.3, 0.9], ms: [180, 380], width: 2 }),
      spark('spark-shield', 'Shield hit', 'Cool white-blue sparks off an arc', 10, { colour: 0xbfe9ff, heading: -Math.PI / 2, spread: 1.3, reach: [0.2, 0.7], ms: [160, 360], width: 1.8 }),
      {
        id: 'fragments',
        label: 'Bouncing fragments',
        title: 'Glowing chunks thrown clear that come down with small blasts',
        spawn: (s, x, y, now, o) => {
          // Each hop of a fragment lands with a small blast and sparks in a match; here only the arcs are shown, so throw a handful.
          for (let i = 0; i < 3; i++) throwShrapnel(s.shrapnel, x, y, Math.max(1, o.radius), now);
        },
      },
      {
        id: 'build-sparks',
        label: 'Construction finish',
        title: 'Sparks racing out along the grid when a site completes',
        spawn: (s, x, y, now) => void s.buildSparks.push(makeBuildSparks(Math.floor(x) - 1, Math.floor(y) - 1, 3, now)),
      },
    ],
  },
  {
    title: 'Lights (best seen at night)',
    effects: [
      glow('glow-muzzle', 'Muzzle flash', 'Warm flash from a gun', 0xffd890, 1.4, 260),
      glow('glow-laser', 'Laser', 'Cool flare from a laser', 0x7fe8ff, 1.8, 320),
      glow('glow-tesla', 'Tesla', 'Violet crackle light', 0xcfa8ff, 3.2, 420),
      glow('glow-engine', 'Missile engine', 'Orange engine glow', 0xffb347, 1.6, 600),
      glow('glow-shield', 'Shield', 'Pale blue shield light', 0x9fdcff, 3.5, 700),
      glow('glow-fire', 'Fire', 'Slow warm fire light', 0xff8a30, 4, 1400),
      glow('glow-green', 'Charging pad', 'Green pulse', 0x5dff9a, 2.6, 900),
    ],
  },
];

/** Spawns each effect in turn around (x, y) so a whole catalogue can be judged side by side. */
export function spawnAll(s: EffectSinks, x: number, y: number, now: number, o: EffectOptions): void {
  const all = EFFECT_GROUPS.flatMap((g) => g.effects);
  const cols = 5;
  all.forEach((e, i) => e.spawn(s, x + (i % cols) * 4 - ((cols - 1) * 4) / 2, y + Math.floor(i / cols) * 4, now, o));
}

/** Scatters `count` blasts of random kinds over a disc of `radius` tiles: a stand-in for a big fight. */
export function barrage(s: EffectSinks, x: number, y: number, now: number, count: number, spread: number, o: EffectOptions): void {
  const blasts = EFFECT_GROUPS[0].effects;
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = Math.sqrt(Math.random()) * spread;
    const def = blasts[Math.floor(Math.random() * blasts.length)];
    def.spawn(s, x + Math.cos(a) * d, y + Math.sin(a) * d, now + Math.random() * 600, { ...o, power: Math.random() });
  }
}
