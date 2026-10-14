import { describe, expect, it } from 'vitest';
import { DEFAULT_DESIGNS, RADAR_COOLDOWN_TICKS, RADAR_ENERGY_PER_TILE, Simulation, TILE } from '../src';

const at = (t: number) => t * TILE + TILE / 2;

function setup() {
  const sim = new Simulation({ width: 40, height: 40, seed: 1 });
  const bp = sim.blueprints.define(1, 'Watcher', ['chassis.medium', 'cpu.basic', 'radar.pulse', 'battery.cell']);
  const dummy = sim.blueprints.define(2, 'Dummy', ['chassis.light', 'cpu.basic']);
  const radar = sim.spawnUnit(bp, at(5), at(5));
  const near = sim.spawnUnit(dummy, at(10), at(5));
  const far = sim.spawnUnit(dummy, at(30), at(5));
  sim.spatial.rebuild(sim.pos.f.x, sim.pos.f.y, sim.pos.dense, sim.world.capacity);
  return { sim, radar, near, far };
}

describe('radar pulse', () => {
  it('finds units within the range the energy buys, and costs that energy', () => {
    const { sim, radar } = setup();
    const before = sim.energy.f.amount[radar];
    expect(sim.radarPulse(radar, RADAR_ENERGY_PER_TILE * 8)).toBe(1);
    expect(sim.energy.f.amount[radar]).toBe(before - RADAR_ENERGY_PER_TILE * 8);
    expect(sim.radarPulses).toHaveLength(1);
    expect(sim.radarPulses[0].contacts).toHaveLength(1);
  });

  it('reaches further with more energy', () => {
    const { sim, radar } = setup();
    expect(sim.radarPulse(radar, RADAR_ENERGY_PER_TILE * 30)).toBe(2);
  });

  it('rests between pulses and fails without a radar or enough energy', () => {
    const { sim, radar, near } = setup();
    expect(sim.radarPulse(near, 500)).toBe(-1);
    expect(sim.radarPulse(radar, RADAR_ENERGY_PER_TILE * 8)).toBe(1);
    expect(sim.radarPulse(radar, RADAR_ENERGY_PER_TILE * 8)).toBe(-1);
    expect(sim.radarCooldown(radar)).toBe(RADAR_COOLDOWN_TICKS);
    sim.energy.f.amount[radar] = 0;
    sim.tick += RADAR_COOLDOWN_TICKS;
    expect(sim.radarPulse(radar, RADAR_ENERGY_PER_TILE * 8)).toBe(-1);
  });
});

describe('Radar Tower default class', () => {
  it('pings on its own while the radar is on, and stays quiet when it is switched off', () => {
    const run = (off: boolean) => {
      const sim = new Simulation({ width: 40, height: 40, seed: 1 });
      const tower = DEFAULT_DESIGNS.get('Radar Tower')!;
      const bp = sim.blueprints.define(1, tower.name, tower.parts);
      sim.setProgram(bp.id, tower.program);
      const dummy = sim.blueprints.define(2, 'Dummy', ['chassis.light', 'cpu.basic']);
      const e = sim.spawnStructure(bp, 5, 5);
      sim.spawnUnit(dummy, at(10), at(5));
      if (off) sim.setModule(e, tower.parts.indexOf('radar.pulse'), false, false);
      let pulses = 0;
      for (let t = 0; t < 40; t++) {
        sim.step();
        pulses += sim.radarPulses.length;
        sim.commit();
      }
      return pulses;
    };
    expect(run(false)).toBeGreaterThanOrEqual(1);
    expect(run(true)).toBe(0);
  });
});
