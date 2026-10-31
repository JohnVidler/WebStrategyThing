import { describe, expect, it } from 'vitest';
import { barrage, EFFECT_GROUPS, spawnAll, type EffectOptions, type EffectSinks } from '../src/devEffects';

const shots: string[] = [];
const sinks = (): EffectSinks => ({ explosions: [], sparks: [], shrapnel: [], buildSparks: [], glows: [], shot: (kind) => void shots.push(kind), alwaysCrash: () => undefined, clear: () => undefined });
const options: EffectOptions = { power: 1, colour: 0x4ea1ff, radius: 1.5 };
const total = (s: EffectSinks) => s.explosions.length + s.sparks.length + s.shrapnel.length + s.buildSparks.length + s.glows.length + shots.length;

describe('dev effects catalogue', () => {
  it('has unique ids and every effect adds something', () => {
    const ids = EFFECT_GROUPS.flatMap((g) => g.effects.map((e) => e.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of EFFECT_GROUPS.flatMap((g) => g.effects)) {
      const s = sinks();
      // Fragments throw a random number (possibly none) per call: try a few times.
      for (let i = 0; i < 5; i++) e.spawn(s, 5, 5, 0, options);
      expect(total(s), e.id).toBeGreaterThan(0);
    }
  });

  it('forces the flavour of unit fire asked for', () => {
    for (const i of [0, 1, 2]) {
      const s = sinks();
      EFFECT_GROUPS[0].effects.find((e) => e.id === `fire-${i}`)!.spawn(s, 0, 0, 0, options);
      expect(s.explosions[0].variant).toBe(i);
    }
  });

  it('sizes a battery discharge by its charge', () => {
    const energy = EFFECT_GROUPS[0].effects.find((e) => e.id === 'energy')!;
    const full = sinks();
    const flat = sinks();
    energy.spawn(full, 0, 0, 0, { ...options, power: 1 });
    energy.spawn(flat, 0, 0, 0, { ...options, power: 0 });
    expect(full.explosions[0].radius).toBeGreaterThan(flat.explosions[0].radius);
  });

  it('fires each kind of hit-scan shot', () => {
    shots.length = 0;
    for (const e of EFFECT_GROUPS[1].effects) e.spawn(sinks(), 0, 0, 0, options);
    expect(new Set(shots)).toEqual(new Set(['laser', 'gun', 'flak']));
  });

  it('spawns the whole catalogue and a barrage', () => {
    const s = sinks();
    spawnAll(s, 10, 10, 0, options);
    expect(s.explosions.length).toBe(EFFECT_GROUPS[0].effects.length);
    expect(s.glows.length).toBe(EFFECT_GROUPS[3].effects.length);
    const b = sinks();
    barrage(b, 10, 10, 0, 40, 8, options);
    expect(b.explosions).toHaveLength(40);
  });
});
