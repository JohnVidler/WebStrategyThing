import { SimEvent } from './events';
import { RAIL_BREAK_PERMILLE, RAIL_CHARGE_TICKS, RAIL_FALLOFF_PERMILLE, RAIL_PIERCE, TILE } from './rules';
import { elevationOf, rangeBonus } from './shell';
import { shieldAbsorb, shieldBlock, shieldHit } from './shield';
import type { Simulation } from './simulation';

/*
 * Railgun. A heavy line weapon with a long charge-up. When it has a target in range it spends its energy and starts to charge
 * (a `Charge` component on the carrier shows it to everyone, so a glint and an aim line are visible for the whole charge, and a program can
 * ask `charging(h)`). Charging for RAIL_CHARGE_TICKS, it then fires an instant line along the aim that pierces up to RAIL_PIERCE enemy units
 * and buildings, each after the first taking RAIL_FALLOFF_PERMILLE of the damage of the one before. Rock stops the line; an enemy shield
 * takes whatever damage is left and stops it. Own and allied units are not hurt.
 *
 * The charge is easy to spoil, which is what keeps the weapon fair: it is lost (energy and all, and the weapon rests its cooldown) when the
 * carrier takes RAIL_BREAK_PERMILLE of its hit points in damage, is stunned, loses the module (broken or switched off), or loses its target
 * (dead, or out of range), or when a vehicle starts to move. For a tick after firing the Charge component stays (`state` 1, `len` the length of
 * the line) so clients can draw the beam.
 */

export interface RailCharge {
  /** Ticks of charge left. */
  left: number;
  /** The carrier's hit points when the charge began, to tell how much damage it has taken since. */
  hp0: number;
  /** Handle of the target being aimed at. */
  target: number;
  /** Which of the carrier's weapons is charging (an index into `stats.weapons`). */
  slot: number;
}

const TAU = Math.PI * 2;
const quantise = (a: number): number => Math.round((((a % TAU) + TAU) % TAU) / TAU * 256) & 255;

/** Begins charging at `t` if it is not charging already and the energy is there. */
export function startRail(sim: Simulation, e: number, t: number, use: number, slot: number): void {
  if (sim.rails.has(e) || !sim.spend(e, use)) return;
  sim.rails.set(e, { left: RAIL_CHARGE_TICKS, hp0: sim.health.f.hp[e], target: sim.world.handle(t), slot });
  const heading = quantise(Math.atan2(sim.pos.f.y[t] - sim.pos.f.y[e], sim.pos.f.x[t] - sim.pos.f.x[e]));
  if (sim.charge.has(e)) {
    sim.charge.f.heading[e] = heading;
    sim.charge.f.pct[e] = 0;
    sim.charge.f.state[e] = 0;
    sim.charge.markChanged(e);
  } else {
    sim.charge.add(e, { heading, pct: 0, state: 0, len: 0 });
  }
}

/** Loses the charge: the energy is gone, and the weapon rests as if it had fired. */
function spoil(sim: Simulation, e: number, slot: number): void {
  sim.rails.delete(e);
  if (sim.charge.has(e)) sim.charge.remove(e);
  const w = sim.stats(e).weapons[slot];
  const store = sim.weaponStores[slot];
  if (w && store.has(e)) store.f.cooldown[e] = w.cooldown;
}

export function railSystem(sim: Simulation): void {
  // A line that was drawn last tick is finished with.
  while (sim.railLines.length > 0) {
    const e = sim.railLines.pop()!;
    if (sim.charge.has(e) && sim.charge.f.state[e] === 1) sim.charge.remove(e);
  }
  if (sim.rails.size === 0) return;
  for (const [e, r] of sim.rails) {
    const s = sim.stats(e);
    const w = s.weapons[r.slot];
    const t = sim.world.resolve(r.target);
    const hp = sim.health.f.hp[e];
    const stunned = (sim.stunUntil[e] ?? 0) > sim.tick;
    if (
      !w || w.kind !== 'rail' || hp <= 0 || stunned || t < 0 || !sim.health.has(t) || sim.health.f.hp[t] <= 0 ||
      ((r.hp0 - hp) * 1000) >= (s.hp * RAIL_BREAK_PERMILLE) ||
      (sim.motion.has(e) && sim.motion.f.moving[e] === 1) ||
      Math.hypot(sim.pos.f.x[t] - sim.pos.f.x[e], sim.pos.f.y[t] - sim.pos.f.y[e]) > w.range + rangeBonus(sim, e, t, w.kind) + (sim.unit.has(t) ? (sim.stats(t).footprint * TILE) / 2 : 0)
    ) {
      spoil(sim, e, r.slot);
      continue;
    }
    r.left--;
    const heading = quantise(Math.atan2(sim.pos.f.y[t] - sim.pos.f.y[e], sim.pos.f.x[t] - sim.pos.f.x[e]));
    sim.charge.f.heading[e] = heading;
    sim.charge.f.pct[e] = Math.min(255, Math.round(((RAIL_CHARGE_TICKS - r.left) * 255) / RAIL_CHARGE_TICKS));
    sim.charge.markChanged(e);
    if (r.left <= 0) fire(sim, e, t, w.range, w.damage, w.cooldown, r.slot);
  }
}

const candidates: { along: number; o: number }[] = [];

function fire(sim: Simulation, e: number, t: number, range: number, damage: number, cooldown: number, slot: number): void {
  sim.rails.delete(e);
  const owner = sim.unit.f.owner[e];
  const x0 = sim.pos.f.x[e];
  const y0 = sim.pos.f.y[e];
  const angle = Math.atan2(sim.pos.f.y[t] - y0, sim.pos.f.x[t] - x0);
  const cos = Math.cos(angle), sin = Math.sin(angle);
  // Rock ends the line.
  const up = elevationOf(sim, e);
  let len = range;
  for (let d = TILE / 4; d <= range; d += TILE / 4) {
    if (sim.terrain.heightAt(sim.tileX(x0 + cos * d), sim.tileY(y0 + sin * d)) > up) {
      len = d - TILE / 4;
      break;
    }
  }
  let x1 = x0 + cos * len, y1 = y0 + sin * len;
  // An enemy shield across the line takes what is left of the hit and stops it.
  const shield = sim.shieldList.length > 0 ? shieldBlock(sim, owner, x0, y0, x1, y1) : -1;
  let shieldDamage = 0;
  if (shield >= 0) {
    x1 = shieldHit.x;
    y1 = shieldHit.y;
    len = Math.hypot(x1 - x0, y1 - y0);
  }
  // Everything of the enemy's the line passes through, nearest first.
  candidates.length = 0;
  sim.spatial.forEachInRadius((x0 + x1) / 2, (y0 + y1) / 2, len / 2 + 2 * TILE, (o) => {
    if (o === e || !sim.unit.has(o) || sim.allied(sim.unit.f.owner[o], owner) || sim.health.f.hp[o] <= 0 || sim.isSite(o)) return;
    const s = sim.stats(o);
    const reach = s.structure ? (s.footprint * TILE) / 2 : Math.max(0.3 * TILE, s.radius);
    const dx = sim.pos.f.x[o] - x0, dy = sim.pos.f.y[o] - y0;
    const along = dx * cos + dy * sin;
    if (along < 0 || along > len + reach) return;
    if (Math.abs(-dx * sin + dy * cos) <= reach) candidates.push({ along, o });
  });
  candidates.sort((a, b) => a.along - b.along || a.o - b.o);
  let dealt = damage;
  let first = e;
  let hits = 0;
  for (const c of candidates) {
    if (hits >= RAIL_PIERCE) break;
    if (hits === 0) first = c.o;
    sim.damage(c.o, Math.max(1, Math.round(dealt)), owner, sim.weaponStores[slot].f.aim[e]);
    dealt = (dealt * RAIL_FALLOFF_PERMILLE) / 1000;
    hits++;
  }
  if (shield >= 0) {
    shieldDamage = Math.max(1, Math.round(dealt));
    shieldAbsorb(sim, shield, shieldDamage, owner, x1, y1);
  }
  sim.weaponStores[slot].f.cooldown[e] = cooldown;
  sim.charge.f.heading[e] = quantise(angle);
  sim.charge.f.pct[e] = 255;
  sim.charge.f.state[e] = 1;
  sim.charge.f.len[e] = Math.min(255, Math.round(len / (TILE / 10)));
  sim.charge.markChanged(e);
  sim.railLines.push(e);
  sim.emit(SimEvent.RailShot, e, first);
}
