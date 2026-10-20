import { describe, expect, it } from 'vitest';
import {
  applyTick,
  DART_CLASS,
  PATHFINDER_CLASS,
  SCOUT_CLASS,
  encodeTick,
  FIGHTER_PROGRAM_TEXT,
  FLAK_CLASS,
  GAME_COMPONENTS,
  Missile,
  MISSILE_DAMAGE_PER_MATTER,
  PARTS,
  ROCKET_CLASS,
  SimEvent,
  Simulation,
  TaskType,
  TILE,
  visibleTo,
  World,
} from '../src';
import { prog } from './helpers';

const FIGHTER_TEXT = FIGHTER_PROGRAM_TEXT;
const LAUNCHER = ['missile.small', 'missile.medium', 'missile.large'] as const;

/** A map with a launcher unit for player 1 (full cargo) at (5, 15) and a tough, stationary enemy building at (x, 15) for player 2. */
function range(launcher: (typeof LAUNCHER)[number], distance = 10) {
  const sim = new Simulation({ width: 40, height: 30, seed: 7 });
  const bp = sim.blueprints.define(1, 'L', ['chassis.heavy', 'cpu.basic', 'motor.small', 'sensor.long', launcher, 'cargo.bay', 'cargo.bay', 'cargo.bay']);
  const wall = sim.blueprints.define(2, 'Wall', ['frame.large', 'armor.plate', 'armor.plate', 'armor.plate', 'armor.plate', 'armor.plate', 'armor.plate', 'armor.plate', 'armor.plate', 'armor.plate', 'armor.plate']);
  const shooter = sim.spawnUnit(bp, 5 * TILE, 15 * TILE);
  sim.cargo.f.amount[shooter] = 120;
  const target = sim.spawnStructure(wall, 5 + distance, 14);
  return { sim, shooter, target, bp, wall };
}

const step = (sim: Simulation, n: number) => {
  for (let i = 0; i < n; i++) {
    sim.step();
    sim.commit();
  }
};

const aim = (sim: Simulation, shooter: number, target: number) => {
  sim.weapon.f.target[shooter] = sim.world.handle(target);
};

describe('missile launchers', () => {
  it('damage is proportional to the matter each missile costs', () => {
    for (const id of LAUNCHER) {
      const w = PARTS[id].weapon!;
      expect(w.damage).toBe(w.matter! * MISSILE_DAMAGE_PER_MATTER);
    }
  });

  it('launching spends matter and spawns a missile; the first shot does not hurt anything yet', () => {
    const { sim, shooter, target } = range('missile.medium');
    const hp = sim.health.f.hp[target];
    aim(sim, shooter, target);
    sim.step();
    expect(sim.missile.dense).toHaveLength(1);
    expect(sim.cargo.f.amount[shooter]).toBe(120 - 12);
    expect(sim.health.f.hp[target]).toBe(hp);
  });

  it('a hit does damage in proportion to the missile, and the missile is gone', () => {
    const dealt: number[] = [];
    for (const id of LAUNCHER) {
      const { sim, shooter, target } = range(id);
      const hp = sim.health.f.hp[target];
      aim(sim, shooter, target);
      step(sim, 1);
      sim.weapon.f.target[shooter] = -1; // one missile only
      step(sim, 120);
      expect(sim.missile.dense).toHaveLength(0);
      dealt.push(hp - sim.health.f.hp[target]);
    }
    // Falloff and the odd miss aside, a bigger warhead always hurts more, by roughly the ratio of the matter.
    expect(dealt[0]).toBeGreaterThan(0);
    expect(dealt[1]).toBeGreaterThan(dealt[0] * 2);
    expect(dealt[2]).toBeGreaterThan(dealt[1] * 2);
    expect(dealt[2]).toBeLessThanOrEqual(30 * MISSILE_DAMAGE_PER_MATTER);
  });

  it('bigger missiles fly slower', () => {
    const travelled = LAUNCHER.map((id) => {
      const { sim, shooter, target } = range(id, 10);
      aim(sim, shooter, target);
      step(sim, 1);
      sim.weapon.f.target[shooter] = -1;
      const m = sim.missile.dense[0];
      const x0 = sim.flights[m]!.x;
      const y0 = sim.flights[m]!.y;
      step(sim, 10);
      return Math.hypot(sim.flights[m]!.x - x0, sim.flights[m]!.y - y0);
    });
    expect(travelled[0]).toBeGreaterThan(travelled[1]);
    expect(travelled[1]).toBeGreaterThan(travelled[2]);
  });

  it('turns only a little each tick: a target behind it is reached by a wide arc, not a pivot', () => {
    const { sim, shooter, target } = range('missile.large', 10);
    aim(sim, shooter, target);
    step(sim, 1);
    sim.weapon.f.target[shooter] = -1;
    const m = sim.missile.dense[0];
    const limit = (2.5 * Math.PI) / 180 + 1e-9;
    sim.flights[m]!.heading += Math.PI * 0.9; // point nearly away from the target
    let last = sim.flights[m]!.heading;
    let turned = 0;
    for (let i = 0; i < 20; i++) {
      step(sim, 1);
      if (!sim.flights[m]) break;
      const d = Math.abs(sim.flights[m]!.heading - last);
      expect(d).toBeLessThanOrEqual(limit);
      turned += d;
      last = sim.flights[m]!.heading;
    }
    expect(turned).toBeGreaterThan(0.2); // it was turning the whole time
  });

  it('bursts on its own at the end of its flight, hurting enemies nearby but not allies', () => {
    const { sim, shooter, target, wall } = range('missile.medium', 4);
    const ally = sim.spawnStructure(sim.blueprints.define(1, 'Own', ['frame.small', 'armor.plate']), 7, 10);
    aim(sim, shooter, target);
    step(sim, 1);
    sim.weapon.f.target[shooter] = -1;
    const m = sim.missile.dense[0];
    // Cut the leash: the target is gone, so the missile flies straight until it runs out of flight.
    sim.flights[m]!.target = -1;
    sim.flights[m]!.heading = -Math.PI / 2; // north, past the allied building
    sim.flights[m]!.ttl = 3;
    sim.flights[m]!.x = 7.5 * TILE;
    sim.flights[m]!.y = 11.5 * TILE;
    const allyHp = sim.health.f.hp[ally];
    const events: number[] = [];
    for (let i = 0; i < 10; i++) {
      sim.step();
      events.push(...sim.events);
      sim.commit();
    }
    expect(sim.missile.dense).toHaveLength(0);
    expect(events).toContain(SimEvent.Death);
    expect(sim.health.f.hp[ally]).toBe(allyHp);
    expect(sim.stats(target).hp).toBe(sim.blueprints.get(wall.id)!.stats.hp);
  });

  it('can be shot down by hit-scan weapons: a large one reliably, a small one only sometimes', () => {
    const killed = (id: (typeof LAUNCHER)[number]): { hits: number; shots: number } => {
      const { sim, shooter, target } = range(id, 10);
      const gunBp = sim.blueprints.define(2, 'Gunner', ['chassis.light', 'cpu.basic', 'gun.light']);
      const gunner = sim.spawnUnit(gunBp, 12 * TILE, 15 * TILE);
      aim(sim, shooter, target);
      step(sim, 1);
      sim.weapon.f.target[shooter] = -1;
      const m = sim.missile.dense[0];
      sim.flights[m]!.ttl = 1000;
      sim.flights[m]!.speed = 0; // hold it still in front of the gun so only the hit chance matters
      sim.pos.f.x[m] = 14 * TILE;
      sim.pos.f.y[m] = 15 * TILE;
      sim.flights[m]!.x = 14 * TILE;
      sim.flights[m]!.y = 15 * TILE;
      const hp0 = sim.health.f.hp[m];
      aim(sim, gunner, m);
      let shots = 0;
      let hits = 0;
      for (let i = 0; i < 400 && sim.world.isAlive(m); i++) {
        const before = sim.health.has(m) ? sim.health.f.hp[m] : 0;
        sim.step();
        for (let k = 0; k < sim.events.length; k += 3) if (sim.events[k] === SimEvent.Shot && sim.events[k + 1] === gunner) shots++;
        if (sim.world.isAlive(m) && sim.health.f.hp[m] < before) hits++;
        sim.commit();
      }
      expect(hp0).toBeGreaterThan(0);
      return { hits, shots };
    };
    const small = killed('missile.small');
    const large = killed('missile.large');
    expect(large.hits).toBeGreaterThan(0);
    expect(small.hits).toBeLessThanOrEqual(1); // one connecting hit kills it
    expect(small.shots).toBeGreaterThan(large.shots / 4); // and it took several tries to land it
    expect(large.shots).toBeLessThanOrEqual(13); // 60 hit points, 5 damage a shot, every shot lands
  });

  it('sentries can see incoming missiles as enemies', () => {
    const { sim, shooter, target } = range('missile.medium', 8);
    const gunBp = sim.blueprints.define(2, 'Sentry', ['chassis.light', 'cpu.basic', 'sensor.short', 'gun.light']);
    const sentry = sim.spawnUnit(gunBp, 9 * TILE, 15 * TILE);
    sim.setProgram(gunBp.id, prog('on(Detected, { watch: [ENEMY], interval: 2 }, (kind, enemy) => {\n  fire(enemy);\n});'));
    aim(sim, shooter, target);
    step(sim, 1);
    sim.weapon.f.target[shooter] = -1;
    const m = sim.missile.dense[0];
    step(sim, 6);
    expect(sim.weapon.f.target[sentry]).toBeGreaterThanOrEqual(0); // locked on something...
    expect(sim.world.resolve(sim.weapon.f.target[sentry])).toBe(m); // ...the missile, not the shooter's building target
  });
});

describe('missiles on the network', () => {
  it('stay visible to their owner however far they fly, but only within sight for everyone else', () => {
    const { sim, shooter, target } = range('missile.large', 12);
    aim(sim, shooter, target);
    step(sim, 1);
    const m = sim.missile.dense[0];
    sim.pos.f.x[m] = 38 * TILE;
    sim.pos.f.y[m] = 2 * TILE;
    const stats = (e: number) => sim.stats(e);
    expect(visibleTo(sim.world, 1, stats).has(m)).toBe(true);
    expect(visibleTo(sim.world, 2, stats).has(m)).toBe(false);
  });

  it('replicate with their heading and size', () => {
    const { sim, shooter, target } = range('missile.medium');
    aim(sim, shooter, target);
    sim.step();
    const mirror = new World(GAME_COMPONENTS, 64);
    applyTick(mirror, encodeTick(sim.world, sim.tick, sim.events, true));
    const store = mirror.store(Missile);
    expect(store.dense).toHaveLength(1);
    const m = store.dense[0];
    expect(store.f.size[m]).toBe(12);
    expect(store.f.owner[m]).toBe(1);
    expect(store.f.blast[m]).toBe(15);
    expect(store.f.heading[m]).toBe(sim.missile.f.heading[sim.missile.dense[0]]);
  });
});

describe('the Rocket Truck', () => {
  it('fetches ammunition from a stocked silo and carries on', () => {
    const sim = new Simulation({ width: 40, height: 30, seed: 3 });
    const siloBp = sim.blueprints.define(1, 'Silo', ['frame.medium', 'silo', 'battery.cell']);
    const silo = sim.spawnStructure(siloBp, 8, 8);
    sim.addStock(silo, 500);
    const bp = sim.blueprints.define(1, ROCKET_CLASS.name, [...ROCKET_CLASS.parts]);
    sim.setProgram(bp.id, ROCKET_CLASS.program);
    const truck = sim.spawnUnit(bp, 14 * TILE, 8 * TILE);
    expect(sim.cargo.f.amount[truck]).toBe(0);
    step(sim, 150);
    expect(sim.cargo.f.amount[truck]).toBe(bp.stats.cargo);
    expect(sim.stockpile.f.amount[silo]).toBeLessThan(500);
  });
});

describe('shooting missiles down', () => {
  /** A medium missile held still at (14, 15), owned by player 1; player 2's units shoot at it. */
  function held() {
    const { sim, shooter, target } = range('missile.medium', 10);
    aim(sim, shooter, target);
    step(sim, 1);
    sim.weapon.f.target[shooter] = -1;
    const m = sim.missile.dense[0];
    sim.flights[m]!.speed = 0;
    sim.flights[m]!.ttl = 1000;
    sim.flights[m]!.x = sim.pos.f.x[m] = 14 * TILE;
    sim.flights[m]!.y = sim.pos.f.y[m] = 15 * TILE;
    return { sim, m };
  }

  it('an attack order on an enemy missile is accepted and shoots it down', () => {
    const { sim, m } = held();
    const bp = sim.blueprints.define(2, 'Gunner', ['chassis.light', 'cpu.basic', 'sensor.short', 'gun.light']);
    sim.setProgram(bp.id, prog(FIGHTER_TEXT));
    const gunner = sim.spawnUnit(bp, 11 * TILE, 15 * TILE);
    step(sim, 2);
    sim.issueOrder(2, gunner, 14, 15, m, false);
    expect(sim.tasks[gunner]!.count).toBe(1);
    expect(sim.tasks[gunner]!.type(0)).toBe(TaskType.Attack);
    sim.world.isAlive(m);
    step(sim, 120);
    expect(sim.world.isAlive(m)).toBe(false);
  });

  it('your own missile is not an attack target', () => {
    const { sim, m } = held();
    const bp = sim.blueprints.define(1, 'Mine', ['chassis.light', 'cpu.basic', 'sensor.short', 'gun.light']);
    sim.setProgram(bp.id, prog(FIGHTER_TEXT));
    const own = sim.spawnUnit(bp, 11 * TILE, 15 * TILE);
    step(sim, 2);
    sim.issueOrder(1, own, 14, 15, m, false);
    expect(sim.tasks[own]!.type(0)).not.toBe(TaskType.Attack);
  });
});

describe('flak', () => {
  it('bursts every enemy missile near its target, even the small ones, and never hurts units', () => {
    const { sim, shooter, target } = range('missile.small', 10);
    const flakBp = sim.blueprints.define(2, FLAK_CLASS.name, [...FLAK_CLASS.parts]);
    sim.setProgram(flakBp.id, FLAK_CLASS.program);
    const flak = sim.spawnUnit(flakBp, 11 * TILE, 15 * TILE);
    const bystander = sim.spawnUnit(sim.blueprints.define(2, 'Bystander', ['chassis.light', 'cpu.basic']), 13 * TILE, 15 * TILE);
    const hp = sim.health.f.hp[bystander];
    aim(sim, shooter, target);
    step(sim, 1);
    sim.weapon.f.target[shooter] = -1;
    const m = sim.missile.dense[0];
    for (const k of [m]) {
      sim.flights[k]!.speed = 0;
      sim.flights[k]!.ttl = 1000;
      sim.flights[k]!.x = sim.pos.f.x[k] = 13 * TILE;
      sim.flights[k]!.y = sim.pos.f.y[k] = 15 * TILE;
    }
    step(sim, 12);
    expect(sim.world.isAlive(m)).toBe(false); // a 30% target for a gun, certain for flak
    expect(sim.health.f.hp[bystander]).toBe(hp);
    expect(sim.weapon.f.target[flak]).toBe(-1);
  });

  it('wastes nothing on units: it will not lock on a ground target', () => {
    const { sim, target } = range('missile.small', 10);
    const bp = sim.blueprints.define(2, 'Flak', [...FLAK_CLASS.parts]);
    const flak = sim.spawnUnit(bp, 8 * TILE, 15 * TILE);
    sim.weapon.f.target[flak] = sim.world.handle(target);
    const e0 = sim.energy.f.amount[flak];
    step(sim, 5);
    expect(sim.energy.f.amount[flak]).toBeGreaterThanOrEqual(e0 - 1);
    expect(sim.weapon.f.target[flak]).toBe(-1);
  });
});

describe('fast light units', () => {
  it('a turbo motor makes the Dart more than twice as quick as the Scout', () => {
    const sim = new Simulation({ width: 20, height: 20, seed: 1 });
    const speed = (c: { name: string; parts: readonly string[] }) => sim.blueprints.define(1, c.name, [...c.parts]).stats.speed;
    expect(speed(DART_CLASS)).toBeGreaterThan(2 * speed(SCOUT_CLASS));
    expect(speed(PATHFINDER_CLASS)).toBeGreaterThan(2 * speed(SCOUT_CLASS));
  });
});
