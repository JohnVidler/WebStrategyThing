import { SimEvent } from './events';
import { MISSILE_EDGE_DAMAGE, MISSILE_FUSE_RADIUS, MISSILE_LAUNCH_SPREAD, TILE } from './rules';
import type { Simulation } from './simulation';
import type { BlueprintStats } from './blueprint';

/*
 * Missiles. A launcher in the weapon system does not hurt its target directly: it spawns a
 * missile, an entity with a Position, Health (so hit-scan weapons can shoot it down) and Missile
 * component (what clients draw). The numbers that do not replicate live here, in `Simulation.flights`.
 *
 * A missile homes on its target at a limited turn rate, so it flies wide arcs and can be dodged
 * by anything fast. It bursts when it comes close to an enemy, when it reaches the end of its
 * flight, or at the edge of the map; the burst hurts every enemy in its blast, less towards the
 * edge. A missile that is shot down just dies, without a burst.
 */

/** The part of a missile's state that is not replicated. Positions are kept as floats and rounded onto the entity. */
export interface MissileFlight {
  x: number;
  y: number;
  /** Radians, 0 = east, increasing towards south (screen space). */
  heading: number;
  /** Sub-tile units per tick. */
  speed: number;
  /** Radians per tick. */
  turn: number;
  /** Ticks of flight left. */
  ttl: number;
  damage: number;
  /** Sub-tile units. */
  blast: number;
  hp: number;
  /** Chance that a hit-scan shot at it connects. */
  hitChance: number;
  owner: number;
  /** Handle of the target; it flies on straight if that is gone. */
  target: number;
}

const TAU = Math.PI * 2;
const quantise = (heading: number): number => Math.round((((heading % TAU) + TAU) % TAU) / TAU * 256) & 255;

type LauncherStats = NonNullable<BlueprintStats['weapon']>;

/** Launches a missile from shooter `e` at `target`. The caller has already paid for it. */
export function launchMissile(sim: Simulation, e: number, target: number, w: LauncherStats): number {
  const m = w.missile!;
  const x = sim.pos.f.x[e];
  const y = sim.pos.f.y[e];
  const aim = Math.atan2(sim.pos.f.y[target] - y, sim.pos.f.x[target] - x);
  const heading = aim + ((sim.rng.int(2001) - 1000) / 1000) * MISSILE_LAUNCH_SPREAD;
  const owner = sim.unit.f.owner[e];
  const id = sim.world.create();
  sim.pos.add(id, { x, y });
  sim.health.add(id, { hp: m.hp });
  sim.missile.add(id, { owner, size: Math.min(255, w.matter), heading: quantise(heading), blast: Math.min(255, Math.round(m.blast * 10)) });
  sim.lastHitBy[id] = 0;
  sim.flights[id] = {
    x,
    y,
    heading,
    speed: m.speed * TILE,
    turn: (m.turn * Math.PI) / 180,
    ttl: m.flight,
    damage: w.damage,
    blast: m.blast * TILE,
    hp: m.hp,
    hitChance: m.hitChance,
    owner,
    target: sim.world.handle(target),
  };
  return id;
}

/** True if a hit-scan shot at missile `m` connects (small missiles are hard to hit). */
export function shotHitsMissile(sim: Simulation, m: number): boolean {
  const chance = sim.flights[m]?.hitChance ?? 1;
  return chance >= 1 || sim.rng.int(1000) < chance * 1000;
}

/** Half the side of a building (sub-tile units); 0 for anything else. */
const halfSize = (sim: Simulation, o: number): number => (sim.unit.has(o) ? (sim.stats(o).footprint * TILE) / 2 : 0);
/** The biggest building is 3x3, so look this far beyond a radius to catch buildings by their edge. */
const REACH_PAD = 1.5 * TILE;

/** The burst: damages every enemy unit and building in the blast, then the missile is gone. */
function detonate(sim: Simulation, e: number, f: MissileFlight): void {
  const px = sim.pos.f.x;
  const py = sim.pos.f.y;
  sim.spatial.forEachInRadius(f.x, f.y, f.blast + REACH_PAD, (o) => {
    if (!sim.unit.has(o) || sim.allied(sim.unit.f.owner[o], f.owner)) return;
    const edge = Math.max(0, Math.hypot(px[o] - f.x, py[o] - f.y) - halfSize(sim, o));
    if (edge > f.blast) return;
    const share = 1 - (1 - MISSILE_EDGE_DAMAGE) * (edge / f.blast);
    sim.damage(o, Math.max(1, Math.round(f.damage * share)), f.owner);
  });
  sim.emit(SimEvent.Death, e, 0);
  sim.destroyEntity(e);
}

/** True if an enemy unit or building is within the fuse radius of the missile. */
function nearEnemy(sim: Simulation, f: MissileFlight): boolean {
  const px = sim.pos.f.x;
  const py = sim.pos.f.y;
  let near = false;
  sim.spatial.forEachInRadius(f.x, f.y, MISSILE_FUSE_RADIUS + REACH_PAD, (o) => {
    if (near || !sim.unit.has(o) || sim.allied(sim.unit.f.owner[o], f.owner)) return;
    if (Math.hypot(px[o] - f.x, py[o] - f.y) - halfSize(sim, o) <= MISSILE_FUSE_RADIUS) near = true;
  });
  return near;
}

/** Flies every missile one tick: steer towards the target, advance, then burst if it should. */
export function missileSystem(sim: Simulation): void {
  const hp = sim.health.f.hp;
  // Copy: bursting destroys the entity, which edits the list being walked.
  for (const e of [...sim.missile.dense]) {
    const f = sim.flights[e];
    if (!f || hp[e] <= 0) continue; // shot down this tick: the death system removes it
    const t = sim.world.resolve(f.target);
    if (t >= 0 && sim.health.has(t) && hp[t] > 0) {
      const want = Math.atan2(sim.pos.f.y[t] - f.y, sim.pos.f.x[t] - f.x);
      const diff = Math.atan2(Math.sin(want - f.heading), Math.cos(want - f.heading));
      f.heading += Math.max(-f.turn, Math.min(f.turn, diff));
    }
    f.x += Math.cos(f.heading) * f.speed;
    f.y += Math.sin(f.heading) * f.speed;
    if (f.x < 0 || f.y < 0 || f.x >= sim.widthSub || f.y >= sim.heightSub) {
      f.x = Math.min(sim.widthSub - 1, Math.max(0, f.x));
      f.y = Math.min(sim.heightSub - 1, Math.max(0, f.y));
      sim.pos.f.x[e] = Math.round(f.x);
      sim.pos.f.y[e] = Math.round(f.y);
      detonate(sim, e, f);
      continue;
    }
    sim.pos.f.x[e] = Math.round(f.x);
    sim.pos.f.y[e] = Math.round(f.y);
    sim.pos.markChanged(e);
    const heading = quantise(f.heading);
    if (heading !== sim.missile.f.heading[e]) {
      sim.missile.f.heading[e] = heading;
      sim.missile.markChanged(e);
    }
    if (--f.ttl <= 0 || nearEnemy(sim, f)) detonate(sim, e, f);
  }
}
