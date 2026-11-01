import {
  LIGHT_FRIEND_MARGIN,
  LIGHT_FRIEND_RANGE,
  LIGHT_FULL_ABOVE,
  LIGHT_HALF_ANGLE,
  LIGHT_HOME_RADIUS,
  LIGHT_OFF_BELOW,
  LIGHT_TURN_PER_TICK,
  TILE,
} from './rules';
import type { Simulation } from './simulation';

/*
 * Spotlights. A spotlight module throws a beam from its owner along a `head`ing; the beam's length is proportional to the power it is
 * given (LIGHT_TILES_PER_ENERGY tiles for each point of energy per tick), so more power peers further into the dark. Whoever owns it
 * sees everything the beam falls on: it is one more wedge of vision (see `viewersOf` in vision.ts), cut short by rock and buildings
 * like any other sight. The light costs its power every tick; a light that cannot be paid for goes out for that tick.
 *
 * Like a shield, a light never aims itself: a program turns it (config.lightAngle, or the Spotlight block). Its settings live in
 * `Simulation.lights`, and the part both sides need (heading and the power actually paid) is replicated in the Light component.
 */

const TAU = Math.PI * 2;
const quantise = (heading: number): number => Math.round((((heading % TAU) + TAU) % TAU) / TAU * 256) & 255;
/** Wraps an angle difference into [-PI, PI]. */
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** The part of a light that does not replicate. Angles in radians (0 = east, increasing towards south). */
export interface LightState {
  /** Where the beam points now, and where it is turning to. */
  head: number;
  want: number;
  /** Energy per tick a script asked for (whole numbers, 0 = off). */
  wantPower: number;
}

/** Gives `e` the spotlight its blueprint has: on at its starting power, facing the middle of the map. */
export function addLight(sim: Simulation, e: number): void {
  const l = sim.blueprintOf(e)?.stats.light;
  if (!l) return;
  const head = Math.atan2(sim.heightSub / 2 - sim.pos.f.y[e], sim.widthSub / 2 - sim.pos.f.x[e]);
  sim.lights[e] = { head, want: head, wantPower: l.power };
  sim.light.add(e, { heading: quantise(head), power: 0, dim: 0 });
}

/**
 * Once a tick, before weapons fire. Every working spotlight (module on and unbroken, owner finished) turns towards the angle a
 * program asked for, at a limited speed, and pays for the power it asked for (up to what the module allows). It dims as its owner's
 * store runs down: full strength while it holds LIGHT_FULL_ABOVE (100) energy or more, in proportion less below that, and out at LIGHT_OFF_BELOW (30), so a starved
 * light fades instead of flickering. The beam is as long as the power it is paid, so it shortens as it dims. The Light component holds
 * the power actually paid (in tenths) and the brightness, so a light that is off or starved shows nothing.
 */
export function lightSystem(sim: Simulation): void {
  const f = sim.light.f;
  for (const e of sim.light.dense) {
    const st = sim.lights[e];
    if (!st) continue;
    const l = sim.stats(e).light;
    let power = 0;
    let dim = 0;
    if (l && !sim.isSite(e) && sim.health.f.hp[e] > 0) {
      st.wantPower = Math.min(st.wantPower, l.maxPower);
      const turn = wrap(st.want - st.head);
      st.head += Math.abs(turn) <= LIGHT_TURN_PER_TICK ? turn : Math.sign(turn) * LIGHT_TURN_PER_TICK;
      const fade = Math.min(1, Math.max(0, (sim.energy.f.amount[e] - LIGHT_OFF_BELOW) / (LIGHT_FULL_ABOVE - LIGHT_OFF_BELOW)));
      const paid = st.wantPower * fade;
      if (paid > 0 && sim.spend(e, Math.ceil(paid))) {
        power = Math.max(1, Math.round(paid * 10));
        dim = Math.round(fade * 255);
      }
    }
    const heading = quantise(st.head);
    if (f.heading[e] !== heading || f.power[e] !== power || f.dim[e] !== dim) {
      f.heading[e] = heading;
      f.power[e] = power;
      f.dim[e] = dim;
      sim.light.markChanged(e);
    }
  }
}

// --- Script settings ----------------------------------------------------------------------

/** Point the spotlight along an angle in degrees (0 = east, 90 = south); it turns there at a limited speed. Returns the angle, or -1 without a working spotlight. */
export function setLightAngle(sim: Simulation, e: number, degrees: number): number {
  const st = sim.lights[e];
  if (!st || !sim.stats(e).light) return -1;
  const d = ((Math.round(degrees) % 360) + 360) % 360;
  st.want = (d * Math.PI) / 180;
  return d;
}

/** Sets the energy per tick the spotlight is given, from 0 (off) up to what the module allows. Returns the power it is set to, or -1 without a working spotlight. */
export function setLightPower(sim: Simulation, e: number, energy: number): number {
  const st = sim.lights[e];
  const l = sim.stats(e).light;
  if (!st || !l) return -1;
  st.wantPower = Math.min(l.maxPower, Math.max(0, Math.round(energy)));
  return st.wantPower;
}

/** The angle in degrees the spotlight is turning to (where a program last pointed it), or -1 without a working spotlight. */
export function lightAngleOf(sim: Simulation, e: number): number {
  const st = sim.lights[e];
  if (!st || !sim.stats(e).light) return -1;
  return ((Math.round((st.want * 180) / Math.PI) % 360) + 360) % 360;
}

// --- Looking outwards ----------------------------------------------------------------------

let nearSim: Simulation;
let nearE = 0;
let nearOwner = 0;
let sumX = 0;
let sumY = 0;
let nearCount = 0;
const addHome = (o: number): void => {
  if (o === nearE || !nearSim.unit.has(o) || !nearSim.allied(nearSim.unit.f.owner[o], nearOwner)) return;
  sumX += nearSim.pos.f.x[o] - nearSim.pos.f.x[nearE];
  sumY += nearSim.pos.f.y[o] - nearSim.pos.f.y[nearE];
  nearCount++;
};

/**
 * The angle in degrees (0 = east, 90 = south) that points away from home: opposite the middle of the allied units and buildings within
 * LIGHT_HOME_RADIUS of `e`. With nothing allied about (or them evenly all round), away from the middle of the map. Where a light should
 * look to see the edge of what its side knows, rather than back over its own base.
 */
export function outwardBearing(sim: Simulation, e: number): number {
  nearSim = sim;
  nearE = e;
  nearOwner = sim.unit.f.owner[e];
  sumX = 0;
  sumY = 0;
  nearCount = 0;
  sim.spatial.forEachInRadius(sim.pos.f.x[e], sim.pos.f.y[e], LIGHT_HOME_RADIUS * TILE, addHome);
  let dx = -sumX;
  let dy = -sumY;
  if (nearCount === 0 || Math.hypot(dx, dy) < nearCount * TILE * 0.5) {
    dx = sim.pos.f.x[e] - sim.widthSub / 2;
    dy = sim.pos.f.y[e] - sim.heightSub / 2;
  }
  return ((Math.round((Math.atan2(dy, dx) * 180) / Math.PI) % 360) + 360) % 360;
}

let friendHit = false;
let friendHead = 0;
const checkFriend = (o: number): void => {
  if (friendHit || o === nearE || !nearSim.unit.has(o) || nearSim.stats(o).structure || !nearSim.allied(nearSim.unit.f.owner[o], nearOwner)) return;
  const a = Math.atan2(nearSim.pos.f.y[o] - nearSim.pos.f.y[nearE], nearSim.pos.f.x[o] - nearSim.pos.f.x[nearE]);
  if (Math.abs(wrap(a - friendHead)) <= LIGHT_HALF_ANGLE + LIGHT_FRIEND_MARGIN) friendHit = true;
};

/** True if a beam pointed along `degrees` would fall on an allied unit (not a building) within LIGHT_FRIEND_RANGE tiles of `e`. */
export function lightBlocked(sim: Simulation, e: number, degrees: number): boolean {
  nearSim = sim;
  nearE = e;
  nearOwner = sim.unit.f.owner[e];
  friendHit = false;
  friendHead = (degrees * Math.PI) / 180;
  sim.spatial.forEachInRadius(sim.pos.f.x[e], sim.pos.f.y[e], LIGHT_FRIEND_RANGE * TILE, checkFriend);
  return friendHit;
}
