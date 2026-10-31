import { SimEvent } from './events';
import {
  FLAME_BURN_DAMAGE,
  FLAME_BURN_INTERVAL,
  FLAME_BURN_TICKS,
  FLAME_BURST_BURN_TICKS,
  FLAME_BURST_DAMAGE,
  FLAME_SPREAD,
  FLAME_BURST_COUNT,
  FLAME_BURST_REACH,
  FLAME_BURST_STRUCTURE_BONUS,
  FLAME_DEFLECT_KEEP,
  FLAME_MAX_DEFLECTIONS,
  FLAME_RAIN_BURN_FACTOR,
  FLAME_RADIUS,
  FLAME_SHIELD_DAMAGE,
  FLAME_SPEED,
  MAX_FLAMES,
  TILE,
} from './rules';
import { shieldAbsorb, shieldBlock, shieldHit } from './shield';
import type { Simulation } from './simulation';

/*
 * Flamethrower. The projector lobs a fireball: an entity with a Position and a Flame component (what clients draw)
 * that flies slowly in a straight line over the ground, whatever stands in its way, to the spot it was aimed at.
 * There it sticks and burns in place for FLAME_BURN_TICKS; the same entity becomes the fire. Every few ticks a fire
 * hurts each unit and building that touches it, whoever owns them: it knows no friends. An enemy shield across the
 * fireball's path turns it back (the shield's battery pays a little). A unit or building that carries a projector
 * takes extra damage (see `Simulation.damage`) and, when it dies, throws fireballs in every direction (`flameBurst`).
 * Everything that does not replicate lives in `Simulation.flameFlights`.
 */

export interface FlameFlight {
  x: number;
  y: number;
  /** Velocity in sub-tile units per tick while in the air. */
  vx: number;
  vy: number;
  /** Ticks of flight left (0 once it is burning), and the length of the hop it is on. */
  left: number;
  span: number;
  /** Ticks of burning left (counted once landed); rain takes them off faster. `total` is how many it started with. */
  burn: number;
  total: number;
  /** Damage each burn pulse does. */
  damage: number;
  /** The player credited with what the fire kills. */
  owner: number;
  deflections: number;
}

const TAU = Math.PI * 2;
/** Fire life is replicated in this many steps. */
export const FLAME_LIFE_STEPS = 32;

/** Lobs a fireball from (x, y) at (tx, ty). Returns its entity, or -1 if there are too many already. */
export function lobFlame(sim: Simulation, x: number, y: number, tx: number, ty: number, owner: number, burn = FLAME_BURN_TICKS, damage = FLAME_BURN_DAMAGE): number {
  if (sim.flame.dense.length >= MAX_FLAMES) return -1;
  tx = Math.min(sim.widthSub - 1, Math.max(0, tx));
  ty = Math.min(sim.heightSub - 1, Math.max(0, ty));
  const dist = Math.hypot(tx - x, ty - y);
  const span = Math.max(1, Math.round(dist / (FLAME_SPEED * TILE)));
  const id = sim.world.create();
  sim.pos.add(id, { x: Math.round(x), y: Math.round(y) });
  sim.flame.add(id, { owner, state: 0, arc: 0, life: FLAME_LIFE_STEPS });
  sim.flameFlights[id] = { x, y, vx: (tx - x) / span, vy: (ty - y) / span, left: span, span, burn, total: burn, damage, owner, deflections: 0 };
  return id;
}

/** Fires a projector at `target`: a fireball from the muzzle to where the target stands, with a little spread. */
export function launchFlame(sim: Simulation, e: number, target: number): number {
  const x = sim.pos.f.x[e];
  const y = sim.pos.f.y[e];
  const spread = FLAME_SPREAD;
  const tx = sim.pos.f.x[target] + ((sim.rng.int(2001) - 1000) / 1000) * spread;
  const ty = sim.pos.f.y[target] + ((sim.rng.int(2001) - 1000) / 1000) * spread;
  return lobFlame(sim, x, y, tx, ty, sim.unit.f.owner[e]);
}

/** True if `e` carries a flame projector (and so is fragile and bursts when it dies). */
export function carriesFlame(sim: Simulation, e: number): boolean {
  return sim.unit.has(e) && sim.stats(e).weapon?.kind === 'flame';
}

/** `e` has just died: it throws fireballs all round, landing at random up to FLAME_BURST_REACH tiles out. */
export function flameBurst(sim: Simulation, e: number): void {
  flameBurstAt(sim, sim.pos.f.x[e], sim.pos.f.y[e], FLAME_BURST_COUNT + (sim.stats(e).structure ? FLAME_BURST_STRUCTURE_BONUS : 0), sim.lastHitBy[e] || sim.unit.f.owner[e]);
}

/** `n` fireballs thrown evenly round (x, y), each landing at a random distance. */
export function flameBurstAt(sim: Simulation, x: number, y: number, n: number, owner: number): void {
  for (let i = 0; i < n; i++) {
    const angle = ((i + sim.rng.int(1000) / 1000) / n) * TAU;
    const dist = (0.6 + (sim.rng.int(1000) / 1000) * (FLAME_BURST_REACH - 0.6)) * TILE;
    lobFlame(sim, x, y, x + Math.cos(angle) * dist, y + Math.sin(angle) * dist, owner, FLAME_BURST_BURN_TICKS, FLAME_BURST_DAMAGE);
  }
}

// The scorch visitor is shared so a burning fire allocates nothing.
let scorchSim: Simulation;
let scorchX = 0;
let scorchY = 0;
let scorchOwner = 0;
let scorchDamage = 0;

function scorchOne(o: number): void {
  const sim = scorchSim;
  if (!sim.unit.has(o) || !sim.health.has(o) || sim.health.f.hp[o] <= 0) return;
  const s = sim.stats(o);
  if (s.flying) return; // fire is on the ground
  const dx = sim.pos.f.x[o] - scorchX;
  const dy = sim.pos.f.y[o] - scorchY;
  // A building burns when the fire is on its footprint, a unit when the fire reaches its hull.
  const hit = s.structure
    ? Math.abs(dx) <= (s.footprint * TILE) / 2 + FLAME_RADIUS / 2 && Math.abs(dy) <= (s.footprint * TILE) / 2 + FLAME_RADIUS / 2
    : Math.hypot(dx, dy) <= FLAME_RADIUS + s.radius;
  if (hit) sim.damage(o, scorchDamage, scorchOwner);
}

/** The biggest building is 3x3: look this far past the fire's radius to catch buildings by their edge. */
const REACH_PAD = 1.5 * TILE;

function scorch(sim: Simulation, f: FlameFlight): void {
  scorchSim = sim;
  scorchX = f.x;
  scorchY = f.y;
  scorchOwner = f.owner;
  scorchDamage = f.damage;
  sim.spatial.forEachInRadius(f.x, f.y, FLAME_RADIUS + REACH_PAD, scorchOne);
}

/** Flies every fireball one tick and burns every fire. */
export function flameSystem(sim: Simulation): void {
  if (sim.flame.dense.length === 0) return;
  // Rain wears fires down faster, in proportion to how wet the air is (integer percent from the weather, so it stays deterministic).
  const burnRate = 1 + (sim.weatherNow().wetness * (FLAME_RAIN_BURN_FACTOR - 1)) / 100;
  // Copy: landing and burning out edit the list being walked.
  for (const e of [...sim.flame.dense]) {
    const f = sim.flameFlights[e];
    if (!f) {
      sim.destroyEntity(e);
      continue;
    }
    if (f.left > 0) {
      let nx = f.x + f.vx;
      let ny = f.y + f.vy;
      if (sim.shieldList.length > 0) {
        const shield = shieldBlock(sim, f.owner, f.x, f.y, nx, ny);
        if (shield >= 0) {
          shieldAbsorb(sim, shield, FLAME_SHIELD_DAMAGE, f.owner, shieldHit.x, shieldHit.y);
          if (++f.deflections > FLAME_MAX_DEFLECTIONS) {
            // Turned back too often: it drops where it is.
            f.left = 1;
            nx = f.x;
            ny = f.y;
          } else {
            // Turned back the way it came, on a shorter hop; it stays where it was this tick.
            f.vx = -f.vx;
            f.vy = -f.vy;
            f.span = Math.max(1, Math.round((f.span - f.left) * FLAME_DEFLECT_KEEP));
            f.left = f.span + 1;
            nx = f.x;
            ny = f.y;
          }
        }
      }
      f.x = nx;
      f.y = ny;
      if (--f.left > 0) {
        sim.pos.f.x[e] = Math.round(f.x);
        sim.pos.f.y[e] = Math.round(f.y);
        sim.pos.markChanged(e);
        sim.flame.f.arc[e] = Math.min(255, Math.round((255 * (f.span - f.left)) / f.span));
        sim.flame.markChanged(e);
        continue;
      }
      // Landed.
      f.x = Math.min(sim.widthSub - 1, Math.max(0, f.x));
      f.y = Math.min(sim.heightSub - 1, Math.max(0, f.y));
      f.vx = f.vy = 0;
      sim.pos.f.x[e] = Math.round(f.x);
      sim.pos.f.y[e] = Math.round(f.y);
      sim.pos.markChanged(e);
      sim.flame.f.state[e] = 1;
      sim.flame.f.arc[e] = 255;
      sim.flame.markChanged(e);
      sim.emit(SimEvent.FlameLand, e, e);
      continue;
    }
    f.burn -= burnRate;
    if (f.burn <= 0) {
      sim.destroyEntity(e);
      continue;
    }
    if ((sim.tick + e) % FLAME_BURN_INTERVAL === 0) scorch(sim, f);
    const life = Math.ceil((f.burn * FLAME_LIFE_STEPS) / f.total);
    if (life !== sim.flame.f.life[e]) {
      sim.flame.f.life[e] = life;
      sim.flame.markChanged(e);
    }
  }
}
