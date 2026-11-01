import { SimEvent } from './events';
import {
  ELEVATION_RANGE_PER_LEVEL,
  FLYER_ELEVATION,
  SHELL_BOUNCE_KEEP,
  SHELL_BOUNCE_ROCK_CHANCE,
  SHELL_BOUNCE_UNIT_CHANCE,
  SHELL_MAX_BOUNCES,
  SHELL_SPEED,
  SHELL_SPREAD,
  SHELL_UNIT_RADIUS,
  TILE,
} from './rules';
import { shieldAbsorb, shieldBlock, shieldHit } from './shield';
import type { Simulation } from './simulation';
import type { BlueprintStats } from './blueprint';

/*
 * Cannon shells. A cannon does not hurt its target directly: it fires a shell, an entity with a
 * Position and a Shell component (what clients draw) that flies in a straight line to the end of the
 * cannon's range and keeps going past a target it misses. Everything that does not replicate lives in
 * `Simulation.shellFlights`.
 *
 * A shell flies at the shooter's elevation: rock no higher than that is cleared, higher rock stops it
 * (or, now and then, it glances off). It explodes on the first enemy unit or building it meets, with
 * a small chance to glance off that instead. A glancing shell loses speed and part of its flight and
 * ignores the thing it glanced off. A spent shell stays one tick where it landed so clients can show it.
 */

export interface ShellFlight {
  x: number;
  y: number;
  /** Velocity in sub-tile units per tick. */
  vx: number;
  vy: number;
  /** Sub-tile units of flight left. */
  left: number;
  damage: number;
  owner: number;
  /** Module class the cannon aimed at (0 = any). */
  aim: number;
  /** Rock up to this height is flown over. */
  height: number;
  bounces: number;
  /** Entity handle of the unit it last glanced off, which it ignores from then on (-1 = none). */
  ignore: number;
  /** Landed this tick: removed at the start of the next. */
  spent: boolean;
}

const TAU = Math.PI * 2;
const quantise = (heading: number): number => Math.round((((heading % TAU) + TAU) % TAU) / TAU * 256) & 255;
/** Distance per collision test: small enough that a shell cannot skip over a unit or a rock tile. */
const SUB_STEP = 0.3 * TILE;

type CannonStats = NonNullable<BlueprintStats['weapon']>;

/** How high a shooter or target stands: the rock under it, or a little for a flyer. */
export function elevationOf(sim: Simulation, e: number): number {
  if (!sim.unit.has(e)) return 0; // a missile in the air counts as ground level for range
  if (sim.stats(e).flying) return FLYER_ELEVATION;
  return sim.terrain.heightAt(sim.tileX(sim.pos.f.x[e]), sim.tileY(sim.pos.f.y[e]));
}

/** Extra range a shooter gets for standing above its target (zero for the tesla coil and flak, whose reach is fixed). */
export function rangeBonus(sim: Simulation, shooter: number, target: number, kind: string): number {
  if (kind === 'tesla' || kind === 'flak') return 0;
  const up = elevationOf(sim, shooter) - elevationOf(sim, target);
  return up > 0 ? up * ELEVATION_RANGE_PER_LEVEL : 0;
}

const halfSize = (sim: Simulation, o: number): number => (sim.unit.has(o) ? (sim.stats(o).footprint * TILE) / 2 : 0);
/** The biggest building is 3x3, so look this far beyond a radius to catch buildings by their edge. */
const REACH_PAD = 1.5 * TILE;

/** Fires a shell from `e` at `target`. The caller has already paid for it. */
export function launchShell(sim: Simulation, e: number, target: number, w: CannonStats): number {
  const x = sim.pos.f.x[e];
  const y = sim.pos.f.y[e];
  const aim = Math.atan2(sim.pos.f.y[target] - y, sim.pos.f.x[target] - x) + ((sim.rng.int(2001) - 1000) / 1000) * SHELL_SPREAD;
  const speed = SHELL_SPEED * TILE;
  const out = halfSize(sim, e) + 0.4 * TILE; // leaves the muzzle, not the middle
  const owner = sim.unit.f.owner[e];
  const id = sim.world.create();
  const sx = x + Math.cos(aim) * out;
  const sy = y + Math.sin(aim) * out;
  sim.pos.add(id, { x: Math.round(sx), y: Math.round(sy) });
  sim.shell.add(id, { owner, size: Math.min(255, w.damage), heading: quantise(aim), state: 0 });
  sim.shellFlights[id] = {
    x: sx,
    y: sy,
    vx: Math.cos(aim) * speed,
    vy: Math.sin(aim) * speed,
    left: w.range + rangeBonus(sim, e, target, w.kind) + halfSize(sim, target),
    damage: w.damage,
    owner,
    aim: sim.firing.f.aim[e],
    height: elevationOf(sim, e),
    bounces: 0,
    ignore: -1,
    spent: false,
  };
  return id;
}

function finish(sim: Simulation, e: number, f: ShellFlight, event: number): void {
  f.spent = true;
  sim.pos.f.x[e] = Math.round(f.x);
  sim.pos.f.y[e] = Math.round(f.y);
  sim.pos.markChanged(e);
  sim.shell.f.state[e] = 1;
  sim.shell.markChanged(e);
  sim.emit(event, e, e);
}

/** Turns the shell to a new direction (radians), keeping part of its speed and flight. */
function glance(sim: Simulation, e: number, f: ShellFlight, angle: number): void {
  const speed = Math.hypot(f.vx, f.vy) * SHELL_BOUNCE_KEEP;
  f.vx = Math.cos(angle) * speed;
  f.vy = Math.sin(angle) * speed;
  f.left *= SHELL_BOUNCE_KEEP;
  f.bounces++;
  sim.pos.f.x[e] = Math.round(f.x);
  sim.pos.f.y[e] = Math.round(f.y);
  sim.pos.markChanged(e);
  sim.shell.f.heading[e] = quantise(angle);
  sim.shell.markChanged(e);
  sim.emit(SimEvent.ShellBounce, e, e);
}

const roll = (sim: Simulation, chance: number): boolean => sim.rng.int(1000) < chance * 1000;

/** First enemy unit or building the point is inside, or -1. */
function enemyAt(sim: Simulation, f: ShellFlight): number {
  const px = sim.pos.f.x;
  const py = sim.pos.f.y;
  const hp = sim.health.f.hp;
  let found = -1;
  sim.spatial.forEachInRadius(f.x, f.y, SHELL_UNIT_RADIUS + REACH_PAD, (o) => {
    if (found >= 0 || !sim.unit.has(o) || !sim.health.has(o) || hp[o] <= 0 || sim.allied(sim.unit.f.owner[o], f.owner)) return;
    if (sim.world.handle(o) === f.ignore) return;
    const half = halfSize(sim, o);
    // A building is hit anywhere inside its square, a unit within its radius.
    const hit = half > 0 ? Math.abs(px[o] - f.x) <= half && Math.abs(py[o] - f.y) <= half : Math.hypot(px[o] - f.x, py[o] - f.y) <= SHELL_UNIT_RADIUS;
    if (hit) found = o;
  });
  return found;
}

/** Flies every shell one tick, in small steps so none passes through a unit or a rock. */
export function shellSystem(sim: Simulation): void {
  // Copy: landing and removal edit the list being walked.
  for (const e of [...sim.shell.dense]) {
    const f = sim.shellFlights[e];
    if (!f || f.spent) {
      sim.destroyEntity(e);
      continue;
    }
    const steps = Math.max(1, Math.ceil(Math.hypot(f.vx, f.vy) / SUB_STEP));
    const sx = f.vx / steps;
    const sy = f.vy / steps;
    const stepLen = Math.hypot(sx, sy);
    for (let i = 0; i < steps; i++) {
      const nx = f.x + sx;
      const ny = f.y + sy;
      if (nx < 0 || ny < 0 || nx >= sim.widthSub || ny >= sim.heightSub) {
        f.x = Math.min(sim.widthSub - 1, Math.max(0, nx));
        f.y = Math.min(sim.heightSub - 1, Math.max(0, ny));
        finish(sim, e, f, SimEvent.ShellLand);
        break;
      }
      const tx = Math.floor(nx / TILE);
      const ty = Math.floor(ny / TILE);
      if (sim.terrain.heightAt(tx, ty) > f.height) {
        if (f.bounces < SHELL_MAX_BOUNCES && roll(sim, SHELL_BOUNCE_ROCK_CHANCE)) {
          // Turn back off the face it struck: flip the axis whose tile changed (both, in a corner).
          const crossX = tx !== Math.floor(f.x / TILE);
          const crossY = ty !== Math.floor(f.y / TILE);
          if (crossX || !crossY) f.vx = -f.vx;
          if (crossY || !crossX) f.vy = -f.vy;
          glance(sim, e, f, Math.atan2(f.vy, f.vx) + ((sim.rng.int(2001) - 1000) / 1000) * 0.3);
        } else {
          finish(sim, e, f, SimEvent.ShellLand);
        }
        break;
      }
      if (sim.shieldList.length > 0) {
        // An enemy shield across this step stops the shell dead; the owner's battery pays for the damage it would have done.
        const shield = shieldBlock(sim, f.owner, f.x, f.y, nx, ny);
        if (shield >= 0) {
          f.x = shieldHit.x;
          f.y = shieldHit.y;
          finish(sim, e, f, SimEvent.ShellLand);
          shieldAbsorb(sim, shield, f.damage, f.owner, f.x, f.y);
          break;
        }
      }
      f.x = nx;
      f.y = ny;
      f.left -= stepLen;
      const o = enemyAt(sim, f);
      if (o >= 0) {
        if (f.bounces < SHELL_MAX_BOUNCES && roll(sim, SHELL_BOUNCE_UNIT_CHANCE)) {
          f.ignore = sim.world.handle(o);
          const away = Math.atan2(f.y - sim.pos.f.y[o], f.x - sim.pos.f.x[o]) + ((sim.rng.int(2001) - 1000) / 1000) * 0.8;
          glance(sim, e, f, away);
        } else {
          finish(sim, e, f, SimEvent.ShellHit);
          sim.damage(o, f.damage, f.owner, f.aim);
        }
        break;
      }
      if (f.left <= 0) {
        finish(sim, e, f, SimEvent.ShellLand);
        break;
      }
    }
    if (f.spent) continue;
    sim.pos.f.x[e] = Math.round(f.x);
    sim.pos.f.y[e] = Math.round(f.y);
    sim.pos.markChanged(e);
    const heading = quantise(Math.atan2(f.vy, f.vx));
    if (heading !== sim.shell.f.heading[e]) {
      sim.shell.f.heading[e] = heading;
      sim.shell.markChanged(e);
    }
  }
}
