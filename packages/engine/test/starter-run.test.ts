import { describe, expect, it } from 'vitest';
import { CpuState, FLOW_HOST, NEUTRAL_CLASS, SCOUT_CLASS, STARTER_CLASSES, Simulation, TILE, compileProgram } from '../src';

const at = (t: number) => t * TILE + TILE / 2;

describe('every starter class script', () => {
  it('compiles with no errors', () => {
    for (const c of [...STARTER_CLASSES, NEUTRAL_CLASS]) {
      if (!c.program) continue;
      expect(() => compileProgram(c.program, FLOW_HOST), c.name).not.toThrow();
    }
  });

  it('runs for a while beside an enemy and an ally without a script fault', () => {
    for (const c of [...STARTER_CLASSES, NEUTRAL_CLASS]) {
      const sim = new Simulation({ width: 60, height: 40, seed: 3 });
      const bp = sim.blueprints.define(1, c.name, [...c.parts]);
      if (c.program) sim.setProgram(bp.id, c.program);
      const e = bp.stats.structure ? sim.spawnStructure(bp, 20, 20) : sim.spawnUnit(bp, at(20), at(20));
      sim.energy.f.amount[e] = sim.stats(e).energyCapacity;
      if (sim.cargo.has(e)) sim.cargo.f.amount[e] = 40;
      const foe = sim.blueprints.define(2, 'Foe', [...SCOUT_CLASS.parts]);
      sim.spawnUnit(foe, at(26), at(20));
      sim.spawnUnit(sim.blueprints.define(1, 'Friend', [...SCOUT_CLASS.parts]), at(17), at(20));
      for (let i = 0; i < 150; i++) {
        sim.step();
        sim.commit();
        if (!sim.world.isAlive(e)) break;
        if (sim.cpu?.has?.(e) && sim.cpu.f.fault[e] !== 0) throw new Error(`${c.name}: script fault ${sim.cpu.f.fault[e]} at tick ${i}`);
      }
      expect(CpuState.Running).toBeDefined();
    }
  });
});
