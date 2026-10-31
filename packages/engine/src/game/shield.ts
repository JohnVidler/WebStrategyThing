import { SimEvent } from './events';
import { PARTS } from './parts';
import {
  SHIELD_BURST_DAMAGE_FRACTION,
  SHIELD_CLEARANCE,
  SHIELD_EASE,
  SHIELD_ENERGY_PER_DAMAGE,
  SHIELD_INTERFERENCE_DRAIN,
  SHIELD_INCOMING_RANGE,
  SHIELD_TURN_PER_TICK,
  TILE,
} from './rules';
import type { Simulation } from './simulation';

/*
 * Energy shields. A shield emitter projects an arc of energy, centred on its owner and `range` out from it, that
 * covers `arc` radians around a `head`ing. Enemy units cannot cross the arc, and enemy shots (cannon shells, missiles,
 * guns and lasers) that cross it are stopped; allies pass through. Whatever it stops drains the owner's battery
 * (SHIELD_ENERGY_PER_DAMAGE per point of damage); when that runs flat the shield collapses: the emitter breaks and
 * the owner is hurt in proportion to how much energy it could store.
 *
 * The shield has no entity of its own: its settings live in `Simulation.shields` and are replicated in the Shield
 * component of the owner. `Simulation.shieldList` holds the shields that are up this tick (rebuilt by `shieldSystem`),
 * which is all the projectile and movement systems look at, so a match without shields pays one length check.
 */

const TAU = Math.PI * 2;
const quantise = (heading: number): number => Math.round((((heading % TAU) + TAU) % TAU) / TAU * 256) & 255;
/** Wraps an angle difference into [-PI, PI]. */
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** The least arc a script can ask for (radians, about 10 degrees). */
export const SHIELD_MIN_ARC = 0.17;

/** The part of a shield that does not replicate. Angles in radians (0 = east, increasing towards south, as for missiles). */
export interface ShieldState {
  /** Where the arc points now, and where it is turning to. */
  head: number;
  want: number;
  /** Arc and radius (sub-tile units) now, and what a script asked for: they ease towards it. */
  arc: number;
  wantArc: number;
  range: number;
  wantRange: number;
  /** Up this tick. */
  live: boolean;
  /** Working this tick (module on, owner finished), and how many points its arc crosses another's. */
  cand: boolean;
  cross: number;
}

/** Where the last `shieldBlock` that found something crossed the arc (sub-tile units). Reused: read it straight away. */
export const shieldHit = { x: 0, y: 0 };

/** The nearest an emitter's arc may sit to its owner's centre: clear of the hull. */
export function shieldMinRange(sim: Simulation, e: number): number {
  const s = sim.stats(e);
  return (s.structure ? (s.footprint * TILE) / 2 : s.radius) + SHIELD_CLEARANCE;
}

/** Gives `e` the shield its blueprint has (it starts down, facing the middle of the map). */
export function addShield(sim: Simulation, e: number): void {
  const sh = sim.blueprintOf(e)?.stats.shield;
  if (!sh) return;
  const range = Math.max(sh.range, shieldMinRange(sim, e));
  const head = Math.atan2(sim.heightSub / 2 - sim.pos.f.y[e], sim.widthSub / 2 - sim.pos.f.x[e]);
  sim.shields[e] = { head, want: head, arc: sh.arc, wantArc: sh.arc, range, wantRange: range, live: false, cand: false, cross: 0 };
  sim.shield.add(e, { heading: quantise(head), arc: Math.min(255, Math.round((sh.arc / TAU) * 256)), range: Math.min(255, Math.round((range / TILE) * 10)), active: 0, strain: 0 });
}

/** Energy per tick the shield costs: the module's `use` at its starting size, in proportion to the arc and radius now. */
export function shieldCost(use: number, defaultArc: number, defaultRange: number, arc: number, range: number): number {
  return Math.max(1, Math.ceil((use * arc * range) / (defaultArc * defaultRange)));
}

// --- Geometry -------------------------------------------------------------------------

/**
 * Where the segment from (x0, y0) to (x1, y1) crosses an arc of radius `range` about (cx, cy), covering `arc` radians
 * about `head`: its distance along the segment from 0 to 1, or -1 if it does not cross (a segment that stays on one side of the
 * circle, or crosses where the arc is not). The point is left in `shieldHit`. Pure: the client uses it too.
 */
export function arcCrossing(cx: number, cy: number, range: number, head: number, arc: number, x0: number, y0: number, x1: number, y1: number): number {
  const ax = x0 - cx;
  const ay = y0 - cy;
  const bx = x1 - cx;
  const by = y1 - cy;
  const r2 = range * range;
  if ((ax * ax + ay * ay < r2) === (bx * bx + by * by < r2)) return -1; // both ends on the same side of the circle
  const vx = x1 - x0;
  const vy = y1 - y0;
  const a = vx * vx + vy * vy;
  const b = 2 * (ax * vx + ay * vy);
  const disc = b * b - 4 * a * (ax * ax + ay * ay - r2);
  if (a === 0 || disc < 0) return -1;
  const root = Math.sqrt(disc);
  let t = (-b - root) / (2 * a);
  if (t < 0 || t > 1) t = (-b + root) / (2 * a);
  if (t < 0 || t > 1) return -1;
  const px = ax + vx * t;
  const py = ay + vy * t;
  if (Math.abs(wrap(Math.atan2(py, px) - head)) > arc / 2) return -1;
  shieldHit.x = cx + px;
  shieldHit.y = cy + py;
  return t;
}

/**
 * Where the circles of two arcs cross, keeping only the points that lie on both arcs: pushes [x, y, ...] onto `out` and returns
 * how many points (0 to 2). Pure and in any one unit of length: the client uses it on screen coordinates.
 */
export function circleArcCrossings(
  ax: number, ay: number, ar: number, ah: number, aa: number,
  bx: number, by: number, br: number, bh: number, ba: number,
  out: number[],
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const d = Math.hypot(dx, dy);
  if (d === 0 || d > ar + br || d < Math.abs(ar - br)) return 0;
  const along = (ar * ar - br * br + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, ar * ar - along * along));
  const mx = ax + (dx * along) / d;
  const my = ay + (dy * along) / d;
  let n = 0;
  for (let k = 0; k < 2; k++) {
    const sign = k === 0 ? 1 : -1;
    const px = mx + (-dy * h * sign) / d;
    const py = my + (dx * h * sign) / d;
    if (Math.abs(wrap(Math.atan2(py - ay, px - ax) - ah)) <= aa / 2 && Math.abs(wrap(Math.atan2(py - by, px - bx) - bh)) <= ba / 2) {
      out.push(px, py);
      n++;
    }
  }
  return n;
}

/**
 * The enemy shield (of anyone not allied to `owner`) that the segment crosses first, or -1. The crossing point is in `shieldHit`.
 * Cheap when no shield is up.
 */
export function shieldBlock(sim: Simulation, owner: number, x0: number, y0: number, x1: number, y1: number): number {
  const list = sim.shieldList;
  let best = -1;
  let bestT = 2;
  let hx = 0;
  let hy = 0;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    const st = sim.shields[e];
    if (!st || !st.live || sim.health.f.hp[e] <= 0 || sim.allied(sim.unit.f.owner[e], owner)) continue;
    const t = arcCrossing(sim.pos.f.x[e], sim.pos.f.y[e], st.range, st.head, st.arc, x0, y0, x1, y1);
    if (t >= 0 && t < bestT) {
      best = e;
      bestT = t;
      hx = shieldHit.x;
      hy = shieldHit.y;
    }
  }
  shieldHit.x = hx;
  shieldHit.y = hy;
  return best;
}

/** True if a unit of `e`'s owner stepping from one point to another would cross an enemy shield. */
export function moveBlocked(sim: Simulation, e: number, x0: number, y0: number, x1: number, y1: number): boolean {
  return sim.shieldList.length > 0 && shieldBlock(sim, sim.unit.f.owner[e], x0, y0, x1, y1) >= 0;
}

/**
 * How far `e` must shoot to hit `t`: its edge distance, or, when an enemy shield arc lies across the line, the distance to
 * where the line meets the arc (the shield extends beyond its owner, and the arc is what the shot will hit). Used for deciding
 * whether a weapon is in range, so a unit stops as soon as it can reach the target or the shield in front of it.
 */
export function reachDistance(sim: Simulation, e: number, t: number): number {
  const edge = sim.edgeDistance(e, t);
  if (sim.shieldList.length === 0 || sim.missile.has(t)) return edge; // shots at a missile fly over shields
  const x = sim.pos.f.x[e];
  const y = sim.pos.f.y[e];
  if (shieldBlock(sim, sim.unit.f.owner[e], x, y, sim.pos.f.x[t], sim.pos.f.y[t]) < 0) return edge;
  return Math.min(edge, Math.hypot(shieldHit.x - x, shieldHit.y - y));
}

// --- Taking hits ------------------------------------------------------------------------

/**
 * Shield `e` stops `damage` from `attacker` at (x, y): its owner's battery pays. If the battery cannot, the shield
 * collapses (see `collapse`).
 */
export function shieldAbsorb(sim: Simulation, e: number, damage: number, attacker: number, x: number, y: number): void {
  const heading = quantise(Math.atan2(y - sim.pos.f.y[e], x - sim.pos.f.x[e]));
  sim.emit(SimEvent.ShieldHit, e, heading + 256 * Math.min(255, Math.max(1, Math.round(damage))));
  sim.lastHitBy[e] = attacker;
  const cost = Math.ceil(damage * SHIELD_ENERGY_PER_DAMAGE);
  const have = sim.energy.f.amount[e];
  if (have > cost) {
    sim.energy.f.amount[e] = have - cost;
    return;
  }
  collapse(sim, e, attacker);
}

/** The battery ran flat under a hit: the emitter is destroyed and the owner takes a blast scaled to its energy capacity. */
function collapse(sim: Simulation, e: number, attacker: number): void {
  const st = sim.shields[e];
  if (st) st.live = false;
  const capacity = sim.stats(e).energyCapacity;
  sim.energy.f.amount[e] = 0;
  const parts = sim.blueprintOf(e)?.parts ?? [];
  const index = parts.findIndex((id) => PARTS[id]?.slot === 'shield');
  if (index >= 0) sim.breakPart(e, index);
  sim.emit(SimEvent.ShieldBurst, e, e);
  sim.damage(e, Math.max(1, Math.round(capacity * SHIELD_BURST_DAMAGE_FRACTION)), attacker);
}

// --- The system -------------------------------------------------------------------------

let seekSim: Simulation;
let seekOwner = 0;
const isThreat = (o: number): boolean => {
  // A shell has no Health (only a missile can be shot down), so only a missile's hit points are checked.
  if (seekSim.missile.has(o)) return seekSim.health.f.hp[o] > 0 && !seekSim.allied(seekSim.missile.f.owner[o], seekOwner);
  return seekSim.shell.has(o) && seekSim.shell.f.state[o] === 0 && !seekSim.allied(seekSim.shell.f.owner[o], seekOwner);
};

let pairSim: Simulation;
let pairE = 0;
let pairState: ShieldState;
const crossTmp: number[] = [];
/** Counts the points where shield `pairE`'s arc crosses the arc of the shield on entity `o` (each pair once: only higher entities). */
const visitPair = (o: number): void => {
  if (o <= pairE) return;
  const b = pairSim.shields[o];
  if (!b || !b.cand) return;
  const a = pairState;
  crossTmp.length = 0;
  const n = circleArcCrossings(pairSim.pos.f.x[pairE], pairSim.pos.f.y[pairE], a.range, a.head, a.arc, pairSim.pos.f.x[o], pairSim.pos.f.y[o], b.range, b.head, b.arc, crossTmp);
  a.cross += n;
  b.cross += n;
};

/** Moves `cur` a share of the way to `want`, landing on it once it is close. */
const ease = (cur: number, want: number, snap: number): number => (Math.abs(want - cur) <= snap ? want : cur + (want - cur) * SHIELD_EASE);

/**
 * Once a tick, before weapons fire. First every working shield eases its arc, radius and heading towards what a script asked for
 * (the engine never chooses where to point: the ShieldGuard block, or a program of the player's own, does); then the points where
 * two arcs cross are counted, and each shield pays its per-tick cost times SHIELD_INTERFERENCE_DRAIN for every one; and the ones
 * that could pay are listed as up. A shield works if its module is on and unbroken and the owner is finished.
 */
export function shieldSystem(sim: Simulation): void {
  const list = sim.shieldList;
  list.length = 0;
  const f = sim.shield.f;
  let working = 0;
  for (const e of sim.shield.dense) {
    const st = sim.shields[e];
    if (!st) continue;
    const sh = sim.stats(e).shield;
    st.cand = sh !== null && !sim.isSite(e) && sim.health.f.hp[e] > 0;
    st.cross = 0;
    st.live = false;
    if (!st.cand || !sh) continue;
    working++;
    st.wantArc = Math.min(st.wantArc, sh.maxArc);
    st.wantRange = Math.min(Math.max(st.wantRange, shieldMinRange(sim, e)), sh.maxRange);
    st.arc = ease(st.arc, st.wantArc, 0.005);
    st.range = ease(st.range, st.wantRange, TILE / 50);
    const turn = wrap(st.want - st.head);
    st.head += Math.abs(turn) < 0.005 ? turn : Math.max(-SHIELD_TURN_PER_TICK, Math.min(SHIELD_TURN_PER_TICK, turn * SHIELD_EASE * 2));
  }
  pairSim = sim;
  if (working > 1) {
    for (const e of sim.shield.dense) {
      const st = sim.shields[e];
      const sh = st && st.cand ? sim.stats(e).shield : null;
      if (!st || !sh) continue;
      pairE = e;
      pairState = st;
      sim.spatial.forEachInRadius(sim.pos.f.x[e], sim.pos.f.y[e], st.range + sh.maxRange, visitPair);
    }
  }
  for (const e of sim.shield.dense) {
    const st = sim.shields[e];
    if (!st) continue;
    const sh = sim.stats(e).shield;
    if (st.cand && sh) {
      let cost = shieldCost(sh.use, sh.arc, sh.range, st.arc, st.range);
      for (let i = 0; i < st.cross; i++) cost *= SHIELD_INTERFERENCE_DRAIN;
      st.live = sim.spend(e, Math.ceil(cost));
      if (st.live) list.push(e);
    }
    const heading = quantise(st.head);
    const arc = Math.min(255, Math.round((st.arc / TAU) * 256));
    const range = Math.min(255, Math.round((st.range / TILE) * 10));
    const active = st.live ? 1 : 0;
    const strain = st.live ? Math.min(255, st.cross) : 0;
    if (f.heading[e] !== heading || f.arc[e] !== arc || f.range[e] !== range || f.active[e] !== active || f.strain[e] !== strain) {
      f.heading[e] = heading;
      f.arc[e] = arc;
      f.range[e] = range;
      f.active[e] = active;
      f.strain[e] = strain;
      sim.shield.markChanged(e);
    }
  }
}

// --- Script settings ----------------------------------------------------------------------

/** Point the shield along an angle in degrees (0 = east, 90 = south); it turns there at a limited speed. Returns the angle now, or -1 without a working emitter. */
export function setShieldAngle(sim: Simulation, e: number, degrees: number): number {
  const st = sim.shields[e];
  if (!st || !sim.stats(e).shield) return -1;
  const d = ((Math.round(degrees) % 360) + 360) % 360;
  st.want = (d * Math.PI) / 180;
  return d;
}

/** Sets how wide the arc is, in degrees (within the emitter's limits). A wider arc costs more energy per tick. Returns the arc it is moving to, or -1 without a working emitter. */
export function setShieldArc(sim: Simulation, e: number, degrees: number): number {
  const st = sim.shields[e];
  const sh = sim.stats(e).shield;
  if (!st || !sh) return -1;
  st.wantArc = Math.min(sh.maxArc, Math.max(SHIELD_MIN_ARC, (Math.round(degrees) * Math.PI) / 180));
  return Math.round((st.wantArc * 180) / Math.PI);
}

/** Sets the arc's distance from the owner's centre, in tiles (within the emitter's limits and clear of the hull). A longer reach costs more. Returns the tiles it is moving to, or -1 without a working emitter. */
export function setShieldRange(sim: Simulation, e: number, tiles: number): number {
  const st = sim.shields[e];
  const sh = sim.stats(e).shield;
  if (!st || !sh) return -1;
  st.wantRange = Math.min(sh.maxRange, Math.max(shieldMinRange(sim, e), Math.round(tiles) * TILE));
  return Math.round(st.wantRange / TILE);
}

/** Bearing in degrees (0 = east, 90 = south) from `e` to `t`: the number to give shieldAngle to face it. */
export function bearingTo(sim: Simulation, e: number, t: number): number {
  const d = (Math.atan2(sim.pos.f.y[t] - sim.pos.f.y[e], sim.pos.f.x[t] - sim.pos.f.x[e]) * 180) / Math.PI;
  return ((Math.round(d) % 360) + 360) % 360;
}

/** Bearing in degrees to the nearest enemy shell or missile in flight within SHIELD_INCOMING_RANGE of `e`, or -1 if there is none. */
export function incomingBearing(sim: Simulation, e: number): number {
  seekSim = sim;
  seekOwner = sim.unit.f.owner[e];
  const o = sim.spatial.nearest(sim.pos.f.x[e], sim.pos.f.y[e], SHIELD_INCOMING_RANGE, isThreat);
  return o < 0 ? -1 : bearingTo(sim, e, o);
}
