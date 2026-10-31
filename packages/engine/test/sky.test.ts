import { describe, expect, it } from 'vitest';
import { HAZE_MIN_SIGHT, LIGHTNING_STUN_TICKS, RAIN_SOLAR_CAP, RAIN_WIND_FLOOR, SKY_COUNT, SKY_DEV_RAMP_TICKS, SKY_RAMP_MAX_TICKS, SKY_RAMP_MIN_TICKS, skyRampTicks, SKY_SLOT_TICKS, STORM_SOLAR_CAP, STORM_WIND_FLOOR, Sky, Simulation, Weather, skyKind, strikeAt, strikeIsAimed, strikeSpot, visionAt, HEAT_SOLAR_GAIN, HEAT_WIND_CEILING } from '../src';
import { lightningSystem } from '../src/game/systems';

/** First slot (from `from`) of the given kind whose neighbours are dry, so its edges slide from and to clear weather. */
function isolatedSlot(seed: number, kind: number, from = 1): number {
  for (let s = from; s < 8000; s++) {
    if (skyKind(seed, s * SKY_SLOT_TICKS) === kind && skyKind(seed, (s - 1) * SKY_SLOT_TICKS) === Sky.Dry && skyKind(seed, (s + 1) * SKY_SLOT_TICKS) === Sky.Dry) return s * SKY_SLOT_TICKS;
  }
  throw new Error('none found');
}

const at = (w: Weather, seed: number, tick: number): Weather => {
  w.update(seed, tick);
  return w;
};

describe('weather', () => {
  it('is rare, and each kind turns up, the rarer ones less often', () => {
    const counts = new Array(SKY_COUNT).fill(0);
    for (let s = 0; s < 6000; s++) counts[skyKind(7, s * SKY_SLOT_TICKS)]++;
    for (let k = 1; k < SKY_COUNT; k++) expect(counts[k]).toBeGreaterThan(0);
    expect(counts[Sky.Rain]).toBeGreaterThan(counts[Sky.Storm]);
    expect(counts[Sky.Dry] / 6000).toBeGreaterThan(0.7);
  });

  it('does not change from one run to the next, and the mix always adds up to 100', () => {
    const a = new Weather();
    const b = new Weather();
    for (let t = 0; t < 30000; t += 37) {
      at(a, 3, t);
      at(b, 3, t);
      expect([...a.mix]).toEqual([...b.mix]);
      expect(a.mix.reduce((x, y) => x + y, 0)).toBe(100);
      expect(a.strength).toBe(100 - a.mix[Sky.Dry]);
    }
  });

  it('leaves the sun and wind alone when dry', () => {
    const w = new Weather();
    for (let s = 1; s < 50; s++) {
      if (skyKind(11, s * SKY_SLOT_TICKS) !== Sky.Dry || skyKind(11, (s - 1) * SKY_SLOT_TICKS) !== Sky.Dry) continue;
      at(w, 11, s * SKY_SLOT_TICKS + 100);
      expect(w.kind).toBe(Sky.Dry);
      expect(w.solar(73)).toBe(73);
      expect(w.windy(12)).toBe(12);
      expect(w.haze).toBe(0);
      return;
    }
    throw new Error('no dry slot');
  });

  it('slides in linearly at the start of a spell, then holds', () => {
    const w = new Weather();
    const rain = isolatedSlot(5, Sky.Rain);
    at(w, 5, rain - 1);
    expect(w.kind).toBe(Sky.Dry);
    let last = 100;
    for (let f = 0; f < skyRampTicks(5, rain / SKY_SLOT_TICKS); f++) {
      at(w, 5, rain + f);
      expect(w.solarCap).toBeLessThanOrEqual(last);
      expect(w.windFloor).toBeGreaterThanOrEqual(0);
      last = w.solarCap;
    }
    expect(at(w, 5, rain).solarCap).toBeGreaterThan(RAIN_SOLAR_CAP + 30);
    at(w, 5, rain + SKY_RAMP_MAX_TICKS);
    expect(w.solarCap).toBe(RAIN_SOLAR_CAP);
    expect(w.windFloor).toBe(RAIN_WIND_FLOOR);
    expect(w.kind).toBe(Sky.Rain);
    // And it clears the same way at the start of the dry slot after.
    at(w, 5, rain + SKY_SLOT_TICKS + 1);
    expect(w.mix[Sky.Rain]).toBeGreaterThan(80);
    at(w, 5, rain + SKY_SLOT_TICKS + skyRampTicks(5, rain / SKY_SLOT_TICKS + 1));
    expect(w.mix[Sky.Dry]).toBe(100);
  });

  it('cuts the sun and lifts the wind more in a storm than in rain', () => {
    const w = new Weather();
    const storm = isolatedSlot(5, Sky.Storm);
    at(w, 5, storm + SKY_RAMP_MAX_TICKS);
    expect(w.solarCap).toBe(STORM_SOLAR_CAP);
    expect(w.windFloor).toBe(STORM_WIND_FLOOR);
    expect(STORM_SOLAR_CAP).toBeLessThan(RAIN_SOLAR_CAP);
    expect(w.solar(100)).toBe(STORM_SOLAR_CAP);
    expect(w.windy(10)).toBe(STORM_WIND_FLOOR);
    expect(w.windy(90)).toBe(90);
  });

  it('has a heatwave that adds to the sun and holds the wind down, and dust and mist that shrink sight', () => {
    const w = new Weather();
    at(w, 9, isolatedSlot(9, Sky.Heat) + SKY_RAMP_MAX_TICKS);
    expect(w.solar(100)).toBe(HEAT_SOLAR_GAIN);
    expect(w.solar(40)).toBe(50);
    expect(w.windy(90)).toBe(HEAT_WIND_CEILING);
    expect(w.windy(10)).toBe(10);
    for (const kind of [Sky.Dust, Sky.Mist]) {
      at(w, 9, isolatedSlot(9, kind) + SKY_RAMP_MAX_TICKS);
      expect(w.haze).toBeGreaterThanOrEqual(40);
      expect(w.kind).toBe(kind);
    }
  });

  it('shrinks sight with haze, but never below a couple of tiles', () => {
    const sim = new Simulation({ width: 16, height: 16, seed: 5 });
    const s = sim.stats(sim.spawnStructure(sim.blueprints.define(1, 'Hut', ['frame.small', 'battery.cell']), 2, 2));
    const clear = visionAt(s, 100, 0);
    expect(visionAt(s, 100, 55)).toBeLessThan(clear);
    expect(visionAt(s, 100, 100)).toBeLessThan(visionAt(s, 100, 55));
    expect(visionAt(s, 100, 100)).toBeGreaterThanOrEqual(Math.min(clear, HAZE_MIN_SIGHT));
    expect(visionAt(s, 100, 0)).toBe(clear);
  });

  it('is scaled by the dev intensity, and slides when the dev tools force a different sky', () => {
    const w = new Weather();
    const storm = isolatedSlot(5, Sky.Storm);
    at(w, 5, storm + SKY_RAMP_MAX_TICKS);
    w.setDev(-1, 50, storm + SKY_RAMP_MAX_TICKS);
    at(w, 5, storm + SKY_RAMP_MAX_TICKS);
    expect(w.mix[Sky.Storm]).toBe(50);
    expect(w.solarCap).toBe(100 - (100 - STORM_SOLAR_CAP) / 2);
    w.setDev(-1, 0, storm + SKY_RAMP_MAX_TICKS);
    expect(at(w, 5, storm + SKY_RAMP_MAX_TICKS).solarCap).toBe(100);
    // Forcing a kind slides from what was showing.
    const t = storm + SKY_RAMP_MAX_TICKS;
    w.setDev(Sky.Mist, -1, t);
    at(w, 5, t);
    const first = w.mix[Sky.Mist];
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(100);
    at(w, 5, t + SKY_DEV_RAMP_TICKS);
    expect(w.mix[Sky.Mist]).toBe(100);
    expect(w.kind).toBe(Sky.Mist);
    w.setDev(-1, -1, t + SKY_DEV_RAMP_TICKS);
    expect(w.intensity).toBe(100);
  });

  it('throws lightning only in a storm, and some of it picks out a unit', () => {
    const w = new Weather();
    let strikes = 0;
    let aimed = 0;
    for (let t = 0; t < 400 * SKY_SLOT_TICKS; t += 1) {
      at(w, 9, t);
      const s = w.lightning(9, t);
      if (s === 0) continue;
      expect(w.mix[Sky.Storm]).toBeGreaterThanOrEqual(50);
      strikes++;
      if (strikeIsAimed(s)) aimed++;
      const spot = strikeSpot(s, 40, 30);
      expect(spot.x).toBeGreaterThanOrEqual(0);
      expect(spot.x).toBeLessThan(40);
      expect(spot.y).toBeLessThan(30);
    }
    expect(strikes).toBeGreaterThan(5);
    expect(aimed).toBeGreaterThan(0);
    expect(aimed).toBeLessThan(strikes);
  });

  it('stuns a unit that lightning picks out, for a short while', () => {
    const sim = new Simulation({ width: 16, height: 16, seed: 5 });
    const hut = sim.spawnStructure(sim.blueprints.define(1, 'Hut', ['frame.small', 'battery.cell']), 2, 2);
    const base = SKY_DEV_RAMP_TICKS + 10;
    sim.weather.setDev(Sky.Storm, -1, 0);
    let tick = base;
    while (!(strikeAt(5, tick) && strikeIsAimed(strikeAt(5, tick)))) tick++;
    sim.tick = tick;
    sim.spatial.rebuild(sim.pos.f.x, sim.pos.f.y, sim.pos.dense, sim.world.capacity);
    expect(sim.stunUntil[hut] ?? 0).toBeLessThanOrEqual(tick);
    lightningSystem(sim);
    expect(sim.stunUntil[hut]).toBe(tick + LIGHTNING_STUN_TICKS);
    expect(sim.events).toContain(14);
  });

  it('is held back in the simulation, but not for a fixed sun level or wind level', () => {
    const sim = new Simulation({ width: 16, height: 16, seed: 5 });
    sim.tick = isolatedSlot(5, Sky.Rain) + SKY_RAMP_MAX_TICKS;
    sim.devSun = 100;
    expect(sim.solarNow()).toBe(100);
    sim.devSun = -1;
    expect(sim.solarNow()).toBeLessThanOrEqual(RAIN_SOLAR_CAP);
    expect(sim.windNow()).toBeGreaterThanOrEqual(RAIN_WIND_FLOOR);
    sim.devWind = 3;
    expect(sim.windNow()).toBe(3);
  });

  it('changes at a pace that varies from spell to spell, between the tunable limits, and can be set by the dev tools', () => {
    const lengths = new Set<number>();
    for (let slot = 0; slot < 300; slot++) {
      const n = skyRampTicks(5, slot);
      expect(n).toBeGreaterThanOrEqual(SKY_RAMP_MIN_TICKS);
      expect(n).toBeLessThanOrEqual(SKY_RAMP_MAX_TICKS);
      lengths.add(n);
    }
    expect(lengths.size).toBeGreaterThan(50);
    expect(SKY_RAMP_MAX_TICKS).toBeLessThan(SKY_SLOT_TICKS);
    // A slow spell is still only half in when a quick one is fully in.
    const w = new Weather();
    const rain = isolatedSlot(5, Sky.Rain);
    const own = skyRampTicks(5, rain / SKY_SLOT_TICKS);
    at(w, 5, rain + Math.floor(own / 2));
    expect(w.mix[Sky.Rain]).toBeGreaterThanOrEqual(45);
    expect(w.mix[Sky.Rain]).toBeLessThanOrEqual(55);
    // The dev tools can make every change instant, or slower.
    w.setDev(-1, -1, rain, 0);
    at(w, 5, rain);
    expect(w.mix[Sky.Rain]).toBe(100);
    w.setDev(-1, -1, rain, 400);
    at(w, 5, rain + 100);
    expect(w.mix[Sky.Rain]).toBe(25);
  });
});
