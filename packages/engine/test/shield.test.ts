import { describe, expect, it } from 'vitest';
import {
  AEGIS_CLASS,
  SHIELD_BURST_DAMAGE_FRACTION,
  SHIELD_ENERGY_PER_DAMAGE,
  SHIELD_TOWER_CLASS,
  SimEvent,
  Simulation,
  TILE,
  arcCrossing,
  deriveStats,
  shieldHit,
  setShieldAngle,
  setShieldArc,
  setShieldRange,
} from '../src';
import { prog } from './helpers';

const at = (tiles: number) => tiles * TILE + TILE / 2;
const wrapDeg = (d: number): number => ((((d + 180) % 360) + 360) % 360) - 180;

const SHIELDED = ['chassis.heavy', 'cpu.basic', 'shield.emitter', 'battery.cell', 'battery.cell', 'battery.cell'];
const CANNON = ['chassis.medium', 'cpu.basic', 'gun.cannon', 'cargo.bay', 'battery.cell'];
const GUN = ['chassis.medium', 'cpu.basic', 'gun.light', 'battery.cell'];
const ROCKET = ['chassis.medium', 'cpu.basic', 'missile.medium', 'cargo.bay', 'battery.cell'];
const DUMMY = ['chassis.heavy', 'cpu.basic', 'battery.cell'];

/** A shielded unit (owner 2) at (20, 10) and a shooter (owner 1) `gap` tiles west of it, aimed at it. The shield faces the shooter. */
function duel(shooterParts: readonly string[], gap = 8, facing: number | null = 180) {
  const sim = new Simulation({ width: 40, height: 40, seed: 1 });
  const shooter = sim.blueprints.define(1, 'Shooter', shooterParts);
  const target = sim.blueprints.define(2, 'Shielded', SHIELDED);
  const s = sim.spawnUnit(shooter, at(20 - gap), at(10));
  const t = sim.spawnUnit(target, at(20), at(10));
  sim.cargo.has(s) && (sim.cargo.f.amount[s] = 40);
  sim.health.f.hp[t] = 1_000_000;
  if (facing !== null) setShieldAngle(sim, t, facing);
  for (let i = 0; i < 30; i++) sim.step(); // let the shield turn into place (and the first-tick setup settle)
  sim.commit();
  sim.weapon.f.target[s] = sim.world.handle(t);
  return { sim, s, t };
}

function run(sim: Simulation, ticks: number, onTick?: () => void): number[] {
  const events: number[] = [];
  for (let k = 0; k < ticks; k++) {
    sim.step();
    for (let i = 0; i < sim.events.length; i += 3) events.push(sim.events[i]);
    sim.commit();
    onTick?.();
  }
  return events;
}

describe('arc geometry', () => {
  it('finds where a segment crosses the arc, and only inside it', () => {
    // Arc of radius 100 about the origin, facing east, 90 degrees wide.
    const head = 0;
    const arc = Math.PI / 2;
    expect(arcCrossing(0, 0, 100, head, arc, 200, 0, 0, 0)).toBeCloseTo(0.5);
    expect(shieldHit.x).toBeCloseTo(100);
    expect(shieldHit.y).toBeCloseTo(0);
    // The same crossing from inside to outside.
    expect(arcCrossing(0, 0, 100, head, arc, 0, 0, 200, 0)).toBeCloseTo(0.5);
    // On the far side of the circle, outside the arc.
    expect(arcCrossing(0, 0, 100, head, arc, -200, 0, 0, 0)).toBe(-1);
    // Just inside and just outside the edge of the arc (45 degrees each way).
    expect(arcCrossing(0, 0, 100, head, arc, 70, 60, 95, 90)).toBeGreaterThanOrEqual(0); // crosses at about 40 degrees
    expect(arcCrossing(0, 0, 100, head, arc, 50, 80, 60, 110)).toBe(-1); // crosses at about 57 degrees
    // A segment that stays on one side never crosses.
    expect(arcCrossing(0, 0, 100, head, arc, 150, 0, 300, 0)).toBe(-1);
    expect(arcCrossing(0, 0, 100, head, arc, 10, 0, 50, 0)).toBe(-1);
  });
});

describe('the shield emitter module', () => {
  it('is a switchable module with arc and range stats, and a class may carry only one', () => {
    const s = deriveStats(SHIELDED);
    expect(s.shield).not.toBeNull();
    expect(s.shield!.arc).toBeCloseTo((120 * Math.PI) / 180);
    expect(s.shield!.range).toBe(3 * TILE);
    expect(deriveStats(SHIELDED, 1 << 2).shield).toBeNull(); // switched off
    expect(() => deriveStats(['chassis.heavy', 'shield.emitter', 'shield.emitter'])).toThrow(/one shield/);
  });

  it('costs energy every tick while up, and nothing when switched off', () => {
    const { sim, t } = duel(GUN, 8, null);
    const before = sim.energy.f.amount[t];
    run(sim, 10);
    expect(sim.shield.f.active[t]).toBe(1);
    expect(before - sim.energy.f.amount[t]).toBe(10 * 5);
    // Switch the module off (part 2): the shield drops and the drain stops.
    expect(sim.setModule(t, 2, false, false)).toBe(true);
    const after = sim.energy.f.amount[t];
    run(sim, 10);
    expect(sim.shield.f.active[t]).toBe(0);
    expect(sim.energy.f.amount[t]).toBe(after);
    // And back on.
    sim.setModule(t, 2, true, false);
    run(sim, 2);
    expect(sim.shield.f.active[t]).toBe(1);
  });

  it('costs more for a wider arc or a longer reach, and the script setters clamp to the emitter', () => {
    const { sim, t } = duel(GUN, 8, null);
    const per = (): number => {
      const e = sim.energy.f.amount[t];
      run(sim, 1);
      return e - sim.energy.f.amount[t];
    };
    expect(per()).toBe(5);
    expect(setShieldArc(sim, t, 240)).toBe(240);
    run(sim, 60); // the arc eases out to its new width
    expect(per()).toBe(10);
    expect(setShieldArc(sim, t, 999)).toBe(240); // never past the emitter's limit
    expect(setShieldArc(sim, t, 1)).toBe(10); // nor below ten degrees
    expect(setShieldRange(sim, t, 6)).toBe(6);
    expect(setShieldRange(sim, t, 50)).toBe(6);
    expect(setShieldRange(sim, t, 0)).toBeGreaterThanOrEqual(1); // never inside the hull
    expect(setShieldAngle(sim, t, -90)).toBe(270);
    // A unit without an emitter gets -1.
    const plain = sim.spawnUnit(sim.blueprints.define(2, 'Plain', DUMMY), at(30), at(30));
    expect(setShieldAngle(sim, plain, 90)).toBe(-1);
  });

  it('never aims itself: it holds the angle a program gave it', () => {
    const { sim, t } = duel(GUN, 8, null); // an enemy is due west, but nothing tells the shield so
    run(sim, 40);
    const heading = () => (sim.shield.f.heading[t] / 256) * 360;
    const start = heading();
    run(sim, 40);
    expect(heading()).toBe(start);
    setShieldAngle(sim, t, 90);
    run(sim, 40);
    expect(Math.abs(heading() - 90)).toBeLessThan(3);
  });
});

describe('the ShieldGuard block', () => {
  const guard = (parts: readonly string[], text = 'use(ShieldGuard);') => {
    const sim = new Simulation({ width: 40, height: 40, seed: 1 });
    const bp = sim.blueprints.define(2, 'Guard', parts);
    sim.setProgram(bp.id, prog(text));
    return { sim, bp, g: sim.spawnUnit(bp, at(20), at(10)) };
  };
  const GUARD = ['chassis.heavy', 'cpu.basic', 'sensor.long', 'shield.emitter', 'battery.cell', 'battery.cell', 'battery.cell'];
  const heading = (sim: Simulation, g: number) => (sim.shield.f.heading[g] / 256) * 360;

  it('turns the shield to the nearest enemy its sensor finds', () => {
    const { sim, g } = guard(GUARD);
    const foe = sim.spawnUnit(sim.blueprints.define(1, 'Foe', DUMMY), at(20), at(16)); // due south
    sim.health.f.hp[foe] = 1_000_000;
    run(sim, 60);
    expect(Math.abs(heading(sim, g) - 90)).toBeLessThan(3);
    sim.pos.f.x[foe] = at(14);
    sim.pos.f.y[foe] = at(10); // now due west
    run(sim, 60);
    expect(Math.abs(heading(sim, g) - 180)).toBeLessThan(3);
  });

  it('faces an incoming shell before an enemy that is nearer', () => {
    const { sim, g } = guard(GUARD);
    const near = sim.spawnUnit(sim.blueprints.define(1, 'Near', DUMMY), at(20), at(15)); // due south, closest
    sim.health.f.hp[near] = 1_000_000;
    const gun = sim.spawnUnit(sim.blueprints.define(1, 'Gun', CANNON), at(1), at(10)); // far west (19 tiles), firing at the guard
    sim.cargo.f.amount[gun] = 40;
    sim.weapon.f.target[gun] = sim.world.handle(g);
    let faced = false;
    run(sim, 80, () => {
      if (sim.shell.dense.length > 0 && Math.abs((sim.shields[g]!.want * 180) / Math.PI - 180) < 15) faced = true; // what the script chose; the arc then takes a few ticks to swing round
    });
    expect(faced).toBe(true);
  });

  it('leaves the shield alone with nothing to face, and without the block nothing moves it', () => {
    const { sim, g } = guard(GUARD);
    const before = sim.shield.f.heading[g];
    run(sim, 40);
    expect(sim.shield.f.heading[g]).toBe(before);
    const bare = guard(GUARD, 'on(Every, { ticks: 5 }, () => {\n  rand(2);\n});');
    const foe = bare.sim.spawnUnit(bare.sim.blueprints.define(1, 'Foe', DUMMY), at(14), at(10));
    bare.sim.health.f.hp[foe] = 1_000_000;
    const first = bare.sim.shield.f.heading[bare.g];
    run(bare.sim, 60);
    expect(bare.sim.shield.f.heading[bare.g]).toBe(first);
  });

  it('is what the starter Shield Tower and Aegis run', () => {
    expect(SHIELD_TOWER_CLASS.text).toContain('use(ShieldGuard');
    expect(AEGIS_CLASS.text).toContain('use(ShieldGuard');
    expect(SHIELD_TOWER_CLASS.program).not.toBe('');
    expect(deriveStats(SHIELD_TOWER_CLASS.parts).cyclesPerTick).toBeGreaterThan(0);
  });
});

describe('easing', () => {
  it('moves the arc, radius and heading towards the asked-for values over several ticks, never past them', () => {
    const { sim, t } = duel(GUN, 8, 0);
    const st = sim.shields[t]!;
    setShieldArc(sim, t, 240);
    setShieldRange(sim, t, 6);
    setShieldAngle(sim, t, 180);
    const arc0 = st.arc;
    const range0 = st.range;
    run(sim, 1);
    expect(st.arc).toBeGreaterThan(arc0);
    expect(st.arc).toBeLessThan(st.wantArc);
    expect(st.range).toBeGreaterThan(range0);
    expect(st.range).toBeLessThan(st.wantRange);
    let last = st.arc;
    for (let i = 0; i < 80; i++) {
      run(sim, 1);
      expect(st.arc).toBeGreaterThanOrEqual(last);
      expect(st.arc).toBeLessThanOrEqual(st.wantArc);
      last = st.arc;
    }
    expect(st.arc).toBe(st.wantArc);
    expect(st.range).toBe(st.wantRange);
    expect(Math.abs(wrapDeg((sim.shield.f.heading[t] / 256) * 360 - 180))).toBeLessThan(3);
  });
});

describe('interference', () => {
  /** Two shields (owners 1 and 2) 4 tiles apart facing each other: their 3-tile arcs cross in two places. */
  function facing(gap: number) {
    const sim = new Simulation({ width: 40, height: 40, seed: 1 });
    const a = sim.spawnUnit(sim.blueprints.define(1, 'A', SHIELDED), at(20), at(10));
    const b = sim.spawnUnit(sim.blueprints.define(2, 'B', SHIELDED), at(20 + gap), at(10));
    setShieldAngle(sim, a, 0);
    setShieldAngle(sim, b, 180);
    run(sim, 40);
    return { sim, a, b };
  }
  const drain = (sim: Simulation, e: number): number => {
    const before = sim.energy.f.amount[e];
    run(sim, 1);
    return before - sim.energy.f.amount[e];
  };

  it('costs both shields 1.5x for each point where their arcs cross', () => {
    const { sim, a, b } = facing(4);
    expect(sim.shield.f.strain[a]).toBe(2);
    expect(sim.shield.f.strain[b]).toBe(2);
    expect(drain(sim, a)).toBe(Math.ceil(5 * 1.5 * 1.5));
    expect(drain(sim, b)).toBe(Math.ceil(5 * 1.5 * 1.5));
  });

  it('costs nothing extra when the arcs do not touch, or face away from each other', () => {
    const far = facing(8);
    expect(far.sim.shield.f.strain[far.a]).toBe(0);
    expect(drain(far.sim, far.a)).toBe(5);
    const { sim, a, b } = facing(4);
    setShieldAngle(sim, a, 180);
    setShieldAngle(sim, b, 0);
    run(sim, 60);
    expect(sim.shield.f.strain[a]).toBe(0);
    expect(drain(sim, a)).toBe(5);
    expect(drain(sim, b)).toBe(5);
  });
});

describe('stopping shots', () => {
  it('stops a cannon shell and bills the battery, not the hit points', () => {
    const { sim, t } = duel(CANNON);
    const hp = sim.health.f.hp[t];
    const energy = sim.energy.f.amount[t];
    const events = run(sim, 40);
    expect(events).toContain(SimEvent.ShieldHit);
    expect(events).not.toContain(SimEvent.ShellHit);
    expect(sim.health.f.hp[t]).toBe(hp);
    // Each shell is 25 damage; the shield costs 5 a tick besides.
    const drained = energy - sim.energy.f.amount[t];
    expect(drained).toBeGreaterThanOrEqual(25 * SHIELD_ENERGY_PER_DAMAGE);
  });

  it('does not stop a shell that comes from behind the arc', () => {
    const { sim, t } = duel(CANNON, 8, 0); // facing east, the shooter is west
    const hp = sim.health.f.hp[t];
    const events = run(sim, 40);
    expect(events).not.toContain(SimEvent.ShieldHit);
    expect(sim.health.f.hp[t]).toBeLessThan(hp);
  });

  it('stops a missile before it bursts', () => {
    const { sim, t } = duel(ROCKET, 10);
    const hp = sim.health.f.hp[t];
    const events = run(sim, 80);
    expect(events).toContain(SimEvent.ShieldHit);
    expect(sim.health.f.hp[t]).toBe(hp);
    expect(sim.missile.dense.length).toBe(0);
  });

  it('stops hit-scan guns', () => {
    const { sim, t } = duel(GUN, 3);
    const hp = sim.health.f.hp[t];
    const events = run(sim, 20);
    expect(events).toContain(SimEvent.ShieldHit);
    expect(sim.health.f.hp[t]).toBe(hp);
  });

  it('lets an ally shoot through its own side', () => {
    const sim = new Simulation({ width: 40, height: 40, seed: 1 });
    const ally = sim.blueprints.define(2, 'Ally', CANNON);
    const mine = sim.blueprints.define(2, 'Shielded', SHIELDED);
    const foe = sim.blueprints.define(1, 'Foe', DUMMY);
    const w = sim.spawnUnit(ally, at(14), at(10));
    const s = sim.spawnUnit(mine, at(17), at(10)); // its arc stands at x = 20, between the cannon and the foe
    const f = sim.spawnUnit(foe, at(26), at(10));
    sim.cargo.f.amount[w] = 40;
    sim.health.f.hp[f] = 1_000_000;
    setShieldAngle(sim, s, 0);
    run(sim, 30);
    sim.weapon.f.target[w] = sim.world.handle(f);
    const hp = sim.health.f.hp[f];
    run(sim, 20);
    expect(sim.health.f.hp[f]).toBeLessThan(hp);
  });

  it('only blocks what crosses the arc: a shooter inside it, against a target inside it, is not stopped', () => {
    const { sim, t } = duel(GUN, 1); // the shooter stands one tile away, well inside the 3-tile arc
    const hp = sim.health.f.hp[t];
    run(sim, 20);
    expect(sim.health.f.hp[t]).toBeLessThan(hp);
  });
});

describe('collapse', () => {
  it('blows up the emitter and hurts the owner when the battery runs flat', () => {
    const { sim, t, s } = duel(CANNON);
    const capacity = sim.stats(t).energyCapacity;
    const hp = sim.health.f.hp[t];
    sim.energy.f.amount[t] = 60; // less than one shell's worth
    const events = run(sim, 40);
    expect(events).toContain(SimEvent.ShieldBurst);
    expect(events).toContain(SimEvent.Break);
    expect(sim.stats(t).shield).toBeNull(); // the module is broken
    expect(sim.shield.f.active[t]).toBe(0);
    expect(sim.energy.f.amount[t]).toBe(0);
    // Hurt by the blast, in proportion to the capacity (and then by the shells that come through).
    expect(hp - sim.health.f.hp[t]).toBeGreaterThanOrEqual(Math.round(capacity * SHIELD_BURST_DAMAGE_FRACTION));
    expect(sim.health.f.hp[s]).toBeGreaterThan(0);
  });

  it('can kill a weak owner, and credits the shooter', () => {
    const { sim, t } = duel(CANNON);
    sim.health.f.hp[t] = 5;
    sim.energy.f.amount[t] = 60;
    run(sim, 40);
    expect(sim.health.f.hp[t]).toBeLessThanOrEqual(0);
    expect(sim.lastHitBy[t]).toBe(1);
  });
});

describe('walls for enemy units', () => {
  const marcher = (shielded: boolean) => {
    const sim = new Simulation({ width: 40, height: 40, seed: 1 });
    const walker = sim.blueprints.define(1, 'Walker', ['chassis.light', 'cpu.basic', 'motor.small', 'battery.cell']);
    const guard = sim.blueprints.define(2, 'Guard', SHIELDED);
    const g = sim.spawnUnit(guard, at(20), at(10));
    setShieldAngle(sim, g, 180);
    const w = sim.spawnUnit(walker, at(10), at(10));
    if (!shielded) sim.setModule(g, 2, false, false);
    run(sim, 30);
    sim.setDestination(w, at(30), at(10));
    run(sim, 300);
    return { sim, w };
  };

  it('cannot walk through an enemy shield', () => {
    const { sim, w } = marcher(true);
    // The shield is a 3-tile ring west of the guard at x = 20 - 3 = 17: it stops short of it.
    expect(sim.pos.f.x[w]).toBeLessThan(at(17));
    expect(sim.pos.f.x[w]).toBeGreaterThan(at(14));
  });

  it('walks right through once the shield is off', () => {
    const { sim, w } = marcher(false);
    expect(sim.pos.f.x[w]).toBeGreaterThan(at(28));
  });
});

describe('starter classes and scripts', () => {
  it('offers a shield tower and an escort', () => {
    expect(deriveStats(SHIELD_TOWER_CLASS.parts).shield).not.toBeNull();
    expect(deriveStats(AEGIS_CLASS.parts).shield).not.toBeNull();
    expect(deriveStats(SHIELD_TOWER_CLASS.parts).structure).toBe(true);
  });

  it('lets a program aim, widen and extend the shield with config calls', () => {
    const sim = new Simulation({ width: 20, height: 20, seed: 1 });
    const bp = sim.blueprints.define(1, 'Aegis', SHIELDED);
    sim.setProgram(bp.id, prog("on(Spawned, () => {\n  config.shieldAngle(90);\n  config.shieldArc(200);\n  config.shieldRange(5);\n});"));
    const e = sim.spawnUnit(bp, at(10), at(10));
    run(sim, 30);
    const st = sim.shields[e]!;
    expect(st.want).toBeCloseTo(Math.PI / 2);
    expect(st.wantArc).toBeCloseTo((200 * Math.PI) / 180);
    expect(st.wantRange).toBe(5 * TILE);
    expect(st.arc).toBeCloseTo((200 * Math.PI) / 180, 1); // eased all the way there by now
    expect(st.range).toBe(5 * TILE);
    expect(sim.shield.f.range[e]).toBe(50);
  });

  it('is deterministic', () => {
    const final = () => {
      const { sim, t } = duel(CANNON);
      run(sim, 60);
      return [sim.energy.f.amount[t], sim.health.f.hp[t], sim.shield.f.heading[t]];
    };
    expect(final()).toEqual(final());
  });
});
