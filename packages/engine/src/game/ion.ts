import { SimEvent } from './events';
import { ION_IMMUNITY_TICKS, ION_SHIELD_DRAIN, ION_TICKS, SHIELD_ENERGY_PER_DAMAGE } from './rules';
import { shieldAbsorb, shieldBlock, shieldHit } from './shield';
import type { Simulation } from './simulation';

/*
 * Ion gun. A hit-scan bolt that does no damage: it holds one working module of the target down (as if switched off, but a program cannot
 * switch it back) for ION_TICKS. It spends a lot of energy per shot on purpose, and a target that has just been ion-struck is immune for
 * ION_IMMUNITY_TICKS after the effect ends, so a few ion guns cannot keep a unit helpless for ever.
 *
 * Which module: the kind the shooter's `config.aim` names if the target has a working one (a motor, a weapon, a shield...), otherwise a
 * random working one. Passive parts (frame, armour, batteries, memory) are never chosen. A shot at a target that is already held down or
 * immune is wasted. An enemy shield across the line stops the bolt and loses ION_SHIELD_DRAIN energy. The held-down bit lives in
 * `Modules.ion` (replicated, so clients derive the same stats); the timers are in side tables, and `Simulation.ionActive` lists the targets
 * to check each tick, so nothing sweeps every unit.
 */

/** Fires the bolt of `e` at `t`. The caller has paid the energy. */
export function ionStrike(sim: Simulation, e: number, t: number): void {
  sim.emit(SimEvent.IonHit, e, t);
  const owner = sim.unit.f.owner[e];
  if (sim.shieldList.length > 0) {
    const shield = shieldBlock(sim, owner, sim.pos.f.x[e], sim.pos.f.y[e], sim.pos.f.x[t], sim.pos.f.y[t]);
    if (shield >= 0) {
      shieldAbsorb(sim, shield, ION_SHIELD_DRAIN / SHIELD_ENERGY_PER_DAMAGE, owner, shieldHit.x, shieldHit.y);
      return;
    }
  }
  if (!sim.unit.has(t) || sim.isSite(t) || sim.ionActive.has(t) || sim.tick < (sim.ionImmune[t] ?? 0)) return;
  const bp = sim.blueprintOf(t);
  if (!bp) return;
  const slot = bp.hit.slot;
  const unavailable = (sim.modules.f.off[t] | sim.modules.f.broken[t]) >>> 0;
  const aim = sim.firing.f.aim[e];
  let pick = -1;
  for (const only of aim > 0 ? [aim, 0] : [0]) {
    let n = 0;
    for (let i = 0; i < slot.length; i++) if (slot[i] > 0 && slot[i] < 255 && !((unavailable >>> i) & 1) && (only === 0 || slot[i] === only)) n++;
    if (n === 0) continue;
    let k = n > 1 ? sim.rng.int(n) : 0;
    for (let i = 0; i < slot.length; i++) {
      if (slot[i] > 0 && slot[i] < 255 && !((unavailable >>> i) & 1) && (only === 0 || slot[i] === only) && k-- === 0) {
        pick = i;
        break;
      }
    }
    break;
  }
  if (pick < 0) return;
  sim.modules.f.ion[t] = (1 << pick) >>> 0;
  sim.ionBit[t] = pick;
  sim.ionUntil[t] = sim.tick + ION_TICKS;
  sim.ionActive.add(t);
  sim.modulesChanged(t);
}

/** Dev tool: holds a random working module of `t` down now, whatever its immunity. Returns false if it has none to hold. */
export function ionHold(sim: Simulation, t: number): boolean {
  if (!sim.unit.has(t) || sim.ionActive.has(t)) return false;
  const bp = sim.blueprintOf(t);
  if (!bp) return false;
  const unavailable = (sim.modules.f.off[t] | sim.modules.f.broken[t]) >>> 0;
  const open: number[] = [];
  for (let i = 0; i < bp.hit.slot.length; i++) if (bp.hit.slot[i] > 0 && bp.hit.slot[i] < 255 && !((unavailable >>> i) & 1)) open.push(i);
  if (open.length === 0) return false;
  const pick = open[sim.rng.int(open.length)];
  sim.modules.f.ion[t] = (1 << pick) >>> 0;
  sim.ionBit[t] = pick;
  sim.ionUntil[t] = sim.tick + ION_TICKS;
  sim.ionActive.add(t);
  sim.modulesChanged(t);
  return true;
}

/** Lets modules held down by an ion bolt go again when their time is up, and starts the immunity. */
export function ionSystem(sim: Simulation): void {
  if (sim.ionActive.size === 0) return;
  for (const t of sim.ionActive) {
    if (sim.tick < (sim.ionUntil[t] ?? 0)) continue;
    sim.ionActive.delete(t);
    sim.modules.f.ion[t] = 0;
    sim.ionImmune[t] = sim.tick + ION_IMMUNITY_TICKS;
    sim.modulesChanged(t);
  }
}
